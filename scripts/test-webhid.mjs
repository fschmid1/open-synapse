import assert from 'node:assert/strict';
import * as P from '../src/webhid/protocol.js';
import { lookup, capsOf, MODELS } from '../src/webhid/models.js';

// CRC and layout of a DPI write
const dpi = P.setDpi(0x1f, 800, 800);
assert.equal(dpi[88], dpi.subarray(2, 88).reduce((a, b) => a ^ b, 0));
assert.deepEqual([...dpi.slice(5, 8)], [0x07, 0x04, 0x05]);
assert.deepEqual([...dpi.slice(8, 13)], [0x01, 0x03, 0x20, 0x03, 0x20]);

// DPI stages layout
const stages = P.setDpiStages(0x1f, 2, [[400, 400], [1600, 1600]]);
assert.deepEqual([...stages.slice(8, 11)], [0x01, 0x02, 0x02]);
assert.deepEqual([...stages.slice(11, 18)], [0x01, 0x01, 0x90, 0x01, 0x90, 0, 0]);
assert.equal(stages[18], 0x02);

// Byte-for-byte captures from the official app (transaction id aside)
assert.deepEqual([...P.setHyperPolling(0x1f, 2000).slice(5, 10)], [0x02, 0x00, 0x40, 0x01, 0x04]);
assert.deepEqual([...P.setDongleLed(0x1f, 3).slice(5, 9)], [0x01, 0x07, 0x10, 0x03]);
assert.deepEqual([...P.setTrackingMode(0x1f).slice(5, 11)], [0x03, 0x0b, 0x03, 0x00, 0x04, 0x01]);
assert.deepEqual([...P.setLiftoff(0x1f, 2).slice(5, 12)], [0x04, 0x0b, 0x0b, 0x00, 0x04, 0x01, 0x02]);
assert.deepEqual([...P.setDynamicSensitivity(0x1f, true).slice(5, 10)], [0x02, 0x0b, 0x10, 0x01, 0x01]);
assert.deepEqual([...P.setSensitivityCurve(0x1f, 0).slice(5, 10)], [0x02, 0x0b, 0x11, 0x01, 0x00]);
assert.deepEqual([...P.setButtonMouse(0x1f, 5, 0, 1).slice(5, 14)], [0x0a, 0x02, 0x0c, 0x01, 0x05, 0x00, 0x01, 0x01, 0x01]);
assert.deepEqual([...P.setButtonMouse(0x1f, 5, 1, 5).slice(8, 14)], [0x01, 0x05, 0x01, 0x01, 0x01, 0x05]);
assert.deepEqual([...P.setButtonKey(0x1f, 5, 0, 0, 0x04).slice(5, 18)], [0x0a, 0x02, 0x0c, 0x01, 0x05, 0x00, 0x02, 0x02, 0x00, 0x04, 0, 0, 0]);

// Default custom curve packets
const curve = P.curvePoints(0x1f, P.rampCurve(1.4975));
assert.equal(curve.length, 32);
assert.deepEqual([...curve[0].slice(5, 13)], [0x25, 0x0b, 0x13, 0x01, 0x03, 0xfa, 0x00, 0x08]);
assert.deepEqual([...curve[31].slice(8, 13)], [0x01, 0x03, 0xfa, 0xf8, 0x02]);
const first = new DataView(curve[0].buffer, curve[0].byteOffset + 13, 4).getFloat32(0, true);
assert.ok(Math.abs(first - 1.0025) < 0.0005, String(first));

// Static effect layout
const fx = P.extEffect(0x1f, 0x04, 'static', [[1, 2, 3]], 2, 1);
assert.equal(fx[5], 0x09);
assert.deepEqual([...fx.slice(8, 17)], [0x01, 0x04, 0x01, 0, 0, 0x01, 1, 2, 3]);

// Device database
const viperModel = lookup(0x00c1);
assert.equal(viperModel.name, 'Viper V3 Pro');
assert.equal(viperModel.kind, 'mouse');
const caps = capsOf(viperModel);
assert.equal(caps.max_dpi, 35000);
assert.equal(caps.dongle_led, true);
assert.deepEqual(caps.polling, [125, 500, 1000, 2000, 4000, 8000]);
const unknown = lookup(0x1abc, 'Razer Mystery');
assert.equal(unknown.kind, 'other');
assert.equal(unknown.name, 'Mystery');
assert.equal(MODELS.filter((m) => m.pid === 0x02e3)[0].name, 'Reclusa X Mini 65%');

