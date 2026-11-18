//! Software key remapping for Windows.
//!
//! Some keyboards do not implement Razer's documented `02/0D` (set) and
//! `02/8D` (get) key-map commands. The Reclusa X Mini 65% (1532:02E3) answers
//! status `0x05` "not supported" on every profile and layer; Synapse remaps it
//! in software instead. This module does the same: a low-level keyboard hook
//! rewrites keys for the whole session and injects the replacement with
//! `SendInput`.
//!
//! The mapping engine below is platform independent so it can be unit tested
//! everywhere. The hook, the Win32 calls and the process-wide state are
//! Windows-only; on Linux and macOS the commands return a clear error.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// Modifier bits, matching the Razer key-map byte and the frontend.
pub const MOD_LCTRL: u8 = 1;
pub const MOD_LSHIFT: u8 = 2;
pub const MOD_LALT: u8 = 4;
pub const MOD_LWIN: u8 = 8;
pub const MOD_RCTRL: u8 = 16;
pub const MOD_RSHIFT: u8 = 32;
pub const MOD_RALT: u8 = 64;
pub const MOD_RWIN: u8 = 128;

// Virtual-key codes used by the hook and by SendInput. Only the values this
// module needs are listed; they are the stable Win32 values.
pub mod vk {
    pub const BACK: u16 = 0x08;
    pub const TAB: u16 = 0x09;
    pub const CLEAR: u16 = 0x0C;
    pub const RETURN: u16 = 0x0D;
    pub const SHIFT: u16 = 0x10;
    pub const CONTROL: u16 = 0x11;
    pub const MENU: u16 = 0x12;
    pub const PAUSE: u16 = 0x13;
    pub const CAPITAL: u16 = 0x14;
    pub const ESCAPE: u16 = 0x1B;
    pub const SPACE: u16 = 0x20;
    pub const PRIOR: u16 = 0x21;
    pub const NEXT: u16 = 0x22;
    pub const END: u16 = 0x23;
    pub const HOME: u16 = 0x24;
    pub const LEFT: u16 = 0x25;
    pub const UP: u16 = 0x26;
    pub const RIGHT: u16 = 0x27;
    pub const DOWN: u16 = 0x28;
    pub const SNAPSHOT: u16 = 0x2C;
    pub const INSERT: u16 = 0x2D;
    pub const DELETE: u16 = 0x2E;
    pub const HELP: u16 = 0x2F;
    pub const LWIN: u16 = 0x5B;
    pub const RWIN: u16 = 0x5C;
    pub const APPS: u16 = 0x5D;
    pub const NUMPAD0: u16 = 0x60;
    pub const MULTIPLY: u16 = 0x6A;
    pub const ADD: u16 = 0x6B;
    pub const SEPARATOR: u16 = 0x6C;
    pub const SUBTRACT: u16 = 0x6D;
    pub const DECIMAL: u16 = 0x6E;
    pub const DIVIDE: u16 = 0x6F;
    pub const NUMLOCK: u16 = 0x90;
    pub const SCROLL: u16 = 0x91;
    pub const LSHIFT: u16 = 0xA0;
    pub const RSHIFT: u16 = 0xA1;
    pub const LCONTROL: u16 = 0xA2;
    pub const RCONTROL: u16 = 0xA3;
    pub const LMENU: u16 = 0xA4;
    pub const RMENU: u16 = 0xA5;
    pub const OEM_1: u16 = 0xBA;
    pub const OEM_PLUS: u16 = 0xBB;
    pub const OEM_COMMA: u16 = 0xBC;
    pub const OEM_MINUS: u16 = 0xBD;
    pub const OEM_PERIOD: u16 = 0xBE;
    pub const OEM_2: u16 = 0xBF;
    pub const OEM_3: u16 = 0xC0;
    pub const OEM_4: u16 = 0xDB;
    pub const OEM_5: u16 = 0xDC;
    pub const OEM_6: u16 = 0xDD;
    pub const OEM_7: u16 = 0xDE;
    pub const OEM_102: u16 = 0xE2;
    pub const VOLUME_MUTE: u16 = 0xAD;
    pub const VOLUME_DOWN: u16 = 0xAE;
    pub const VOLUME_UP: u16 = 0xAF;
}

/// A physical key that can be the source of a software mapping.
///
/// A normal key has a USB HID usage and a zero `modifier`; a modifier key has
/// a zero `usage` and one bit from `modifiers`. Exactly one field must be set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SourceKey {
    #[serde(default)]
    pub usage: u8,
    #[serde(default)]
    pub modifier: u8,
}

impl SourceKey {
    #[cfg(test)]
    pub fn usage(usage: u8) -> Self {
        Self { usage, modifier: 0 }
    }

    #[cfg(test)]
    pub fn modifier(bit: u8) -> Self {
        Self { usage: 0, modifier: bit }
    }

    pub fn vk(self) -> Option<u16> {
        if self.modifier != 0 {
            if self.usage != 0 {
                return None;
            }
            mod_vk(self.modifier)
        } else {
            usage_to_vk(self.usage)
        }
    }
}

/// What a source key should produce.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Target {
    Key { modifiers: u8, usage: u8 },
    Mouse { function: u8 },
    Off,
}

/// One persisted mapping. The wire shape is `{ source, target }`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SoftwareMapping {
    pub source: SourceKey,
    pub target: Target,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MouseButton {
    Left,
    Right,
    Middle,
    X1,
    X2,
}

/// A single event to inject. The Windows layer turns these into `INPUT`s.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Injected {
    Key { vk: u16, down: bool },
    MouseButton { button: MouseButton, down: bool },
    Wheel { up: bool },
}

/// Status returned to the frontend and used for the tray indicator.
#[derive(Debug, Clone, Default, Serialize)]
pub struct RemapStatus {
    pub supported: bool,
    pub enabled: bool,
    pub active: bool,
    pub panic: bool,
    pub mappings: usize,
    pub device: Option<String>,
    pub error: Option<String>,
}

