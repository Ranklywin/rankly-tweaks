# Third-party notices

Rankly's application code is distributed under the [MIT License](LICENSE).
The following libraries and assets are bundled in the frontend. Their original
copyright and license texts are preserved in the linked files.

| Component | Version | License | Full notice |
| --- | --- | --- | --- |
| react | 19.2.3 | MIT | [License](licenses/react.txt) |
| react-dom | 19.2.3 | MIT | [License](licenses/react-dom.txt) |
| scheduler | 0.27.0 | MIT | [License](licenses/scheduler.txt) |
| lucide-react | 0.562.0 | ISC | [License](licenses/lucide-react.txt) |
| @fontsource/poppins | 5.2.7 | OFL-1.1 | [License](licenses/fontsource-poppins.txt) |

The Windows executable is built with Tauri 2.12.5 and 274 Rust crates.
Their names, versions, licenses, and full license texts are listed in
[licenses/rust-crates.txt](licenses/rust-crates.txt). The interface runs in the
Microsoft Edge WebView2 runtime provided by Windows; it is not bundled.

The project license, this notice, and the licenses directory are also installed
with the app. Build tools are development dependencies; their license metadata
remains available through package-lock.json, Cargo.lock, npm, and cargo.

Regenerate this file and the license copies with npm run notices:update after
changing bundled dependencies. npm run check:release checks these copies.
