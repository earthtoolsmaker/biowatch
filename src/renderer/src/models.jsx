import { useState, useEffect, useCallback } from 'react'
import {
  Download,
  LucideLoader,
  Trash2,
  CircleOff,
  PlayIcon,
  CpuIcon,
  Book,
  Server,
  Mail
} from 'lucide-react'
import { toast } from 'sonner'
import { platformToKey, findPythonEnvironment } from '../../shared/mlmodels'
import {
  isOwnEnvironmentDownload,
  isDownloadComplete,
  determineInitialDownloadState,
  calculateProgressInfo
} from '../../shared/downloadState'
import googleLogo from './assets/logos/google.png'
import cnrsLogo from './assets/logos/cnrs_blue.png'
import etmLogo from './assets/logos/earthtoolsmaker.png'
import osiPantheraLogo from './assets/logos/osi-panthera.jpg'

const MODEL_LOGOS = {
  google: googleLogo,
  cnrs: cnrsLogo,
  'osi-panthera': osiPantheraLogo
}

/**
 * Converts a size in MiB to GiB or returns the size in MiB if it is less than or equal to 1000.
 * @param {number} size_in_MiB - The size in MiB to convert.
 * @returns {string} The size in GiB if greater than 1000, otherwise in MiB.
 */
function formatSizeInMiB(size_in_MiB) {
  if (size_in_MiB > 1000) {
    return (size_in_MiB / 1024).toFixed(2) + ' GiB'
  }
  return size_in_MiB + ' MiB'
}