// ------------------------------------------------------------------ HID -> VK

/// Converts a USB HID keyboard usage (page 0x07) to a Win32 virtual-key code.
pub fn usage_to_vk(usage: u8) -> Option<u16> {
    Some(match usage {
        0x04..=0x1D => 0x41 + (usage - 0x04) as u16, // A-Z
        0x1E..=0x26 => 0x31 + (usage - 0x1E) as u16, // 1-9
        0x27 => 0x30,                                // 0
        0x28 => vk::RETURN,
        0x29 => vk::ESCAPE,
        0x2A => vk::BACK,
        0x2B => vk::TAB,
        0x2C => vk::SPACE,
        0x2D => vk::OEM_MINUS,
        0x2E => vk::OEM_PLUS,
        0x2F => vk::OEM_4,
        0x30 => vk::OEM_6,
        0x31 => vk::OEM_5,
        0x32 => vk::OEM_5,
        0x33 => vk::OEM_1,
        0x34 => vk::OEM_7,
        0x35 => vk::OEM_3,
        0x36 => vk::OEM_COMMA,
        0x37 => vk::OEM_PERIOD,
        0x38 => vk::OEM_2,
        0x39 => vk::CAPITAL,
        0x3A..=0x45 => 0x70 + (usage - 0x3A) as u16, // F1-F12
        0x46 => vk::SNAPSHOT,
        0x47 => vk::SCROLL,
        0x48 => vk::PAUSE,
        0x49 => vk::INSERT,
        0x4A => vk::HOME,
        0x4B => vk::PRIOR,
        0x4C => vk::DELETE,
        0x4D => vk::END,
        0x4E => vk::NEXT,
        0x4F => vk::RIGHT,
        0x50 => vk::LEFT,
        0x51 => vk::DOWN,
        0x52 => vk::UP,
        0x53 => vk::NUMLOCK,
        0x54 => vk::DIVIDE,
        0x55 => vk::MULTIPLY,
        0x56 => vk::SUBTRACT,
        0x57 => vk::ADD,
        0x58 => vk::RETURN, // Numpad Enter
        0x59..=0x61 => 0x61 + (usage - 0x59) as u16, // Numpad 1-9
        0x62 => vk::NUMPAD0,
        0x63 => vk::DECIMAL,
        0x64 => vk::OEM_102,
        0x65 => vk::APPS,
        0x68..=0x73 => 0x7C + (usage - 0x68) as u16, // F13-F24
        0x75 => vk::HELP,
        0x7F => vk::VOLUME_MUTE,
        0x80 => vk::VOLUME_UP,
        0x81 => vk::VOLUME_DOWN,
        0x85 => vk::SEPARATOR,
        0x9A => vk::SNAPSHOT,
        0x9C => vk::CLEAR,
        0x9D => vk::PRIOR,
        0x9E => vk::RETURN,
        0x9F => vk::SEPARATOR,
        0xE0 => vk::LCONTROL,
        0xE1 => vk::LSHIFT,
        0xE2 => vk::LMENU,
        0xE3 => vk::LWIN,
        0xE4 => vk::RCONTROL,
        0xE5 => vk::RSHIFT,
        0xE6 => vk::RMENU,
        0xE7 => vk::RWIN,
        _ => return None,
    })
}

pub fn mod_vk(bit: u8) -> Option<u16> {
    match bit {
        MOD_LCTRL => Some(vk::LCONTROL),
        MOD_LSHIFT => Some(vk::LSHIFT),
        MOD_LALT => Some(vk::LMENU),
        MOD_LWIN => Some(vk::LWIN),
        MOD_RCTRL => Some(vk::RCONTROL),
        MOD_RSHIFT => Some(vk::RSHIFT),
        MOD_RALT => Some(vk::RMENU),
        MOD_RWIN => Some(vk::RWIN),
        _ => None,
    }
}

/// The generic virtual-key a side-specific modifier also generates.
fn generic_mod_vk(bit: u8) -> Option<u16> {
    match bit {
        MOD_LCTRL | MOD_RCTRL => Some(vk::CONTROL),
        MOD_LSHIFT | MOD_RSHIFT => Some(vk::SHIFT),
        MOD_LALT | MOD_RALT => Some(vk::MENU),
        _ => None,
    }
}

fn mod_bit(vk: u16) -> u8 {
    match vk {
        vk::CONTROL | vk::LCONTROL => MOD_LCTRL,
        vk::SHIFT | vk::LSHIFT => MOD_LSHIFT,
        vk::MENU | vk::LMENU => MOD_LALT,
        vk::LWIN => MOD_LWIN,
        vk::RCONTROL => MOD_RCTRL,
        vk::RSHIFT => MOD_RSHIFT,
        vk::RMENU => MOD_RALT,
        vk::RWIN => MOD_RWIN,
        _ => 0,
    }
}

fn mouse_button(function: u8) -> Option<MouseButton> {
    match function {
        1 => Some(MouseButton::Left),
        2 => Some(MouseButton::Right),
        3 => Some(MouseButton::Middle),
        4 => Some(MouseButton::X1),
        5 => Some(MouseButton::X2),
        _ => None,
    }
}

fn validate(target: Target) -> Result<(), String> {
    match target {
        Target::Off => Ok(()),
        Target::Mouse { function } => {
            if (1..=5).contains(&function) || function == 9 || function == 10 {
                Ok(())
            } else {
                Err("unknown mouse function".into())
            }
        }
        Target::Key { modifiers, usage } => {
            if usage == 0 {
                if modifiers == 0 {
                    return Err("a key mapping needs a key or a modifier".into());
                }
                for bit in [MOD_LCTRL, MOD_LSHIFT, MOD_LALT, MOD_LWIN, MOD_RCTRL, MOD_RSHIFT, MOD_RALT, MOD_RWIN] {
                    if modifiers & bit != 0 && mod_vk(bit).is_none() {
                        return Err("unknown modifier mask".into());
                    }
                }
                return Ok(());
            }
            if !(0x04..=0xE7).contains(&usage) || usage_to_vk(usage).is_none() {
                return Err("this key cannot be remapped in software".into());
            }
            Ok(())
        }
    }
}

