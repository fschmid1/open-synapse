// WebHID backend for Open Synapse.
//
// Mirrors the Tauri commands in src-tauri/src/main.rs and the device manager in
// src-tauri/src/razer/mod.rs, but talks to devices through navigator.hid.
// Requires Chrome/Edge (or another Chromium browser with WebHID) and a secure
// context: https:// or http://localhost.

import * as P from "./protocol.js";
import {
  RAZER_VID,
  HEADSET_EQ,
  HYPER,
  BRIGHT,
  EXT,
  LIFTOFF,
  DONGLE_LED,
  DYNSENS,
  REMAP,
  RECEIVER,
  WIRELESS,
  lookup,
  capsOf,
} from "./models.js";

export const supported = typeof navigator !== "undefined" && !!navigator.hid;
export const WEBHID = supported;

const REMAPPABLE = [0x03, 0x04, 0x05];
const MOUSE_FUNCS = [1, 2, 3, 4, 5, 9, 10];

/** @type {Map<number, {device: HIDDevice, tx: number, firmware: string|null, serial: string|null, asleepAtProbe: boolean}>} */
const links = new Map();
/** @type {Map<number, HIDDevice>} */
const vendor = new Map();
/** @type {Map<number, number>} */
const probeFailures = new Map();
/** @type {Map<number, string[]>} */
const probeErrors = new Map();

class HidError extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const msg = (e) => (e && e.message ? e.message : String(e));

// Only one feature-report exchange may run per device at a time.
const queues = new WeakMap();
function locked(device, fn) {
  const prev = queues.get(device) || Promise.resolve();
  const run = prev.then(fn, fn);
  queues.set(device, run.catch(() => {}));
  return run;
}

const keyOf = (pid) => `1532:${pid.toString(16).padStart(4, "0")}`;

function pidOf(key) {
  const pid = /^1532:([0-9a-f]{4})$/i.exec(String(key));
  if (!pid) throw new Error(`bad device key ${key}`);
  return parseInt(pid[1], 16);
}

function bytesOf(value) {
  if (value instanceof DataView) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value);
}

// ------------------------------------------------------------------ transport

async function ensureOpen(device) {
  if (device.opened) return;
  await device.open();
}

/**
 * Sends a 90-byte feature report and reads the answer, retrying while busy.
 * WebHID sends feature reports at report id 0, which is what the Razer
 * protocol expects.
 */
function transfer(device, req, reportId = 0) {
  return locked(device, () => rawTransfer(device, req, reportId));
}

async function rawTransfer(device, req, reportId) {
  try {
    await device.sendFeatureReport(reportId, req);
  } catch (e) {
    throw new HidError(`HID error${e && e.name ? ` (${e.name})` : ""}: ${msg(e)}`);
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(attempt === 0 ? 4 : 12);
    let body;
    try {
      body = bytesOf(await device.receiveFeatureReport(reportId));
    } catch (e) {
      if (attempt === 7) throw new HidError(`HID error: ${msg(e)}`);
      continue;
    }
    // Some backends keep the report id, some strip it.
    if (body.length === P.REPORT_LEN + 1) body = body.subarray(1);
    const out = new Uint8Array(P.REPORT_LEN);
    out.set(body.subarray(0, P.REPORT_LEN));

    switch (out[0]) {
      case P.STATUS_OK:
        if (out[6] !== req[6] || out[7] !== req[7]) throw new HidError("unexpected response");
        return out;
      case P.STATUS_BUSY:
      case 0x00:
        break;
      case P.STATUS_FAIL:
        throw new HidError("command failed");
      case P.STATUS_TIMEOUT:
        throw new HidError("device did not answer (asleep or out of range?)");
      case P.STATUS_UNSUPPORTED:
        throw new HidError("command not supported by this device");
      default:
        throw new HidError("unexpected response");
    }
  }
  throw new HidError("device busy");
}

// ------------------------------------------------------------------ discovery

function groupDevices(devices) {
  const groups = new Map();
  for (const device of devices) {
    if (device.vendorId !== RAZER_VID) continue;
    const pid = device.productId;
    let group = groups.get(pid);
    if (!group) {
      group = { pid, product: device.productName || "", devices: [], vendor: null };
      groups.set(pid, group);
    }
    group.devices.push(device);
    if (!group.vendor && device.collections && device.collections.some((c) => c.usagePage === 0xff00)) {
      group.vendor = device;
    }
  }
  return groups;
}

