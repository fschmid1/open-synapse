// Razer USB HID control protocol, ported from src-tauri/src/razer/protocol.rs.
//
// Every command is a 90-byte feature report (sent with report id 0):
//   [0] status, [1] transaction id, [5] data size, [6] class,
//   [7] command id (bit 7 = read), [8..88] arguments, [88] XOR checksum.

export const REPORT_LEN = 90;

export const STATUS_BUSY = 0x01;
export const STATUS_OK = 0x02;
export const STATUS_FAIL = 0x03;
export const STATUS_TIMEOUT = 0x04;
export const STATUS_UNSUPPORTED = 0x05;

export const VARSTORE = 0x01;

export function crc(r) {
  let acc = 0;
  for (let i = 2; i < 88; i++) acc ^= r[i];
  return acc;
}

function be16(v) {
  return [(v >> 8) & 0xff, v & 0xff];
}

export function report(tx, cls, id, size, args = []) {
  const r = new Uint8Array(REPORT_LEN);
  r[1] = tx;
  r[5] = size;
  r[6] = cls;
  r[7] = id;
  const n = Math.min(args.length, 80);
  r.set(args.slice(0, n), 8);
  r[88] = crc(r);
  return r;
}

export const args = (r) => r.subarray(8, 88);
export const status = (r) => r[0];

export const getFirmware = (tx) => report(tx, 0x00, 0x81, 0x02, []);
export const getSerial = (tx) => report(tx, 0x00, 0x82, 0x16, []);

export function setDpi(tx, x, y) {
  return report(tx, 0x04, 0x05, 0x07, [VARSTORE, ...be16(x), ...be16(y), 0, 0]);
}

export const getDpi = (tx) => report(tx, 0x04, 0x85, 0x07, [VARSTORE]);

export function setDpiStages(tx, active, stages) {
  const list = stages.slice(0, 5);
  const a = [VARSTORE, Math.min(Math.max(active, 1), Math.max(list.length, 1)), list.length];
  list.forEach(([x, y], i) => {
    a.push(i + 1, ...be16(x), ...be16(y), 0, 0);
  });
  return report(tx, 0x04, 0x06, 0x26, a);
}

export const getDpiStages = (tx) => report(tx, 0x04, 0x86, 0x26, [VARSTORE]);

export function pollingCode(hz) {
  return hz >= 1000 ? 0x01 : hz >= 500 ? 0x02 : 0x08;
}

export const setPolling = (tx, hz) => report(tx, 0x00, 0x05, 0x01, [pollingCode(hz)]);
export const getPolling = (tx) => report(tx, 0x00, 0x85, 0x01, []);

export function hyperCode(hz) {
  if (hz >= 8000) return 0x01;
  if (hz >= 4000) return 0x02;
  if (hz >= 2000) return 0x04;
  if (hz >= 1000) return 0x08;
  if (hz >= 500) return 0x10;
  if (hz >= 250) return 0x20;
  return 0x40;
}

export const setHyperPolling = (tx, hz) => report(tx, 0x00, 0x40, 0x02, [0x01, hyperCode(hz)]);
export const getHyperPolling = (tx) => report(tx, 0x00, 0xc0, 0x02, [0x01]);

// Receiver link status: args[1] is 1 while the paired mouse is awake.
export const getLink = (tx) => report(tx, 0x00, 0xbf, 0x50, []);

export const getBattery = (tx) => report(tx, 0x07, 0x80, 0x02, []);
export const getCharging = (tx) => report(tx, 0x07, 0x84, 0x02, []);

export function setIdleTime(tx, secs) {
  const v = Math.min(Math.max(secs, 60), 900);
  return report(tx, 0x07, 0x03, 0x02, be16(v));
}

export const getIdleTime = (tx) => report(tx, 0x07, 0x83, 0x02, []);

export function setLowBattery(tx, percent) {
  const raw = Math.floor((Math.min(Math.max(percent, 5), 100) * 255) / 100);
  return report(tx, 0x07, 0x01, 0x01, [raw]);
}

export const getLowBattery = (tx) => report(tx, 0x07, 0x81, 0x01, []);
export const getLiftoff = (tx) => report(tx, 0x0b, 0x85, 0x05, [VARSTORE]);

export const setTrackingMode = (tx) => report(tx, 0x0b, 0x03, 0x03, [0x00, 0x04, 0x01]);

export function setLiftoff(tx, level) {
  return report(tx, 0x0b, 0x0b, 0x04, [0x00, 0x04, 0x01, Math.min(level, 2)]);
}

export function setDongleLed(tx, mode) {
  return report(tx, 0x07, 0x10, 0x01, [Math.min(Math.max(mode, 1), 3)]);
}

export const getDongleLed = (tx) => report(tx, 0x07, 0x90, 0x01, []);

export const setDynamicSensitivity = (tx, on) => report(tx, 0x0b, 0x10, 0x02, [0x01, on ? 1 : 0]);
export const getDynamicSensitivity = (tx) => report(tx, 0x0b, 0x90, 0x02, [0x01]);

export function setSensitivityCurve(tx, curve) {
  return report(tx, 0x0b, 0x11, 0x02, [0x01, Math.min(curve, 3)]);
}

export const getSensitivityCurve = (tx) => report(tx, 0x0b, 0x91, 0x02, [0x01]);

export const CURVE_POINTS = 250;

const f32le = (() => {
  const dv = new DataView(new ArrayBuffer(4));
  return (v) => {
    dv.setFloat32(0, v, true);
    return [dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3)];
  };
})();

