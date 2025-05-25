import { join } from 'path'
import { spawn } from 'child_process'
import log from 'electron-log'
import kill from 'tree-kill'

export async function getPredictions(imagesPath, onPrediction) {
  log.info('images', imagesPath)
  const scriptPath = join(__dirname, '../../test-species/run_server.py')
  const pythonInterpreter = join(__dirname, '../../test-species/.venv/bin/python')

  // Start the Python server
  const pythonProcess = spawn(pythonInterpreter, [scriptPath, '--port', '8000'])

  log.info('Python process started:', pythonProcess.pid)

  // Set up error handlers
  pythonProcess.stderr.on('data', (err) => {
    log.error('Python error:', err.toString())
  })

  pythonProcess.on('error', (err) => {
    log.error('Python process error:', err)
  })

  // Wait for server to be ready by polling the endpoint
  const serverReady = async () => {
    const maxRetries = 30
    const retryInterval = 1000 // 1 second

    for (let i = 0; i < maxRetries; i++) {
      try {
        const healthCheck = await fetch('http://localhost:8000/health', {
          method: 'GET',
          timeout: 1000
        })

        if (healthCheck.ok) {
          log.info('Server is ready')
          return
        }
      } catch (error) {
        // Server not ready yet, will retry
      }

      // Wait before next retry
      await new Promise((resolve) => setTimeout(resolve, retryInterval))
      log.info(`Waiting for server to start (attempt ${i + 1}/${maxRetries})`)
    }

    throw new Error('Server failed to start in the expected time')
  }

  try {
    // Wait for server to be ready
    await serverReady()

    // Send request and handle streaming response
    const response = await fetch('http://localhost:8000/predict', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ instances: imagesPath.map((path) => ({ filepath: path })) })
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    // Check if the response is streamed
    if (
      response.headers.get('Transfer-Encoding') === 'chunked' ||
      response.headers.get('Content-Type')?.includes('stream')
    ) {
      let predictions = []
      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        const chunk = decoder.decode(value, { stream: true })
        // Process chunk data - assuming each chunk is a JSON prediction
        try {
          // Handle different formats of streaming responses
          const lines = chunk.trim().split('\n')
          for (const line of lines) {
            if (line.trim()) {
              const response = JSON.parse(line)
              const preds = response.output.predictions
              log.info('Received prediction:', response.output, preds)
              // predictions = [...predictions, ...preds]
              await onPrediction(preds)
            }
          }
        } catch (e) {
          log.error('Error parsing prediction chunk:', e)
        }
      }
      return predictions
    } else {
      // Handle non-streamed response
      const data = await response.json()
      return data
    }
  } catch (error) {
    log.error('Error in prediction process:', error)
    throw error
  } finally {
    // Terminate the Python process
    kill(pythonProcess.pid)
    log.info('Python process terminated')
  }
}