async function grantedDevices() {
  if (!supported) return [];
  try {
    return await navigator.hid.getDevices();
  } catch {
    return [];
  }
}

const firmwareOf = (r) => `v${P.args(r)[0]}.${String(P.args(r)[1]).padStart(2, "0")}`;

function serialOf(r) {
  const a = P.args(r).subarray(0, 22);
  let s = "";
  for (const b of a) {
    if (b === 0) break;
    if (b >= 0x21 && b <= 0x7e) s += String.fromCharCode(b);
  }
  return s || null;
}

/**
 * Chromium rejects report id 0 when the interface uses numbered reports, and
 * some keyboards expose the 90-byte control report under a vendor report id.
 * Try the unnumbered report first, then every feature report id the device
 * advertises.
 */
function reportIdsOf(device) {
  const ids = new Set();
  for (const collection of device.collections || []) {
    for (const id of collection.featureReports || []) ids.add(id);
  }
  const list = [...ids].sort((a, b) => a - b);
  if (!list.includes(0)) list.unshift(0);
  return list;
}

async function isAsleep(link) {
  try {
    const r = await transfer(link.device, P.getLink(link.tx), link.reportId);
    const a = P.args(r);
    return a[0] === 0x02 && a[1] === 0x00;
  } catch {
    return false;
  }
}

async function probe(model, candidates) {
  const txs = [model.tx];
  for (const tx of [0x1f, 0x3f, 0xff, 0x9f]) if (!txs.includes(tx)) txs.push(tx);
  const failures = [];

  for (const device of candidates) {
    try {
      await ensureOpen(device);
    } catch (e) {
      failures.push(`open: ${msg(e)}`);
      continue;
    }
    for (const reportId of reportIdsOf(device)) {
      for (const tx of txs) {
        try {
          const fw = await transfer(device, P.getFirmware(tx), reportId);
          let serial = null;
          try {
            serial = serialOf(await transfer(device, P.getSerial(tx), reportId));
          } catch {
            /* optional */
          }
          const link = { device, tx, reportId, firmware: firmwareOf(fw), serial, asleepAtProbe: false };
          if ((model.flags & RECEIVER) !== 0) link.asleepAtProbe = await isAsleep(link);
          return link;
        } catch (e) {
          failures.push(`id ${reportId}, tx ${tx.toString(16)}: ${msg(e)}`);
        }
      }
    }
  }
  if (failures.length) {
    const unique = [...new Set(failures)];
    probeErrors.set(model.pid, unique.slice(0, 8));
  }
  return null;
}

const KIND_ORDER = { mouse: 0, keyboard: 1, keypad: 2, mousepad: 3, headset: 4, dock: 5, other: 6 };

let refreshing = null;

export function refresh() {
  if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; });
  return refreshing;
}

async function doRefresh() {
  const groups = groupDevices(await grantedDevices());

  vendor.clear();
  for (const [pid, group] of groups) if (group.vendor) vendor.set(pid, group.vendor);

  for (const pid of [...links.keys()]) if (!groups.has(pid)) links.delete(pid);
  for (const pid of [...probeErrors.keys()]) if (!groups.has(pid)) probeErrors.delete(pid);
  for (const [pid, link] of [...links]) {
    if (link.asleepAtProbe && !(await isAsleep(link))) links.delete(pid);
  }

  const out = [];
  for (const [pid, group] of groups) {
    const model = lookup(pid, group.product);

    if ((model.flags & HEADSET_EQ) !== 0) {
      out.push({
        key: keyOf(pid),
        pid,
        name: model.name,
        kind: model.kind,
        wireless: true,
        receiver: true,
        verified: true,
        online: vendor.has(pid),
        asleep: false,
        firmware: null,
        serial: null,
        caps: capsOf(model),
      });
      continue;
    }

    if (!links.has(pid)) {
      const retryAt = probeFailures.get(pid) || 0;
      if (Date.now() >= retryAt) {
        const link = await probe(model, group.devices);
        if (link) {
          links.set(pid, link);
          probeFailures.delete(pid);
          probeErrors.delete(pid);
        } else {
          probeFailures.set(pid, Date.now() + 5000);
        }
      }
    }

    const link = links.get(pid);
    const asleep = (model.flags & RECEIVER) !== 0 && !!link && (await isAsleep(link));
    out.push({
      key: keyOf(pid),
      pid,
      name: model.name,
      kind: model.kind,
      wireless: (model.flags & WIRELESS) !== 0,
      receiver: (model.flags & RECEIVER) !== 0,
      verified: true,
      online: !!link,
      asleep,
      firmware: link?.firmware ?? null,
      serial: link?.serial ?? null,
      error: link ? null : (probeErrors.get(pid) || []).join(" | "),
      caps: capsOf(model),
    });
  }

  out.sort((a, b) => (KIND_ORDER[a.kind] ?? 6) - (KIND_ORDER[b.kind] ?? 6) || a.name.localeCompare(b.name));
  return out;
}

