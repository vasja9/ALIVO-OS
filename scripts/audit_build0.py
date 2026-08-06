#!/usr/bin/env python3
"""Deterministic, dependency-free audit for the Build 0 repository baseline."""

from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / "docs/ALIVO-OS_Specification_v1.0.md"
SPEC_SHA256 = "417f06ea5bfbc1947a5cdc47a185f4240856ed1434d76a0f65e8fdc25207ff79"
REQUIRED_DOCS = (
    "BUILD0_COMPLETION_REPORT.md",
    "FINAL_AUDIT.md",
    "ENGINEERING_METRICS.md",
    "KNOWLEDGE_GRAPH.md",
    "PROJECT_DASHBOARD.md",
    "ENGINEERING_LEDGER.md",
    "ENGINEERING_DECISIONS.md",
    "TRACEABILITY_MATRIX.md",
    "REPOSITORY_HEALTH.md",
    "TECHNICAL_DEBT.md",
    "CHANGELOG_BUILD0.md",
    "BUILD0_BASELINE.md",
    "ENGINEERING_CERTIFICATE.md",
    "RELEASE_CERTIFICATE.md",
)


def main() -> int:
    failures: list[str] = []
    digest = hashlib.sha256(SPEC.read_bytes()).hexdigest()
    if digest != SPEC_SHA256:
        failures.append(f"frozen specification digest changed: {digest}")

    for name in REQUIRED_DOCS:
        path = ROOT / "docs" / name
        if not path.is_file() or not path.read_text(encoding="utf-8").strip():
            failures.append(f"required document missing or empty: docs/{name}")

    matrix = (ROOT / "docs/TRACEABILITY_MATRIX.md").read_text(encoding="utf-8")
    for requirement in ("SPEC-001", "SPEC-002", "SPEC-003", "SPEC-004"):
        if requirement not in matrix:
            failures.append(f"traceability entry missing: {requirement}")

    if failures:
        for failure in failures:
            print(f"FAIL: {failure}")
        return 1
    print(f"PASS: Build 0 baseline audit ({len(REQUIRED_DOCS)} governed documents)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
