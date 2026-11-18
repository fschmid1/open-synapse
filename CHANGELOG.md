# Changelog

## Unreleased

- Close the Windows desktop window to the tray instead of quitting, so software remapping and the
  panic shortcut keep working with no window on screen. The tray menu restores the window; **Quit**
  there still exits and removes the hook. Without a tray icon (the web build, other platforms) the
  close button behaves as before.
- Add keyboard key remapping on the standard layer: map a key to another key, a mouse button or Off, with every write read back. The feature is only offered where the firmware answers `02/8D`; the Reclusa X Mini 65% rejects it with "not supported", so device-side remapping stays hidden on that model. Macros are not supported; mappings this app does not understand are left untouched.
- Add an opt-in **software remap** for the Windows desktop app, for keyboards whose firmware rejects the device-side key-map commands (the Reclusa X Mini 65%). A `WH_KEYBOARD_LL` hook remaps keys while Open Synapse runs, with modifier and key-up/down tracking, a tray indicator, a global-scope warning and an instant-off **Ctrl+Alt+Shift+Esc** panic shortcut. Mappings live in `settings.softwareKeys`, separate from the device-side `settings.keys`; the web build is unchanged because WebHID cannot install a system-wide hook. See `docs/software-remap-checklist.md`.
- Correct the Reclusa X Mini 65% note: Synapse remaps it in software and does not store the mapping on the keyboard.
- Make the app, documentation and UI tests English-only; the Russian locale and language switcher were removed.
- Add a browser build that talks to Razer devices over WebHID. Run `npm run web` and open it in Chrome or Edge; presets and photos live in `localStorage`.
- Let the web build disconnect a device from its page or the sidebar, or all devices at once, revoking the page's WebHID access until they are connected again.
- Add `npm run test:webhid` for the browser protocol port.
- Publish the web build to GitHub Pages from `main`.

## 0.1.1

- Keep preset names and save, copy and export actions inside the device header, including long names.
- Let sliders shrink to the available width instead of overflowing their cards.
- Constrain the main column and page headings to the available window width.
- Keep the compact device header side by side so settings appear sooner in smaller windows.
- Keep dialogs scrollable within short windows.
- Start newly selected pages at the top; preserve scroll while editing the current page.
- Cancel button-key capture when navigating away from the device.
- Replace the application icon with a clearer signal-shaped S, with regenerated desktop platform assets.

Hardware support is unchanged. This release retains the existing device-specific limitations documented in README.md.
