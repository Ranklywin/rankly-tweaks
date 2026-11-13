//! NVIDIA driver profile (DRS) access through the driver's own nvapi64.dll.
//! Function IDs, setting IDs and structure layouts come from NVIDIA's public
//! headers (github.com/NVIDIA/nvapi: nvapi_interface.h, nvapi.h,
//! NvApiDriverSettings.h). Only the current global profile is touched.
use serde_json::{json, Value};

pub const SETTING_NOT_FOUND: i32 = -160;

// NVDRS_SETTING_V1 under #pragma pack(4): 4 + 4096 + 5*4 + 2*4100 bytes.
const UNICODE_MAX: usize = 2048;
const BINARY_MAX: usize = 4096;
const SETTING_SIZE: usize = 12320;
const SETTING_VERSION: u32 = SETTING_SIZE as u32 | (1 << 16);
const VRR_INFO_VERSION: u32 = 24 | (1 << 16);

#[repr(C, packed(4))]
pub struct DrsSetting {
    pub version: u32,
    pub name: [u16; UNICODE_MAX],
    pub id: u32,
    pub kind: u32,
    pub location: u32,
    pub is_current_predefined: u32,
    pub is_predefined_valid: u32,
    pub predefined: [u8; 4 + BINARY_MAX],
    pub current: [u8; 4 + BINARY_MAX],
}

const _: () = assert!(std::mem::size_of::<DrsSetting>() == SETTING_SIZE);

impl DrsSetting {
    fn boxed() -> Box<Self> {
        // SAFETY: an all-zero bit pattern is valid for this plain-data struct.
        let mut s: Box<Self> = unsafe { Box::new(std::mem::zeroed()) };
        s.version = SETTING_VERSION;
        s
    }
    fn current_u32(&self) -> u32 {
        let c = self.current;
        u32::from_le_bytes([c[0], c[1], c[2], c[3]])
    }
}

/// One DWORD setting as stored in the global profile. `exists` is false when
/// the profile has no user value (the driver or NVIDIA's predefined value applies).
#[derive(Debug, Clone, PartialEq)]
pub struct Snapshot {
    pub id: u32,
    pub exists: bool,
    pub value: u32,
}

pub trait Drs {
    fn read(&self, ids: &[u32]) -> Result<Vec<Snapshot>, String>;
    /// Sets each value, or removes the user value when `value` is None, then saves.
    fn write(&self, changes: &[(u32, Option<u32>)]) -> Result<(), String>;
}