fn table_from(mappings: &[SoftwareMapping]) -> Result<HashMap<u16, Target>, String> {
    let mut table: HashMap<u16, Target> = HashMap::new();
    for mapping in mappings {
        let source = mapping.source;
        let vk = source
            .vk()
            .ok_or_else(|| "unknown source key".to_string())?;
        validate(mapping.target)?;
        table.insert(vk, mapping.target);
        // The hook may report the generic VK for a side-specific modifier.
        if let Some(generic) = generic_mod_vk(source.modifier) {
            table.entry(generic).or_insert(mapping.target);
        }
    }
    Ok(table)
}

// ------------------------------------------------------------------ engine

#[derive(Debug, Clone)]
struct Active {
    target: Target,
    /// Modifier virtual keys this key injected (reference counted in `mod_refs`).
    injected_mods: Vec<u16>,
}

/// The platform-independent key state machine.
///
/// It receives physical key events in order and returns whether the original
/// event must be swallowed and which events should be injected. Repeated
/// key-down events are auto-repeat: character targets repeat, modifier-only
/// and mouse-button targets do not. Every injected key-down is paired with a
/// key-up, and target modifiers are reference counted so two remapped keys
/// cannot release each other's modifier.
#[derive(Debug)]
pub struct Engine {
    table: HashMap<u16, Target>,
    /// Every physical modifier key currently down, including remapped ones.
    /// Used only for the panic shortcut.
    physical_mods: u8,
    /// Modifiers that are actually down in Windows because an unmapped key
    /// passed through. Remapped modifier keys are tracked by `mod_refs`.
    effective_mods: u8,
    active: HashMap<u16, Active>,
    mod_refs: HashMap<u16, u32>,
    panic: bool,
}

impl Engine {
    pub fn new(table: HashMap<u16, Target>) -> Self {
        Self {
            table,
            physical_mods: 0,
            effective_mods: 0,
            active: HashMap::new(),
            mod_refs: HashMap::new(),
            panic: false,
        }
    }

    pub fn empty() -> Self {
        Self::new(HashMap::new())
    }

    #[cfg(test)]
    pub fn from_mappings(mappings: &[SoftwareMapping]) -> Result<Self, String> {
        Ok(Self::new(table_from(mappings)?))
    }

    pub fn len(&self) -> usize {
        // Side-specific modifiers also get a generic alias in the table, so
        // count only real source keys.
        self.table
            .keys()
            .filter(|&&vk| !matches!(vk, vk::CONTROL | vk::SHIFT | vk::MENU))
            .count()
    }

    pub fn is_panic(&self) -> bool {
        self.panic
    }

    pub fn take_panic(&mut self) -> bool {
        std::mem::take(&mut self.panic)
    }

    pub fn reset_panic(&mut self) {
        self.panic = false;
    }

    /// Replaces the mapping table and releases anything currently held.
    pub fn replace(&mut self, table: HashMap<u16, Target>) -> Vec<Injected> {
        let events = self.release_all();
        self.table = table;
        self.panic = false;
        self.recompute_effective();
        events
    }

    pub fn clear(&mut self) -> Vec<Injected> {
        let events = self.release_all();
        self.table.clear();
        events
    }

    pub fn release_all(&mut self) -> Vec<Injected> {
        let keys: Vec<u16> = self.active.keys().copied().collect();
        let mut events = Vec::new();
        for key in keys {
            events.extend(self.release(key));
        }
        // Normally empty; this is a safety net for a mapping changed mid-press.
        let mut leftovers: Vec<u16> = self.mod_refs.keys().copied().collect();
        leftovers.sort_unstable();
        for vk in leftovers {
            events.push(Injected::Key { vk, down: false });
        }
        self.mod_refs.clear();
        events
    }

    fn recompute_effective(&mut self) {
        let mut mapped_bits = 0;
        for &vk in self.table.keys() {
            mapped_bits |= mod_bit(vk);
        }
        self.effective_mods = self.physical_mods & !mapped_bits;
    }

    fn panic_combo(&self) -> bool {
        let ctrl = self.physical_mods & (MOD_LCTRL | MOD_RCTRL) != 0;
        let shift = self.physical_mods & (MOD_LSHIFT | MOD_RSHIFT) != 0;
        let alt = self.physical_mods & (MOD_LALT | MOD_RALT) != 0;
        ctrl && shift && alt
    }

    pub fn on_key(&mut self, vk: u16, down: bool) -> (bool, Vec<Injected>) {
        let bit = mod_bit(vk);
        let mapped = self.table.get(&vk).copied();

        if bit != 0 {
            if down {
                self.physical_mods |= bit;
            } else {
                self.physical_mods &= !bit;
            }
            // Only unmapped modifiers actually reach Windows.
            if mapped.is_none() {
                if down {
                    self.effective_mods |= bit;
                } else {
                    self.effective_mods &= !bit;
                }
            }
        }

        // The panic shortcut bypasses remapping, even when Esc is remapped.
        if down && vk == vk::ESCAPE && self.panic_combo() {
            self.panic = true;
            let events = self.release_all();
            self.table.clear();
            self.effective_mods = 0;
            return (false, events);
        }

        if down {
            if self.active.contains_key(&vk) {
                // Auto-repeat from the physical keyboard.
                return (true, self.repeat(vk));
            }
            match mapped {
                Some(target) => (true, self.start(vk, target)),
                None => (false, Vec::new()),
            }
        } else if self.active.contains_key(&vk) {
            (true, self.release(vk))
        } else {
            // Swallow an orphan key-up for a currently mapped key so a key
            // pressed before a mapping change does not leak through.
            (mapped.is_some(), Vec::new())
        }
    }

