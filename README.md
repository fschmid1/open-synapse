<p align="center">
  <img src="src/logo.svg" width="112" alt="Open Synapse">
</p>

<h1 align="center">Open Synapse</h1>

<p align="center">
  A free, open-source configurator for Razer peripherals.<br>
  Local settings. No account, cloud or telemetry.<br>
  <a href="https://github.com/1apok/open-synapse/releases/latest">Download</a> · <a href="https://github.com/1apok/open-synapse/issues">Report a device or bug</a>
</p>

**Try it:** download the latest release for **Windows x64**, **Linux x64** or **macOS Apple Silicon**. Demo mode lets you explore the UI without a device. Close official Razer Synapse before configuring hardware.

**Early release:** Viper V3 Pro is the main hardware-tested mouse. The model database is not a promise that every feature works on every listed device. This is an independent MIT-licensed project, not affiliated with Razer.

---

## Why

The official software requires an account login, runs background services and weighs hundreds of megabytes.
Open Synapse is one small (~10 MB) Rust app that opens instantly and simply configures your device.

## Features

- **Performance** — up to 5 DPI stages, separate X/Y, polling rate 125–1000 Hz and HyperPolling up to 8000 Hz.
- **Lighting** — static color, breathing (1 or 2 colors), spectrum, wave, reactive, starlight; brightness, speed, direction, individual zones (logo, wheel, etc.) with a live preview.
- **Power** — charge and charging status, time to sleep, low-battery threshold, dongle indicator mode.
- **Buttons** — wheel and side buttons to any mouse function or key (with Ctrl/Shift/Alt/Win). Left and right are not remappable so a preset never leaves you without a click.
- **Calibration** — lift-off distance (low/medium/high), dynamic sensitivity with "classic", "natural", "jump" and custom curves.
- **Sleeping mouse** — if a wireless mouse falls asleep, the app notices and does not mistake the dongle for the mouse.
- **Portable presets** — a preset is not tied to a model: apply one mouse's settings to another, export to an `.osp` file or share an `OSP1.…` code in chat. Unsupported parameters are skipped, DPI is clamped to the sensor maximum.
- **Auto-apply** — the device's preset is restored on every connection.
- **Hot-plug** — devices appear and disappear on their own.
- **7 themes**: Graphite, Neon, Orange, Ultraviolet, Terminal, Paper and a faithful **Windows 95** with beveled buttons.
- **Custom device photo** — drag an image onto the preview (for example from the manufacturer's site); it is stored locally only.
- **Settings from device memory** — DPI stages, polling rate and sleep time saved to the mouse by another program are read on first connection.
- **English interface**, fonts Unbounded, Inter, JetBrains Mono and Playfair Display.
- **Demo mode** — look around without hardware.
- **Web version** — the same page opens in Chrome or Edge and controls devices through WebHID.

## Supported devices

The database has 70+ models: mice (DeathAdder, Viper, Basilisk, Naga, Cobra, Orochi), keyboards (BlackWidow, Huntsman, Ornata, Cynosa), Tartarus/Orbweaver keypads, Firefly/Goliathus/Strider mousepads, docks and stands. The full list is in [`src-tauri/src/razer/models.rs`](src-tauri/src/razer/models.rs).

A device that is not in the database is still detected: capabilities are guessed from its Product ID, and the interface marks it "Unverified".

> EQ presets "Game", "Movie" and "Music" are available for the BlackShark V2 Pro (PID `0555`). Other headsets are not supported yet; this is not a full replacement for their settings in Synapse.
> Before launching, close Razer Synapse if it is installed: two configurators interfere with each other.

## Installation

Download the installer from the [Releases](../../releases) page. Windows, Linux and macOS builds are produced automatically when a `v*` tag is published.

On Linux, to access devices without root, add a udev rule:

```bash
echo 'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1532", MODE="0666"' | sudo tee /etc/udev/rules.d/99-open-synapse.rules
```

## Building from source

You need [Rust](https://rustup.rs), [Node.js](https://nodejs.org) 20+ and, on Windows, Visual Studio Build Tools with the C++ component.

```bash
npm install
npm run dev      # start in development mode
npm run build    # installer in src-tauri/target/release/bundle
```

Protocol tests: `cargo test --manifest-path src-tauri/Cargo.toml`.

Web version: [fschmid1.github.io/open-synapse](https://fschmid1.github.io/open-synapse/) (requires Chrome or Edge with WebHID).

```bash
npm run web        # http://127.0.0.1:4173
npm run build:web  # static build in dist/, published to GitHub Pages
npm run test:webhid
```

The same page is published to GitHub Pages from the `main` branch. Hardware control goes through WebHID, so a Chromium browser and HTTPS or `localhost` are required; demo mode is available in Firefox and Safari. Presets in the web version are stored in `localStorage`. On Linux the browser needs access to the HID device: if connecting fails, add the udev rule for `1532` (or install `chrome-udev`).

Interface check (seven themes, four window sizes, presets and scrolling):

```bash
npx playwright install chromium
npm run test:ui
```

Version changes: [CHANGELOG.md](CHANGELOG.md).

## How it works

```
src/                 interface: HTML + CSS + JS with no bundler
  app.js             state, presets, hot-plug
  art.js             SVG device illustrations with lighting zones
  i18n.js            translations
  webhid/            browser backend: protocol, device database, WebHID
src-tauri/src/
  main.rs            Tauri commands, storage, import/export
  razer/protocol.rs  90-byte Razer HID feature reports
  razer/models.rs    device database
  razer/mod.rs       control-interface discovery and commands
```

The protocol uses 90-byte HID feature reports (command class, ID, arguments, XOR checksum), documented by the [OpenRazer](https://github.com/openrazer/openrazer) project. For each device, the app iterates over its HID interfaces and transaction IDs until the device responds, then remembers the working pair.

Presets are stored in `library.json` in the app's settings folder (`%APPDATA%\dev.opensynapse.app` on Windows), and in the web version in the browser's `localStorage`.

### Preset format

```json
{
  "format": "open-synapse/preset",
  "version": 1,
  "name": "Tournament",
  "kind": "mouse",
  "settings": {
    "dpi": { "stages": [{ "x": 800, "y": 800 }, { "x": 1600, "y": 1600 }], "active": 0, "split": false },
    "polling": 1000,
    "lighting": { "brightness": 80, "sync": true, "zones": { "all": { "effect": "static", "colors": ["#2ff0b0", "#22a6ff"], "two": false, "speed": 2, "direction": 1 } } },
    "power": { "idle": 300, "lowBattery": 15 }
  }
}
```

### Verified on hardware

Everything in the "Buttons", "Calibration" and "Dongle LED" sections was captured from the official app's USB traffic (USBPcap) on the **Viper V3 Pro** and re-checked on the mouse itself: the value is written, read back and returned. For other models these features are currently disabled. To add a model, do the same: record the traffic and attach the decode to a pull request.

Tests on real hardware are marked `#[ignore]` and run explicitly:

```bash
cargo test --manifest-path src-tauri/Cargo.toml probe_hardware -- --ignored --nocapture
```

## Contributing

Found a device with wrong data or want to add a new one — open a pull request with a change to `models.rs` (PID, transaction ID, zones). "Works / doesn't work" reports with real hardware are especially useful.

## Legal

Open Synapse is an independent project, not affiliated with Razer Inc. Razer, Synapse and device names are trademarks of their respective owners and are used only to indicate compatibility. Licensed under [MIT](LICENSE).
