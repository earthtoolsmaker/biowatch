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
# src/main/db/schema.js

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
│   │   ├── index.js        # Entry point, IPC handlers
│   │   ├── db/             # Database layer
│   │   └── *.js            # Feature modules
│   ├── renderer/src/       # React frontend
│   │   ├── base.jsx        # App root
│   │   └── *.jsx           # Page components
│   ├── preload/            # IPC bridge
│   └── shared/             # Shared code (model zoo)
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

1. Update version in `package.json`
2. Commit and push
3. Create GitHub release
4. CI builds and publishes:
   - Windows: `.exe` installer
   - macOS: `.dmg` (signed + notarized)
   - Linux: `.AppImage`

Auto-updates are handled by `electron-updater`.

## Common Tasks

### Add new IPC handler

1. Add handler in `src/main/index.js`:
   ```javascript
   ipcMain.handle('myfeature:action', async (_, params) => { ... })
   ```

2. Expose in `src/preload/index.js`:
   ```javascript
   myAction: async (params) => {
     return await electronAPI.ipcRenderer.invoke('myfeature:action', params)
   }
   ```

3. Call from React:
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

1. Define in `src/main/db/schema.js`
2. Export from `src/main/db/index.js`
3. Generate migration: `npx drizzle-kit generate --name add_mytable`

### Add new ML model

See [HTTP ML Servers](./http-servers.md) for complete guide.