    fn start(&mut self, vk: u16, target: Target) -> Vec<Injected> {
        let mut events = Vec::new();
        let mut injected_mods = Vec::new();

        match target {
            Target::Off => {}
            Target::Key { modifiers, usage } => {
                for bit in [MOD_LCTRL, MOD_LSHIFT, MOD_LALT, MOD_LWIN, MOD_RCTRL, MOD_RSHIFT, MOD_RALT, MOD_RWIN] {
                    if modifiers & bit == 0 || self.effective_mods & bit != 0 {
                        continue;
                    }
                    let Some(mvk) = mod_vk(bit) else { continue };
                    let count = self.mod_refs.entry(mvk).or_insert(0);
                    if *count == 0 {
                        events.push(Injected::Key { vk: mvk, down: true });
                    }
                    *count += 1;
                    injected_mods.push(mvk);
                }
                if usage != 0 {
                    if let Some(kvk) = usage_to_vk(usage) {
                        events.push(Injected::Key { vk: kvk, down: true });
                    }
                }
            }
            Target::Mouse { function } => match function {
                9 => events.push(Injected::Wheel { up: true }),
                10 => events.push(Injected::Wheel { up: false }),
                _ => {
                    if let Some(button) = mouse_button(function) {
                        events.push(Injected::MouseButton { button, down: true });
                    }
                }
            },
        }

        self.active.insert(vk, Active { target, injected_mods });
        events
    }

    fn repeat(&mut self, vk: u16) -> Vec<Injected> {
        let Some(active) = self.active.get(&vk) else { return Vec::new() };
        match active.target {
            Target::Key { usage, .. } if usage != 0 => usage_to_vk(usage)
                .map(|kvk| vec![Injected::Key { vk: kvk, down: true }])
                .unwrap_or_default(),
            Target::Mouse { function: 9 } => vec![Injected::Wheel { up: true }],
            Target::Mouse { function: 10 } => vec![Injected::Wheel { up: false }],
            _ => Vec::new(),
        }
    }

    fn release(&mut self, vk: u16) -> Vec<Injected> {
        let Some(active) = self.active.remove(&vk) else { return Vec::new() };
        let mut events = Vec::new();
        match active.target {
            Target::Key { usage, .. } => {
                if usage != 0 {
                    if let Some(kvk) = usage_to_vk(usage) {
                        events.push(Injected::Key { vk: kvk, down: false });
                    }
                }
                for mvk in active.injected_mods {
                    let Some(count) = self.mod_refs.get_mut(&mvk) else { continue };
                    *count = count.saturating_sub(1);
                    if *count == 0 {
                        self.mod_refs.remove(&mvk);
                        events.push(Injected::Key { vk: mvk, down: false });
                    }
                }
            }
            Target::Mouse { function } => {
                if let Some(button) = mouse_button(function) {
                    events.push(Injected::MouseButton { button, down: false });
                }
            }
            Target::Off => {}
        }
        events
    }
}

// ------------------------------------------------------------------ Windows

/// True when the Windows low-level hook should ignore this event because it
/// was injected by this module. Kept outside `cfg(windows)` so the loop guard
/// can be unit tested on every platform.
pub const MAGIC_EXTRA_INFO: usize = 0x4F53_4E52; // "OSNR"

pub fn is_injected(flags: u32, extra_info: usize) -> bool {
    const LLKHF_INJECTED: u32 = 0x10;
    flags & LLKHF_INJECTED != 0 || extra_info == MAGIC_EXTRA_INFO
}

