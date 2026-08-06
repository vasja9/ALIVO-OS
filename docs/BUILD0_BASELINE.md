# Build 0 Baseline

## Purpose

Build 0 is the repository-foundation baseline. It establishes governance and traceability; it does not implement product behavior. The frozen Specification v1.0 names the architecture but explicitly says its remaining sections are not yet complete. Implementing those components would therefore introduce unsupported assumptions.

## Controlled contents

- `README.md`: project identity and phase.
- `docs/ALIVO-OS_Specification_v1.0.md`: immutable authority.
- `docs/*.md`: governance, evidence, and certification records.
- `scripts/audit_build0.py`: deterministic baseline audit using only Python's standard library.
- `Makefile`: stable `make audit` entry point.

## Reproduction

Use Git to check out the certified commit, install Python 3, and run `make audit`. No network service, generated artifact, package manager, secret, database, or third-party dependency is required.

## Freeze rule

After certification, changes require explicit CEO authorization. Build 1 must not begin by inference. Specification changes must occur through a separately authorized specification version, never by editing v1.0.
