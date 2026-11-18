# Software remap — manual checklist (Reclusa X Mini 65%)

Tested configuration: Windows 10/11 x64, Open Synapse desktop build, Razer Reclusa X Mini 65%
(`1532:02E3`), firmware version: `__________`, Windows build: `__________`, AV/EDR: `__________`.

The keyboard answers status `0x05` ("not supported") to the documented `02/0D` (set) and
`02/8D` (get) key-map commands on every profile and layer, so device-side key remapping is not
available. This checklist validates the Windows software fallback.

## Before you start

- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` passes. This includes the 19 remap engine
      tests (modifier masks, key-up/down pairing, auto-repeat, shared modifiers, loop guard).
- [ ] `npm run test:webhid` passes.
- [ ] Razer Synapse is closed; two configurators conflict with each other.
- [ ] The app is built and running (`npm run dev`, or an installed build).
- [ ] The keyboard is connected directly (no KVM, VM or remote-desktop input path).
- [ ] No other keyboard remapper (PowerToys Keyboard Manager, AutoHotkey, etc.) is running.

## Detection and UI

- [ ] The keyboard page has a **Keys** tab.
- [ ] The tab shows **Software remap**, not the device-side **Key mapping** table.
- [ ] The warning says software-only, names the BIOS/other-OS/elevated-app limits, and says the
      hook applies to every keyboard.
- [ ] The tray icon exists. Its menu shows `Software remap: off` and
      `Disable software remapping`.
- [ ] The window title does not show a remap status while the feature is off.

## Basic remapping

- [ ] Enable the switch. The tray menu and the window title show **on**, and no error toast
      appears.
- [ ] Map **Caps Lock → Left Ctrl**. Caps Lock no longer toggles case; Ctrl+A, Ctrl+C and Ctrl+V
      work.
- [ ] Map **A → B**. Pressing A types `b`; Shift+A types `B`; holding A repeats `b`.
- [ ] Map a key → **Button 4**. In a browser, the button navigates back. No click stays stuck.
- [ ] Map a key → **Off**. It produces nothing.
- [ ] Map a key → **Ctrl+C**. Copy works; holding Shift with it gives Ctrl+Shift+C.
- [ ] Map **Left Shift → A**. Typing produces `a` (Shift is suppressed), and releasing does not
      leave Shift or A stuck.
- [ ] Map **A → A**. One `a` per press, no loop, no CPU spike.

## Held keys, repeats and modifiers

- [ ] Hold a remapped character key: auto-repeat works and stops on release.
- [ ] Hold a remapped modifier-only target (for example Caps Lock → Left Ctrl): it stays down
      until release and does not flicker with auto-repeat.
- [ ] Hold physical Shift and press a key mapped to Shift+A: the result is `A`, and releasing
      Caps Lock does not release the physical Shift.
- [ ] Press two keys mapped to Ctrl+… at the same time. Releasing one does not release Ctrl while
      the other is still held.
- [ ] Map a key to the mouse wheel. Each press scrolls one notch; holding it repeats.

## Stopping and restoring

- [ ] Press **Ctrl+Alt+Shift+Esc** while remapping is active. It stops immediately, the title and
      tray update, and no key is left held.
- [ ] Repeat the panic test with Esc itself remapped, and with Ctrl/Alt/Shift remapped. The panic
      combination still works because it is checked before the mapping lookup.
- [ ] Use the tray item **Disable software remapping**. It stops the hook.
- [ ] Close the app. The hook is removed and the keyboard behaves normally.
- [ ] Disconnect the keyboard. The hook stops instead of leaving stale mappings active.
- [ ] Reconnect the keyboard. The mapping is restored when the preset has software remap enabled.
- [ ] Sleep/resume. Remapping either keeps working or can be re-enabled without restarting.

## Known limitations (expected results)

- [ ] Notepad started as administrator: remapping does not work unless Open Synapse is also
      elevated (Windows UIPI).
- [ ] BIOS/UEFI and another operating system: no remapping.
- [ ] UAC secure desktop and the lock screen: no remapping.
- [ ] Ctrl+Alt+Del: never intercepted (Secure Attention Sequence).
- [ ] A second keyboard: its keys are remapped too, because v1 uses one global hook.
- [ ] A game that reads Raw Input or blocks injected input: remapping may be ignored.
- [ ] Anti-cheat or endpoint security that blocks `WH_KEYBOARD_LL`: enabling fails with a clear
      error instead of silently doing nothing.

## Report

- [ ] Record the exact error if the hook cannot be installed.
- [ ] Note any key that does not produce the expected output, and whether it is a game, an
      elevated app or a normal window.
- [ ] Attach the findings to the pull request or issue.