#[cfg(windows)]
mod platform {
    use super::*;
    use std::sync::mpsc;
    use std::sync::{Mutex, MutexGuard, OnceLock};
    use std::thread::{self, JoinHandle};
    use std::time::Duration;
    use windows_sys::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYEVENTF_EXTENDEDKEY,
        KEYEVENTF_KEYUP, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN,
        MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP, MOUSEEVENTF_WHEEL,
        MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, MOUSEINPUT,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, GetMessageW, PostThreadMessageW, SetWindowsHookExW, UnhookWindowsHookEx,
        HC_ACTION, KBDLLHOOKSTRUCT, MSG, PM_NOREMOVE, WH_KEYBOARD_LL, WM_KEYDOWN, WM_KEYUP,
        WM_QUIT, WM_SYSKEYDOWN, WM_SYSKEYUP,
    };

    struct Shared {
        engine: Engine,
        thread_id: u32,
        enabled: bool,
        installed: bool,
        device: Option<String>,
    }

    struct Controller {
        handle: Option<JoinHandle<()>>,
        device: Option<String>,
        last_mappings: Vec<SoftwareMapping>,
        error: Option<String>,
    }

    impl Controller {
        const fn new() -> Self {
            Self { handle: None, device: None, last_mappings: Vec::new(), error: None }
        }
    }

    static SHARED: OnceLock<Mutex<Shared>> = OnceLock::new();
    static CONTROLLER: Mutex<Controller> = Mutex::new(Controller::new());
    static STATUS_CALLBACK: OnceLock<Box<dyn Fn(RemapStatus) + Send + Sync>> = OnceLock::new();

    fn shared() -> &'static Mutex<Shared> {
        SHARED.get_or_init(|| {
            Mutex::new(Shared { engine: Engine::empty(), thread_id: 0, enabled: false, installed: false, device: None })
        })
    }

    fn lock_shared() -> MutexGuard<'static, Shared> {
        shared().lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn lock_controller() -> MutexGuard<'static, Controller> {
        CONTROLLER.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn notify(status: &RemapStatus) {
        if let Some(callback) = STATUS_CALLBACK.get() {
            callback(status.clone());
        }
    }

    /// The hook thread must not wait for the window/tray, so its status
    /// notifications run on a short-lived thread.
    fn notify_async(status: RemapStatus) {
        let _ = thread::Builder::new()
            .name("open-synapse-remap-notify".into())
            .spawn(move || notify(&status));
    }

    fn cleanup(controller: &mut Controller) {
        if controller.handle.as_ref().is_some_and(|handle| handle.is_finished()) {
            if let Some(handle) = controller.handle.take() {
                let _ = handle.join();
            }
        }
    }

    fn status_of(controller: &Controller) -> RemapStatus {
        let shared = lock_shared();
        RemapStatus {
            supported: true,
            enabled: shared.enabled && shared.installed,
            active: shared.installed,
            panic: shared.engine.is_panic(),
            mappings: if shared.installed { shared.engine.len() } else { 0 },
            device: shared.device.clone().or_else(|| controller.device.clone()),
            error: controller.error.clone(),
        }
    }

    // -------------------------------------------------------------- injection

    fn extended_vk(vk: u16) -> bool {
        matches!(
            vk,
            vk::INSERT
                | vk::DELETE
                | vk::HOME
                | vk::END
                | vk::PRIOR
                | vk::NEXT
                | vk::LEFT
                | vk::UP
                | vk::RIGHT
                | vk::DOWN
                | vk::NUMLOCK
                | vk::DIVIDE
                | vk::RCONTROL
                | vk::RMENU
                | vk::LWIN
                | vk::RWIN
                | vk::APPS
                | vk::SNAPSHOT
        )
    }

    fn input_of(event: Injected) -> INPUT {
        let mut input = INPUT::default();
        match event {
            Injected::Key { vk, down } => {
                input.r#type = INPUT_KEYBOARD;
                let mut flags = 0;
                if !down {
                    flags |= KEYEVENTF_KEYUP;
                }
                if extended_vk(vk) {
                    flags |= KEYEVENTF_EXTENDEDKEY;
                }
                input.Anonymous.ki = KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: MAGIC_EXTRA_INFO,
                };
            }
            Injected::MouseButton { button, down } => {
                input.r#type = INPUT_MOUSE;
                let (flags, data) = match (button, down) {
                    (MouseButton::Left, true) => (MOUSEEVENTF_LEFTDOWN, 0),
                    (MouseButton::Left, false) => (MOUSEEVENTF_LEFTUP, 0),
                    (MouseButton::Right, true) => (MOUSEEVENTF_RIGHTDOWN, 0),
                    (MouseButton::Right, false) => (MOUSEEVENTF_RIGHTUP, 0),
                    (MouseButton::Middle, true) => (MOUSEEVENTF_MIDDLEDOWN, 0),
                    (MouseButton::Middle, false) => (MOUSEEVENTF_MIDDLEUP, 0),
                    (MouseButton::X1, true) => (MOUSEEVENTF_XDOWN, 1),
                    (MouseButton::X1, false) => (MOUSEEVENTF_XUP, 1),
                    (MouseButton::X2, true) => (MOUSEEVENTF_XDOWN, 2),
                    (MouseButton::X2, false) => (MOUSEEVENTF_XUP, 2),
                };
                input.Anonymous.mi = MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: data,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: MAGIC_EXTRA_INFO,
                };
            }
            Injected::Wheel { up } => {
                input.r#type = INPUT_MOUSE;
                input.Anonymous.mi = MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: if up { 120 } else { (-120i32) as u32 },
                    dwFlags: MOUSEEVENTF_WHEEL,
                    time: 0,
                    dwExtraInfo: MAGIC_EXTRA_INFO,
                };
            }
        }
        input
    }

    fn send(events: &[Injected]) {
        if events.is_empty() {
            return;
        }
        let inputs: Vec<INPUT> = events.iter().copied().map(input_of).collect();
        // UIPI may refuse input to elevated windows; there is nothing sensible
        // to do from inside a hook, so a failed send is ignored.
        unsafe {
            SendInput(inputs.len() as u32, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32);
        }
    }

    // -------------------------------------------------------------- hook

    unsafe extern "system" fn hook_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code != HC_ACTION as i32 {
            return CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam);
        }
        let Some(info) = (lparam as *const KBDLLHOOKSTRUCT).as_ref() else {
            return CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam);
        };
        if is_injected(info.flags, info.dwExtraInfo) {
            return CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam);
        }
        let down = match wparam as u32 {
            WM_KEYDOWN | WM_SYSKEYDOWN => true,
            WM_KEYUP | WM_SYSKEYUP => false,
            _ => return CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam),
        };
        let vk = info.vkCode as u16;

        let (suppress, events, panic, thread_id, installed, device, mappings) = {
            let mut shared = lock_shared();
            let (suppress, events) = shared.engine.on_key(vk, down);
            let panic = shared.engine.take_panic();
            if panic {
                shared.enabled = false;
            }
            (
                suppress,
                events,
                panic,
                shared.thread_id,
                shared.installed,
                shared.device.clone(),
                shared.engine.len(),
            )
        };

        send(&events);

        if panic {
            let status = RemapStatus {
                supported: true,
                enabled: false,
                active: installed,
                panic: true,
                mappings,
                device,
                error: None,
            };
            notify_async(status);
            unsafe { PostThreadMessageW(thread_id, WM_QUIT, 0, 0) };
        }

        if suppress {
            1
        } else {
            CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
        }
    }

    fn hook_thread(table: HashMap<u16, Target>, device: Option<String>, ready: mpsc::Sender<Result<(), String>>) {
        let thread_id = unsafe { GetCurrentThreadId() };
        {
            let mut shared = lock_shared();
            shared.engine = Engine::new(table);
            shared.thread_id = thread_id;
            shared.enabled = true;
            shared.installed = false;
            shared.device = device;
        }

        // Force the message queue into existence before anyone posts to it.
        let mut msg: MSG = unsafe { std::mem::zeroed() };
        unsafe { windows_sys::Win32::UI::WindowsAndMessaging::PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_NOREMOVE) };

        let hook = unsafe {
            SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), GetModuleHandleW(std::ptr::null()), 0)
        };
        if hook.is_null() {
            let message = format!("could not install the keyboard hook: {}", std::io::Error::last_os_error());
            {
                let mut shared = lock_shared();
                shared.enabled = false;
                shared.installed = false;
                shared.device = None;
            }
            let _ = ready.send(Err(message));
            return;
        }

        {
            let mut shared = lock_shared();
            shared.installed = true;
        }
        let _ = ready.send(Ok(()));

        loop {
            let result = unsafe { GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) };
            if result <= 0 {
                break;
            }
        }

        unsafe { UnhookWindowsHookEx(hook) };

        let (events, status) = {
            let mut shared = lock_shared();
            shared.installed = false;
            shared.enabled = false;
            shared.device = None;
            let events = shared.engine.clear();
            let status = status_of_unlocked(&shared);
            (events, status)
        };
        send(&events);
        notify_async(status);
    }

    fn status_of_unlocked(shared: &Shared) -> RemapStatus {
        RemapStatus {
            supported: true,
            enabled: false,
            active: false,
            panic: shared.engine.is_panic(),
            mappings: 0,
            device: shared.device.clone(),
            error: None,
        }
    }

    // -------------------------------------------------------------- commands

    pub fn set_status_callback(callback: Box<dyn Fn(RemapStatus) + Send + Sync>) {
        let _ = STATUS_CALLBACK.set(callback);
    }

    pub fn status() -> RemapStatus {
        let mut controller = lock_controller();
        cleanup(&mut controller);
        status_of(&controller)
    }

    pub fn mappings() -> Vec<SoftwareMapping> {
        let controller = lock_controller();
        controller.last_mappings.clone()
    }

    pub fn enable(mappings: Vec<SoftwareMapping>, device: Option<String>) -> Result<RemapStatus, String> {
        let table = table_from(&mappings)?;

        let mut controller = lock_controller();
        let running = controller.handle.as_ref().is_some_and(|handle| !handle.is_finished());
        if running {
            let events = {
                let mut shared = lock_shared();
                let events = shared.engine.replace(table);
                shared.enabled = true;
                shared.device = device.clone();
                events
            };
            send(&events);
            controller.device = device;
            controller.error = None;
            controller.last_mappings = mappings;
            let status = status_of(&controller);
            drop(controller);
            notify(&status);
            return Ok(status);
        }

        cleanup(&mut controller);
        controller.error = None;

        let (tx, rx) = mpsc::channel();
        let thread_device = device.clone();
        let thread = thread::Builder::new()
            .name("open-synapse-remap".into())
            .spawn(move || hook_thread(table, thread_device, tx))
            .map_err(|error| format!("could not start the remap thread: {error}"))?;

        match rx.recv_timeout(Duration::from_secs(3)) {
            Ok(Ok(())) => {
                controller.handle = Some(thread);
                controller.device = device;
                controller.last_mappings = mappings;
                let status = status_of(&controller);
                drop(controller);
                notify(&status);
                Ok(status)
            }
            Ok(Err(error)) => {
                let _ = thread.join();
                controller.error = Some(error.clone());
                Err(error)
            }
            Err(_) => {
                let thread_id = {
                    let shared = lock_shared();
                    shared.thread_id
                };
                if thread_id != 0 {
                    unsafe { PostThreadMessageW(thread_id, WM_QUIT, 0, 0) };
                }
                let _ = thread.join();
                let error = "timed out while installing the keyboard hook".to_string();
                controller.error = Some(error.clone());
                Err(error)
            }
        }
    }

    pub fn disable() -> Result<RemapStatus, String> {
        let mut controller = lock_controller();
        let (thread_id, events) = {
            let mut shared = lock_shared();
            shared.enabled = false;
            shared.device = None;
            let events = shared.engine.clear();
            shared.engine.reset_panic();
            (shared.thread_id, events)
        };
        send(&events);
        if thread_id != 0 {
            unsafe { PostThreadMessageW(thread_id, WM_QUIT, 0, 0) };
        }
        if let Some(handle) = controller.handle.take() {
            let _ = handle.join();
        }
        controller.device = None;
        controller.error = None;
        let status = status_of(&controller);
        drop(controller);
        notify(&status);
        Ok(status)
    }

    pub fn shutdown() {
        let _ = disable();
    }

    pub fn set(mappings: Vec<SoftwareMapping>) -> Result<RemapStatus, String> {
        let device = {
            let controller = lock_controller();
            controller.device.clone()
        };
        enable(mappings, device)
    }
}

