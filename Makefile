# Visualization Makefile

.PHONY: serve run stop clean help check-commits fix-commits format check-format venv icons viz viz-convert viz-dry-run

# Default port
PORT ?= 8000

# Python executable
PYTHON := python3

# Virtual environment
VENV_DIR := .venv
VENV_PYTHON := $(VENV_DIR)/bin/python3
VENV_PIP := $(VENV_DIR)/bin/pip

## serve: Start the web server
serve: stop
	@echo "Starting server..."
	@sh -c '$(PYTHON) -m http.server $(PORT) > server.log 2>&1 & echo $$! > server.pid'
	@sleep 1
	@echo ""
	@echo "✨ Visualization running!"
	@echo "📍 URL: http://localhost:$(PORT)"
	@echo ""
	@echo "Use 'make stop' to stop the server"

## run: Alias for serve
run: serve

## stop: Stop the web server
stop:
	@sh -c 'test -f server.pid && kill $$(cat server.pid) 2>/dev/null || true'
	@rm -f server.pid

## clean: Clean up server files
clean: stop
	@rm -f server.log server.pid
	@echo "Cleaned up server files"

## check-commits: Check if commit messages follow CLAUDE.md guidelines
check-commits:
	@echo "Checking commit messages for CLAUDE.md compliance..."
	@failed=0; \
	for commit in $$(git log --format=%H origin/main..HEAD 2>/dev/null || git log --format=%H -10); do \
		msg=$$(git log -1 --format=%B $$commit); \
		subject=$$(echo "$$msg" | head -1); \
		body=$$(echo "$$msg" | tail -n +2); \
		errors=""; \
		if echo "$$subject" | grep -q "Generated-by:\|Signed-off-by:\|Co-Authored-By:"; then \
			errors="$$errors\n  ❌ Subject line contains attribution (should be in body only)"; \
		fi; \
		if ! echo "$$body" | grep -q "^Generated-by: "; then \
			errors="$$errors\n  ❌ Missing 'Generated-by:' tag in body (e.g. 'Generated-by: Claude AI')"; \
		fi; \
		if ! echo "$$body" | grep -q "^Signed-off-by: "; then \
			errors="$$errors\n  ❌ Missing 'Signed-off-by:' tag in body"; \
		fi; \
		if echo "$$body" | grep -q "Co-Authored-By:"; then \
			errors="$$errors\n  ❌ Contains incorrect 'Co-Authored-By' (use 'Generated-by' instead)"; \
		fi; \
		if echo "$$body" | grep -q "Claude Code"; then \
			errors="$$errors\n  ❌ Contains 'Claude Code' reference (use 'Claude AI' instead)"; \
		fi; \
		if [ ! -z "$$errors" ]; then \
			echo ""; \
			echo "❌ Commit $$commit has issues:"; \
			echo "  Subject: $$subject"; \
			printf "$$errors\n"; \
			failed=1; \
		fi; \
	done; \
	if [ $$failed -eq 0 ]; then \
		echo "✅ All commits follow CLAUDE.md guidelines!"; \
	else \
		echo ""; \
		echo "⚠️  Fix with: make fix-commits"; \
		exit 1; \
	fi

## fix-commits: Automatically fix commit messages to follow CLAUDE.md guidelines
fix-commits:
	@echo "Fixing commit messages to comply with CLAUDE.md..."
	@echo "⚠️  This will rewrite git history!"
	@read -p "Continue? (y/N) " -n 1 -r; \
	echo ""; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		SOB_NAME=$$(git config user.name); \
		SOB_EMAIL=$$(git config user.email); \
		git filter-branch -f --msg-filter ' \
			msg=$$(cat); \
			subject=$$(echo "$$msg" | head -1 | sed "s/ Generated-by:.*//"); \
			body=$$(echo "$$msg" | tail -n +2); \
			cleaned_body=$$(echo "$$body" | grep -v "^Generated-by:" | grep -v "^Signed-off-by:" | grep -v "^Co-Authored-By:"); \
			echo "$$subject"; \
			if [ ! -z "$$cleaned_body" ]; then \
				echo "$$cleaned_body"; \
			fi; \
			echo ""; \
			echo "Generated-by: Claude AI"; \
			echo "Signed-off-by: '"$$SOB_NAME"' <'"$$SOB_EMAIL"'>" \
		' -- --all; \
		echo "✅ Commit messages fixed!"; \
		echo "⚠️  You may need to force push: git push --force-with-lease"; \
	else \
		echo "Aborted."; \
	fi

## format: Format HTML and JS files with prettier
format:
	@if command -v prettier > /dev/null 2>&1; then \
		echo "Formatting HTML and JS files with Prettier..."; \
		prettier --write "**/*.html" "**/*.js"; \
		echo "✅ Files formatted!"; \
	elif command -v npx > /dev/null 2>&1; then \
		echo "Using npx to run Prettier..."; \
		npx prettier --write "**/*.html" "**/*.js"; \
		echo "✅ Files formatted!"; \
	else \
		echo "⚠️  Prettier not found."; \
		echo ""; \
		echo "Install options:"; \
		echo "  1. npm install        (local installation)"; \
		echo "  2. npm install -g prettier  (global installation)"; \
		echo ""; \
		exit 1; \
	fi

