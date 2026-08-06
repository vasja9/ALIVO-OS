# Engineering Decisions

## EDR-001 — Guard the frozen specification by digest

- **Status:** Accepted
- **Decision:** Audit the specification against SHA-256 `417f06ea5bfbc1947a5cdc47a185f4240856ed1434d76a0f65e8fdc25207ff79`.
- **Reason:** Git history is authoritative, while an explicit check makes accidental local edits immediately visible.
- **Consequence:** An authorized future specification must be a new file/version and requires a deliberate audit update.

## EDR-002 — Do not scaffold unspecified product components

- **Status:** Accepted
- **Decision:** Document the seven architecture names without choosing language, layout, interfaces, or dependencies.
- **Reason:** The Specification says further sections are incomplete. Empty scaffolds would falsely encode ownership and coupling decisions.
- **Consequence:** Build 0 remains documentation-and-governance only.

## EDR-003 — Use a dependency-free audit

- **Status:** Accepted
- **Decision:** Use a small Python 3 standard-library script behind `make audit`.
- **Reason:** This minimizes supply-chain exposure and makes validation portable and deterministic.
- **Consequence:** Python 3 and Make are the only audit-time tools.

## EDR-004 — Make certifications scope-explicit

- **Status:** Accepted
- **Decision:** Certify the Build 0 repository foundation, not unprovided product behavior.
- **Reason:** A broader claim would be unsupported by the authoritative text.
