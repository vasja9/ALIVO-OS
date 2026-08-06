.PHONY: audit build test

audit:
	python3 scripts/audit_build0.py

build:
	tsc --project tsconfig.json

test:
	node --experimental-transform-types --test tests/unit/*.test.ts