function ModelRow({
  model,
  pythonEnvironment,
  platform,
  isDev = false,
  refreshKey = 0,
  onDownloadStatusChange
}) {
  const [modelDownloadStatus, setModelDownloadStatus] = useState({
    model: {},
    pythonEnvironment: {}
  })
  const [isDownloading, setIsDownloading] = useState(false)
  const [isHTTPServerRunning, setIsHTTPServerRunning] = useState(false)
  const [isHTTPServerStarting, setIsHTTPServerStarting] = useState(false)
  const [isDownloaded, setIsDownloaded] = useState(false)
  const [pidPythonProcess, setPidPythonProcess] = useState(null)
  const [portHTTPServer, setPortHTTPServer] = useState(null)
  const [shutdownApiKey, setShutdownApiKey] = useState(null)

  useEffect(() => {
    let intervalId = null
    if (isDownloading) {
      intervalId = setInterval(async () => {
        const downloadStatus = await window.api.getMLModelDownloadStatus({
          modelReference: model.reference,
          pythonEnvironmentReference: pythonEnvironment.reference
        })
        setModelDownloadStatus(downloadStatus)

        const modelState = downloadStatus['model']['state']
        const envState = downloadStatus['pythonEnvironment']['state']
        const envActiveModelId = downloadStatus['pythonEnvironment']['opts']?.activeDownloadModelId

        const isOwnEnvDownload = isOwnEnvironmentDownload(envActiveModelId, model.reference.id)

        if (isDownloadComplete({ modelState, envState, isOwnEnvDownload })) {
          setIsDownloaded(true)
          setIsDownloading(false)
        }
      }, 500)
    }
    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [isDownloading, model.reference, pythonEnvironment.reference])

  useEffect(() => {
    const getMLModelDownloadStatus = async () => {
      const downloadStatus = await window.api.getMLModelDownloadStatus({
        modelReference: model.reference,
        pythonEnvironmentReference: pythonEnvironment.reference
      })
      console.log(downloadStatus)

      const { isDownloaded: downloaded, isDownloading: downloading } =
        determineInitialDownloadState({
          modelStatus: downloadStatus['model'],
          envStatus: downloadStatus['pythonEnvironment'],
          currentModelId: model.reference.id
        })

      setIsDownloaded(downloaded)
      setIsDownloading(downloading)
      setModelDownloadStatus(downloadStatus)
    }

    getMLModelDownloadStatus()
  }, [model.reference, pythonEnvironment.reference, refreshKey])

  // Notify parent when download status changes
  useEffect(() => {
    if (onDownloadStatusChange) {
      onDownloadStatusChange(model.reference.id, isDownloaded)
    }
  }, [isDownloaded, model.reference.id, onDownloadStatusChange])

  const handleRunHTTPServer = async ({ modelReference, pythonEnvironment }) => {
    setIsHTTPServerStarting(true)
    console.log(`Starting HTTP server for ${modelReference.id} version ${modelReference.version}`)
    try {
      const response = await window.api.startMLModelHTTPServer({
        modelReference,
        pythonEnvironment
      })
      console.log(JSON.stringify(response))

      // Check for error response from backend
      if (!response.success) {
        console.error('Server failed to start:', response.message)
        toast.error('Unable to process images', {
          description: 'The AI model could not start. Please try again or restart the app.',
          duration: 8000
        })
        setIsHTTPServerStarting(false)
        return
      }

      setIsHTTPServerRunning(true)
      setIsHTTPServerStarting(false)
      setPortHTTPServer(response.process.port)
      setPidPythonProcess(response.process.pid)
      setShutdownApiKey(response.process.shutdownApiKey)
    } catch (error) {
      console.error('Failed to start HTTP server:', error)
      toast.error('Unable to process images', {
        description: 'The AI model could not start. Please try again or restart the app.',
        duration: 8000
      })
      setIsHTTPServerStarting(false)
    }
  }

  const handleStopHTTPServer = async ({ pid, port, shutdownApiKey }) => {
    console.log(`Stopping HTTP server running with python process pid ${pid}`)
    await window.api.stopMLModelHTTPServer({ pid, port, shutdownApiKey })
    setIsHTTPServerRunning(false)
    setShutdownApiKey(null)
  }

  const handleDelete = async (reference) => {
    console.log('handling delete...')
    try {
      await window.api.deleteLocalMLModel(reference)
      setIsDownloaded(false)
    } catch (error) {
      console.error('Failed to delete the local model:', error)
    }
  }
  const handleDownload = async ({ modelReference, pythonEnvironment }) => {
    console.log('handling download...')
    setIsDownloading(true)
    try {
      await window.api.downloadMLModel(modelReference)
      console.log('downloading python environment')
      await window.api.downloadPythonEnvironment({
        ...pythonEnvironment.reference,
        requestingModelId: modelReference.id
      })
      setIsDownloaded(true)
      const downloadStatus = await window.api.getMLModelDownloadStatus({
        modelReference: model.reference,
        pythonEnvironmentReference: pythonEnvironment.reference
      })
      setModelDownloadStatus(downloadStatus)
      setIsDownloading(false)
      setIsDownloaded(true)
      toast.success(`${model.name} downloaded`, {
        description: 'The model is ready to use.',
        duration: 5000
      })
    } catch (error) {
      setIsDownloading(false)
      console.error('Failed to download model:', error)
    }
  }

  const { name, description, reference, size_in_MiB, logo } = model
  const { downloadMessage, downloadProgress } = calculateProgressInfo({
    modelStatus: modelDownloadStatus.model,
    envStatus: modelDownloadStatus.pythonEnvironment,
    currentModelId: model.reference.id
  })

  return (
    <>
      <tr className="border-b border-gray-200 hover:bg-gray-50">
        <td className="p-4">
          <div className="flex items-center gap-3">
            {logo && MODEL_LOGOS[logo] && (
              <img
                src={MODEL_LOGOS[logo]}
                alt={`${name} logo`}
                className="h-8 w-8 object-contain flex-shrink-0"
              />
            )}
            <div className="font-medium text-sm">{name}</div>
          </div>
        </td>
        <td className="p-4 text-sm text-gray-700 max-w-md">{description}</td>
        <td className="p-4 text-sm text-center">{formatSizeInMiB(size_in_MiB)}</td>
        <td className="p-4 text-sm text-center">
          {formatSizeInMiB(pythonEnvironment['platform'][platformToKey(platform)]['size_in_MiB'])}
        </td>
        <td className="p-4 text-sm">
          {isDownloaded ? (
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
              Downloaded
            </span>
          ) : isDownloading ? (
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
              Downloading
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-800 whitespace-nowrap">
              Not downloaded
            </span>
          )}
        </td>
        <td className="p-4">
          {isDownloading ? (
            <div className="min-w-[200px]">
              <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all duration-500 ease-in-out"
                  style={{ width: `${downloadProgress}%` }}
                ></div>
              </div>
              <div className="w-full text-xs text-center pt-1 text-gray-600">{downloadMessage}</div>
            </div>
          ) : (
            <div className="flex gap-2 justify-end">
              {isDownloaded ? (
                <>
                  <button
                    onClick={() => handleDelete(reference)}
                    className="cursor-pointer transition-colors flex flex-row gap-2 items-center border border-gray-200 px-3 h-8 text-sm shadow-sm rounded-md hover:bg-gray-100"
                    title="Delete model"
                  >
                    <Trash2 color="black" size={14} />
                    Delete
                  </button>
                  {isDev && (
                    <>
                      {isHTTPServerRunning ? (
                        <button
                          onClick={() =>
                            handleStopHTTPServer({
                              pid: pidPythonProcess,
                              port: portHTTPServer,
                              shutdownApiKey: shutdownApiKey
                            })
                          }
                          className="cursor-pointer transition-colors flex flex-row gap-2 items-center border border-gray-200 px-3 h-8 text-sm shadow-sm rounded-md hover:bg-gray-100"
                          title="Stop HTTP server"
                        >
                          <CircleOff color="black" size={14} />
                          Stop
                        </button>
                      ) : isHTTPServerStarting ? (
                        <button
                          className="cursor-not-allowed flex flex-row gap-2 items-center border border-gray-200 px-3 h-8 text-sm shadow-sm rounded-md opacity-70"
                          disabled
                        >
                          <LucideLoader color="black" size={14} className="animate-spin" />
                          Starting
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            handleRunHTTPServer({
                              modelReference: reference,
                              pythonEnvironment: pythonEnvironment
                            })
                          }
                          className="cursor-pointer transition-colors flex flex-row gap-2 items-center border border-gray-200 px-3 h-8 text-sm shadow-sm rounded-md hover:bg-gray-100"
                          title="Run HTTP server"
                        >
                          <PlayIcon color="black" size={14} />
                          Run
                        </button>
                      )}
                    </>
                  )}
                </>
              ) : (
                <button
                  onClick={() =>
                    handleDownload({
                      modelReference: reference,
                      pythonEnvironment: pythonEnvironment
                    })
                  }
                  className="bg-white cursor-pointer transition-colors flex flex-row gap-2 items-center border border-gray-200 px-3 h-8 text-sm shadow-sm rounded-md hover:bg-gray-100"
                  title="Download model"
                >
                  <Download color="black" size={14} />
                  Download
                </button>
              )}
            </div>
          )}
        </td>
      </tr>
      {isHTTPServerRunning && (
        <tr className="border-b border-gray-200 bg-blue-50">
          <td colSpan="6" className="p-4">
            <div className="text-sm flex items-center gap-6">
              <span className="flex items-center gap-2">
                <Server size={14} />
                Port: {portHTTPServer}
              </span>
              <span className="flex items-center gap-2">
                <CpuIcon size={14} />
                PID: {pidPythonProcess}
              </span>
              <a
                href={`http://localhost:${portHTTPServer}/docs`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-blue-600 hover:underline"
              >
                <Book size={14} />
                API Documentation
              </a>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function CustomModelRow() {
  return (
    <tr className="border-b border-gray-200 hover:bg-gray-50">
      <td className="p-4">
        <div className="flex items-center gap-3">
          <img
            src={etmLogo}
            alt="EarthToolsMaker logo"
            className="h-8 w-8 object-contain flex-shrink-0 rounded-full"
          />
          <div className="font-medium text-sm">Your Custom Model</div>
        </div>
      </td>
      <td className="p-4 text-sm text-gray-700 max-w-md">
        Need an AI model tailored to your specific wildlife monitoring needs? EarthToolsMaker can
        develop and integrate custom models directly into BioWatch for your unique species, regions,
        or use cases.
      </td>
      <td className="p-4 text-sm text-center text-gray-400">-</td>
      <td className="p-4 text-sm text-center text-gray-400">-</td>
      <td className="p-4 text-sm">
        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
          Custom
        </span>
      </td>
      <td className="p-4">
        <div className="flex gap-2 justify-end">
          <a
            href="https://www.earthtoolsmaker.org/contact"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-white cursor-pointer transition-colors flex flex-row gap-2 items-center border border-gray-200 px-3 h-8 text-sm shadow-sm rounded-md hover:bg-gray-100 whitespace-nowrap"
          >
            <Mail color="black" size={14} />
            Contact Us
          </a>
        </div>
      </td>
    </tr>
  )
}

export default function Zoo({ modelZoo }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const [downloadedModels, setDownloadedModels] = useState(new Set())

  const handleDownloadStatusChange = useCallback((modelId, isDownloaded) => {
    setDownloadedModels((prev) => {
      const next = new Set(prev)
      if (isDownloaded) {
        next.add(modelId)
      } else {
        next.delete(modelId)
      }
      return next
    })
  }, [])

  const handleClearAllMLModels = async () => {
    console.log('[CLEAR ALL] Frontend: Starting clear all operation...')
    try {
      console.log('[CLEAR ALL] Frontend: Calling clearAllLocalMLModel API...')
      const result = await window.api.clearAllLocalMLModel()
      console.log('[CLEAR ALL] Frontend: API call completed with result:', result)

      if (result && result.success) {
        console.log('[CLEAR ALL] Frontend: Clear all operation successful:', result.message)
        setRefreshKey((prev) => prev + 1)
      } else {
        console.error(
          '[CLEAR ALL] Frontend: Clear all operation failed:',
          result?.message || 'Unknown error'
        )
      }
    } catch (error) {
      console.error('[CLEAR ALL] Frontend: Failed to clear all the local models:', error)
      console.error('[CLEAR ALL] Frontend: Error stack:', error.stack)
    }
  }
  return (
    <div className="px-8 py-4">
      <div className="overflow-x-auto border border-gray-200 rounded-lg shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 bg-white">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                Model
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                Description
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase tracking-wider">
                Model Size
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-700 uppercase tracking-wider">
                Environment Size
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                Status
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-700 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {modelZoo.map((entry) => (
              <ModelRow
                key={entry.reference.id}
                model={entry}
                pythonEnvironment={findPythonEnvironment(entry.pythonEnvironment)}
                platform={window.electron.process.platform}
                isDev={window.electron.process.env.NODE_ENV == 'development'}
                refreshKey={refreshKey}
                onDownloadStatusChange={handleDownloadStatusChange}
              />
            ))}
            <CustomModelRow />
          </tbody>
        </table>
      </div>
      {downloadedModels.size > 0 && (
        <div className="flex justify-end mt-4">
          <button
            onClick={() => handleClearAllMLModels()}
            className="bg-white cursor-pointer transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-3 h-9 text-sm shadow-sm rounded-md hover:bg-gray-50 whitespace-nowrap"
          >
            <Trash2 color="black" size={14} />
            Clear All
          </button>
        </div>
      )}
    </div>
  )
}