// ------------------------------------------------------------------ public API

#[cfg(windows)]
pub use platform::{disable, enable, mappings, set, set_status_callback, shutdown, status};

#[cfg(not(windows))]
fn not_supported() -> String {
    "software remapping is supported in the Windows desktop app only".into()
}

#[cfg(not(windows))]
pub fn set(_mappings: Vec<SoftwareMapping>) -> Result<RemapStatus, String> {
    Err(not_supported())
}

#[cfg(not(windows))]
pub fn status() -> RemapStatus {
    RemapStatus { supported: false, ..RemapStatus::default() }
}

#[cfg(not(windows))]
pub fn enable(_mappings: Vec<SoftwareMapping>, _device: Option<String>) -> Result<RemapStatus, String> {
    Err(not_supported())
}

#[cfg(not(windows))]
pub fn disable() -> Result<RemapStatus, String> {
    Err(not_supported())
}

#[cfg(not(windows))]
pub fn mappings() -> Vec<SoftwareMapping> {
    Vec::new()
}

#[cfg(not(windows))]
pub fn set_status_callback(_callback: Box<dyn Fn(RemapStatus) + Send + Sync>) {}

#[cfg(not(windows))]
pub fn shutdown() {}

// ------------------------------------------------------------------ tests

#[cfg(test)]
mod tests {
    use super::*;

    fn mapping(source: SourceKey, target: Target) -> SoftwareMapping {
        SoftwareMapping { source, target }
    }

