/**
 * electron-builder afterPack hook to fix SUID sandbox issues on Linux
 *
 * PLATFORM: Linux only (skipped on macOS and Windows)
 *
 * PROBLEM:
 * On Linux, Electron requires the chrome-sandbox binary to be owned by root
 * with SUID bit set (mode 4755). AppImages extract to /tmp where this is
 * impossible, causing the error:
 *   "The SUID sandbox helper binary was found, but is not configured correctly."
 *
 * This affects systems where unprivileged user namespaces are disabled:
 * - Ubuntu 24.04+ (restricted by AppArmor)
 * - Debian (disabled by default)
 * - Some enterprise Linux distributions
 *
 * SOLUTION:
 * This script creates a wrapper that:
 * 1. Renames the original binary to <name>.bin
 * 2. Creates a shell script wrapper with the original name
 * 3. The wrapper checks kernel settings at runtime and passes --no-sandbox
 *    only when necessary (unprivileged_userns_clone=0 or apparmor restriction)
 *
 * REFERENCES:
 * - https://github.com/gergof/electron-builder-sandbox-fix
 * - https://github.com/AppImage/AppImageKit/issues/1414
 * - https://github.com/electron-userland/electron-builder/issues/5371
 */

const fs = require('fs/promises')
const path = require('path')

const log = (message, isError = false) => {
  const prefix = isError ? '\x1b[31m•\x1b[0m' : '\x1b[34m•\x1b[0m'
  console.log(`  ${prefix} ${message}`)
}

const afterPackHook = async (params) => {
  // Only apply this fix on Linux - macOS and Windows don't have this issue
  if (params.electronPlatformName !== 'linux') {
    return
  }

  log('applying fix for sandboxing on unsupported kernels')

  const executable = path.join(params.appOutDir, params.packager.executableName)
  const productName = params.packager.appInfo.productName
  const executableName = params.packager.executableName

  const loaderScript = `#!/usr/bin/env bash
set -u

UNPRIVILEGED_USERNS_ENABLED=$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null)
RESTRICT_UNPRIVILEGED_USERNS=$(cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null)
SCRIPT_DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"

!([ "$UNPRIVILEGED_USERNS_ENABLED" != 1 ] || [ "$RESTRICT_UNPRIVILEGED_USERNS" == 1 ])
APPLY_NO_SANDBOX_FLAG=$?

if [ "$SCRIPT_DIR" == "/usr/bin" ]; then
	SCRIPT_DIR="/opt/${productName}"
fi

if [ "$APPLY_NO_SANDBOX_FLAG" == 1 ]; then
	echo "Note: Running with --no-sandbox since unprivileged_userns_clone is disabled or apparmor_restrict_unprivileged_userns is enabled."
fi

exec "$SCRIPT_DIR/${executableName}.bin" "$([ "$APPLY_NO_SANDBOX_FLAG" == 1 ] && echo '--no-sandbox')" "$@"
`

  try {
    await fs.rename(executable, executable + '.bin')
    await fs.writeFile(executable, loaderScript)
    await fs.chmod(executable, 0o755)
  } catch (e) {
    log('failed to create loader for sandbox fix: ' + e.message, true)
    throw new Error('Failed to create loader for sandbox fix')
  }

  log('sandbox fix successfully applied')
}

module.exports = afterPackHook
