# Contributing to Biowatch

Thank you for your interest in contributing to Biowatch! This guide will help you get started.

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.

## Ways to Contribute

- **Report bugs** - Open an issue describing the bug and how to reproduce it
- **Suggest features** - Open an issue describing the feature and its use case
- **Submit code** - Fix bugs or implement new features via pull requests
- **Improve documentation** - Help clarify or expand existing docs

## Development Setup

```bash
# Install dependencies
npm install

# Start the development server
npm run dev
```

## Code Style

We use Prettier and ESLint to maintain consistent code style.

```bash
# Check for issues
npm run lint

# Auto-fix issues
npm run fix

# Format code
npm run format
```

**Style guidelines:**
- Single quotes
- No semicolons
- 100 character line width
- Do not remove existing comments in the codebase

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

## Database Migrations

Biowatch uses Drizzle ORM with SQLite. For detailed information about creating and managing database migrations, see [docs/drizzle.md](docs/drizzle.md).

## Pull Request Process

1. Fork the repository and create a branch from `main`
2. Make your changes and ensure tests pass
3. Run `npm run lint` and `npm run format` before committing
4. Submit a pull request with a clear description of your changes

## Getting Help

If you have questions, feel free to open an issue on GitHub.
