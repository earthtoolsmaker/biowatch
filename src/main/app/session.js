/**
 * Session configuration for the Electron app
 *
 * Handles CORS setup for remote media hosts
 */

import { session } from 'electron'

/**
 * Add CORS headers to responses from remote media hosts.
 * Uses webRequest API which operates AFTER the cache layer,
 * so cached responses are served directly without modification.
 */
export function setupRemoteMediaCORS() {
  // Filter for remote media hosts
  const filter = {
    urls: [
      'https://multimedia.agouti.eu/*',
      'https://lilawildlife.blob.core.windows.net/*',
      'https://storage.googleapis.com/public-datasets-lila/*'
    ]
  }

  session.defaultSession.webRequest.onHeadersReceived(filter, (details, callback) => {
    const responseHeaders = { ...details.responseHeaders }

    // Add CORS headers
    responseHeaders['Access-Control-Allow-Origin'] = ['*']
    responseHeaders['Access-Control-Allow-Methods'] = ['GET, HEAD, OPTIONS']

    callback({ responseHeaders })
  })
}