console.log('webhid tests passed');

// A fake HID stack exercises the browser backend without hardware.
const mouseCalls = [];
const headsetOutputs = [];
const granted = [];

class FakeDevice {
  constructor(pid, name) {
    this.vendorId = 0x1532;
    this.productId = pid;
    this.productName = name;
    this.collections = [{ usagePage: 0xff00 }];
    this.opened = false;
    this.pending = new Uint8Array(90);
  }
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  async forget() {
    const i = granted.indexOf(this);
    if (i < 0) throw Object.assign(new Error("not granted"), { name: "NotFoundError" });
    granted.splice(i, 1);
  }
  async sendFeatureReport(id, data) {
    assert.equal(id, 0);
    const req = new Uint8Array(data);
    if (this.productId === 0x0555) throw new Error("headset has no feature reports");
    mouseCalls.push(req);
    const res = new Uint8Array(90);
    res.set(req);
    res[0] = P.STATUS_OK;
    respond(this.productId, req, res);
    this.pending = res;
  }
  async receiveFeatureReport(id) {
    assert.equal(id, 0);
    return new DataView(this.pending.buffer.slice(0));
  }
  async sendReport(id, data) {
    headsetOutputs.push([id, new Uint8Array(data)]);
  }
}

function respond(pid, req, res) {
  const cls = req[6];
  const cmd = req[7];
  const a = (i, v) => { res[8 + i] = v; };
  switch (`${cls}:${cmd}`) {
    case "0:129": a(0, 1); a(1, 4); break; // firmware v1.04
    case "0:130": for (const [i, c] of [..."TESTSERIAL"].entries()) a(i, c.charCodeAt(0)); break;
    case "0:191": a(0, 2); a(1, 1); break; // link awake
    case "4:133": a(1, 0x03); a(2, 0x20); a(3, 0x03); a(4, 0x20); break; // 800 dpi
    case "4:134": // stages: active 1, two stages
      a(1, 1); a(2, 2);
      a(3, 1); a(4, 0x01); a(5, 0x90); a(6, 0x01); a(7, 0x90);
      a(10, 2); a(11, 0x06); a(12, 0x40); a(13, 0x06); a(14, 0x40);
      break;
    case "0:192": a(1, 0x08); break; // 1000 Hz
    case "7:128": a(1, 200); break; // 78%
    case "7:132": a(1, 1); break; // charging
    case "7:131": a(0, 1); a(1, 44); break; // 300 s
    case "7:129": a(0, 38); break; // 15%
    case "11:133": a(2, 1); break; // medium lift-off
    case "7:144": a(0, 2); break; // dongle LED battery
    case "11:144": a(1, 1); break; // dynamic sensitivity on
    case "11:145": a(1, 0); break; // classic curve
    case "2:140": a(1, req[9]); a(3, 1); a(5, req[9]); break; // buttons echo
    default: break;
  }
}

const mouse = new FakeDevice(0x00c1, "Razer Viper V3 Pro");
const keyboard = new FakeDevice(0x0287, "Razer BlackWidow V4");
const headset = new FakeDevice(0x0555, "Razer BlackShark V2 Pro");
granted.push(mouse, keyboard, headset);
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    hid: {
      getDevices: async () => [...granted],
      requestDevice: async () => [...granted],
      addEventListener() {},
      removeEventListener() {},
    },
  },
});

const backend = await import("../src/webhid/backend.js");
assert.equal(backend.supported, true);

const listed = await backend.invoke("list_devices");
assert.deepEqual(listed.map((d) => d.pid).sort((a, b) => a - b), [0x00c1, 0x0287, 0x0555]);
const viper = listed.find((d) => d.pid === 0x00c1);
assert.equal(viper.name, "Viper V3 Pro");
assert.equal(viper.online, true);
assert.equal(viper.firmware, "v1.04");
assert.equal(viper.serial, "TESTSERIAL");
assert.equal(viper.caps.max_dpi, 35000);
assert.equal(listed.find((d) => d.pid === 0x0555).online, true);

const st = await backend.invoke("device_state", { key: "1532:00c1" });
assert.deepEqual(st.dpi, [800, 800]);
assert.deepEqual(st.stages, [1, [[400, 400], [1600, 1600]]]);
assert.equal(st.polling, 1000);
assert.equal(st.battery, 78);
assert.equal(st.charging, true);
assert.equal(st.idle, 300);
assert.equal(st.low_battery, 14);
assert.equal(st.liftoff, 1);
assert.equal(st.dongle_led, 2);
assert.equal(st.dynamic_sensitivity, true);
assert.equal(st.curve, 0);
assert.deepEqual(st.buttons.map((b) => b.button), [3, 4, 5]);

