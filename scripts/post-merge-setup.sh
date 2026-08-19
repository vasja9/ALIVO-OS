#!/usr/bin/env bash
set -euo pipefail

export CI=true

npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run build
npm run desktop:smoke