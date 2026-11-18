# Changelog

## Unreleased

- Add keyboard key remapping for the Reclusa X Mini 65% (`1532:02E3`): map a key on the standard layer to another key, a mouse button or Off, with every write read back. Macros are not supported; mappings this app does not understand are left untouched.
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
