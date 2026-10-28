# Changelog

All notable changes to this project are documented in this file.
This project follows [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-10-28

### Added

- Physical EtherCAT backend based on SOEM v2.0.0.
- NPF adapter discovery and real slave scan support.
- Real hardware scan and OP validation with WKC checks.
- Portable Windows x64 release packaging.
- GPL-3.0-only project licensing and bundled third-party notices.

### Changed

- Native output is staged in `native/build/bin`.
- MinGW/Ninja builds copy required runtime DLLs into the application package.
- SOEM packaging validates all required license files before building.
- Npcap is documented as a user-installed runtime dependency and is not bundled.

### Known Limitations

- SDO, PDO, and FoE have not completed acceptance testing on real slaves.
- The Windows 1 ms cycle has not completed the 30-minute real-time acceptance
  run.
- ENI files are recorded but do not yet override SOEM's automatic PDO mapping.

## [0.1.0] - 2026-10-27

### Added

- Initial React and Electron EtherCAT commissioning console.
- Native JSON-Lines simulator and TypeScript simulator fallback.
- Adapter, slave, state-machine, SDO, PDO, FoE, and diagnostics UI foundations.

[0.2.0]: https://github.com/cl234583745/ecat_soem_gui/releases/tag/v0.2.0
