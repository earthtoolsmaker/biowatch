import { spawn } from 'child_process'
import log from 'electron-log'
import exifr from 'exifr'
import fs from 'fs'
import geoTz from 'geo-tz'
import readline from 'linebyline'
import luxon from 'luxon'
import path, { join } from 'path'

async function getPredictions(path) {
  console.log('Getting predictions for path:', path)
  return new Promise((resolve, reject) => {
    let preds = []
    const scriptPath = join(__dirname, '../../test-species/main.py')
    const pythonInterpreter = join(__dirname, '../../test-species/.venv/bin/python3.11')
    let pythonProcess = spawn(pythonInterpreter, [scriptPath, '--path', path])
    const rl = readline(pythonProcess.stdout)

    rl.on('line', (line) => {
      try {
        // log.info('Python line:', line)
        if (line.startsWith('PREDICTION:')) {
          const [, prediction] = line.split('PREDICTION: ')
          preds.push(JSON.parse(prediction))
          // log.info('Prediction:', JSON.parse(prediction))
        }
      } catch (err) {
        console.error('Failed to parse line:', line, err)
      }
    })

    pythonProcess.stderr.on('data', (err) => {
      log.error('Python error:', err.toString())
    })

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        resolve(preds)
      } else {
        reject(new Error(`Python process exited with code ${code}`))
      }
    })

    pythonProcess.on('error', (err) => {
      reject(err)
    })
  })
}

async function scanDir(folderPath) {
  const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.svg']

  const media = []

  // Recursive function to build the directory tree
  async function processDirectory(dirPath) {
    const name = path.basename(dirPath)
    const stats = fs.statSync(dirPath)

    console.log('Processing directory:', dirPath, stats)

    if (!stats.isDirectory()) {
      return null
    }

    const items = fs.readdirSync(dirPath)
    const children = []
    let mediaList = [] // Replace imagesCount with mediaList array

    // Process each item in the directory
    for (const item of items) {
      const itemPath = path.join(dirPath, item)
      const itemStats = fs.statSync(itemPath)

      // If it's a directory, process it recursively
      if (itemStats.isDirectory()) {
        const subdirectory = await processDirectory(itemPath)
        if (subdirectory) {
          children.push(subdirectory)
        }
      }
      // If it's a file, check if it's an image
      else if (itemStats.isFile()) {
        const ext = path.extname(item).toLowerCase()
        if (imageExtensions.includes(ext)) {
          let exifData = {}
          try {
            exifData = await exifr.parse(itemPath, {
              gps: true,
              exif: true,
              reviveValues: true
            })
          } catch (exifError) {
            log.warn(`Could not extract EXIF data from ${itemPath}: ${exifError.message}`)
          }

          let latitude = null
          let longitude = null
          if (exifData && exifData.latitude && exifData.longitude) {
            latitude = exifData.latitude
            longitude = exifData.longitude
          }

          const [timeZone] = latitude && longitude ? geoTz.find(latitude, longitude) : [null]

          const date = luxon.DateTime.fromJSDate(exifData.DateTimeOriginal, {
            zone: timeZone
          })

          const mediaItem = {
            path: itemPath,
            name: item,
            size: itemStats.size,
            date,
            latitude,
            longitude
          }

          media.push(mediaItem)
          mediaList.push(mediaItem) // Add to the current directory's media list
        }
      }
    }

    return {
      name,
      path: dirPath,
      children,
      mediaList // Return mediaList instead of imagesCount
    }
  }

  const tree = await processDirectory(folderPath)

  return { tree, media }
}

export async function importFromImages(folderPath) {
  // getPredictions(folderPath)
  //   .then((predictions) => {
  //     console.log('Predictions:', predictions)
  //     // Handle the predictions as needed
  //   })
  //   .catch((error) => {
  //     console.error('Error getting predictions:', error)
  //   })

  const { tree, media } = await scanDir(folderPath)

  // Get all leaf directories from the tree
  const leafDirectories = []

  function findLeafDirectories(node) {
    if (!node) return

    // A leaf directory has no children or empty children array
    if (!node.children || node.children.length === 0) {
      leafDirectories.push(node)
    } else {
      // Recursively process children
      for (const child of node.children) {
        findLeafDirectories(child)
      }
    }
  }

  findLeafDirectories(tree)

  // Process each leaf directory to create deployments
  const deployments = leafDirectories.map((leaf) => {
    const mediaList = leaf.mediaList || []

    // Calculate min and max dates
    let minDate = null
    let maxDate = null

    // Track locations and their counts
    const locationMap = new Map()

    for (const item of mediaList) {
      // Process dates
      if (item.date) {
        if (!minDate || item.date < minDate) {
          minDate = item.date
        }
        if (!maxDate || item.date > maxDate) {
          maxDate = item.date
        }
      }

      // Process locations
      if (item.latitude !== null && item.longitude !== null) {
        // Create a location key (rounded to 5 decimal places for grouping nearby points)
        const lat = Math.round(item.latitude * 1000000) / 1000000
        const lng = Math.round(item.longitude * 1000000) / 1000000
        const locKey = `${lat},${lng}`

        if (!locationMap.has(locKey)) {
          locationMap.set(locKey, {
            lat,
            lng,
            mediaCount: 1
          })
        } else {
          const loc = locationMap.get(locKey)
          loc.mediaCount++
        }
      }
    }

    // Convert the location map to an array
    const locations = Array.from(locationMap.values())

    // Determine the main location (with highest count)
    let mainLocation = null
    if (locations.length > 0) {
      mainLocation = locations.reduce((prev, current) =>
        prev.mediaCount > current.mediaCount ? prev : current
      )

      // Extract just the lat/lng for the main location
      mainLocation = {
        lat: mainLocation.lat,
        lng: mainLocation.lng
      }
    }

    if (!minDate) {
      console.log('No date found in directory:', leaf.path)
    }

    return {
      name: leaf.name,
      path: leaf.path,
      minDate: minDate.toISO(),
      maxDate: maxDate.toISO(),
      locations,
      mainLocation,
      mediaCount: mediaList.length
    }
  })

  log.info('Scanned directory:', folderPath, tree, media.length, media[0])
  log.info(
    'Found deployments:',
    deployments,
    deployments.map((d) => d.locations)
  )

  const treeWithMediaCount = transformTreeMediaList(tree)

  return { tree: treeWithMediaCount, media, deployments }
}

// Helper function to transform the tree structure
function transformTreeMediaList(node) {
  if (!node) return null

  // Create a new node with mediaCount instead of mediaList
  const newNode = {
    name: node.name,
    path: node.path,
    mediaCount: node.mediaList ? node.mediaList.length : 0
  }

  // Transform children recursively if they exist
  if (node.children && node.children.length > 0) {
    newNode.children = node.children.map(transformTreeMediaList)
  } else {
    newNode.children = []
  }

  return newNode
}
