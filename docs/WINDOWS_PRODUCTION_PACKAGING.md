# Windows Production Packaging

## Scope

DEPLOY-002 establishes the source-controlled production installer configuration for ALIVO-OS Personal Edition. The installer is a release artifact: `Setup.exe` and all unpacked or intermediate packaging output must be generated on the Windows certification machine and must not be committed.

## Compatibility

- Supported client operating systems: 64-bit Windows 10 and Windows 11.
- Supported architecture: x64.
- Installer format: NSIS assisted installer (`Setup.exe`).
- Installation scope: current user by default, with elevation available when the chosen location requires it.
- Windows versions earlier than Windows 10 are rejected before installation.

## Certification Build

On the Windows certification machine, use a clean checkout and the lockfile-controlled dependency set:

```powershell
npm ci
npm run build
npm test
npm run desktop:smoke
npm run package:verify
npm run package:win
```

The generated installer is written beneath `release/`. It must be retained by the release pipeline as an external release artifact, then code-signed, malware-scanned, installed, launched, and uninstalled on current Windows 10 and Windows 11 x64 certification targets before release.

## Source and Artifact Boundary

The repository retains Electron source, builder and NSIS configuration, package metadata and lockfile, verification scripts, tests, and this compatibility requirement. Generated executables, libraries, block maps, installers, and unpacked application directories are excluded through `.gitignore`.
