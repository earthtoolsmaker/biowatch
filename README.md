# Biowatch

<p align="center">
  <img src="./docs/assets/images/biowatch-logo.png" alt="Biowatch Logo" />
</p>


<p align="center">
    <img alt="GitHub package.json version" src="https://img.shields.io/github/package-json/v/earthtoolsmaker/biowatch" />
    <a href="./LICENSE"><img alt="License: CC BY-NC 4.0" src="https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg" /></a>
    <img alt="Build" src="https://github.com/earthtoolsmaker/biowatch/actions/workflows/build.yml/badge.svg" />
    <img alt="Tests" src="https://github.com/earthtoolsmaker/biowatch/actions/workflows/test.yml/badge.svg" />
    <img alt="JS Lint" src="https://github.com/earthtoolsmaker/biowatch/actions/workflows/js_lint.yml/badge.svg" />
    <img alt="Python Lint" src="https://github.com/earthtoolsmaker/biowatch/actions/workflows/python_lint.yml/badge.svg" />
</p>
<br/>

<p align="center">
  <a href="https://www.earthtoolsmaker.org/tools/biowatch/">Download</a> | <a href="./docs/">Documentation</a> | <a href="https://www.earthtoolsmaker.org/contact/">Contact Us</a>
</p>
<br/>
<br/>

**Analyze Camera Trap Data — Privately, On Your Machine**

Biowatch is a free, open-source desktop application for wildlife researchers and conservationists. Analyze camera trap datasets completely offline — your data never leaves your machine.

![Overview](./docs/assets/images/overview-biowatch.gif)

## Key Features

- **100% Offline & Private**: Your research data stays on your machine. No cloud uploads, no accounts, no tracking.
- **On-Device AI**: Species identification models run locally — no internet required.
- **Interactive Maps**: Visualize camera trap locations and wildlife sightings with spatial analysis tools.
- **Data Analysis**: Generate insights with temporal activity patterns, species distributions, and deployment metrics.
- **Media Management**: Browse, filter, and search through thousands of camera trap images and videos.
- **CamtrapDP Compatible**: Import and export using Camera Trap Data Package standards for GBIF integration.

## Documentation

Full developer documentation is available in the [docs/](./docs/) folder:

- [Architecture](./docs/architecture.md) - System design and data flow
- [Data Formats](./docs/data-formats.md) - CamTrap DP and import/export formats
- [Database Schema](./docs/database-schema.md) - SQLite tables and relationships
- [HTTP ML Servers](./docs/http-servers.md) - ML model integration
- [Development](./docs/development.md) - Setup, testing, and building
- [Contributing](./CONTRIBUTING.md) - How to contribute

## Quick Start (Development)

```bash
# Install all dependencies and start development
make install
make dev
```

Run `make help` to see all available commands.

See [Development Guide](./docs/development.md) for full details.

## License

[CC BY-NC 4.0](./LICENSE) - Free for non-commercial use with attribution.