    fn engine(pairs: &[(SourceKey, Target)]) -> Engine {
        let maps: Vec<SoftwareMapping> = pairs.iter().map(|(s, t)| mapping(*s, *t)).collect();
        Engine::from_mappings(&maps).expect("valid mappings")
    }

    fn key(vk: u16, down: bool) -> Injected {
        Injected::Key { vk, down }
    }

    #[test]
    fn every_modifier_bit_has_a_vk() {
        for bit in [MOD_LCTRL, MOD_LSHIFT, MOD_LALT, MOD_LWIN, MOD_RCTRL, MOD_RSHIFT, MOD_RALT, MOD_RWIN] {
            assert!(mod_vk(bit).is_some(), "bit {bit}");
        }
        assert!(mod_vk(0).is_none());
        assert!(mod_vk(0x40 | 0x80).is_none());
    }

    #[test]
    fn source_requires_exactly_one_field() {
        assert!(SourceKey { usage: 0x39, modifier: 0 }.vk().is_some());
        assert!(SourceKey { usage: 0, modifier: MOD_LCTRL }.vk().is_some());
        assert!(SourceKey { usage: 0, modifier: 0 }.vk().is_none());
        assert!(SourceKey { usage: 0x39, modifier: MOD_LCTRL }.vk().is_none());
        assert!(SourceKey { usage: 0x02, modifier: 0 }.vk().is_none());
    }

    #[test]
    fn invalid_targets_are_rejected() {
        assert!(table_from(&[mapping(SourceKey::usage(0x39), Target::Key { modifiers: 0, usage: 0 })]).is_err());
        assert!(table_from(&[mapping(SourceKey::usage(0x39), Target::Mouse { function: 6 })]).is_err());
        assert!(table_from(&[mapping(SourceKey::usage(0x39), Target::Key { modifiers: 0, usage: 0x02 })]).is_err());
        assert!(table_from(&[mapping(SourceKey::usage(0x02), Target::Off)]).is_err());
        assert!(table_from(&[mapping(SourceKey::usage(0x39), Target::Off)]).is_ok());
    }

    #[test]
    fn caps_lock_to_ctrl_c_presses_and_releases_in_order() {
        let mut e = engine(&[(
            SourceKey::usage(0x39),
            Target::Key { modifiers: MOD_LCTRL, usage: 0x06 },
        )]);
        let (suppress, down) = e.on_key(vk::CAPITAL, true);
        assert!(suppress);
        assert_eq!(down, vec![key(vk::LCONTROL, true), key('C' as u16, true)]);
        let (suppress, up) = e.on_key(vk::CAPITAL, false);
        assert!(suppress);
        assert_eq!(up, vec![key('C' as u16, false), key(vk::LCONTROL, false)]);
    }

    #[test]
    fn held_character_key_repeats_and_pairs_once() {
        let mut e = engine(&[(SourceKey::usage(0x04), Target::Key { modifiers: 0, usage: 0x05 })]);
        let (_, down) = e.on_key('A' as u16, true);
        assert_eq!(down, vec![key('B' as u16, true)]);
        let (suppress, repeat) = e.on_key('A' as u16, true);
        assert!(suppress);
        assert_eq!(repeat, vec![key('B' as u16, true)]);
        let (_, up) = e.on_key('A' as u16, false);
        assert_eq!(up, vec![key('B' as u16, false)]);
        // A second key-up must not emit another release, but the mapped key
        // stays swallowed so no orphan event reaches Windows.
        let (suppress, extra) = e.on_key('A' as u16, false);
        assert!(suppress);
        assert!(extra.is_empty());
    }

    #[test]
    fn modifier_only_target_ignores_auto_repeat() {
        let mut e = engine(&[(SourceKey::usage(0x39), Target::Key { modifiers: MOD_LCTRL, usage: 0 })]);
        assert_eq!(e.on_key(vk::CAPITAL, true).1, vec![key(vk::LCONTROL, true)]);
        assert!(e.on_key(vk::CAPITAL, true).1.is_empty());
        assert_eq!(e.on_key(vk::CAPITAL, false).1, vec![key(vk::LCONTROL, false)]);
    }

    #[test]
    fn off_swallows_the_key_without_output() {
        let mut e = engine(&[(SourceKey::usage(0x04), Target::Off)]);
        assert_eq!(e.on_key('A' as u16, true), (true, Vec::new()));
        assert_eq!(e.on_key('A' as u16, false), (true, Vec::new()));
    }

    #[test]
    fn mouse_buttons_pair_and_wheel_fires_on_down_and_repeat() {
        let mut e = engine(&[(SourceKey::usage(0x04), Target::Mouse { function: 4 })]);
        assert_eq!(
            e.on_key('A' as u16, true).1,
            vec![Injected::MouseButton { button: MouseButton::X1, down: true }]
        );
        assert_eq!(
            e.on_key('A' as u16, false).1,
            vec![Injected::MouseButton { button: MouseButton::X1, down: false }]
        );

        let mut w = engine(&[(SourceKey::usage(0x04), Target::Mouse { function: 9 })]);
        assert_eq!(w.on_key('A' as u16, true).1, vec![Injected::Wheel { up: true }]);
        assert_eq!(w.on_key('A' as u16, true).1, vec![Injected::Wheel { up: true }]);
        assert!(w.on_key('A' as u16, false).1.is_empty());
    }

    #[test]
    fn physically_held_shift_is_not_pressed_twice() {
        let mut e = engine(&[(
            SourceKey::usage(0x39),
            Target::Key { modifiers: MOD_LSHIFT, usage: 0x04 },
        )]);
        // Left Shift passes through unmapped, so it is already down in Windows.
        assert_eq!(e.on_key(vk::LSHIFT, true), (false, Vec::new()));
        assert_eq!(e.on_key(vk::CAPITAL, true).1, vec![key('A' as u16, true)]);
        // Releasing Caps Lock must not release the physical Shift.
        assert_eq!(e.on_key(vk::CAPITAL, false).1, vec![key('A' as u16, false)]);
        assert_eq!(e.on_key(vk::LSHIFT, false), (false, Vec::new()));
    }