/** Opens the browser chooser. Must be called from a click/tap. */
export async function requestDevices() {
  if (!supported) throw new Error("WebHID is not available in this browser");
  let devices;
  try {
    devices = await navigator.hid.requestDevice({ filters: [{ vendorId: RAZER_VID }] });
  } catch (e) {
    if (e && e.name === "NotFoundError") return 0;
    throw e;
  }
  for (const device of devices) {
    try {
      await ensureOpen(device);
    } catch {
      /* probed later */
    }
  }
  probeFailures.clear();
  return devices.length;
}

if (supported) {
  navigator.hid.addEventListener("disconnect", (e) => {
    for (const [pid, link] of links) {
      if (link.device === e.device || link.device.productId === e.device.productId) links.delete(pid);
    }
  });
  navigator.hid.addEventListener("connect", (e) => {
    links.delete(e.device.productId);
    probeFailures.delete(e.device.productId);
  });
}

// ------------------------------------------------------------------ commands

function needLink(key) {
  const pid = pidOf(key);
  const link = links.get(pid);
  if (!link) throw new Error("device is not connected or does not answer");
  return { pid, link };
}

async function run(key, build) {
  const { link } = needLink(key);
  return transfer(link.device, build(link.tx), link.reportId);
}

function emptyState() {
  return {
    dpi: null,
    stages: null,
    polling: null,
    battery: null,
    charging: null,
    idle: null,
    low_battery: null,
    liftoff: null,
    dongle_led: null,
    dynamic_sensitivity: null,
    curve: null,
    buttons: [],
  };
}

export async function deviceState(key) {
  const pid = pidOf(key);
  if ((lookup(pid).flags & HEADSET_EQ) !== 0) return emptyState();

  const { link } = needLink(key);
  const model = lookup(pid);
  const caps = capsOf(model);
  const q = async (req) => {
    try {
      return await transfer(link.device, req, link.reportId);
    } catch {
      return null;
    }
  };
  const s = emptyState();

  if (caps.dpi) {
    const r = await q(P.getDpi(link.tx));
    if (r) {
      const a = P.args(r);
      s.dpi = [(a[1] << 8) | a[2], (a[3] << 8) | a[4]];
    }
  }
  if (caps.stages) {
    const r = await q(P.getDpiStages(link.tx));
    if (r) {
      const a = P.args(r);
      const count = Math.min(a[2], 5);
      const list = [];
      for (let i = 0; i < count; i++) {
        const o = 3 + i * 7;
        const x = (a[o + 1] << 8) | a[o + 2];
        const y = (a[o + 3] << 8) | a[o + 4];
        if (x > 0) list.push([x, y]);
      }
      if (list.length) s.stages = [a[1], list];
    }
  }
  if (caps.polling.length > 3) {
    const r = await q(P.getHyperPolling(link.tx));
    if (r) {
      s.polling = { 0x01: 8000, 0x02: 4000, 0x04: 2000, 0x10: 500, 0x20: 250, 0x40: 125 }[P.args(r)[1]] || 1000;
    }
  }
  if (s.polling == null && caps.polling.length) {
    const r = await q(P.getPolling(link.tx));
    if (r) s.polling = { 0x02: 500, 0x08: 125 }[P.args(r)[0]] || 1000;
  }
  if (caps.battery) {
    const b = await q(P.getBattery(link.tx));
    if (b) s.battery = Math.trunc((P.args(b)[1] * 100) / 255);
    const c = await q(P.getCharging(link.tx));
    if (c) s.charging = P.args(c)[1] === 1;
  }
  if (caps.idle) {
    const i = await q(P.getIdleTime(link.tx));
    if (i) s.idle = (P.args(i)[0] << 8) | P.args(i)[1];
    const l = await q(P.getLowBattery(link.tx));
    if (l) s.low_battery = Math.trunc((P.args(l)[0] * 100) / 255);
  }
  if (caps.liftoff) {
    const r = await q(P.getLiftoff(link.tx));
    if (r) s.liftoff = P.args(r)[2];
  }
  if (caps.dongle_led) {
    const r = await q(P.getDongleLed(link.tx));
    if (r) {
      const mode = P.args(r)[0];
      if (mode >= 1 && mode <= 3) s.dongle_led = mode;
    }
  }
  if (caps.dynamic_sensitivity) {
    const d = await q(P.getDynamicSensitivity(link.tx));
    if (d) s.dynamic_sensitivity = P.args(d)[1] === 1;
    const c = await q(P.getSensitivityCurve(link.tx));
    if (c && P.args(c)[1] <= 3) s.curve = P.args(c)[1];
  }
  if (caps.remap) {
    for (const button of REMAPPABLE) {
      const r = await q(P.getButton(link.tx, button, 0));
      if (!r) continue;
      const a = P.args(r);
      if (a[1] !== button) continue;
      if (a[3] === 0x01) s.buttons.push({ kind: "mouse", button, function: a[5] });
      else if (a[3] === 0x02) s.buttons.push({ kind: "key", button, modifiers: a[5], usage: a[6] });
    }
  }
  return s;
}

