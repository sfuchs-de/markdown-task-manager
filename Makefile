.PHONY: setup init dev api web test test-empty test-e2e build doctor privacy links qa docker

PYTHON ?= python3

setup:
	$(PYTHON) -m venv .venv
	.venv/bin/python -m pip install -r requirements-dev.txt
	npm --prefix web ci

init:
	.venv/bin/python scripts/pm.py init --vault vault

demo: init

dev:
	@echo "Run 'make api' and 'make web' in separate terminals."

api:
	PM_VAULT_ROOT="$${PM_VAULT_ROOT:-$$(pwd)/vault}" .venv/bin/python -m uvicorn server.app:app --host 127.0.0.1 --port 8765 --reload

web:
	npm --prefix web run dev

test:
	.venv/bin/python -m pytest
	npm --prefix web run test

test-empty:
	@tmp=$$(mktemp -d); PM_VAULT_ROOT="$$tmp" .venv/bin/python -m pytest; rm -rf "$$tmp"

test-e2e:
	npm --prefix web run test:e2e

build:
	npm --prefix web run build

doctor:
	.venv/bin/python scripts/pm.py doctor

privacy:
	.venv/bin/python scripts/privacy_scan.py --all-files

links:
	.venv/bin/python scripts/check_links.py

qa: test build privacy links

docker:
	docker compose up --build
