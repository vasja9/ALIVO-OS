# Windows Production Compatibility Requirement

## Status

**Mandatory release requirement — certification pending.**

This requirement is an approved production constraint for ALIVO OS v1.0. It
does not claim that either operating system has passed clean-machine
certification.

## Supported production targets

- Windows 10 64-bit
- Windows 11 64-bit

The desktop package uses Electron Builder's NSIS target to produce one x64
artifact named `Setup.exe`. The same artifact is the certification candidate
for both supported operating systems; separate operating-system-specific
installers are not acceptable unless the approved requirement is changed.

Windows 10 support must never be inferred from a Windows 11 result. A release
cannot be certified until the exact release-candidate `Setup.exe` passes the
matrix below independently on clean Windows 10 and Windows 11 machines.

## Clean-machine certification matrix

Record a separate result and evidence reference in every cell. `Not run` and
`Blocked` are not passing results.

| Verification | Windows 10 64-bit | Windows 11 64-bit |
|---|---|---|
| `Setup.exe` installation | Not run | Not run |
| Application launch | Not run | Not run |
| First-Run Onboarding | Not run | Not run |
| Dashboard and all primary GUI workspaces | Not run | Not run |
| Persistent database | Not run | Not run |
| Credential Vault | Not run | Not run |
| Library | Not run | Not run |
| Blog workflow | Not run | Not run |
| Pinterest workflow | Not run | Not run |
| Scheduler | Not run | Not run |
| Backup Now | Not run | Not run |
| Monthly backup architecture | Not run | Not run |
| Integrity checks | Not run | Not run |
| Recovery Manager | Not run | Not run |
| Uninstall with data preservation | Not run | Not run |
| Reinstall with existing data | Not run | Not run |
| Offline startup | Not run | Not run |
| Normal Windows restart | Not run | Not run |

## Test protocol

For each operating system:

1. Start with a clean, fully updated 64-bit installation of the operating
   system with no ALIVO OS user data or development dependencies.
2. Record the operating-system edition, version and build; machine or virtual
   machine identity; test date; tester; and SHA-256 digest of `Setup.exe`.
3. Disconnect development tooling and install the unchanged release candidate
   through `Setup.exe`.
4. Execute every matrix row and retain logs, screenshots, database and backup
   evidence as applicable.
5. Uninstall the application without deleting user data, reinstall the same
   `Setup.exe`, and prove that the existing data is detected and usable.
6. Prove offline startup with networking disabled and prove startup after a
   normal operating-system restart.
7. Mark the operating-system column passing only when every row passes. A
   failure in either column blocks the v1.0 production release.

## Dependency safeguard

The packaging dependency versions are locked by `package-lock.json` and must be
reviewed as part of the release candidate. If Electron, Electron Builder, NSIS,
or a transitive runtime dependency prevents Windows 10 support, the release
must be blocked and the exact dependency name and resolved version recorded
before any proposal to change supported operating systems. Windows 10 support
must not be silently removed from configuration, documentation, testing, or
release claims.

## Evidence record

Certification evidence must identify the immutable `Setup.exe` digest and link
the completed result for every matrix row. Until those records exist, release
documentation must continue to state **certification pending** rather than
claiming Windows production compatibility.