export async function setDpi(key, x, y) {
  await run(key, (tx) => P.setDpi(tx, Math.max(x, 100), Math.max(y, 100)));
}

export async function setDpiStages(key, active, stages) {
  await run(key, (tx) => P.setDpiStages(tx, active, stages));
}

export async function setPolling(key, hz) {
  const { pid, link } = needLink(key);
  const model = lookup(pid);
  const req = (model.flags & HYPER) !== 0 ? P.setHyperPolling(link.tx, hz) : P.setPolling(link.tx, hz);
  await transfer(link.device, req, link.reportId);
}

export async function setLighting(key, zone, lighting, brightness) {
  const { pid, link } = needLink(key);
  const model = lookup(pid);
  const fx = lighting.effect;
  if (!P.EFFECTS.includes(fx)) throw new Error("unknown effect");
  const ext = (model.flags & EXT) !== 0;
  const req = ext
    ? P.extEffect(link.tx, zone, fx, lighting.colors || [], lighting.speed, lighting.direction)
    : P.stdEffect(link.tx, fx, lighting.colors || [], lighting.speed, lighting.direction);
  await transfer(link.device, req, link.reportId);

  if ((model.flags & BRIGHT) !== 0) {
    const value = Math.trunc((Math.min(brightness, 100) * 255) / 100);
    const br = ext ? P.extBrightness(link.tx, zone, value) : P.stdBrightness(link.tx, zone, value);
    // Brightness is optional on some firmwares, do not fail the whole call.
    try {
      await transfer(link.device, br, link.reportId);
    } catch {
      /* ignore */
    }
  }
}

export async function setLiftoff(key, level) {
  const { pid, link } = needLink(key);
  if ((lookup(pid).flags & LIFTOFF) === 0) throw new Error("lift-off is not supported on this device");
  await transfer(link.device, P.setTrackingMode(link.tx), link.reportId);
  await transfer(link.device, P.setLiftoff(link.tx, level), link.reportId);
}

export async function setDongleLed(key, mode) {
  const { pid, link } = needLink(key);
  if ((lookup(pid).flags & DONGLE_LED) === 0) throw new Error("dongle LED is not supported on this device");
  await transfer(link.device, P.setDongleLed(link.tx, mode), link.reportId);
}

export async function setDynamicSensitivity(key, on, curve, customMax) {
  const { pid, link } = needLink(key);
  if ((lookup(pid).flags & DYNSENS) === 0) throw new Error("dynamic sensitivity is not supported on this device");
  await transfer(link.device, P.setDynamicSensitivity(link.tx, on), link.reportId);
  if (!on) return;
  await transfer(link.device, P.setSensitivityCurve(link.tx, curve), link.reportId);
  if (curve === 3) {
    for (const req of P.curvePoints(link.tx, P.rampCurve(customMax))) {
      await transfer(link.device, req, link.reportId);
    }
  }
}

export async function setButton(key, map) {
  const { pid, link } = needLink(key);
  if ((lookup(pid).flags & REMAP) === 0) throw new Error("button remapping is not supported on this device");
  if (!REMAPPABLE.includes(map.button)) throw new Error("only the middle and side buttons can be remapped");

  let req;
  if (map.kind === "mouse") {
    if (!MOUSE_FUNCS.includes(map.function)) throw new Error("unknown mouse function");
    req = P.setButtonMouse(link.tx, map.button, 0, map.function);
  } else if (map.kind === "key") {
    if (map.usage < 0x04 || map.usage > 0xe7) throw new Error("unknown key");
    req = P.setButtonKey(link.tx, map.button, 0, map.modifiers & 0x0f, map.usage);
  } else {
    throw new Error("unknown button map");
  }
  await transfer(link.device, req, link.reportId);
}

