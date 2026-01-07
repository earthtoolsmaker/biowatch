/**
 * @fileoverview Server lifecycle management for ML model HTTP servers.
 *
 * @module ml/server
 */

import { is } from '@electron-toolkit/utils'
import net from 'net'
import { join } from 'path'
import { spawn, ChildProcess } from 'child_process'
import log from 'electron-log'
import kill from 'tree-kill'
import crypto from 'crypto'
import os from 'node:os'

import { getMLModelLocalInstallPath, getMLModelEnvironmentLocalInstallPath } from './paths.js'

// ============================================================================
// Active Server Registry
// ============================================================================

/**
 * Represents an active ML model HTTP server process.
 */
export interface ActiveServer {
  pid: number
  port: number
  shutdownApiKey: string
  modelId: string
}

/**
 * Registry of all currently active ML model HTTP servers.
 * Key is the process ID (pid).
 */
const activeServers: Map<number, ActiveServer> = new Map()

/**
 * Registers an ML server in the active servers registry.
 * @param server - The server information to register.
 */
export function registerActiveServer(server: ActiveServer): void {
  activeServers.set(server.pid, server)
  log.info(
    `[Server Registry] Registered server pid=${server.pid} port=${server.port} model=${server.modelId}`
  )
}

/**
 * Unregisters an ML server from the active servers registry.
 * @param pid - The process ID of the server to unregister.
 */
export function unregisterActiveServer(pid: number): void {
  if (activeServers.has(pid)) {
    const server = activeServers.get(pid)
    activeServers.delete(pid)
    log.info(`[Server Registry] Unregistered server pid=${pid} model=${server?.modelId}`)
  }
}

/**
 * Returns all currently active servers.
 * @returns Array of active server information.
 */
export function getActiveServers(): ActiveServer[] {
  return Array.from(activeServers.values())
}

// ============================================================================
// Port Utilities
// ============================================================================

/**
 * Finds a free port on the local machine.
 *
 * This function creates a temporary server that listens on a random port
 * (by passing 0 to the `listen` method). Once the server is successfully
 * listening, it retrieves the assigned port number, closes the server,
 * and resolves the promise with the free port number. If there is an error
 * while creating the server, the promise is rejected.
 *
 * @returns {Promise<number>} A promise that resolves to a free port number.
 */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

// ============================================================================
// Server Health Check and Startup
// ============================================================================

interface StartServerOptions {
  pythonInterpreter: string
  scriptPath: string
  scriptArgs: string[]
  healthEndpoint: string
  retryInterval?: number
  maxRetries?: number
  restartRetries?: number
  maxRestarts?: number
  env?: Record<string, string>
}

/**
 * Waits for the specified server to become healthy by polling its health endpoint.
 *
 * This function spawns a Python process for the server and continuously checks
 * its health status by making GET requests to the provided health endpoint.
 * If the server becomes healthy within the maximum number of retries,
 * the function resolves with the spawned process.
 * If the server fails to start within the expected time,
 * it terminates the process and throws an error.
 *
 * Supports automatic restart: if the server crashes or times out during startup,
 * it will be restarted up to `maxRestarts` times with a shorter timeout for
 * restart attempts (since model caches should be warm).
 *
 * @async
 * @param {StartServerOptions} options - The configuration options for health checking.
 * @returns {Promise<ChildProcess>} A promise that resolves to the spawned Python process if the server starts successfully.
 * @throws {Error} Throws an error if the server fails to start within the expected time.
 */
