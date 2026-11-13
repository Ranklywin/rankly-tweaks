//! Read-only probe of the NVIDIA driver on this PC. Run with --ignored --nocapture.
#![cfg(windows)]
use rankly_tweaks_lib::nvapi;

#[test]
#[ignore = "reads this PC's NVIDIA driver; run with --ignored"]
fn print_driver_settings() {
    let api = nvapi::load().expect("driver");
    let open = api.open().expect("session");
    for id in [
        0x007B_A09E,
        0x1057_EB71,
        0x00A8_79CF,
        0x1083_5002,
        0x0005_F543,
        0x1083_5000,
        0x10A8_79CF,
        0x1194_F158,
        0x00AC_8497,
    ] {
        println!(
            "0x{id:08X} {:?} => {:?}",
            api.setting_name(id),
            open.get(id)
        );
    }
    for d in 1..=4 {
        println!("DISPLAY{d}: {:?}", api.vrr(&format!(r"\\.\DISPLAY{d}")));
    }
}
