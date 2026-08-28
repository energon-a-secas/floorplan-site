.DEFAULT_GOAL := help

PORT = 8868

# ── Help ──────────────────────────────────────────────────────────────────────
.PHONY: help
help:
	@echo ""
	@echo "  make serve    Start dev server → http://localhost:$(PORT)"
	@echo "  make kill     Kill this project's HTTP server"
	@echo "  make test     Run the Node tests (presence core)"
	@echo "  make install  npm install (Convex CLI for the presence backend)"
	@echo "  make convex   Run Convex dev (deploys functions + watches)"
	@echo "  make deploy   Deploy Convex functions to production"
	@echo "  make login    Authenticate with Convex"
	@echo ""

# ── Dev server ────────────────────────────────────────────────────────────────
.PHONY: serve
serve:
	@echo "Serving → http://localhost:$(PORT)"
	@if [ -f ../../scripts/serve.py ]; then python3 ../../scripts/serve.py $(PORT); else python3 -m http.server $(PORT); fi

# ── Kill ──────────────────────────────────────────────────────────────────────
.PHONY: kill
kill:
	@lsof -ti :$(PORT) | xargs kill 2>/dev/null && echo "Stopped server on port $(PORT)" || echo "No server running on port $(PORT)"

# ── Tests ─────────────────────────────────────────────────────────────────────
.PHONY: test
test:
	node --test "test/*.test.mjs"

# ── Convex (Visit-mode presence backend; optional) ────────────────────────────
.PHONY: install
install:
	npm install

.PHONY: convex
convex:
	npx convex dev

.PHONY: deploy
deploy:
	npx convex deploy

.PHONY: login
login:
	npx convex login
