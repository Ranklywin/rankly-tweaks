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

The Windows executable also includes Electron 44.3.0 and its Chromium,
Node.js, and other runtime components. Electron's original LICENSE.electron.txt
and LICENSES.chromium.html are retained beside the extracted executable.
The portable launcher contains that complete runtime distribution.

The project license, this notice, and the licenses directory are also included
in the portable distribution. Build tools are development dependencies; their
license metadata remains available through package-lock.json and npm.

Regenerate this file and the frontend license copies with npm run notices:update
after changing bundled dependencies. npm run check:release checks these copies.