export async function startAndWaitTillServerHealty({
  pythonInterpreter,
  scriptPath,
  scriptArgs,
  healthEndpoint,
  retryInterval = 1000,
  maxRetries = 120,
  restartRetries = 60,
  maxRestarts = 1,
  env = {}
}: StartServerOptions): Promise<ChildProcess> {
  for (let attempt = 0; attempt <= maxRestarts; attempt++) {
    // Use shorter timeout for restart attempts (cache should be warm)
    const retriesForThisAttempt = attempt === 0 ? maxRetries : restartRetries

    if (attempt > 0) {
      log.info(
        `[RESTART] Attempt ${attempt + 1}/${maxRestarts + 1} - restarting server (timeout: ${retriesForThisAttempt}s)...`
      )
    }

    const pythonProcess = spawn(pythonInterpreter, [scriptPath, ...scriptArgs], {
      env: { ...process.env, ...env }
    })

    log.info('Python process started:', pythonProcess.pid)

    // Track if process exits unexpectedly
    let processExited = false
    let exitCode: number | null = null

    pythonProcess.on('exit', (code) => {
      processExited = true
      exitCode = code
      if (code !== null && code !== 0) {
        log.error(`Python process exited unexpectedly with code ${code}`)
      }
    })

    // Set up output handlers
    pythonProcess.stdout?.on('data', (data) => {
      log.info('Python stdout:', data.toString())
    })

    pythonProcess.stderr?.on('data', (data) => {
      const message = data.toString().trim()
      // Uvicorn and Python write INFO/WARNING to stderr - don't call it "error"
      if (message.includes('INFO:') || message.includes('WARNING:')) {
        log.info('Python:', message)
      } else {
        log.error('Python error:', message)
      }
    })

    pythonProcess.on('error', (err) => {
      log.error('Python process error:', err)
    })

    // Wait for server to be ready by polling the endpoint
    for (let i = 0; i < retriesForThisAttempt; i++) {
      // Check if process crashed during startup
      if (processExited) {
        log.warn(`Python process exited during startup (code: ${exitCode})`)
        break // Exit retry loop, will attempt restart
      }

      try {
        const healthCheck = await fetch(healthEndpoint, {
          method: 'GET'
        })

        if (healthCheck.ok) {
          log.info('Server is ready')
          return pythonProcess
        }
      } catch (error) {
        // Log health check error on first attempt and every 30 seconds for debugging
        if (i === 0 || (i + 1) % 30 === 0) {
          log.debug(
            `Health check failed: ${(error as Error & { code?: string }).code || (error as Error).message}`
          )
        }
      }

      // Wait before next retry
      await new Promise((resolve) => setTimeout(resolve, retryInterval))
      // Log every 10 seconds to reduce spam
      if ((i + 1) % 10 === 0) {
        log.info(`Waiting for server to start (${i + 1}s/${retriesForThisAttempt}s)...`)
      }
    }

    // Timeout or crash - decide what to do
    if (!processExited) {
      // Process still running but didn't respond - kill it
      log.warn(
        `Server timeout after ${retriesForThisAttempt}s. Process still running - killing for restart...`
      )
      kill(pythonProcess.pid as number)
    }

    // If this was the last attempt, throw error
    if (attempt === maxRestarts) {
      throw new Error(
        `Server failed to start after ${maxRestarts + 1} attempt(s). Check Python logs above for details.`
      )
    }

    // Brief pause before restart to let resources clean up
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }

  // This should never be reached, but TypeScript requires a return
  throw new Error('Server failed to start')
}

// ============================================================================
// Model-Specific Server Starters
// ============================================================================

interface SpeciesNetServerOptions {
  port: number
  modelWeightsFilepath: string
  geofence: boolean
  timeout: number
  pythonEnvironment: {
    reference: { id: string; version: string }
  }
  country?: string | null
}

/**
 * Starts the SpeciesNet HTTP server using a specified Python environment and configuration.
 *
 * @async
 * @param {SpeciesNetServerOptions} options - The configuration options for starting the server.
 * @returns {Promise<{process: ChildProcess, shutdownApiKey: string}>} The spawned process and shutdown key.
 * @throws {Error} Throws an error if the server fails to start within the expected time.
 */
