# Changelog

## 1.2.0

- NVIDIA tweaks: low latency, maximum performance, and a G-SYNC low-latency
  setup with a frame cap matched to your refresh rate.
- Multi-plane overlay off, for flicker or stutter in borderless games.
- Prefer performance cores on CPUs with P-cores and E-cores.
- Removed Variable refresh for more games (it is in Windows Settings); old
  backups still restore.

## 1.1.0

- Rebuilt on Tauri 2 with a Rust backend: a much smaller download and memory
  footprint. Existing recovery backups restore unchanged.
- Ships as an installer with in-app updates, verified by signature before
  installing. Replaces the portable executable.
- Performance checkup on Overview: flags a monitor below its highest refresh
  rate, a monitor on integrated graphics, memory at base speed or in one
  channel, laptops on battery, and missing or old graphics drivers.
- Mouse polling test on the new Input page.
- Variable refresh for more games (Windows VRR option).
- Update check: a notice offers newer releases. Nothing installs until you
  choose Update now; checks can be turned off in Settings.

## 1.0.0

First release: Windows gaming controls, support checks, local recovery,
custom dropdowns, dark/light themes, and sidebar social links.
