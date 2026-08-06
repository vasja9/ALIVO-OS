.PHONY: audit build

audit:
	python3 scripts/audit_build0.py

build:
	tsc --project tsconfig.json
