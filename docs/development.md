# Development Guide

Setup, testing, and building Biowatch.

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 18+ | JavaScript runtime |
| npm | 9+ | Package manager |
| uv | Latest | Python package manager |
| Python | 3.11+ | ML model servers |

### Platform-specific

**macOS:**
- Xcode Command Line Tools: `xcode-select --install`

**Linux:**
- Build essentials: `sudo apt install build-essential`

**Windows:**
- Visual Studio Build Tools

## Setup

### 1. Clone and install

```bash
git clone https://github.com/earthtoolsmaker/biowatch.git
cd biowatch
npm install
```

### 2. Build Python environment

```bash
# Install uv (if not already installed)
pipx install uv

# Build the ML model environment
npm run build:python-env-common
```

This creates `python-environments/common/.venv/` with all Python dependencies.

### 3. Start development server

```bash
npm run dev
```

Opens Electron app with hot reload enabled.

## npm Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Build application |
| `npm run start` | Preview built application |
| `npm run lint` | Check code style |
| `npm run fix` | Auto-fix lint issues |
| `npm run format` | Format code with Prettier |
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |

### Build scripts

| Script | Description |
|--------|-------------|
| `npm run build:win` | Build for Windows |
| `npm run build:mac` | Build for macOS (with signing) |
| `npm run build:mac:no-sign` | Build for macOS (no signing) |
| `npm run build:linux` | Build for Linux |
| `npm run build:unpack` | Build unpacked (for debugging) |

### Linux build notes

The Linux build includes an `afterPack` hook (`scripts/afterPack.js`) that fixes a common Electron sandbox issue.

**The problem:**

On Linux, Electron requires `chrome-sandbox` to be owned by root with SUID bit (mode 4755). AppImages extract to `/tmp` where this is impossible, causing:

```
FATAL:setuid_sandbox_host.cc: The SUID sandbox helper binary was found,
but is not configured correctly.
```

This affects distributions where unprivileged user namespaces are disabled:
- Ubuntu 24.04+ (AppArmor restriction)
- Debian (disabled by default)
- Some enterprise distributions

**The solution:**

The `afterPack` hook creates a wrapper script that:
1. Renames `biowatch` → `biowatch.bin`
2. Creates a shell script `biowatch` that checks kernel settings at runtime
3. Passes `--no-sandbox` only when the kernel doesn't support unprivileged namespaces

This means the sandbox is preserved on systems that support it, while still working on restricted systems.

**Files involved:**
- `scripts/afterPack.js` - The hook script (Linux-only, skipped on macOS/Windows)
- `electron-builder.yml` - References the hook via `afterPack`

## Code Style

### ESLint + Prettier

```bash
# Check for issues
npm run lint

# Auto-fix issues
npm run fix

# Format code
npm run format
```

### Style rules

- **Quotes**: Single quotes
- **Semicolons**: None
- **Line width**: 100 characters
- **Comments**: Preserve existing comments

## Testing

### Run tests

```bash
# All tests
npm test

# Watch mode
npm run test:watch

# Specific test file
npm run test:rebuild && node --test test/camtrap.test.js
```

### Test structure

```
test/
├── camtrap.test.js       # CamTrap DP import tests
├── wildlife.test.js      # Wildlife Insights import tests
├── deepfaune.test.js     # DeepFaune import tests
├── db-schema.test.js     # Database schema tests
├── migrations.test.js    # Migration tests
└── test-data/            # Test fixtures
```

### Writing tests

```javascript
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'

describe('MyFeature', () => {
  before(() => {
    // Setup
  })

  after(() => {
    // Cleanup
  })

  it('should do something', async () => {
    const result = await myFunction()
    assert.strictEqual(result, expected)
  })
})
```

### SQLite rebuild note

Tests require rebuilding `better-sqlite3` for Node.js (vs Electron):

```bash
npm run test:rebuild      # Before tests (for Node.js)
npm run test:rebuild-electron  # After tests (restore for Electron)
```