export async function startSpeciesNetHTTPServer({
  port,
  modelWeightsFilepath,
  geofence,
  timeout,
  pythonEnvironment,
  country = null
}: SpeciesNetServerOptions): Promise<{ process: ChildProcess; shutdownApiKey: string }> {
  log.info('StartSpeciesNetHTTPServer success!')
  log.info(pythonEnvironment)
  const localInstalRootDirPythonEnvironment = join(
    getMLModelEnvironmentLocalInstallPath({
      ...pythonEnvironment.reference
    }),
    pythonEnvironment.reference.id
  )
  log.info('Local Python Environment root dir is', localInstalRootDirPythonEnvironment)
  const scriptPath = is.dev
    ? join(__dirname, '../../python-environments/common/run_speciesnet_server.py')
    : join(process.resourcesPath, 'python-environments', 'common', 'run_speciesnet_server.py')
  const pythonInterpreter = is.dev
    ? join(__dirname, '../../python-environments/common/.venv/bin/python')
    : os.platform() === 'win32'
      ? join(localInstalRootDirPythonEnvironment, 'python.exe')
      : join(localInstalRootDirPythonEnvironment, 'bin', 'python')
  log.info('Python Interpreter found in', pythonInterpreter)
  log.info('Script path is', scriptPath)
  const scriptArgs = [
    '--port',
    String(port),
    '--geofence',
    String(geofence),
    '--model',
    modelWeightsFilepath,
    '--timeout',
    String(timeout)
  ]

  // Add country parameter if provided
  if (country) {
    scriptArgs.push('--country', country)
  }
  log.info('Script args: ', scriptArgs)
  log.info('Formatted script args: ', [scriptPath, ...scriptArgs])

  // Generate shutdown API key for graceful shutdown
  const shutdownApiKey = crypto.randomUUID()
  log.info('Generated shutdown API key for SpeciesNet server')

  const pythonProcess = await startAndWaitTillServerHealty({
    pythonInterpreter,
    scriptPath,
    scriptArgs,
    healthEndpoint: `http://localhost:${port}/health`,
    env: { LIT_SHUTDOWN_API_KEY: shutdownApiKey }
  })

  return { process: pythonProcess, shutdownApiKey }
}

interface DeepFauneServerOptions {
  port: number
  classifierWeightsFilepath: string
  detectorWeightsFilepath: string
  timeout: number
  pythonEnvironment: {
    reference: { id: string; version: string }
  }
}

/**
 * Starts the DeepFaune HTTP server using a specified Python environment and configuration.
 *
 * @async
 * @param {DeepFauneServerOptions} options - The configuration options for starting the server.
 * @returns {Promise<{process: ChildProcess, shutdownApiKey: string}>} The spawned process and shutdown key.
 * @throws {Error} Throws an error if the server fails to start within the expected time.
 */
export async function startDeepFauneHTTPServer({
  port,
  classifierWeightsFilepath,
  detectorWeightsFilepath,
  timeout,
  pythonEnvironment
}: DeepFauneServerOptions): Promise<{ process: ChildProcess; shutdownApiKey: string }> {
  log.info('StartDeepFauneNetHTTPServer success!')
  log.info(pythonEnvironment)
  const localInstalRootDirPythonEnvironment = join(
    getMLModelEnvironmentLocalInstallPath({
      ...pythonEnvironment.reference
    }),
    pythonEnvironment.reference.id
  )
  log.info('Local Python Environment root dir is', localInstalRootDirPythonEnvironment)
  const scriptPath = is.dev
    ? join(__dirname, '../../python-environments/common/run_deepfaune_server.py')
    : join(process.resourcesPath, 'python-environments', 'common', 'run_deepfaune_server.py')
  const pythonInterpreter = is.dev
    ? join(__dirname, '../../python-environments/common/.venv/bin/python')
    : os.platform() === 'win32'
      ? join(localInstalRootDirPythonEnvironment, 'python.exe')
      : join(localInstalRootDirPythonEnvironment, 'bin', 'python')
  log.info('Python Interpreter found in', pythonInterpreter)
  log.info('Script path is', scriptPath)
  const scriptArgs = [
    '--port',
    String(port),
    '--filepath-classifier-weights',
    classifierWeightsFilepath,
    '--filepath-detector-weights',
    detectorWeightsFilepath,
    '--timeout',
    String(timeout)
  ]
  log.info('Script args: ', scriptArgs)
  log.info('Formatted script args: ', [scriptPath, ...scriptArgs])

  // Generate shutdown API key for graceful shutdown
  const shutdownApiKey = crypto.randomUUID()
  log.info('Generated shutdown API key for DeepFaune server')

  const pythonProcess = await startAndWaitTillServerHealty({
    pythonInterpreter,
    scriptPath,
    scriptArgs,
    healthEndpoint: `http://localhost:${port}/health`,
    env: { LIT_SHUTDOWN_API_KEY: shutdownApiKey }
  })

  return { process: pythonProcess, shutdownApiKey }
}

