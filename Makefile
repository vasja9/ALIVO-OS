.PHONY: audit build test desktop-smoke

audit:
	python3 scripts/audit_build0.py

build:
	tsc --project tsconfig.json

test:
	node --experimental-transform-types --test tests/unit/*.test.ts

desktop-smoke:
	node --check ui/shell.js && node --check electron/main.cjs