## Database Migrations

See [Drizzle ORM Guide](./drizzle.md) for full details.

### Quick workflow

```bash
# 1. Edit schema
# src/main/database/models.js

# 2. Generate migration
npx drizzle-kit generate --name my_change

# 3. Test
npm run dev
# Navigate to a study - migrations run automatically
```

## Project Structure

```
biowatch/
├── src/
│   ├── main/               # Electron main process
│   │   ├── index.js        # Minimal entry point
│   │   ├── app/            # Application lifecycle
│   │   ├── ipc/            # IPC handlers (presentation layer)
│   │   ├── services/       # Business logic layer
│   │   │   ├── import/     # Data importers
│   │   │   ├── export/     # Data exporters
│   │   │   ├── ml/         # ML model services
│   │   │   └── cache/      # Caching services
│   │   ├── utils/          # Pure utilities
│   │   └── database/       # Database layer
│   ├── renderer/src/       # React frontend
│   │   ├── base.jsx        # App root
│   │   └── *.jsx           # Page components
│   ├── preload/            # IPC bridge
│   └── shared/             # Shared code (model zoo)
├── scripts/
│   └── afterPack.js        # electron-builder hook (Linux sandbox fix)
├── python-environments/
│   └── common/             # ML model Python env
├── test/                   # Test files
├── resources/              # App resources (icons)
└── docs/                   # Documentation
```

## Debugging

### DevTools

In development mode:
- Press `F12` to open DevTools
- Or uncomment in `src/main/index.js`:
  ```javascript
  mainWindow.webContents.openDevTools()
  ```

### Logs

```bash
# View Electron logs
tail -f ~/.config/biowatch/logs/main.log

# Or on macOS
tail -f ~/Library/Logs/biowatch/main.log
```

### React Query DevTools

Add to `src/renderer/src/base.jsx`:
```javascript
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

// In component:
<ReactQueryDevtools initialIsOpen={false} />
```

## Configuration Files

| File | Purpose |
|------|---------|
| `electron-builder.yml` | Build configuration |
| `electron.vite.config.mjs` | Vite build config |
| `drizzle.config.js` | Drizzle ORM config |
| `eslint.config.mjs` | ESLint rules |
| `.prettierrc` | Prettier config |

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `GH_TOKEN` | GitHub token for releases (CI only) |
| `ELECTRON_RENDERER_URL` | Dev server URL (set automatically) |

## IDE Setup

### VS Code

Recommended extensions:
- ESLint
- Prettier
- Tailwind CSS IntelliSense

Settings (`.vscode/settings.json`):
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "eslint.experimental.useFlatConfig": true
}
```

## Release Process

Biowatch uses an automated CI/CD pipeline that builds and publishes releases for Windows, macOS, and Linux when a version tag is pushed.

### Prerequisites

- Write access to the repository
- For maintainers: GitHub secrets must be configured (see [GitHub Secrets](#github-secrets-for-maintainers) below)

### Step-by-Step Release

1. **Update version** in `package.json`:
   ```json
   "version": "1.5.0"
   ```

2. **Update `CHANGELOG.md`** with the new version's changes:
   - Add a new section for the version with the release date
   - Document all notable changes under: Added, Changed, Fixed, Removed
   - Update the comparison links at the bottom of the file

3. **Commit the version bump**:
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore: bump version to 1.5.0"
   git push origin main
   ```

4. **Create and push a version tag**:
   ```bash
   git tag v1.5.0
   git push origin v1.5.0
   ```