export function curvePoints(tx, points) {
  const n = Math.min(points.length, CURVE_POINTS);
  const out = [];
  for (let offset = 0; offset < n; offset += 8) {
    const chunk = points.slice(offset, Math.min(offset + 8, n));
    const a = [0x01, 0x03, CURVE_POINTS, offset, chunk.length];
    for (const p of chunk) a.push(...f32le(p));
    out.push(report(tx, 0x0b, 0x13, 0x25, a));
  }
  return out;
}

export function rampCurve(max) {
  const top = Math.min(Math.max(max, 1), 3);
  const out = [];
  for (let i = 0; i < CURVE_POINTS; i++) {
    const t = Math.min((i + 0.5) / 100, 1);
    out.push(1 + (top - 1) * t);
  }
  return out;
}

// BlackShark V2 Pro EQ preset: a 64-byte output report (report id 2).
export function headsetEqReport(preset) {
  const r = new Uint8Array(64);
  r.set([0x02, 0x80, 0x09, 0x00, 0x00, 0x50, 0x41, 0x08, 0x00, 0x04, 0x93, 0x00, 0x01, preset], 0);
  return r;
}

export const setButtonMouse = (tx, button, layer, fn) =>
  report(tx, 0x02, 0x0c, 0x0a, [0x01, button, Math.min(layer, 1), 0x01, 0x01, fn]);

export const setButtonKey = (tx, button, layer, modifiers, usage) =>
  report(tx, 0x02, 0x0c, 0x0a, [0x01, button, Math.min(layer, 1), 0x02, 0x02, modifiers, usage]);

export const getButton = (tx, button, layer) =>
  report(tx, 0x02, 0x8c, 0x0a, [0x01, button, Math.min(layer, 1)]);

// Keyboard key mapping. Same function ids as mouse buttons: 0 off, 1 mouse
// button, 2 keyboard key. `key` is a Razer AT-101 key id, not a HID usage.
export const KEYMAP_PROFILE = 1;
export const KEYMAP_LAYER = 0;

export const getKey = (tx, key, layer = KEYMAP_LAYER) =>
  report(tx, 0x02, 0x8d, 0x50, [KEYMAP_PROFILE, key, layer]);

export const setKey = (tx, key, fn, data, layer = KEYMAP_LAYER) =>
  report(tx, 0x02, 0x0d, 0x50, [KEYMAP_PROFILE, key, layer, fn, data.length, ...data]);

export const EFFECTS = ["off", "static", "breathing", "spectrum", "wave", "reactive", "starlight"];

export function extEffect(tx, led, fx, colors, speed, dir) {
  const c0 = colors[0] || [0, 255, 160];
  const a = [VARSTORE, led];
  let size;
  switch (fx) {
    case "off":
      a.push(0x00);
      size = 0x06;
      break;
    case "static":
      a.push(0x01, 0, 0, 0x01, ...c0);
      size = 0x09;
      break;
    case "breathing":
      if (colors.length === 0) {
        a.push(0x02, 0x00);
        size = 0x06;
      } else if (colors.length === 1) {
        a.push(0x02, 0x01, 0, 0x01, ...c0);
        size = 0x09;
      } else {
        a.push(0x02, 0x02, 0, 0x02, ...c0, ...colors[1]);
        size = 0x0c;
      }
      break;
    case "spectrum":
      a.push(0x03);
      size = 0x06;
      break;
    case "wave": {
      const s = 0x10 + (Math.min(Math.max(speed, 1), 4) - 1) * 0x18;
      a.push(0x04, dir === 2 ? 0x02 : 0x01, s);
      size = 0x06;
      break;
    }
    case "reactive":
      a.push(0x05, 0, Math.min(Math.max(speed, 1), 4), 0x01, ...c0);
      size = 0x09;
      break;
    case "starlight":
      a.push(0x07, 0, Math.min(Math.max(speed, 1), 3), 0x01, ...c0);
      size = 0x09;
      break;
    default:
      throw new Error("unknown effect");
  }
  return report(tx, 0x0f, 0x02, size, a);
}

export function stdEffect(tx, fx, colors, speed, dir) {
  const c0 = colors[0] || [0, 255, 160];
  let size;
  let a;
  switch (fx) {
    case "off":
      size = 1;
      a = [0x00];
      break;
    case "wave":
      size = 2;
      a = [0x01, dir === 2 ? 0x02 : 0x01];
      break;
    case "reactive":
      size = 5;
      a = [0x02, Math.min(Math.max(speed, 1), 4), ...c0];
      break;
    case "breathing":
      if (colors.length === 0) {
        size = 1;
        a = [0x03, 0x03];
      } else if (colors.length === 1) {
        size = 8;
        a = [0x03, 0x01, ...c0];
      } else {
        size = 8;
        a = [0x03, 0x02, ...c0, ...colors[1]];
      }
      break;
    case "spectrum":
      size = 1;
      a = [0x04];
      break;
    case "static":
    case "starlight":
      size = 4;
      a = [0x06, ...c0];
      break;
    default:
      throw new Error("unknown effect");
  }
  return report(tx, 0x03, 0x0a, size, a);
}

export const extBrightness = (tx, led, value) => report(tx, 0x0f, 0x04, 0x03, [VARSTORE, led, value]);
export const stdBrightness = (tx, led, value) => report(tx, 0x03, 0x03, 0x03, [VARSTORE, led, value]);