## check-format: Check if HTML and JS files are properly formatted
check-format:
	@if command -v prettier > /dev/null 2>&1; then \
		echo "Checking code formatting..."; \
		prettier --check "**/*.html" "**/*.js" || \
		(echo "❌ Code formatting issues found. Run 'make format' to fix."; exit 1); \
		echo "✅ All files are properly formatted!"; \
	elif command -v npx > /dev/null 2>&1; then \
		echo "Using npx to check formatting..."; \
		npx prettier --check "**/*.html" "**/*.js" || \
		(echo "❌ Code formatting issues found. Run 'make format' to fix."; exit 1); \
		echo "✅ All files are properly formatted!"; \
	else \
		echo "⚠️  Prettier not found."; \
		echo ""; \
		echo "Install options:"; \
		echo "  1. npm install        (local installation)"; \
		echo "  2. npm install -g prettier  (global installation)"; \
		echo ""; \
		exit 1; \
	fi

## venv: Create Python virtual environment and install dependencies
venv: $(VENV_DIR)/bin/activate

$(VENV_DIR)/bin/activate:
	@echo "Creating virtual environment..."
	@$(PYTHON) -m venv $(VENV_DIR)
	@$(VENV_PIP) install --upgrade pip
	@$(VENV_PIP) install openai
	@echo "✅ Virtual environment ready at $(VENV_DIR)/"

## icons: Generate infographic images for blog posts (skips existing)
icons: venv
	@$(VENV_PYTHON) gen-infographics.py

## icons-dry-run: Preview infographic prompts without calling the API
icons-dry-run: venv
	@$(VENV_PYTHON) gen-infographics.py --dry-run

## viz-convert: Convert any leftover JSX files to standalone HTML
viz-convert:
	@found=0; \
	for jsx in $$(find viz/ -name '*.jsx' 2>/dev/null); do \
		html=$${jsx%.jsx}.html; \
		if [ ! -f "$$html" ]; then \
			found=1; \
			echo "[CONVERT] $$jsx -> $$html"; \
			tmp=$${html}.tmp; \
			if cat "$$jsx" | claude -p "Convert this JSX React component to a standalone self-contained HTML file. No React, no npm, no external JS dependencies. Use vanilla HTML/CSS/JS. Replace React useState with vanilla JS event handlers for tab switching. Convert JSX SVG to plain SVG (camelCase to kebab-case attributes). Include proper <meta> tags (charset, viewport, description from the component, theme-color). Match the dark theme styling. The file must work when opened directly in a browser." > "$$tmp" 2>/dev/null; then \
				if grep -qi '<title>' "$$tmp"; then \
					mv "$$tmp" "$$html"; \
					rm "$$jsx"; \
					echo "[OK] Converted and removed $$jsx"; \
				else \
					rm -f "$$tmp"; \
					echo "[FAIL] $$jsx: output is not valid HTML (no <title> found), keeping JSX"; \
				fi; \
			else \
				rm -f "$$tmp"; \
				echo "[FAIL] $$jsx: claude -p failed, keeping JSX"; \
			fi; \
		fi; \
	done; \
	if [ $$found -eq 0 ]; then echo "[CONVERT] No JSX files to convert"; fi

## viz: Full visualization pipeline (convert, icons, catalog, format, commit)
viz: viz-convert icons
	@$(VENV_PYTHON) gen-infographics.py --catalog-only
	@$(MAKE) format
	@./scripts/viz-commit.sh
	@echo "Done! Catalog updated at viz/catalog.json"

## viz-dry-run: Preview what viz pipeline would do without changes
viz-dry-run: venv
	@$(VENV_PYTHON) gen-infographics.py --dry-run

## help: Show this help message
help:
	@echo "Visualization - Demo"
	@echo "==========================================="
	@echo ""
	@echo "Server Commands:"
	@echo "  make              Start server at http://localhost:8000"
	@echo "  make serve        Start server"
	@echo "  make run          Same as serve"
	@echo "  make stop         Stop the running server"
	@echo "  make clean        Stop server and clean up files"
	@echo ""
	@echo "Visualization Pipeline:"
	@echo "  make viz             Full pipeline: convert, icons, catalog, format, auto-commit"
	@echo "  make viz-convert     Convert leftover JSX files to standalone HTML"
	@echo "  make viz-dry-run     Preview pipeline without changes"
	@echo ""
	@echo "  Flow: JSX->HTML -> discover+inject -> icons -> catalog.json -> format -> commit"
	@echo "  After 'make viz', just run 'git push'."
	@echo ""
	@echo "Infographics:"
	@echo "  make icons           Generate infographic images (skips existing)"
	@echo "  make icons-dry-run   Preview prompts without API calls"
	@echo "  make venv            Create Python venv with dependencies"
	@echo ""
	@echo "Code Quality:"
	@echo "  make check-commits   Check if commit messages follow CLAUDE.md"
	@echo "  make fix-commits     Fix commit messages to follow CLAUDE.md"
	@echo "  make format          Format HTML/JS files with Prettier"
	@echo "  make check-format    Check if HTML/JS files are formatted"
	@echo ""
	@echo "  make help         Show this help message"
	@echo ""
	@echo "Options:"
	@echo "  PORT=8080 make serve    Use custom port (default: 8000)"
	@echo ""
	@echo "Features:"
	@echo "  Watch visualizations at http://localhost:PORT"

# Default target
.DEFAULT_GOAL := serve
