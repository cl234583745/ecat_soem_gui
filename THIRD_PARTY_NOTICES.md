# Third-Party Notices

ECAT Bench is licensed under GPL-3.0-only. The complete project license is in
`LICENSE`.

## SOEM 2.0.0

- Source: `third_party/SOEM`
- Upstream: https://github.com/OpenEtherCATsociety/SOEM
- Tag: `v2.0.0`
- Commit: `304d1c05eab77dc0d426f1a5cf09c8cc7dc03713`
- License: GPLv3 or commercial license from RT-Labs
- License text: `licenses/SOEM-LICENSE.md`

SOEM is linked only into builds configured with `-EnableSoem`. ECAT Bench
distributes those builds under GPL-3.0-only and provides the corresponding
source code through the tagged GitHub repository and release source archive.

## nlohmann/json 3.11.2

- Source: `third_party/nlohmann-json`
- License: MIT
- License text: `licenses/nlohmann-json-LICENSE.txt`

## Electron and Chromium

- Runtime: Electron 45
- License: MIT for Electron; Chromium and its bundled components retain their
  respective licenses
- License texts: `licenses/Electron-LICENSE.txt` and
  `licenses/Electron-Chromium-LICENSES.html`

## React and React DOM

- Runtime: React 19 and React DOM 19
- License: MIT
- License texts: `licenses/React-LICENSE.txt` and
  `licenses/ReactDOM-LICENSE.txt`

## Lucide

- Runtime: `lucide-react`
- License: ISC
- License text: `licenses/Lucide-LICENSE.txt`

## Npcap

Npcap is an external runtime and SDK dependency for Windows raw packet access.
No Npcap runtime binaries, SDK files, or installer are included in this
repository or application package. Review the Npcap license and OEM
redistribution terms before distribution.

## Build-Time Packages

Vite, TypeScript, Vitest, Playwright, electron-builder, and other build-time
packages retain their own licenses under `node_modules`. The exact dependency
graph and declared licenses are recorded in `package-lock.json`. Build-time
packages are not included as application runtime dependencies unless Electron
Builder packages them into the application.

## rcedit

- Build dependency: `rcedit` 5.x
- License: MIT
- Usage: applies the Windows icon and version metadata after packaging.
- It is not shipped as production application code.
