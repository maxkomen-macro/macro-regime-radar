# Macro Regime Radar — owner conveniences (2026-09-06). Never commits, pushes
# or deploys anything.

PY ?= .venv/bin/python

.PHONY: sync-data validate-db snapshot test-api test-web build-web actionlint

## Pull the latest validated DB snapshot from the private data-latest Release
## (needs `gh auth login`); validates before an atomic replace.
sync-data:
	bash scripts/sync_data.sh

## Validate the local DB the way the refresh workflow does.
validate-db:
	$(PY) scripts/validate_db.py data/macro_radar.db --mode verify-only --allow-stale "local check"

## Build web/public/snapshot/latest.json from the local DB.
snapshot:
	$(PY) scripts/build_snapshot.py

test-api:
	EODHD_PROBE_ON_START=0 $(PY) -m pytest tests -q --ignore=tests/test_streamlit_backports.py

test-web:
	cd web && npm run typecheck && npm test

build-web:
	cd web && npm run build

actionlint:
	actionlint .github/workflows/*.yml
