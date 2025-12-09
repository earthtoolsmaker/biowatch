.PHONY: install-dev lint lint-fix format format-check test test-debug

# Install dev dependencies
install-dev:
	uv sync --extra dev

# Run ruff linter (check only)
lint:
	uv run ruff check .

# Run ruff linter and auto-fix issues
lint-fix:
	uv run ruff check --fix .

# Format code with ruff
format:
	uv run ruff format .

# Check formatting without making changes
format-check:
	uv run ruff format --check .

# Run all e2e tests
test:
	uv run pytest tests/ -v

# Run tests with verbose output and no capture
test-debug:
	uv run pytest tests/ -v -s --tb=long
