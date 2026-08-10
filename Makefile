.PHONY: audit build test desktop-smoke package-windows release-archive

audit:
	python3 scripts/audit_build0.py

build:
	tsc --project tsconfig.json

test:
	node --experimental-transform-types --test tests/unit/*.test.ts

desktop-smoke:
	node --check ui/shell.js && node --check electron/main.cjs

package-windows:
	npm run package:windows

release-archive:
	npm run release:archive