#[cfg(windows)]
mod native {
    use super::*;
    use std::ffi::c_void;
    use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};

    type Query = unsafe extern "C" fn(u32) -> *mut c_void;
    type Fn0 = unsafe extern "C" fn() -> i32;
    type Session = *mut c_void;
    type Profile = *mut c_void;

    pub struct Api {
        create_session: unsafe extern "C" fn(*mut Session) -> i32,
        destroy_session: unsafe extern "C" fn(Session) -> i32,
        load_settings: unsafe extern "C" fn(Session) -> i32,
        save_settings: unsafe extern "C" fn(Session) -> i32,
        current_global_profile: unsafe extern "C" fn(Session, *mut Profile) -> i32,
        get_setting: unsafe extern "C" fn(Session, Profile, u32, *mut DrsSetting) -> i32,
        set_setting: unsafe extern "C" fn(Session, Profile, *mut DrsSetting) -> i32,
        delete_setting: unsafe extern "C" fn(Session, Profile, u32) -> i32,
        setting_name: unsafe extern "C" fn(u32, *mut [u16; UNICODE_MAX]) -> i32,
        display_id_by_name: unsafe extern "C" fn(*const u8, *mut u32) -> i32,
        vrr_info: unsafe extern "C" fn(u32, *mut [u32; 6]) -> i32,
    }

    unsafe fn resolve<T: Copy>(query: Query, id: u32) -> Result<T, String> {
        let p = query(id);
        if p.is_null() {
            return Err(format!(
                "This NVIDIA driver does not provide function 0x{id:08x}."
            ));
        }
        Ok(std::mem::transmute_copy(&p))
    }

    pub fn load() -> Result<Api, String> {
        let dll: Vec<u16> = "nvapi64.dll\0".encode_utf16().collect();
        // SAFETY: documented Win32 and NVAPI entry points with the signatures from NVIDIA's headers.
        unsafe {
            let module = LoadLibraryW(dll.as_ptr());
            if module.is_null() {
                return Err("No NVIDIA driver was found.".into());
            }
            let query = GetProcAddress(module, c"nvapi_QueryInterface".as_ptr() as *const u8)
                .ok_or("The NVIDIA driver interface is unavailable.")?;
            let query: Query = std::mem::transmute(query);
            let initialize: Fn0 = resolve(query, 0x0150_e828)?;
            let status = initialize();
            if status != 0 {
                return Err(format!(
                    "The NVIDIA driver could not be initialized ({status})."
                ));
            }
            Ok(Api {
                create_session: resolve(query, 0x0694_d52e)?,
                destroy_session: resolve(query, 0xdad9_cff8)?,
                load_settings: resolve(query, 0x375d_bd6b)?,
                save_settings: resolve(query, 0xfcbc_7e14)?,
                current_global_profile: resolve(query, 0x617b_ff9f)?,
                get_setting: resolve(query, 0x73bf_8338)?,
                set_setting: resolve(query, 0x577d_d202)?,
                delete_setting: resolve(query, 0xe4a2_6362)?,
                setting_name: resolve(query, 0xd61c_be6e)?,
                display_id_by_name: resolve(query, 0xae45_7190)?,
                vrr_info: resolve(query, 0xdf8f_da57)?,
            })
        }
    }

    fn check(status: i32, what: &str) -> Result<(), String> {
        if status == 0 {
            Ok(())
        } else {
            Err(format!("The NVIDIA driver could not {what} ({status})."))
        }
    }

    /// An open driver-settings session on the current global profile.
    pub struct Open<'a> {
        api: &'a Api,
        session: Session,
        profile: Profile,
    }

    impl Drop for Open<'_> {
        fn drop(&mut self) {
            // SAFETY: the session was created by this API and is destroyed once.
            unsafe { (self.api.destroy_session)(self.session) };
        }
    }

    impl Api {
        pub fn open(&self) -> Result<Open<'_>, String> {
            let mut session: Session = std::ptr::null_mut();
            // SAFETY: out-pointers are valid for the duration of each call.
            unsafe {
                check((self.create_session)(&mut session), "open its settings")?;
                // Created before the next calls so the session is always destroyed.
                let mut open = Open {
                    api: self,
                    session,
                    profile: std::ptr::null_mut(),
                };
                check((self.load_settings)(session), "load its settings")?;
                check(
                    (self.current_global_profile)(session, &mut open.profile),
                    "find the global profile",
                )?;
                Ok(open)
            }
        }

        pub fn setting_name(&self, id: u32) -> Option<String> {
            let mut name = [0u16; UNICODE_MAX];
            // SAFETY: the buffer is NvAPI_UnicodeString-sized.
            let status = unsafe { (self.setting_name)(id, &mut name) };
            if status != 0 {
                return None;
            }
            let end = name.iter().position(|c| *c == 0).unwrap_or(UNICODE_MAX);
            Some(String::from_utf16_lossy(&name[..end]))
        }

        /// VRR state of a display such as `\\.\DISPLAY1`: (possible, requested, enabled).
        pub fn vrr(&self, display: &str) -> Option<(bool, bool, bool)> {
            let name = format!("{display}\0");
            let mut id = 0u32;
            let mut info = [0u32; 6];
            info[0] = VRR_INFO_VERSION;
            // SAFETY: NV_GET_VRR_INFO_V1 is six DWORDs; the name is NUL-terminated ANSI.
            unsafe {
                if (self.display_id_by_name)(name.as_ptr(), &mut id) != 0
                    || (self.vrr_info)(id, &mut info) != 0
                {
                    return None;
                }
            }
            let bits = info[1];
            Some((bits & 2 != 0, bits & 4 != 0, bits & 1 != 0))
        }
    }

    impl Open<'_> {
        pub fn get(&self, id: u32) -> Result<Snapshot, String> {
            let mut s = DrsSetting::boxed();
            // SAFETY: the setting buffer is a correctly versioned NVDRS_SETTING_V1.
            let status = unsafe { (self.api.get_setting)(self.session, self.profile, id, &mut *s) };
            if status == SETTING_NOT_FOUND {
                return Ok(Snapshot {
                    id,
                    exists: false,
                    value: 0,
                });
            }
            check(status, "read a setting")?;
            let (kind, location, predefined) = (s.kind, s.location, s.is_current_predefined);
            if kind != 0 {
                return Err("An NVIDIA setting has an unexpected type.".into());
            }
            // Only a value stored in this profile by a user or tool is "set"; predefined
            // and inherited values are what deleting the setting restores.
            let exists = location == 0 && predefined == 0;
            Ok(Snapshot {
                id,
                exists,
                value: s.current_u32(),
            })
        }

        pub fn set(&self, id: u32, value: u32) -> Result<(), String> {
            let mut s = DrsSetting::boxed();
            s.id = id;
            s.kind = 0;
            s.current[..4].copy_from_slice(&value.to_le_bytes());
            // SAFETY: as above.
            check(
                unsafe { (self.api.set_setting)(self.session, self.profile, &mut *s) },
                "change a setting",
            )
        }

        pub fn delete(&self, id: u32) -> Result<(), String> {
            // SAFETY: deleting a profile value by ID; "not found" means already default.
            let status = unsafe { (self.api.delete_setting)(self.session, self.profile, id) };
            if status == SETTING_NOT_FOUND {
                Ok(())
            } else {
                check(status, "restore a setting")
            }
        }

        pub fn save(&self) -> Result<(), String> {
            // SAFETY: saves the loaded session to the driver's settings store.
            check(
                unsafe { (self.api.save_settings)(self.session) },
                "save its settings",
            )
        }
    }
}

