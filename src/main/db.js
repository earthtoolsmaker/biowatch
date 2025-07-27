import sqlite3 from 'sqlite3'
import log from 'electron-log'

function setupDatabase(db) {
  db.serialize(() => {
    db.run(
      `CREATE TABLE IF NOT EXISTS deployments (
        deploymentID TEXT PRIMARY KEY,
        locationID TEXT,
        locationName TEXT,
        deploymentStart TEXT,
        deploymentEnd TEXT,
        latitude REAL,
        longitude REAL
      )`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS media (
        mediaID TEXT PRIMARY KEY,
        deploymentID TEXT,
        timestamp TEXT,
        filePath TEXT,
        fileName TEXT,
        FOREIGN KEY (deploymentID) REFERENCES deployments(deploymentID)
      )`
    )
    db.run(
      `CREATE TABLE IF NOT EXISTS observations (
        observationID TEXT PRIMARY KEY,
        mediaID TEXT,
        deploymentID TEXT,
        eventID TEXT,
        eventStart TEXT,
        eventEnd TEXT,
        scientificName TEXT,
        observationType TEXT,
        commonName TEXT,
        confidence REAL,
        count INTEGER,
        prediction TEXT,
        lifeStage TEXT,
        age TEXT,
        sex TEXT,
        behavior TEXT,
        FOREIGN KEY (mediaID) REFERENCES media(mediaID),
        FOREIGN KEY (deploymentID) REFERENCES deployments(deploymentID)
      )`
    )
  })
}

/**
 * Open a SQLite database
 * @param {string} dbPath - Path to the database file
 * @returns {Promise<sqlite3.Database>} - Database instance
 */
function openDatabase(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        log.error(`Error opening database: ${err.message}`)
        reject(err)
      } else {
        resolve(db)
      }
    })
  })
}

/**
 * Close a SQLite database
 * @param {sqlite3.Database} db - Database instance
 * @returns {Promise<void>}
 */
function closeDatabase(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) {
        log.error(`Error closing database: ${err.message}`)
        reject(err)
      } else {
        resolve()
      }
    })
  })
}

export { setupDatabase, openDatabase, closeDatabase }
