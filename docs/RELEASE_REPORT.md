# Release validation — 1.0.0

Targets: Windows x64 companion, local VS Code UI extension and Linux SSH workspace component. All three component manifests are version **1.0.0**.

## Checks

Release validation is run from the final source tree:

- TypeScript build and test suite.
- Native Windows C# test suite.
- ESLint and TypeScript Prettier checks.
- Self-contained Windows publish and VSIX packaging.
- Packaged companion integration scenarios.
- Archive contents, embedded remote version, bilingual localization and binary hashes.
- Installed component hashes, stable executable path and icon identity preservation.
- Public main branch, tag, release and asset checks.

Local validation passed on Windows x64: **96 TypeScript tests**, **80 C# tests** and **16 packaged-companion integration scenarios**, with ESLint and TypeScript formatting checks passing. The main archive contains 21 files and the embedded remote archive contains 8 files. Both English and French localization catalogs and manifest resources are verified.

See the published release for artifact hashes. Automated tests do not certify every display DPI, Windows notification policy, network condition or a real quota renewal.

## Manual checks

Use [Manual acceptance checks](MANUAL_TESTS.md) for visual and end-user interaction. See the bilingual [English](../README.md) and [French](../README.fr.md) installation guides.