interface ManasServerOptions {
  port: number
  classifierWeightsFilepath: string
  classesFilepath: string
  detectorWeightsFilepath: string
  timeout: number
  pythonEnvironment: {
    reference: { id: string; version: string }
  }
}

/**
 * Starts the Manas HTTP server using a specified Python environment and configuration.
 *
 * @async
 * @param {ManasServerOptions} options - The configuration options for starting the server.
 * @returns {Promise<{process: ChildProcess, shutdownApiKey: string}>} The spawned process and shutdown key.
 * @throws {Error} Throws an error if the server fails to start within the expected time.
 */
export async function startManasHTTPServer({
  port,
  classifierWeightsFilepath,
  classesFilepath,
  detectorWeightsFilepath,
  timeout,
  pythonEnvironment
}: ManasServerOptions): Promise<{ process: ChildProcess; shutdownApiKey: string }> {
  log.info('StartManasHTTPServer initiated')
  log.info(pythonEnvironment)
  const localInstalRootDirPythonEnvironment = join(
    getMLModelEnvironmentLocalInstallPath({
      ...pythonEnvironment.reference
    }),
    pythonEnvironment.reference.id
  )
  log.info('Local Python Environment root dir is', localInstalRootDirPythonEnvironment)
  const scriptPath = is.dev
    ? join(__dirname, '../../python-environments/common/run_manas_server.py')
    : join(process.resourcesPath, 'python-environments', 'common', 'run_manas_server.py')
  const pythonInterpreter = is.dev
    ? join(__dirname, '../../python-environments/common/.venv/bin/python')
    : os.platform() === 'win32'
      ? join(localInstalRootDirPythonEnvironment, 'python.exe')
      : join(localInstalRootDirPythonEnvironment, 'bin', 'python')
  log.info('Python Interpreter found in', pythonInterpreter)
  log.info('Script path is', scriptPath)
  const scriptArgs = [
    '--port',
    String(port),
    '--filepath-classifier-weights',
    classifierWeightsFilepath,
    '--filepath-classes',
    classesFilepath,
    '--filepath-detector-weights',
    detectorWeightsFilepath,
    '--timeout',
    String(timeout)
  ]
  log.info('Script args: ', scriptArgs)
  log.info('Formatted script args: ', [scriptPath, ...scriptArgs])

  // Generate shutdown API key for graceful shutdown
  const shutdownApiKey = crypto.randomUUID()
  log.info('Generated shutdown API key for Manas server')

  const pythonProcess = await startAndWaitTillServerHealty({
    pythonInterpreter,
    scriptPath,
    scriptArgs,
    healthEndpoint: `http://localhost:${port}/health`,
    env: { LIT_SHUTDOWN_API_KEY: shutdownApiKey }
  })

  return { process: pythonProcess, shutdownApiKey }
}

// ============================================================================
// Server Lifecycle Management
// ============================================================================

interface StopServerOptions {
  pid: number
  port: number
  shutdownApiKey: string
}

