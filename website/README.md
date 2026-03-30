# Biowatch Documentation Website

Documentation site for [Biowatch](https://github.com/earthtoolsmaker/biowatch), built with [MkDocs Material](https://squidfunk.github.io/mkdocs-material/).

Published at [biowatch.earthtoolsmaker.org](https://biowatch.earthtoolsmaker.org).

## Prerequisites

- [uv](https://docs.astral.sh/uv/)

## Local Development

```bash
# Install dependencies
make install

# Start local dev server (http://127.0.0.1:8000)
make dev

# Build for production
make build
```

## Deployment

The site is deployed to Netlify. Configuration is in `netlify.toml`.
