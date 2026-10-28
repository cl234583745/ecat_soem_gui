# Third-Party Notices

## SOEM 2.0.0

- Source: `third_party/SOEM`
- Upstream: https://github.com/OpenEtherCATsociety/SOEM
- Tag: `v2.0.0`
- Commit: `304d1c05eab77dc0d426f1a5cf09c8cc7dc03713`
- License: GPLv3 or commercial license from RT-Labs
- License text: `third_party/SOEM/LICENSE.md`

SOEM is linked only into builds configured with `-EnableSoem`. Public
distribution requires either GPLv3-compliant corresponding source or an
applicable commercial license. The project is currently marked
`UNLICENSED`, so this decision remains open.

## nlohmann/json 3.11.2

- Source: `third_party/nlohmann-json`
- License: MIT
- License text: `third_party/nlohmann-json/LICENSE.MIT`

## Npcap

Npcap is an external runtime and SDK dependency for Windows raw packet access.
No Npcap runtime binaries, SDK files, or installer are included in this
repository or application package. Review the Npcap license and OEM
redistribution terms before distribution.

## Electron and JavaScript Packages

Electron, React, Vite, and build-time packages retain their own licenses under
`node_modules`. The exact dependency graph is recorded in
`package-lock.json`. Generate a production license report and review Electron's
notices before a public release.

## rcedit

- Build dependency: `rcedit` 5.x
- License: MIT
- Usage: applies the Windows icon and version metadata after packaging.
- It is not shipped as production application code.