/**
 * Stops the ML Model HTTP Server using graceful shutdown via HTTP endpoint.
 *
 * This function first attempts to gracefully shut down the server by sending a POST request
 * to the /shutdown endpoint with the provided API key. If the graceful shutdown fails or
 * times out, it falls back to forcefully killing the process with SIGKILL.
 *
 * @async
 * @param {StopServerOptions} params - The parameters for stopping the server.
 * @returns {Promise<{success: boolean, message: string}>} The result of the stop operation.
 */
export async function stopMLModelHTTPServer({
  pid,
  port,
  shutdownApiKey
}: StopServerOptions): Promise<{ success: boolean; message: string }> {
  log.info(`Stopping ML Model HTTP Server running on port ${port} with pid ${pid}`)

  // Try graceful shutdown first if we have an API key
  if (shutdownApiKey) {
    try {
      log.info('Attempting graceful shutdown via /shutdown endpoint')
      const shutdownResponse = await fetch(`http://localhost:${port}/shutdown`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${shutdownApiKey}`
        }
      })

      if (shutdownResponse.ok) {
        log.info('Graceful shutdown initiated successfully')

        // Wait for the process to exit (up to 10 seconds)
        const maxWaitTime = 10000
        const checkInterval = 500
        let waited = 0

        while (waited < maxWaitTime) {
          try {
            // Check if process is still running by sending signal 0
            process.kill(pid, 0)
            // Process still running, wait and check again
            await new Promise((resolve) => setTimeout(resolve, checkInterval))
            waited += checkInterval
          } catch {
            // Process no longer exists - shutdown complete
            log.info('Python process exited gracefully')
            unregisterActiveServer(pid)
            return {
              success: true,
              message: `Gracefully stopped ML Model within python process pid ${pid}`
            }
          }
        }

        log.warn('Graceful shutdown timed out, falling back to SIGKILL')
      } else {
        log.warn(`Graceful shutdown request failed with status ${shutdownResponse.status}`)
      }
    } catch (error) {
      log.warn('Graceful shutdown failed, falling back to SIGKILL:', (error as Error).message)
    }
  }

  // Fallback to SIGKILL
  try {
    return new Promise((resolve, reject) => {
      kill(pid, 'SIGKILL', (err) => {
        if (err) {
          log.error('Error killing Python process:', err)
          reject(err)
        } else {
          log.info('Python process killed with SIGKILL')
          unregisterActiveServer(pid)
          resolve({ success: true, message: `Stopped ML Model within python process pid ${pid}` })
        }
      })
    })
  } catch {
    return { success: false, message: `could not stop ML Model within python process pid ${pid}` }
  }
}

interface StartMLModelServerOptions {
  pythonEnvironment: {
    reference: { id: string; version: string }
  }
  modelReference: { id: string; version: string }
  country?: string | null
}

interface StartMLModelServerResult {
  port: number | null
  process: ChildProcess | null
  shutdownApiKey: string | null
}

/**
 * Starts the ML Model HTTP Server using a specified Python environment and model reference.
 *
 * This function initializes the HTTP server for the ML model, allowing it to handle requests.
 * It finds a free port for the server to listen on, initializes the server with the provided
 * model weights, and manages the lifecycle of the server process.
 *
 * @async
 * @param {StartMLModelServerOptions} options - The options for starting the server.
 * @returns {Promise<StartMLModelServerResult>} The port, process, and shutdown key.
 */
export async function startMLModelHTTPServer({
  pythonEnvironment,
  modelReference,
  country = null
}: StartMLModelServerOptions): Promise<StartMLModelServerResult> {
  log.info('Starting ML Model HTTP Server')
  log.info('Finding free port for Python server...')
  log.info('Model Reference:', modelReference, pythonEnvironment)

  switch (modelReference.id) {
    case 'speciesnet': {
      const port = is.dev ? 8000 : await findFreePort()
      const localInstallPath = getMLModelLocalInstallPath({ ...modelReference })
      log.info(`Local ML Model install path ${localInstallPath}`)
      const { process: pythonProcess, shutdownApiKey } = await startSpeciesNetHTTPServer({
        port,
        modelWeightsFilepath: localInstallPath,
        geofence: true,
        timeout: 30,
        pythonEnvironment: pythonEnvironment,
        country: country
      })
      log.info(`pythonProcess: ${JSON.stringify(pythonProcess)}`)
      registerActiveServer({
        pid: pythonProcess.pid as number,
        port,
        shutdownApiKey,
        modelId: modelReference.id
      })
      return { port: port, process: pythonProcess, shutdownApiKey }
    }
    case 'deepfaune': {
      const port = is.dev ? 8001 : await findFreePort()
      const localInstallPath = getMLModelLocalInstallPath({ ...modelReference })
      log.info(`Local ML Model install path ${localInstallPath}`)
      const classifierWeightsFilepath = join(
        localInstallPath,
        'deepfaune-vit_large_patch14_dinov2.lvd142m.v3.pt'
      )
      const detectorWeightsFilepath = join(localInstallPath, 'MDV6-yolov10x.pt')
      const { process: pythonProcess, shutdownApiKey } = await startDeepFauneHTTPServer({
        port,
        classifierWeightsFilepath: classifierWeightsFilepath,
        detectorWeightsFilepath: detectorWeightsFilepath,
        timeout: 30,
        pythonEnvironment: pythonEnvironment
      })
      log.info(`pythonProcess: ${JSON.stringify(pythonProcess)}`)
      registerActiveServer({
        pid: pythonProcess.pid as number,
        port,
        shutdownApiKey,
        modelId: modelReference.id
      })
      return { port: port, process: pythonProcess, shutdownApiKey }
    }
    case 'manas': {
      const port = is.dev ? 8002 : await findFreePort()
      const localInstallPath = getMLModelLocalInstallPath({ ...modelReference })
      log.info(`Local ML Model install path ${localInstallPath}`)
      const classifierWeightsFilepath = join(
        localInstallPath,
        'best_model_Fri_Sep__1_18_50_55_2023.pt'
      )
      const classesFilepath = join(localInstallPath, 'classes_Fri_Sep__1_18_50_55_2023.pickle')
      const detectorWeightsFilepath = join(localInstallPath, 'MDV6-yolov10x.pt')
      const { process: pythonProcess, shutdownApiKey } = await startManasHTTPServer({
        port,
        classifierWeightsFilepath: classifierWeightsFilepath,
        classesFilepath: classesFilepath,
        detectorWeightsFilepath: detectorWeightsFilepath,
        timeout: 30,
        pythonEnvironment: pythonEnvironment
      })
      log.info(`pythonProcess: ${JSON.stringify(pythonProcess)}`)
      registerActiveServer({
        pid: pythonProcess.pid as number,
        port,
        shutdownApiKey,
        modelId: modelReference.id
      })
      return { port: port, process: pythonProcess, shutdownApiKey }
    }
    default: {
      log.warn(
        `startMLModelHTTPServer: Not implemented for ${modelReference.id} version ${modelReference.version}`
      )
      return { port: null, process: null, shutdownApiKey: null }
    }
  }
}

/**
 * Gracefully shuts down all active ML servers.
 * Attempts graceful shutdown first, then falls back to SIGKILL.
 * @returns Promise that resolves when all servers are stopped.
 */
export async function shutdownAllServers(): Promise<void> {
  const servers = getActiveServers()

  if (servers.length === 0) {
    log.info('[Shutdown] No active ML servers to shut down')
    return
  }

  log.info(`[Shutdown] Initiating graceful shutdown of ${servers.length} ML server(s)`)

  const shutdownPromises = servers.map(async (server) => {
    try {
      await stopMLModelHTTPServer({
        pid: server.pid,
        port: server.port,
        shutdownApiKey: server.shutdownApiKey
      })
    } catch (error) {
      log.error(`[Shutdown] Failed to stop server pid=${server.pid}:`, (error as Error).message)
    }
  })

  await Promise.allSettled(shutdownPromises)
  log.info('[Shutdown] All ML servers shutdown complete')
}
