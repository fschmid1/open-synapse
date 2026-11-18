// Razer device database, ported from src-tauri/src/razer/models.rs.

export const RAZER_VID = 0x1532;

export const DPI = 1 << 0;
export const STAGES = 1 << 1;
export const POLL = 1 << 2;
export const HYPER = 1 << 3;
export const BATT = 1 << 4;
export const IDLE = 1 << 5;
export const LIGHT = 1 << 6;
export const EXT = 1 << 7;
export const WIRELESS = 1 << 8;
export const RECEIVER = 1 << 9;
export const BRIGHT = 1 << 10;
export const UNVERIFIED = 1 << 11;
export const LIFTOFF = 1 << 12;
export const DONGLE_LED = 1 << 13;
export const DYNSENS = 1 << 14;
export const REMAP = 1 << 15;
export const HEADSET_EQ = 1 << 16;

export const LED_ALL = 0x00;
export const LED_SCROLL = 0x01;
export const LED_LOGO = 0x04;
export const LED_BACKLIGHT = 0x05;

const M_WIRED = DPI | STAGES | POLL;
const M_LIGHT = LIGHT | EXT | BRIGHT;
const M_WIRELESS = M_WIRED | BATT | IDLE | WIRELESS;
const M_STD_LIGHT = LIGHT | BRIGHT;
const KB = LIGHT | EXT | BRIGHT;

const LOGO = [LED_LOGO];
const LOGO_SCROLL = [LED_LOGO, LED_SCROLL];
const BACKLIGHT = [LED_BACKLIGHT];
const ALL = [LED_ALL];
const NONE = [];

const m = (pid, name, kind, tx, max_dpi, flags, zones) => ({ pid, name, kind, tx, max_dpi, flags, zones });