#[cfg(windows)]
pub use native::{load, Api};

/// The real driver, loaded on first use.
pub struct Driver;

impl Drs for Driver {
    fn read(&self, ids: &[u32]) -> Result<Vec<Snapshot>, String> {
        #[cfg(windows)]
        {
            let api = load()?;
            let open = api.open()?;
            ids.iter().map(|id| open.get(*id)).collect()
        }
        #[cfg(not(windows))]
        {
            let _ = ids;
            Err("This feature requires Windows.".into())
        }
    }

    fn write(&self, changes: &[(u32, Option<u32>)]) -> Result<(), String> {
        #[cfg(windows)]
        {
            let api = load()?;
            let open = api.open()?;
            for (id, value) in changes {
                match value {
                    Some(v) => open.set(*id, *v)?,
                    None => open.delete(*id)?,
                }
            }
            open.save()
        }
        #[cfg(not(windows))]
        {
            let _ = changes;
            Err("This feature requires Windows.".into())
        }
    }
}

/// What support checks need: whether the driver is usable and, for the
/// primary display, whether G-SYNC/VRR is turned on.
pub fn probe(primary_display: Option<&str>) -> Value {
    #[cfg(windows)]
    {
        match load() {
            Ok(api) => {
                let usable = api.open().is_ok();
                let vrr = primary_display.and_then(|d| api.vrr(d));
                json!({"available": usable, "vrrPossible": vrr.map(|v| v.0), "vrrOn": vrr.map(|v| v.0 && v.1)})
            }
            Err(_) => json!({"available": false}),
        }
    }
    #[cfg(not(windows))]
    {
        let _ = primary_display;
        json!({"available": false})
    }
}
