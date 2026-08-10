# DEPLOY-004 Implementation and Certification Record

## Release-gate result

**CONDITIONALLY PASS — Linux destructive-fixture certification passed; Windows installer/path certification remains required before Production Certified status.** DEPLOY-004 does not declare ALIVO OS v1.0 Production Certified.

## Repository inspection and recovery inventory

ALIVO OS currently uses repository abstractions and filesystem-backed JSON persistence, not a production SQL database. Repository transactions provide atomic in-memory commit/rollback semantics; deployment/onboarding state is an atomically replaced schema-versioned JSON document beneath Electron `userData`. Domain repositories retain immutable, stable IDs, versions, Business Package ownership, provenance and audit history. There is no separate database migration engine to duplicate: recovery validates `databaseSchemaVersion` and reports unsupported formats rather than inventing a parallel migration path.

| Classification | Authoritative scope | Backup treatment |
|---|---|---|
| Critical persistent state | Library Books/Editions, Knowledge Sources and versions, Questions/Recommendations, Blog draft/review/publication lineage, Pinterest plans/queue/publication lineage, Performance history, Learning, Decision Memory, Trust grants, Business Package configuration, audit/recovery history | Included as schema/versioned domain artifacts, with stable identity, package scope, provenance and SHA-256 |
| Recoverable/reconstructable | derived read models, search projections, scheduler projections and provider reconciliation projections | Rebuild; exclude cache copies |
| Transient/cache | temporary writes, incomplete archives, UI state, provider responses and generated caches | Excluded |
| Credential state | Credential Vault encrypted document, master password, provider secrets, private keys | Outside ordinary backup scope; plaintext/credential-shaped payloads are rejected; missing credentials become Authentication Required |
| Application state | packaged Electron/TypeScript binaries and `node_modules` | Excluded; supplied by the DEPLOY-003 FULL archive/DEPLOY-002 installer |

Active operational state and its integrity sidecars use the existing application-data boundary. Short-horizon snapshots live under `recovery/snapshots`; ordinary backups use the CEO-configured filesystem location. Onboarding verifies that location by a real write/read/delete probe and reports same-root storage. DEPLOY-003 remains the independent application-survival source.

## Implemented behavior

- A real, standards-readable ZIP archive named `ALIVO-OS-BACKUP-YYYY-MM-DD-HHMM-<id>.zip` contains `manifest.json` and versioned `state/` records. The dependency-free reader accepts stored/deflated entries and rejects encryption, traversal, duplicates, bad CRCs and malformed directories.
- The self-describing manifest records backup/format/schema/application versions, a safely hashed installation identity, Business Package scope, type counts, artifact identity/version/type/package inventory, SHA-256 checksums and verification time.
- Output is written with restricted mode to a unique temporary file, fsynced, parsed and deeply verified, then atomically renamed. Failed candidates are removed and do not trigger retention. At least two verified generations are enforced.
- Create, verify, list, inspect, authority-gated delete and authority-gated restore operations are implemented. External filesystem paths are supported and same-root storage is detectable.
- Monthly protection defaults on, at midnight UTC on the first day of the month. `shouldCatchUp` deterministically identifies one missed monthly opportunity; the host scheduler must invoke it once per runtime opportunity.
- Normal writes atomically replace artifact and SHA-256/schema/version metadata. Lightweight integrity classifies healthy, missing and corrupt state. Versioned checksummed local snapshots are bounded.
- Surgical self-healing tries newest snapshots first, skips damaged generations, validates the replacement and records history. Three repeated failures escalate and stop the repair loop.
- Approved-path discovery never crawls a disk. ZIP analysis is read-only and classifies verified, corrupt, unsupported and unknown sources.
- Salvage uses stable identity/version/package/provenance and declared dependencies. It deduplicates identical versions, imports deterministically newer valid records, rejects older/orphan/invalid candidates, and turns ambiguous same-version alternatives into blocking conflicts without model guessing.
- Restore makes a read-only forensic source copy, reconstructs a new clean target, blocks unsafe/conflicted plans, and uses rename-based activation. Existing state is renamed aside and restored if activation fails. A permanent, count-based report is written after successful activation.
- Existing GUI integration exposes System → Recovery, status, backups, integrity, sources, plan phases, conflicts/history entry points, Backup Now and approved-location scanning. Onboarding's Recover Existing route targets the Recovery Manager.

## Certification evidence

The isolated `RecoveryManager.test.ts` suite performs real filesystem mutation using synthetic artifacts. It certifies legitimate updates, missing/corrupt artifact detection and repair, fallback from a broken newest snapshot, real-ZIP creation and inspection, manifest/checksum tamper rejection, credential exclusion, restricted discovery, deterministic salvage, orphan rejection, conflict blocking, forensic copying, clean-target activation, authorization, retention protection, catch-up detection and repeated-corruption escalation.

The representative fresh-target restore includes Books, Knowledge, Blogs, Pins, Learning and Decision artifacts and salvages a newer Question. Actual fixture archive sizes are emitted by filesystem inspection during certification rather than estimated compression claims; stored ZIP mode intentionally trades compression for a small, auditable recovery dependency surface.

## Scenario disposition

| Scenario | Result |
|---|---|
| Missing artifact / corrupt artifact / legitimate update | PASS |
| Broken newest snapshot fallback | PASS |
| Tampered latest backup; prior verified generation preserved | PASS |
| Fresh clean target from verified backup | PASS |
| Newer deterministic salvage, orphan rejection, conflict stop | PASS |
| Lost credentials | PASS at backup boundary; provider UI remains Authentication Required through existing integration state |
| Interrupted controlled artifact write | PASS by temporary-file fsync plus atomic rename |
| Complete local loss with FULL + BACKUP | Component-level PASS; final Setup.exe test pending Windows |
| Multi-year / future-sized persistence | Domain retention is preserved by artifact restore; representative Windows endurance certification pending |
| Maximum loss window | Valid post-backup candidates are recovered; only invalid/orphan/conflicted candidates are rejected. No fabricated time/count claim is made. |
| Secret audit | PASS for changed implementation and generated synthetic archives |

## Known limitations and mandatory follow-up gate

Final DEPLOY-002 `Setup.exe`, removable-drive/NAS path behavior, Windows ACL/read-only semantics, adaptive machine timezone behavior and complete FULL+BACKUP reinstall/launch must be certified on Windows. This container cannot truthfully issue that platform certificate. The UI is a desktop smoke surface; production IPC wiring for long-running progress and bounded pagination remains part of Windows integration certification. No SQL-native integrity check is claimed because this repository has no production SQL engine.
