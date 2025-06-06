# Python Environments

In this folder, we collect all the python environments required to orchestrate
the ML model predictions locally from within the Electron application.

- [`common`](./common/README.md): Basic python environment that can run ML
Models with a fastapi HTTP server.

## Environment Version Updates

Whenever a dependency is updated, it's essential to increment the version
specified in the `pyproject.toml` files. This action ensures that the build
step in our CI/CD pipeline releases a new Python environment, reflecting the
latest changes and improvements. Keeping track of version updates helps
maintain consistency and compatibility across different environments,
facilitating smoother model predictions and deployments.