export const MODELS = [
  // mice
  m(0x0043, "DeathAdder Chroma", "mouse", 0xff, 10000, M_WIRED | M_STD_LIGHT, NONE),
  m(0x005c, "DeathAdder Elite", "mouse", 0xff, 16000, M_WIRED | M_STD_LIGHT, NONE),
  m(0x0064, "Basilisk", "mouse", 0xff, 16000, M_WIRED | M_STD_LIGHT, NONE),
  m(0x0067, "Naga Trinity", "mouse", 0xff, 16000, M_WIRED | M_LIGHT, LOGO_SCROLL),
  m(0x0078, "Viper", "mouse", 0x1f, 16000, M_WIRED | M_LIGHT, LOGO),
  m(0x007a, "Viper Ultimate (Wired)", "mouse", 0x1f, 20000, M_WIRELESS | M_LIGHT, LOGO),
  m(0x007b, "Viper Ultimate", "mouse", 0x1f, 20000, M_WIRELESS | RECEIVER | M_LIGHT, LOGO),
  m(0x007c, "DeathAdder V2 Pro (Wired)", "mouse", 0x3f, 20000, M_WIRELESS | M_LIGHT, LOGO),
  m(0x007d, "DeathAdder V2 Pro", "mouse", 0x3f, 20000, M_WIRELESS | RECEIVER | M_LIGHT, LOGO),
  m(0x0083, "Basilisk X HyperSpeed", "mouse", 0x1f, 16000, M_WIRELESS | RECEIVER, NONE),
  m(0x0084, "DeathAdder V2", "mouse", 0x3f, 20000, M_WIRED | M_LIGHT, LOGO_SCROLL),
  m(0x0085, "Basilisk V2", "mouse", 0x1f, 20000, M_WIRED | M_LIGHT, LOGO_SCROLL),
  m(0x0086, "Basilisk Ultimate (Wired)", "mouse", 0x1f, 20000, M_WIRELESS | M_LIGHT, LOGO_SCROLL),
  m(0x0088, "Basilisk Ultimate", "mouse", 0x1f, 20000, M_WIRELESS | RECEIVER | M_LIGHT, LOGO_SCROLL),
  m(0x008a, "Viper Mini", "mouse", 0x1f, 8500, M_WIRED | M_LIGHT, LOGO),
  m(0x008c, "DeathAdder V2 Mini", "mouse", 0x3f, 8500, M_WIRED | M_LIGHT, LOGO),
  m(0x008f, "Naga Pro (Wired)", "mouse", 0x1f, 20000, M_WIRELESS | M_LIGHT, LOGO_SCROLL),
  m(0x0090, "Naga Pro", "mouse", 0x1f, 20000, M_WIRELESS | RECEIVER | M_LIGHT, LOGO_SCROLL),
  m(0x0091, "Viper 8KHz", "mouse", 0x1f, 20000, M_WIRED | HYPER | M_LIGHT, LOGO),
  m(0x0094, "Orochi V2", "mouse", 0x1f, 18000, M_WIRELESS | RECEIVER, NONE),
  m(0x0096, "Naga X", "mouse", 0x1f, 18000, M_WIRED | M_LIGHT, LOGO_SCROLL),
  m(0x0098, "DeathAdder Essential", "mouse", 0x1f, 6400, M_WIRED | M_LIGHT, LOGO),
  m(0x0099, "Basilisk V3", "mouse", 0x1f, 26000, M_WIRED | M_LIGHT, LOGO_SCROLL),
  m(0x00a1, "DeathAdder V2 Lite", "mouse", 0x1f, 8500, M_WIRED | M_LIGHT, LOGO),
  m(0x00a3, "Cobra", "mouse", 0x1f, 8500, M_WIRED | M_LIGHT, LOGO),
  m(0x00a5, "Viper V2 Pro (Wired)", "mouse", 0x1f, 30000, M_WIRELESS, NONE),
  m(0x00a6, "Viper V2 Pro", "mouse", 0x1f, 30000, M_WIRELESS | RECEIVER, NONE),
  m(0x00aa, "Basilisk V3 Pro (Wired)", "mouse", 0x1f, 30000, M_WIRELESS | M_LIGHT, LOGO_SCROLL),
  m(0x00ab, "Basilisk V3 Pro", "mouse", 0x1f, 30000, M_WIRELESS | RECEIVER | M_LIGHT, LOGO_SCROLL),
  m(0x00af, "Cobra Pro (Wired)", "mouse", 0x1f, 30000, M_WIRELESS | M_LIGHT, LOGO_SCROLL),
  m(0x00b0, "Cobra Pro", "mouse", 0x1f, 30000, M_WIRELESS | RECEIVER | M_LIGHT, LOGO_SCROLL),
  m(0x00b2, "DeathAdder V3", "mouse", 0x1f, 30000, M_WIRED | HYPER, NONE),
  m(0x00b6, "DeathAdder V3 Pro (Wired)", "mouse", 0x1f, 30000, M_WIRELESS, NONE),
  m(0x00b7, "DeathAdder V3 Pro", "mouse", 0x1f, 30000, M_WIRELESS | RECEIVER, NONE),
  m(0x00c0, "Viper V3 Pro (Wired)", "mouse", 0x1f, 35000, M_WIRELESS | HYPER | LIFTOFF | DYNSENS | REMAP, NONE),
  m(0x00c1, "Viper V3 Pro", "mouse", 0x1f, 35000, M_WIRELESS | RECEIVER | HYPER | LIFTOFF | DYNSENS | DONGLE_LED | REMAP, NONE),
  // headsets
  m(0x0555, "BlackShark V2 Pro", "headset", 0x00, 0, WIRELESS | RECEIVER | HEADSET_EQ, NONE),
  // keyboards
  m(0x0203, "BlackWidow Chroma", "keyboard", 0xff, 0, M_STD_LIGHT, BACKLIGHT),
  m(0x021e, "Ornata Chroma", "keyboard", 0xff, 0, M_STD_LIGHT, BACKLIGHT),
  m(0x0221, "BlackWidow Chroma V2", "keyboard", 0xff, 0, M_STD_LIGHT, BACKLIGHT),
  m(0x0226, "Huntsman Elite", "keyboard", 0xff, 0, KB, BACKLIGHT),
  m(0x0227, "Huntsman", "keyboard", 0xff, 0, KB, BACKLIGHT),
  m(0x0228, "BlackWidow Elite", "keyboard", 0xff, 0, KB, BACKLIGHT),
  m(0x022a, "Cynosa Chroma", "keyboard", 0xff, 0, KB, BACKLIGHT),
  m(0x0241, "BlackWidow (2019)", "keyboard", 0xff, 0, KB, BACKLIGHT),
  m(0x0243, "Huntsman Tournament Edition", "keyboard", 0x1f, 0, KB, BACKLIGHT),
  m(0x024e, "BlackWidow V3", "keyboard", 0x1f, 0, KB, BACKLIGHT),
  m(0x0257, "Huntsman Mini", "keyboard", 0x1f, 0, KB, BACKLIGHT),
  m(0x025a, "BlackWidow V3 Pro (Wired)", "keyboard", 0x1f, 0, KB | BATT, BACKLIGHT),
  m(0x025c, "BlackWidow V3 Pro", "keyboard", 0x1f, 0, KB | BATT | WIRELESS | RECEIVER, BACKLIGHT),
  m(0x025d, "Ornata V2", "keyboard", 0x1f, 0, KB, BACKLIGHT),
  m(0x025e, "Cynosa V2", "keyboard", 0x1f, 0, KB, BACKLIGHT),
  m(0x0266, "Huntsman V2 Analog", "keyboard", 0x1f, 0, KB, BACKLIGHT),
  m(0x026c, "Huntsman V2", "keyboard", 0x1f, 0, KB, BACKLIGHT),
  m(0x0282, "Huntsman Mini Analog", "keyboard", 0x1f, 0, KB, BACKLIGHT),
  m(0x0287, "BlackWidow V4", "keyboard", 0x1f, 0, KB, BACKLIGHT),
  m(0x028d, "BlackWidow V4 Pro", "keyboard", 0x1f, 0, KB, BACKLIGHT),
  m(0x0293, "BlackWidow V4 X", "keyboard", 0x1f, 0, KB, BACKLIGHT),
  m(0x02e3, "Reclusa X Mini 65%", "keyboard", 0x1f, 0, KB, BACKLIGHT),
  // keypads
  m(0x0207, "Orbweaver Chroma", "keypad", 0xff, 0, M_STD_LIGHT, BACKLIGHT),
  m(0x022b, "Tartarus V2", "keypad", 0xff, 0, KB, BACKLIGHT),
  m(0x0244, "Tartarus Pro", "keypad", 0xff, 0, KB, BACKLIGHT),
  // mousepads
  m(0x0c00, "Firefly", "mousepad", 0xff, 0, M_STD_LIGHT, ALL),
  m(0x0c01, "Goliathus Chroma", "mousepad", 0x1f, 0, KB, ALL),
  m(0x0c02, "Goliathus Extended Chroma", "mousepad", 0x1f, 0, KB, ALL),
  m(0x0c04, "Firefly V2", "mousepad", 0x1f, 0, KB, ALL),
  m(0x0c05, "Strider Chroma", "mousepad", 0x1f, 0, KB, ALL),
  // docks & stands
  m(0x007e, "Mouse Dock Chroma", "dock", 0x1f, 0, KB, ALL),
  m(0x00a4, "Mouse Dock Pro", "dock", 0x1f, 0, KB, ALL),
  m(0x0f08, "Base Station Chroma", "dock", 0x1f, 0, KB, ALL),
  m(0x0f20, "Base Station V2 Chroma", "dock", 0x1f, 0, KB, ALL),
];

