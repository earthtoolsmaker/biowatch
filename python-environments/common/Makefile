.PHONY: install-dev lint lint-fix format format-check

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