export async function setPower(key, idle, lowBattery) {
  const { link } = needLink(key);
  if (idle != null) await transfer(link.device, P.setIdleTime(link.tx, idle), link.reportId);
  if (lowBattery != null) await transfer(link.device, P.setLowBattery(link.tx, lowBattery), link.reportId);
}

export async function setHeadsetEq(key, preset) {
  const pid = pidOf(key);
  if ((lookup(pid).flags & HEADSET_EQ) === 0) throw new Error("EQ presets are not supported on this device");
  const code = { game: 0x07, movie: 0x09, music: 0x08 }[preset];
  if (code == null) throw new Error("unknown preset");
  const device = vendor.get(pid);
  if (!device) throw new Error("headset is not connected");
  await ensureOpen(device);
  const report = P.headsetEqReport(code);
  await device.sendReport(report[0], report.subarray(1));
}

/**
 * Connection report for the browser console (`await osynHidDiag()`).
 * Read-only: it only asks for firmware versions.
 */
export async function diag(onlyPid) {
  const result = {
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    supported,
    links: [...links].map(([pid, link]) => ({
      key: keyOf(pid),
      tx: `0x${link.tx.toString(16)}`,
      reportId: link.reportId,
      firmware: link.firmware,
    })),
    probeErrors: Object.fromEntries([...probeErrors].map(([pid, list]) => [keyOf(pid), list])),
    devices: [],
  };

  for (const device of await grantedDevices()) {
    if (onlyPid != null && device.productId !== onlyPid) continue;
    const item = {
      key: keyOf(device.productId),
      name: device.productName,
      vendorId: `0x${device.vendorId.toString(16)}`,
      productId: `0x${device.productId.toString(16)}`,
      opened: device.opened,
      reportIds: reportIdsOf(device),
      collections: (device.collections || []).map((c) => ({
        usagePage: `0x${(c.usagePage || 0).toString(16)}`,
        usage: `0x${(c.usage || 0).toString(16)}`,
        inputReports: [...(c.inputReports || [])],
        outputReports: [...(c.outputReports || [])],
        featureReports: [...(c.featureReports || [])],
      })),
      probe: [],
    };
    try {
      await ensureOpen(device);
      item.opened = true;
    } catch (e) {
      item.openError = `${e.name || "Error"}: ${msg(e)}`;
    }
    if (item.opened && (lookup(device.productId).flags & HEADSET_EQ) !== 0) {
      item.note = "headset: control uses output report 2, not feature reports";
    } else if (item.opened) {
      for (const reportId of reportIdsOf(device)) {
        for (const tx of [0x1f, 0x3f, 0xff, 0x9f]) {
          try {
            const r = await transfer(device, P.getFirmware(tx), reportId);
            item.probe.push({ reportId, tx: `0x${tx.toString(16)}`, status: r[0], args: [...P.args(r).slice(0, 4)] });
          } catch (e) {
            item.probe.push({ reportId, tx: `0x${tx.toString(16)}`, error: `${e.name || "Error"}: ${msg(e)}` });
          }
        }
      }
    }
    result.devices.push(item);
  }
  return result;
}

// ------------------------------------------------------------------ dispatch

/** Tauri-compatible command surface used by app.js. */
export async function invoke(cmd, a = {}) {
  switch (cmd) {
    case "list_devices":
      return refresh();
    case "device_state":
      return deviceState(a.key);
    case "set_dpi":
      return setDpi(a.key, a.x, a.y);
    case "set_dpi_stages":
      return setDpiStages(a.key, a.active, a.stages);
    case "set_polling":
      return setPolling(a.key, a.hz);
    case "set_lighting":
      return setLighting(a.key, a.zone, a.lighting, a.brightness);
    case "set_liftoff":
      return setLiftoff(a.key, a.level);
    case "set_dongle_led":
      return setDongleLed(a.key, a.mode);
    case "set_dynamic_sensitivity":
      return setDynamicSensitivity(a.key, a.on, a.curve, a.customMax);
    case "set_button":
      return setButton(a.key, a.map);
    case "set_headset_eq":
      return setHeadsetEq(a.key, a.preset);
    case "set_power":
      return setPower(a.key, a.idle, a.lowBattery);
    default:
      throw new Error(`unknown command ${cmd}`);
  }
}