    #[test]
    fn two_keys_share_one_injected_modifier() {
        let mut e = engine(&[
            (SourceKey::usage(0x04), Target::Key { modifiers: MOD_LCTRL, usage: 0x06 }),
            (SourceKey::usage(0x05), Target::Key { modifiers: MOD_LCTRL, usage: 0x07 }),
        ]);
        assert_eq!(e.on_key('A' as u16, true).1, vec![key(vk::LCONTROL, true), key('C' as u16, true)]);
        assert_eq!(e.on_key('B' as u16, true).1, vec![key('D' as u16, true)]);
        assert_eq!(e.on_key('A' as u16, false).1, vec![key('C' as u16, false)]);
        assert_eq!(e.on_key('B' as u16, false).1, vec![key('D' as u16, false), key(vk::LCONTROL, false)]);
    }

    #[test]
    fn remapped_modifier_is_not_treated_as_held() {
        // Left Ctrl is remapped to A, so it must not count as a real modifier
        // when another mapping wants Ctrl.
        let mut e = engine(&[
            (SourceKey::modifier(MOD_LCTRL), Target::Key { modifiers: 0, usage: 0x04 }),
            (SourceKey::usage(0x04), Target::Key { modifiers: MOD_LCTRL, usage: 0x06 }),
        ]);
        assert_eq!(e.on_key(vk::LCONTROL, true).1, vec![key('A' as u16, true)]);
        assert_eq!(
            e.on_key('A' as u16, true).1,
            vec![key(vk::LCONTROL, true), key('C' as u16, true)]
        );
    }

    #[test]
    fn panic_shortcut_releases_held_keys_and_stops_mapping() {
        let mut e = engine(&[(SourceKey::usage(0x04), Target::Key { modifiers: MOD_LCTRL, usage: 0x06 })]);
        e.on_key('A' as u16, true);
        e.on_key(vk::LCONTROL, true);
        e.on_key(vk::LSHIFT, true);
        e.on_key(vk::LMENU, true);
        let (suppress, events) = e.on_key(vk::ESCAPE, true);
        assert!(!suppress, "Esc must reach Windows");
        assert_eq!(events, vec![key('C' as u16, false), key(vk::LCONTROL, false)]);
        assert!(e.is_panic());
        assert!(e.take_panic());
        assert!(!e.is_panic());
        // Mapping is gone: the next A passes through.
        assert!(!e.on_key('A' as u16, true).0);
    }

    #[test]
    fn panic_shortcut_needs_ctrl_alt_and_shift() {
        let mut e = engine(&[]);
        e.on_key(vk::LCONTROL, true);
        e.on_key(vk::LSHIFT, true);
        let (suppress, _) = e.on_key(vk::ESCAPE, true);
        assert!(!suppress);
        assert!(!e.is_panic());
    }

    #[test]
    fn clear_releases_everything() {
        let mut e = engine(&[(SourceKey::usage(0x04), Target::Key { modifiers: MOD_LCTRL, usage: 0x06 })]);
        e.on_key('A' as u16, true);
        assert_eq!(e.clear(), vec![key('C' as u16, false), key(vk::LCONTROL, false)]);
        assert_eq!(e.len(), 0);
    }

    #[test]
    fn replacing_the_table_releases_old_keys() {
        let mut e = engine(&[(SourceKey::usage(0x04), Target::Key { modifiers: 0, usage: 0x05 })]);
        e.on_key('A' as u16, true);
        let new_table = table_from(&[mapping(SourceKey::usage(0x04), Target::Off)]).unwrap();
        assert_eq!(e.replace(new_table), vec![key('B' as u16, false)]);
        assert_eq!(e.len(), 1);
    }

    #[test]
    fn self_mapping_is_emitted_once_and_ignores_injected_events() {
        let mut e = engine(&[(SourceKey::usage(0x04), Target::Key { modifiers: 0, usage: 0x04 })]);
        assert_eq!(e.on_key('A' as u16, true).1, vec![key('A' as u16, true)]);
        assert!(is_injected(0x10, 0));
        assert!(is_injected(0, MAGIC_EXTRA_INFO));
        assert!(!is_injected(0, 0));
    }

    #[test]
    fn mapping_count_ignores_generic_modifier_aliases() {
        let e = engine(&[(SourceKey::modifier(MOD_RCTRL), Target::Key { modifiers: 0, usage: 0x04 })]);
        assert_eq!(e.len(), 1);
    }

    #[test]
    fn generic_modifier_event_matches_a_side_specific_source() {
        let mut e = engine(&[(SourceKey::modifier(MOD_RCTRL), Target::Key { modifiers: 0, usage: 0x04 })]);
        assert_eq!(e.on_key(vk::CONTROL, true).1, vec![key('A' as u16, true)]);
        assert_eq!(e.on_key(vk::CONTROL, false).1, vec![key('A' as u16, false)]);
    }

    #[test]
    fn every_standard_keymap_usage_has_a_vk() {
        // The non-modifier usages of the 68-key table in razer/models.rs.
        for usage in [
            0x29, 0x1E, 0x1F, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x2D, 0x2E, 0x2A, 0x2B,
            0x14, 0x1A, 0x08, 0x15, 0x17, 0x1C, 0x18, 0x0C, 0x12, 0x13, 0x2F, 0x30, 0x31, 0x39, 0x04,
            0x16, 0x07, 0x09, 0x0A, 0x0B, 0x0D, 0x0E, 0x0F, 0x33, 0x34, 0x28, 0x1D, 0x1B, 0x06, 0x19,
            0x05, 0x11, 0x10, 0x36, 0x37, 0x38, 0x2C, 0x50, 0x52, 0x51, 0x4F, 0x4C, 0x4A, 0x4D, 0x4B,
            0x4E,
        ] {
            assert!(usage_to_vk(usage).is_some(), "usage {usage:#04x}");
        }
    }
}
