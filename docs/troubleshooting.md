# Troubleshooting

Common issues and solutions.

## Import Issues

### "datapackage.json not found"

**Cause:** Selected folder is not a valid CamTrap DP dataset.

**Solution:**
- Ensure the folder contains `datapackage.json`
- If importing a ZIP, ensure it extracts to a folder with `datapackage.json`
- Check folder structure matches CamTrap DP specification

### "projects.csv not found" (Wildlife Insights)

**Cause:** Selected folder is not a Wildlife Insights export.

**Solution:**
- Wildlife Insights exports should contain `projects.csv`, `deployments.csv`, and `images.csv`
- Download a fresh export from Wildlife Insights

### Missing images after import

**Cause:** Image file paths in CSV don't match actual file locations.

**Solution:**
- For CamTrap DP: `media.csv` `filePath` should be relative to dataset folder
- Check paths use correct separator (`/` on macOS/Linux, `\` on Windows)
- If images are HTTP URLs, ensure they're accessible

### Import hangs or crashes

**Cause:** Very large dataset exceeding memory.

**Solution:**
- Try importing a smaller subset first
- Close other applications to free memory
- Check available disk space

---

## Database Issues

### "Database locked"

**Cause:** Another process is accessing the SQLite database.

**Solutions:**
1. Close Biowatch completely and restart
2. Check for zombie processes:
   ```bash
   ps aux | grep biowatch
   kill -9 <pid>
   ```
3. If issue persists, the database file may be corrupted

### Migration fails

**Cause:** Schema migration couldn't complete.

**Solutions:**
1. Check logs for specific error:
   ```bash
   tail -f ~/.config/biowatch/logs/main.log
   ```
2. If a study is corrupted, delete and re-import:
   ```bash
   rm -rf ~/Library/Application\ Support/biowatch/biowatch-data/studies/<study-id>
   ```

### "No migrations folder found"

**Cause:** Migration file names don't match journal.

**Solution:**
1. Check `src/main/database/migrations/meta/_journal.json`
2. Ensure migration files match the `tag` values exactly
3. Regenerate if needed: `npx drizzle-kit generate --name initial`

---

## ML Model Issues

### Model download fails

**Cause:** Network issues or CDN problems.

**Solutions:**
1. Check internet connection
2. Try downloading again
3. Check free disk space (models are 500MB-3GB)
4. If using VPN, try without it

### "Server failed to start in expected time"

**Cause:** Python server didn't respond to health checks in 30 seconds.

**Solutions:**
1. **First-time GPU init**: Can take longer; wait and retry
2. **Check logs**:
   ```bash
   tail -f ~/.config/biowatch/logs/main.log
   ```
3. **Insufficient memory**: Close other applications
4. **Python environment corrupted**: Delete and re-download from Models tab

### Model weights not found

**Cause:** Download was incomplete or corrupted.

**Solution:**
1. Delete the model from Models tab
2. Re-download

### Predictions are slow

**Cause:** Running on CPU instead of GPU.

**Solutions:**
1. Check GPU is available:
   ```bash
   nvidia-smi  # For NVIDIA GPUs
   ```
2. Ensure CUDA drivers are installed
3. Close other GPU-intensive applications
4. Note: CPU inference is 10-100x slower but works

### Port already in use

**Cause:** Previous server didn't shut down cleanly.

**Solution:**
```bash
# Find process using the port
lsof -i :8000

# Kill it
kill -9 <pid>
```

---

## Build Issues

### "better-sqlite3" build fails

**Cause:** Native module compilation failed.

**Solutions:**

**macOS:**
```bash
xcode-select --install
npm rebuild better-sqlite3
```

**Linux:**
```bash
sudo apt install build-essential python3
npm rebuild better-sqlite3
```

**Windows:**
- Install Visual Studio Build Tools
- Run in Developer Command Prompt

### Electron rebuild fails

**Solution:**
```bash
npx electron-rebuild -f -w better-sqlite3
```

### Python environment build fails

**Cause:** `uv` not installed or wrong Python version.

**Solutions:**
1. Install uv:
   ```bash
   pipx install uv
   ```
2. Ensure Python 3.11+ is available
3. Try cleaning and rebuilding:
   ```bash
   rm -rf python-environments/common/.venv
   npm run build:python-env-common
   ```

---

## Export Issues

### Export hangs

**Cause:** Large number of files or slow network (for remote images).

**Solutions:**
1. Export smaller batches (filter by species)
2. Cancel and retry
3. Check network connection for remote files

### Files missing in export

**Cause:** Source files not found or inaccessible.

**Solutions:**
1. Check export log for errors
2. Verify source images still exist at original paths
3. For remote URLs, ensure they're still accessible

### Filename collisions

**Note:** Biowatch automatically deduplicates filenames by appending `_1`, `_2`, etc.

---

## Performance Issues

### App is slow with large dataset

**Solutions:**
1. **Pagination**: Media browser uses pagination; reduce page size if needed
2. **Close unused studies**: Only active study is loaded
3. **Clear browser cache**: DevTools → Application → Clear storage

### Map rendering slow

**Cause:** Too many markers.

**Solutions:**
1. Markers are clustered automatically
2. Zoom in to reduce visible markers
3. Filter to specific deployments

---

## Platform-Specific Issues

### macOS: "App is damaged"

**Cause:** App not signed/notarized or Gatekeeper blocking.

**Solution:**
```bash
xattr -cr /Applications/Biowatch.app
```

### macOS: Camera/file access denied

**Solution:**
- System Preferences → Security & Privacy → Files and Folders
- Grant Biowatch access

### Linux: AppImage won't run

**Solutions:**
```bash
chmod +x Biowatch-*.AppImage
./Biowatch-*.AppImage
```

**SUID sandbox error** ("chrome-sandbox is not configured correctly"):
```bash
# Option 1: Run with --no-sandbox flag
./Biowatch-*.AppImage --no-sandbox

# Option 2: Extract and run
./Biowatch-*.AppImage --appimage-extract-and-run
```

Note: Starting from v1.5.0, the app automatically handles this.

**FUSE issues:**
```bash
./Biowatch-*.AppImage --appimage-extract-and-run
```

### Windows: SmartScreen warning

**Solution:**
- Click "More info" → "Run anyway"
- This is normal for new applications

---

## Log Locations

| Platform | Path |
|----------|------|
| macOS | `~/Library/Logs/biowatch/` |
| Linux | `~/.config/biowatch/logs/` |
| Windows | `%APPDATA%\biowatch\logs\` |

### Viewing logs

```bash
# macOS/Linux
tail -f ~/.config/biowatch/logs/main.log

# Or open in log viewer
open ~/.config/biowatch/logs/main.log
```

---

## Data Locations

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/biowatch/biowatch-data/` |
| Linux | `~/.config/biowatch/biowatch-data/` |
| Windows | `%APPDATA%\biowatch\biowatch-data\` |

### Study databases

```
biowatch-data/
└── studies/
    ├── <uuid-1>/
    │   └── study.db
    └── <uuid-2>/
        └── study.db
```

---

## Exporting Diagnostics

Biowatch includes a hidden Advanced tab with diagnostics tools. To access it:

1. Go to **Settings** (either AI Models or Info tab)
2. **Hold Shift and click** the EarthToolsMaker logo in the footer
3. The **Advanced** tab will appear in the tab bar (visible until app restart)
4. Click **Export** on the Export Logs card
5. Choose where to save the diagnostics zip file

### What's included in the export

- `system-info.json` - App version, OS, platform, architecture, memory, study list (IDs/names only)
- `logs/main.log` - Main process (Electron) logs
- `logs/renderer.log` - Renderer process (web console) logs

### What's NOT included (privacy)

- Study databases or actual data
- Image/media files
- User credentials

---

## Getting Help

1. **Export diagnostics** using the method above
2. **Check logs** for specific error messages
3. **Search existing issues**: [GitHub Issues](https://github.com/earthtoolsmaker/biowatch/issues)
4. **Open new issue** with:
   - Biowatch version
   - Operating system
   - Steps to reproduce
   - Diagnostics zip file (or relevant log output)
