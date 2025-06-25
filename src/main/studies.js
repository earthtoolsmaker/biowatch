import { app, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import log from 'electron-log'

const studiesPath = path.join(app.getPath('userData'), 'biowatch-data', 'studies')

function getStudy(id) {
  const studyJsonPath = path.join(studiesPath, id, 'study.json')
  if (!fs.existsSync(studyJsonPath)) {
    // console.log('Study JSON file does not exist for study ID:', id, studyJsonPath)
    return null
  } else {
    return JSON.parse(fs.readFileSync(studyJsonPath, 'utf8'))
  }
}

app.whenReady().then(() => {
  ipcMain.handle('studies:list', async () => {
    //read files from the studies directory

    //list directories in studiesPath
    const studyDirs = fs
      .readdirSync(studiesPath, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)

    // Read study.json for each study directory
    const studies = studyDirs
      .map((studyId) => {
        try {
          const study = getStudy(studyId)
          if (!study) return
          return { ...study, id: studyId }
        } catch (error) {
          console.warn(`Failed to read study.json for study ${studyId}:`, error.message)
          return {
            id: studyId,
            error: 'Failed to load study data'
          }
        }
      })
      .filter((study) => study)

    return studies
  })

  ipcMain.handle('studies:fromLocalStorage', async (event, studiesString) => {
    const studies = JSON.parse(studiesString)
    for (const study of studies) {
      const studyJsonPath = path.join(studiesPath, study.id, 'study.json')
      fs.writeFileSync(studyJsonPath, JSON.stringify(study))
    }
  })

  ipcMain.handle('studies:update', async (event, id, update) => {
    console.log('Updating study', id, 'with update:', update)
    const study = getStudy(id)

    if (!study) {
      log.error("Can't update study with id", id)
    }

    const studyJsonPath = path.join(studiesPath, id, 'study.json')
    const updated = { ...study, ...update }
    console.log('updated', updated)

    // Write the updated study data
    fs.writeFileSync(studyJsonPath, JSON.stringify(updated))
    log.info(`Updated study ${id} at ${studyJsonPath}`)

    return study
  })
})

export default {}
