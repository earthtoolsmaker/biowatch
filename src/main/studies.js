import { app, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'

app.whenReady().then(() => {
  ipcMain.handle('studies:list', async () => {
    //read files from the studies directory
    const studiesPath = path.join(app.getPath('userData'), 'biowatch-data', 'studies')

    //list directories in studiesPath
    const studyDirs = fs
      .readdirSync(studiesPath, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)

    // Read study.json for each study directory
    const studies = studyDirs.map((studyId) => {
      try {
        const studyJsonPath = path.join(studiesPath, studyId, 'study.json')
        const studyData = JSON.parse(fs.readFileSync(studyJsonPath, 'utf8'))
        return {
          id: studyId,
          ...studyData
        }
      } catch (error) {
        console.warn(`Failed to read study.json for study ${studyId}:`, error.message)
        return {
          id: studyId,
          error: 'Failed to load study data'
        }
      }
    })

    return studies
  })
})
