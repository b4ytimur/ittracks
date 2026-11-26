# Run ittracks on this computer.
#
#   make up     start the app and print the address to open (Ctrl+C stops it)
#   make seed   add example habits and a few weeks of history to the database
#   make mcp    put the AI assistant script in ~/.ittracks/ and print the config that points at it
#               (run it again after pulling to update the copy)
#
# up and seed install packages when package-lock.json has changed and bring the database up to
# date first. Any setting below can be changed for one run:  make up PORT=5180 DATABASE_PATH=./data/try.db

PORT          ?= 5173
HOST          ?= localhost
DATABASE_PATH ?= ./data/ittracks.db
# Used only when the database has no account yet. Otherwise the example data goes into the
# account that is there: a server has one account.
SEED_USER     ?= demo
SEED_PASSWORD ?= demo1234
# Where make mcp puts the AI assistant script. macOS doesn't let Claude Desktop read Documents,
# Desktop or Downloads, so a copy here works where the repository's own file may not.
MCP_DIR       ?= $(HOME)/.ittracks

# The app, the migrations and the seed script all read the database path from the environment.
export DATABASE_PATH

URL := http://$(HOST):$(PORT)

# Packages, then the database's tables. The app also migrates when it starts; doing it here
# first means `make seed` works on a database the app has never opened.
define prepare
	@[ node_modules/.package-lock.json -nt package-lock.json ] || npm ci --no-audit --no-fund
	@mkdir -p "$$(dirname "$(DATABASE_PATH)")"
	@npm run --silent db:migrate > /dev/null
endef

.PHONY: up seed mcp

# The address is printed once the app answers, not as soon as the server starts. The server
# then runs in the foreground, so Ctrl+C stops it.
up:
	$(prepare)
	@if curl -s -o /dev/null "$(URL)"; then \
		echo "Something is already running at $(URL). Stop it, or pick another port: make up PORT=5180" >&2; \
		exit 1; \
	fi
	@( until curl -s -o /dev/null "$(URL)/login"; do kill -0 $$$$ 2> /dev/null || exit; sleep 0.3; done; \
	   echo "$(URL)" ) & \
	exec npm run --silent dev -- --host $(HOST) --port $(PORT) --strictPort --logLevel warn

seed:
	$(prepare)
	@node scripts/seed-demo.mjs --db $(DATABASE_PATH) --create-user $(SEED_USER):$(SEED_PASSWORD)

# The address is make up's. The key is made in the app (Settings → Keys), so the config keeps a
# place for it.
mcp:
	@mkdir -p "$(MCP_DIR)"
	@if cmp -s static/ittracks-mcp.mjs "$(MCP_DIR)/ittracks-mcp.mjs"; then \
		echo "$(MCP_DIR)/ittracks-mcp.mjs is up to date."; \
	else \
		cp static/ittracks-mcp.mjs "$(MCP_DIR)/ittracks-mcp.mjs" && \
		echo "Copied ittracks-mcp.mjs (version $$(sed -n "s/^const VERSION = '\(.*\)';/\1/p" static/ittracks-mcp.mjs)) to $(MCP_DIR)/"; \
	fi
	@echo
	@echo "Claude Desktop: Settings → Developer → Edit Config, add this, then restart Claude Desktop."
	@echo "Make a key in the app under Settings → Keys and put it in place of itk_…"
	@echo
	@node -e 'const [file, url] = process.argv.slice(1); console.log(JSON.stringify({ mcpServers: { ittracks: { command: "node", args: [file], env: { ITTRACKS_URL: url, ITTRACKS_KEY: "itk_…" } } } }, null, 2))' "$(MCP_DIR)/ittracks-mcp.mjs" "$(URL)"
	@echo
	@echo "Claude Code:"
	@echo "claude mcp add ittracks -e ITTRACKS_URL=$(URL) -e ITTRACKS_KEY=itk_… -- node \"$(MCP_DIR)/ittracks-mcp.mjs\""