export function lookup(pid, product) {
  const known = MODELS.find((model) => model.pid === pid);
  if (known) return known;
  const guessed = product && product.trim() ? product.trim().replace(/^Razer /, "") : `Razer ${pid.toString(16).toUpperCase().padStart(4, "0")}`;
  let kind = "other";
  let flags = UNVERIFIED;
  let zones = NONE;
  let dpi = 0;
  if (pid <= 0x01ff) {
    kind = "mouse";
    flags = M_WIRED | M_LIGHT | UNVERIFIED;
    zones = LOGO;
    dpi = 26000;
  } else if (pid <= 0x02ff) {
    kind = "keyboard";
    flags = KB | UNVERIFIED;
    zones = BACKLIGHT;
  } else if (pid >= 0x0500 && pid <= 0x05ff) {
    kind = "headset";
  } else if (pid >= 0x0c00 && pid <= 0x0cff) {
    kind = "mousepad";
    flags = KB | UNVERIFIED;
    zones = ALL;
  } else if (pid >= 0x0f00 && pid <= 0x0fff) {
    kind = "dock";
    flags = KB | UNVERIFIED;
    zones = ALL;
  }
  return { pid, name: guessed, kind, tx: 0x1f, max_dpi: dpi, flags, zones };
}

export function capsOf(model) {
  const has = (flag) => (model.flags & flag) !== 0;
  let polling = [];
  if (has(HYPER)) polling = [125, 500, 1000, 2000, 4000, 8000];
  else if (has(POLL)) polling = [125, 500, 1000];

  let effects = [];
  if (has(LIGHT)) effects = has(EXT)
    ? ["static", "breathing", "spectrum", "wave", "reactive", "starlight", "off"]
    : ["static", "breathing", "spectrum", "wave", "reactive", "off"];

  let zones = [];
  if (has(LIGHT) && has(EXT)) {
    zones = model.zones.map((id) => ({
      id,
      name: id === LED_LOGO ? "logo" : id === LED_SCROLL ? "scroll" : id === LED_BACKLIGHT ? "backlight" : "all",
    }));
  } else if (has(LIGHT)) {
    zones = [{ id: LED_BACKLIGHT, name: "all" }];
  }

  return {
    dpi: has(DPI),
    stages: has(STAGES),
    max_dpi: model.max_dpi,
    polling,
    battery: has(BATT),
    idle: has(IDLE),
    liftoff: has(LIFTOFF),
    dongle_led: has(DONGLE_LED),
    dynamic_sensitivity: has(DYNSENS),
    remap: has(REMAP),
    eq: has(HEADSET_EQ),
    lighting: has(LIGHT),
    brightness: has(BRIGHT),
    effects,
    zones,
  };
}
