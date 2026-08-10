# RELEASE-001 Production Certification

## Disposition

**BLOCKED — ALIVO OS v1.0.0 is not Production Certified.**

The Linux build environment can validate the repository and create a Windows
installer, but it cannot provide the mandatory direct clean-machine evidence for
Windows 10 64-bit and Windows 11 64-bit. The production certification statement
must not be recorded until those independent gates and the remaining manual
release simulations pass against one unchanged release candidate.

## Release candidate

- Product version: `1.0.0`
- Candidate identity: `ALIVO OS v1.0.0-rc1`
- Installer identity: `ALIVO-OS-v1.0.0-Setup.exe`
- Source identity: the commit containing this record
- Source-freeze rule: only release-blocking corrections with regression tests;
  each correction requires a new candidate identity and affected-gate rerun

## Automated evidence

The repository unit suite, Blog integration suite, TypeScript build, desktop
syntax smoke, Build 0 audit, TypeScript static check, and `git diff --check`
pass in the certification environment. Installer packaging was initially blocked
by deprecated root-level electron-builder directory metadata; the release fix
moves output metadata into `build`, fixes the governed artifact name, explicitly
targets NSIS x64, and adds a regression test.

## Mandatory gates still awaiting direct evidence

| Gate | Result | Required evidence |
|---|---|---|
| Windows installer build | BLOCKED | electron-builder configuration validates, but the Linux packaging attempt ended with `ECONNRESET` while obtaining the Electron Windows runtime; no Setup executable or checksum was produced |
| Windows 10 x64 clean machine | BLOCKED | Install, launch, onboarding, GUI, persistence, reinstall, backup, corruption, restore, DPI, resize, offline, paths, shutdown, multi-instance, crash safety, accessibility and visual review on a clean Windows 10 machine |
| Windows 11 x64 clean machine | BLOCKED | Independent repetition of the Windows production gates on a clean Windows 11 machine |
| Same-installer certification | BLOCKED | The identical checksum-identified Setup executable must pass both operating systems |
| Disaster and salvage exercises | BLOCKED | Destructive FULL plus BACKUP, database loss, application loss, salvage, loss-window, multi-year, published-state and expired-queue exercises |
| Final archive | BLOCKED | FULL archive content/data/secret scans, clean extraction, included-installer test, supported rebuild and external checksum |
| Packaged GUI acceptance | BLOCKED | Manual Windows review at 100%, 125% and 150% scaling and representative laptop/desktop sizes |
| Release security audit | BLOCKED | Scan final source, build, archive, logs and test outputs after artifacts are frozen |

## Release blockers and next action

Windows 10 and Windows 11 are both mandatory; neither is inferred from the
other. No dependency incompatibility has been established, so the support policy
is unchanged. Run the complete certification matrix on dedicated clean Windows
10 and Windows 11 x64 machines using the same frozen installer. If any correction
is necessary, create `rc2` (or later), rerun affected gates, and rerun the full
suite. Only after every mandatory gate passes may final artifacts, checksums, tag,
completion report, and the `Production Certified` statement be created.
