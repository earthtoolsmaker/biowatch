# Biowatch Makefile
# Unified interface for development tasks

.PHONY: install dev build test test-e2e test-e2e-headed test-e2e-debug lint format fix clean help \
        check-node check-uv \
        build-win build-mac build-mac-no-sign build-linux

# Default target
.DEFAULT_GOAL := help

# Colors for output
RED := \033[0;31m
GREEN := \033[0;32m
YELLOW := \033[0;33m
BLUE := \033[0;34m
NC := \033[0m

#------------------------------------------------------------------------------
# Prerequisite checks
#------------------------------------------------------------------------------

check-node:
	@command -v node >/dev/null 2>&1 || { \
		printf "$(RED)Error: 'node' is not installed.$(NC)\n"; \
		printf "\n"; \
		printf "Please install Node.js 18+ using one of the following methods:\n"; \
		printf "\n"; \
		printf "  $(YELLOW)Using nvm (recommended):$(NC)\n"; \
		printf "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash\n"; \
		printf "    nvm install 18\n"; \
		printf "\n"; \
		printf "  $(YELLOW)Using Homebrew (macOS):$(NC)\n"; \
		printf "    brew install node@18\n"; \
		printf "\n"; \
		printf "  $(YELLOW)Using apt (Debian/Ubuntu):$(NC)\n"; \
		printf "    curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -\n"; \
		printf "    sudo apt install -y nodejs\n"; \
		printf "\n"; \
		printf "  See https://nodejs.org/ for more options.\n"; \
		exit 1; \
	}
	@command -v npm >/dev/null 2>&1 || { \
		printf "$(RED)Error: 'npm' is not installed.$(NC)\n"; \
		printf "npm is typically installed with Node.js.\n"; \
		printf "Please reinstall Node.js to get npm.\n"; \
		exit 1; \
	}

check-uv:
	@command -v uv >/dev/null 2>&1 || { \
		printf "$(RED)Error: 'uv' is not installed.$(NC)\n"; \
		printf "\n"; \
		printf "Please install uv using one of the following methods:\n"; \
		printf "\n"; \
		printf "  $(YELLOW)Using pipx (recommended):$(NC)\n"; \
		printf "    pipx install uv\n"; \
		printf "\n"; \
		printf "  $(YELLOW)Using curl (macOS/Linux):$(NC)\n"; \
		printf "    curl -LsSf https://astral.sh/uv/install.sh | sh\n"; \
		printf "\n"; \
		printf "  $(YELLOW)Using Homebrew (macOS):$(NC)\n"; \
		printf "    brew install uv\n"; \
		printf "\n"; \
		printf "  See https://docs.astral.sh/uv/getting-started/installation/ for more options.\n"; \
		exit 1; \
	}

#------------------------------------------------------------------------------
# Main targets
#------------------------------------------------------------------------------

## install: Install all dependencies (npm + Python)
install: check-node check-uv
	@printf "$(GREEN)Installing npm dependencies...$(NC)\n"
	@npm install
	@printf "$(GREEN)Installing Python dependencies...$(NC)\n"
	@npm run build:python-env-common
	@printf "$(GREEN)Installation complete!$(NC)\n"

## dev: Start development server with hot reload
dev:
	npm run dev

## build: Build the application
build:
	npm run build

## test: Run all tests
test:
	npm test

## test-e2e: Run E2E tests (builds app first)
test-e2e: build
	npm run test:e2e

## test-e2e-headed: Run E2E tests with visible window
test-e2e-headed: build
	npm run test:e2e:headed

## test-e2e-debug: Run E2E tests in debug mode
test-e2e-debug: build
	npm run test:e2e:debug

## lint: Check code style (JavaScript and Python)
lint:
	npm run lint
	cd python-environments/common && make lint

## format: Format all code (JavaScript and Python)
format:
	npm run format
	cd python-environments/common && make format

## fix: Auto-fix lint issues (JavaScript and Python)
fix:
	npm run fix
	cd python-environments/common && make lint-fix

## clean: Remove build artifacts
clean:
	rm -rf out dist node_modules/.cache

#------------------------------------------------------------------------------
# Platform-specific builds
#------------------------------------------------------------------------------

## build-win: Build for Windows
build-win:
	npm run build:win

## build-mac: Build for macOS (with signing)
build-mac:
	npm run build:mac

## build-mac-no-sign: Build for macOS (without signing)
build-mac-no-sign:
	npm run build:mac:no-sign

## build-linux: Build for Linux
build-linux:
	npm run build:linux

#------------------------------------------------------------------------------
# Help
#------------------------------------------------------------------------------

## help: Show this help message
help:
	@printf "$(BLUE)Biowatch Development Commands$(NC)\n"
	@printf "\n"
	@printf "Usage: make [target]\n"
	@printf "\n"
	@printf "$(YELLOW)Targets:$(NC)\n"
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## /  /' | awk -F': ' '{printf "  $(GREEN)%-20s$(NC) %s\n", $$1, $$2}'
