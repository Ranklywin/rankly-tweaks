# Rankly Tweaks

A free, open-source app for Windows gaming tweaks.

## Download

[**Download v1.1.0**](https://github.com/Ranklywin/rankly-tweaks/releases/download/v1.1.0/Rankly-Tweaks-1.1.0-setup.exe)

Windows 10 21H2+ or Windows 11, x64. Small installer with in-app updates;
requires administrator access and is not yet code-signed.
[Release notes and checksum](https://github.com/Ranklywin/rankly-tweaks/releases/tag/v1.1.0).

- Gaming, graphics, power, input, and network controls.
- A performance checkup for setup problems, and a mouse polling test.
- Support checks, change review, and local recovery.
- Dark/light themes and searchable tweaks.

Results vary by PC. Read each tweak's tradeoffs before applying it.
Opening the app does not apply tweaks.

## Development

Built with [Tauri](https://tauri.app/) (Rust) and React. Use Node.js 24 and stable Rust:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:5178/tests/ui/tweaks.html` for the simulated browser preview.
Run the desktop app with `npm run desktop` and build the installer with `npm run package`.
See [the migration notes](docs/tauri-migration.md) for how the backend is organized.

## Rankly

[Website](https://rankly.win/) · [X](https://x.com/Rankly_win) ·
[TikTok](https://www.tiktok.com/@rankly_win) · [YouTube](https://www.youtube.com/@Rankly_win)

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [MIT license](LICENSE) · [Third-party notices](THIRD_PARTY_NOTICES.md)
