# DEPLOY-002 — Windows Production Packaging Installer

## Release contract

ALIVO OS 1.0.0 is packaged with Electron Builder as an NSIS installer for Windows
x64. The certified output name is `ALIVO-OS-v1.0.0-Setup.exe`. It is a release
artifact generated on the Windows certification machine and is never committed.

The supported production environments are 64-bit editions of Windows 10 and
Windows 11. A 64-bit processor and a user account permitted to install desktop
applications are required. The installer is per-user by default, presents an
installation-directory choice, and creates Start menu and desktop shortcuts.

## Certification build

1. Use a clean source checkout on the Windows x64 certification machine.
2. Install the locked dependencies with `npm ci`.
3. Place the approved application identity asset at
   `build-resources/icon.ico`; do not commit the binary asset.
4. Run `npm test`, `npm run build`, `npm run desktop:smoke`, and
   `npm run package:verify`.
5. Run `npm run package:windows` and certify the resulting installer from
   `dist/`.

No script refers to a developer workstation, an absolute source path, or a local
`node_modules` tree. Dependencies are resolved exclusively from the lockfile.

## Data preservation and lifecycle

On Windows, mutable state is stored under the operating system application-data
root in the stable `ALIVO OS` directory. It is not stored beside the executable
or inside the packaged application. Updating or reinstalling replaces application
files without relocating persistent state.

The NSIS uninstaller does not delete the application-data directory. Consequently,
uninstall followed by reinstall preserves onboarding and future persistent state.
Deleting that data is an explicit user or administrative operation, not an
installer side effect.

Generated directories (`dist/`, `release/`, `out/`, and `win-unpacked/`) and
Windows binary outputs are ignored. They must remain outside commits and pull
requests.