5. **Verify CI triggered**: Check [GitHub Actions](https://github.com/earthtoolsmaker/biowatch/actions) to ensure both workflows started.

### CI/CD Workflows

Two GitHub Actions workflows handle releases:

| Workflow | File | Trigger | Purpose |
|----------|------|---------|---------|
| Build/Release | `.github/workflows/build.yml` | Push to `main` or `v*.*.*` tags | Builds and publishes binaries |
| Create Release | `.github/workflows/release.yml` | Push to `v*.*.*` tags | Creates GitHub Release with notes |

**Build/Release workflow:**
- Runs on 3 parallel runners: `windows-latest`, `macos-latest`, `ubuntu-22.04`
- Executes platform-specific build scripts (`build:win`, `build:mac`, `build:linux`)
- Publishes artifacts directly to GitHub Releases via `electron-builder --publish always`

**Create Release workflow:**
- Creates the GitHub Release entry
- Auto-generates release notes from commits since last tag

### Build Artifacts

Each release produces the following files:

| Platform | File | Description |
|----------|------|-------------|
| Windows | `Biowatch-setup.exe` | NSIS installer |
| macOS | `Biowatch.dmg` | Signed and notarized disk image |
| Linux | `Biowatch.AppImage` | Portable application |
| Linux | `Biowatch_<version>_amd64.deb` | Debian package |

### GitHub Secrets (for maintainers)

The following secrets must be configured in repository settings for releases to work:

| Secret | Purpose |
|--------|---------|
| `GH_TOKEN` | GitHub token for publishing releases |
| `APPLE_SIGNING_CERTIFICATE_BASE64` | Base64-encoded macOS signing certificate |
| `APPLE_SIGNING_CERTIFICATE_PASSWORD` | Password for the signing certificate |
| `APPLE_ID` | Apple ID for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for notarization |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

### Auto-Updates

Biowatch uses `electron-updater` to automatically notify users of new versions:

1. On startup, the app checks GitHub Releases for newer versions
2. If found, users see an update notification
3. Updates download in the background
4. Users can install when ready (usually on next app restart)

The update mechanism uses the `publish` configuration in `electron-builder.yml`:
```yaml
publish:
  provider: github
  owner: earthtoolsmaker
  repo: biowatch
```

### Troubleshooting Releases

**Build fails on macOS:**
- Verify all Apple signing secrets are correctly set
- Check that the signing certificate hasn't expired
- Review the build logs for notarization errors

**Build fails on Linux:**
- The `afterPack` hook may fail if `scripts/afterPack.js` has issues
- Check that the script handles the Linux platform correctly

**Release not appearing:**
- Ensure the tag matches the pattern `v*.*.*` (e.g., `v1.5.0`)
- Check that `GH_TOKEN` has `write` permissions for releases
- Verify both workflows completed successfully

**Users not seeing updates:**
- The version in `package.json` must be higher than the installed version
- Check that the release is not marked as draft or prerelease

## Common Tasks

### Add new IPC handler

1. Create handler file in `src/main/ipc/myfeature.js`:
   ```javascript
   import { ipcMain } from 'electron'

   export function registerMyFeatureIPCHandlers() {
     ipcMain.handle('myfeature:action', async (_, params) => { ... })
   }
   ```

2. Register in `src/main/ipc/index.js`:
   ```javascript
   import { registerMyFeatureIPCHandlers } from './myfeature.js'
   // In registerAllIPCHandlers():
   registerMyFeatureIPCHandlers()
   ```

3. Expose in `src/preload/index.js`:
   ```javascript
   myAction: async (params) => {
     return await electronAPI.ipcRenderer.invoke('myfeature:action', params)
   }
   ```

4. Call from React:
   ```javascript
   const result = await window.api.myAction(params)
   ```

### Add new page/route

1. Create component in `src/renderer/src/mypage.jsx`
2. Add route in `src/renderer/src/base.jsx`:
   ```javascript
   <Route path="/mypage" element={<MyPage />} />
   ```

### Add new database table

1. Define in `src/main/database/models.js`
2. Export from `src/main/database/index.js`
3. Generate migration: `npx drizzle-kit generate --name add_mytable`

### Add new ML model

See [HTTP ML Servers](./http-servers.md) for complete guide.
