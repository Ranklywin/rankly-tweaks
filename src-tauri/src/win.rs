//! Small read-only Win32 queries used by support checks.

/// The main display's device name (for NVIDIA) and current refresh rate.
#[cfg(windows)]
pub fn primary_display() -> Option<(String, u32)> {
    use windows_sys::Win32::Graphics::Gdi::{
        EnumDisplayDevicesW, EnumDisplaySettingsW, DEVMODEW, DISPLAY_DEVICEW,
        DISPLAY_DEVICE_PRIMARY_DEVICE, ENUM_CURRENT_SETTINGS,
    };
    for index in 0..32 {
        // SAFETY: zeroed plain-data structs with their size fields set, as the APIs require.
        unsafe {
            let mut device: DISPLAY_DEVICEW = std::mem::zeroed();
            device.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
            if EnumDisplayDevicesW(std::ptr::null(), index, &mut device, 0) == 0 {
                return None;
            }
            if device.StateFlags & DISPLAY_DEVICE_PRIMARY_DEVICE == 0 {
                continue;
            }
            let mut mode: DEVMODEW = std::mem::zeroed();
            mode.dmSize = std::mem::size_of::<DEVMODEW>() as u16;
            if EnumDisplaySettingsW(device.DeviceName.as_ptr(), ENUM_CURRENT_SETTINGS, &mut mode)
                == 0
            {
                return None;
            }
            let end = device
                .DeviceName
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(device.DeviceName.len());
            return Some((
                String::from_utf16_lossy(&device.DeviceName[..end]),
                mode.dmDisplayFrequency,
            ));
        }
    }
    None
}

#[cfg(not(windows))]
pub fn primary_display() -> Option<(String, u32)> {
    None
}

/// True when the CPU reports more than one efficiency class (P-cores and E-cores).
#[cfg(windows)]
pub fn hybrid_cpu() -> bool {
    use windows_sys::Win32::System::SystemInformation::GetSystemCpuSetInformation;
    let mut needed = 0u32;
    // SAFETY: the first call only reports the buffer size; the second fills a buffer of that size.
    unsafe {
        GetSystemCpuSetInformation(
            std::ptr::null_mut(),
            0,
            &mut needed,
            std::ptr::null_mut(),
            0,
        );
        if needed == 0 {
            return false;
        }
        let mut buffer = vec![0u64; (needed as usize).div_ceil(8)];
        if GetSystemCpuSetInformation(
            buffer.as_mut_ptr().cast(),
            needed,
            &mut needed,
            std::ptr::null_mut(),
            0,
        ) == 0
        {
            return false;
        }
        let bytes = std::slice::from_raw_parts(buffer.as_ptr().cast::<u8>(), needed as usize);
        efficiency_classes(bytes).len() > 1
    }
}

#[cfg(not(windows))]
pub fn hybrid_cpu() -> bool {
    false
}

/// Distinct EfficiencyClass values in a SYSTEM_CPU_SET_INFORMATION buffer
/// (Size at offset 0, Type at 4, EfficiencyClass at 18 for CpuSet entries).
pub fn efficiency_classes(bytes: &[u8]) -> std::collections::BTreeSet<u8> {
    let mut classes = std::collections::BTreeSet::new();
    let mut offset = 0usize;
    while offset + 19 <= bytes.len() {
        let size = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
        let kind = u32::from_le_bytes(bytes[offset + 4..offset + 8].try_into().unwrap());
        if size < 19 {
            break;
        }
        if kind == 0 {
            classes.insert(bytes[offset + 18]);
        }
        offset += size;
    }
    classes
}

/// A G-SYNC frame cap that stays inside the variable refresh range: at least
/// 3 FPS under refresh (Blur Busters), more at high refresh rates.
pub fn gsync_frame_cap(refresh: u32) -> Option<u32> {
    if !(48..=1000).contains(&refresh) {
        return None;
    }
    let r = refresh as f64;
    Some(((r - r * r / 3600.0).floor() as u32).min(refresh - 3))
}