const last = () => mouseCalls[mouseCalls.length - 1];

await backend.invoke("set_dpi", { key: "1532:00c1", x: 1600, y: 1600 });
assert.deepEqual([...last().slice(5, 13)], [0x07, 0x04, 0x05, 0x01, 0x06, 0x40, 0x06, 0x40]);

await backend.invoke("set_dpi_stages", { key: "1532:00c1", active: 2, stages: [[400, 400], [3200, 3200]] });
assert.deepEqual([...last().slice(8, 11)], [0x01, 0x02, 0x02]);
assert.deepEqual([...last().slice(11, 14)], [0x01, 0x01, 0x90]);

await backend.invoke("set_polling", { key: "1532:00c1", hz: 2000 });
assert.deepEqual([...last().slice(5, 10)], [0x02, 0x00, 0x40, 0x01, 0x04]);

await backend.invoke("set_lighting", {
  key: "1532:0287",
  zone: 5,
  lighting: { effect: "static", colors: [[1, 2, 3]], speed: 2, direction: 1 },
  brightness: 80,
});
assert.deepEqual([...last().slice(5, 8)], [0x03, 0x0f, 0x04]);
assert.deepEqual([...last().slice(8, 11)], [0x01, 0x05, 0xcc]);
assert.equal(mouseCalls.at(-2)[7], 0x02);
assert.deepEqual([...mouseCalls.at(-2).slice(8, 17)], [0x01, 0x05, 0x01, 0, 0, 0x01, 1, 2, 3]);

await backend.invoke("set_liftoff", { key: "1532:00c1", level: 2 });
assert.deepEqual([...last().slice(7, 12)], [0x0b, 0x00, 0x04, 0x01, 0x02]);

await backend.invoke("set_dongle_led", { key: "1532:00c1", mode: 3 });
assert.deepEqual([...last().slice(6, 9)], [0x07, 0x10, 0x03]);

await backend.invoke("set_power", { key: "1532:00c1", idle: 600, lowBattery: 20 });
assert.deepEqual([...last().slice(6, 9)], [0x07, 0x01, 0x33]);

await backend.invoke("set_button", {
  key: "1532:00c1",
  map: { kind: "key", button: 5, modifiers: 2, usage: 0x04 },
});
assert.deepEqual([...last().slice(8, 15)], [0x01, 0x05, 0x00, 0x02, 0x02, 0x02, 0x04]);

const beforeCurve = mouseCalls.length;
await backend.invoke("set_dynamic_sensitivity", { key: "1532:00c1", on: true, curve: 3, customMax: 1.5 });
const curveCalls = mouseCalls.slice(beforeCurve).filter((r) => r[6] === 0x0b && r[7] === 0x13);
assert.equal(curveCalls.length, 32);
assert.deepEqual([...curveCalls[0].slice(5, 13)], [0x25, 0x0b, 0x13, 0x01, 0x03, 0xfa, 0x00, 0x08]);

const diagnostic = await backend.diag();
assert.equal(diagnostic.supported, true);
assert.equal(diagnostic.devices.length, 3);
const diagMouse = diagnostic.devices.find((d) => d.productId === "0xc1");
assert.equal(diagMouse.reportIds[0], 0);
assert.ok(diagMouse.probe.some((p) => p.status === 2));

await backend.invoke("set_headset_eq", { key: "1532:0555", preset: "movie" });
assert.equal(headsetOutputs.length, 1);
assert.equal(headsetOutputs[0][0], 2);
assert.equal(headsetOutputs[0][1].length, 63);
assert.equal(headsetOutputs[0][1][12], 0x09);

// Disconnecting closes the device and revokes the browser permission.
await backend.invoke("disconnect_device", { key: "1532:0287" });
assert.equal(keyboard.opened, false);
assert.equal((await backend.invoke("list_devices")).some((d) => d.pid === 0x0287), false);
assert.equal(granted.length, 2);

await backend.invoke("disconnect_all_devices");
assert.equal((await backend.invoke("list_devices")).length, 0);
assert.deepEqual(granted, []);

console.log("webhid backend tests passed");
