/**
 * Manages ML model HTTP server lifecycle.
 *
 * Enforces one server at a time. If ensureServer is called
 * with a different topic, stops the current server first.
 */

import { startMLModelHTTPServer, stopMLModelHTTPServer } from './ml/server.js'
import mlmodels from '../../shared/mlmodels.js'
import log from './logger.js'

class ServerManager {
  constructor() {
    this._current = null // { topic, port, pid, shutdownApiKey, model }
  }

  /**
   * Ensure a server is running for the given topic.
   * @param {string} topic - e.g. 'speciesnet:4.0.1a'
   * @param {string|null} [country] - Country code for geofencing
   * @returns {Promise<{port: number, model: Object}>}
   */
  async ensureServer(topic, country = null) {
    if (this._current && this._current.topic === topic) {
      return { port: this._current.port, model: this._current.model }
    }

    // Different topic or no server: stop current, start new
    if (this._current) {
      await this.stop()
    }

    const [modelId, modelVersion] = topic.split(':')
    const modelReference = { id: modelId, version: modelVersion }
    const model = mlmodels.findModel(modelReference)
    if (!model) {
      throw new Error(`Model not found: ${topic}`)
    }
    const pythonEnvironment = mlmodels.findPythonEnvironment(model.pythonEnvironment)
    if (!pythonEnvironment) {
      throw new Error(`Python environment not found for: ${topic}`)
    }

    log.info(`[ServerManager] Starting server for topic=${topic}`)
    const {
      port,
      process: proc,
      shutdownApiKey
    } = await startMLModelHTTPServer({
      pythonEnvironment,
      modelReference,
      country
    })

    this._current = {
      topic,
      port,
      pid: proc.pid,
      shutdownApiKey,
      model
    }
    log.info(`[ServerManager] Server started for topic=${topic} on port ${port}`)
    return { port, model }
  }

  /**
   * Stop the current server.
   */
  async stop() {
    if (!this._current) return

    log.info(`[ServerManager] Stopping server for topic=${this._current.topic}`)
    try {
      await stopMLModelHTTPServer({
        pid: this._current.pid,
        port: this._current.port,
        shutdownApiKey: this._current.shutdownApiKey
      })
    } catch (error) {
      log.error(`[ServerManager] Error stopping server:`, error)
    }
    this._current = null
  }

  get currentTopic() {
    return this._current?.topic ?? null
  }

  get isRunning() {
    return this._current !== null
  }
}

export const serverManager = new ServerManager()
