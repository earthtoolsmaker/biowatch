import { useState, useEffect } from 'react'
import {
  Download,
  LucideLoader,
  CircleX,
  CircleOff,
  PlayIcon,
  CpuIcon,
  Book,
  Server,
  Mail
} from 'lucide-react'
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

function ModelCard({ model, pythonEnvironment, platform, isDev = false, refreshKey = 0 }) {
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
  }, [model.reference, pythonEnvironment.reference, refreshKey]) // Run this effect when the model reference changes or refreshKey changes

  const handleRunHTTPServer = async ({ modelReference, pythonEnvironment }) => {
    setIsHTTPServerStarting(true)
    console.log(`Starting HTTP server for ${modelReference.id} version ${modelReference.version}`)
    try {
      const response = await window.api.startMLModelHTTPServer({
        modelReference,
        pythonEnvironment
      })
      console.log(JSON.stringify(response))
      setIsHTTPServerRunning(true)
      setIsHTTPServerStarting(false)
      setPortHTTPServer(response.process.port)
      setPidPythonProcess(response.process.pid)
    } catch (error) {
      console.error('Failed to delete the local model:', error)
    }
  }

  const handleStopHTTPServer = async ({ pid, port }) => {
    console.log(`Stopping HTTP server running with python process pid ${pid}`)
    window.api.stopMLModelHTTPServer({ pid, port })
    setIsHTTPServerRunning(false)
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
  const baseClasses =
    'min-w-[300px] flex flex-col border-gray-200 border p-4 rounded-md w-96 gap-2 shadow-sm relative h-full'
  const classNameMainContainer = [
    baseClasses,
    !isDownloaded && 'bg-gray-50',
    isDownloading && 'animate-pulse [animation-duration:2s]'
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={classNameMainContainer}>
      {logo && MODEL_LOGOS[logo] && (
        <img
          src={MODEL_LOGOS[logo]}
          alt={`${name} logo`}
          className="absolute top-2 right-2 h-8 w-8 object-contain"
        />
      )}
      <div className="p-2 text-l text-center">{name}</div>
      <div className="text-sm p-2 flex-grow">{description}</div>
      <ul className="text-sm p-2">
        <li>🧠 Model Size: {formatSizeInMiB(size_in_MiB)}</li>
        <li>
          🐍 Python Environment Size:{' '}
          {formatSizeInMiB(pythonEnvironment['platform'][platformToKey(platform)]['size_in_MiB'])}
        </li>
      </ul>
      <div className="mt-auto">
        {isDownloading ? (
          <></>
        ) : isDownloaded ? (
          <>
            <div className="flex justify-center p-2 gap-2">
              <button
                onClick={() => handleDelete(reference)}
                className={`cursor-pointer w-[55%] transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md hover:bg-gray-50`}
              >
                <CircleX color="black" size={14} />
                Delete
              </button>
              {!isDev ? (
                <></>
              ) : (
                <>
                  {isHTTPServerRunning ? (
                    <button
                      onClick={() =>
                        handleStopHTTPServer({
                          pid: pidPythonProcess,
                          port: portHTTPServer
                        })
                      }
                      className={`cursor-pointer w-[55%] transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md hover:bg-gray-50`}
                    >
                      <CircleOff color="black" size={14} />
                      Stop ML Server
                    </button>
                  ) : isHTTPServerStarting ? (
                    <button
                      onClick={() =>
                        handleRunHTTPServer({
                          modelReference: reference,
                          pythonEnvironment: pythonEnvironment
                        })
                      }
                      className={`cursor-not-allowed w-[55%] transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md opacity-70`}
                    >
                      <LucideLoader color="black" size={14} />
                      <span className="animate-pulse">Starting Server</span>
                    </button>
                  ) : (
                    <button
                      onClick={() =>
                        handleRunHTTPServer({
                          modelReference: reference,
                          pythonEnvironment: pythonEnvironment
                        })
                      }
                      className={`cursor-pointer w-[55%] transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md hover:bg-gray-50`}
                    >
                      <PlayIcon color="black" size={14} />
                      Run
                    </button>
                  )}
                </>
              )}
            </div>
          </>
        ) : (
          <div className="flex justify-center p-2 gap-2">
            <button
              onClick={() =>
                handleDownload({ modelReference: reference, pythonEnvironment: pythonEnvironment })
              }
              className={`bg-white cursor-pointer w-[60%] transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md hover:bg-gray-50`}
            >
              <Download color="black" size={14} />
              Download
            </button>
          </div>
        )}
      </div>
      {isHTTPServerRunning ? (
        <div className="p-4 text-sm">
          <ul className="list-none space-y-0">
            <li className="flex items-center gap-2">
              <Server size={14}></Server>HTTP server port: {portHTTPServer}
            </li>
            <li className="flex items-center gap-2">
              <CpuIcon size={14} />
              process Id: {pidPythonProcess}
            </li>
            <li className="flex items-center gap-2">
              <Book size={14} />
              <a
                href={`http://localhost:${portHTTPServer}/docs`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline"
              >
                API documentation
              </a>
            </li>
          </ul>
        </div>
      ) : (
        <span></span>
      )}
      {isDownloading ? (
        <>
          <div className="pl-6 pr-6 pb-4">
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-500 ease-in-out"
                style={{ width: `${downloadProgress}%` }}
              ></div>
            </div>
            <div className="w-full text-sm text-center pt-2">{downloadMessage}</div>
          </div>
        </>
      ) : (
        <></>
      )}
    </div>
  )
}

function CustomModelCard() {
  return (
    <div className="min-w-[300px] flex flex-col border-gray-200 border p-4 rounded-md w-96 gap-2 shadow-sm relative bg-gradient-to-br from-white to-blue-50 h-full">
      <img
        src={etmLogo}
        alt="EarthToolsMaker logo"
        className="absolute top-2 right-2 h-8 w-8 object-contain rounded-full"
      />
      <div className="p-2 text-l text-center">Your Custom Model</div>
      <div className="text-sm p-2 flex-grow">
        Need an AI model tailored to your specific wildlife monitoring needs? EarthToolsMaker can
        develop and integrate custom models directly into BioWatch for your unique species, regions,
        or use cases.
      </div>
      <ul className="text-sm p-2">
        <li>&nbsp;</li>
        <li>&nbsp;</li>
      </ul>
      <div className="mt-auto">
        <div className="flex justify-center p-2 gap-2">
          <a
            href="https://www.earthtoolsmaker.org/contact"
            target="_blank"
            rel="noopener noreferrer"
            className="cursor-pointer w-[60%] transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md hover:bg-gray-50"
          >
            <Mail color="black" size={14} />
            Contact Us
          </a>
        </div>
      </div>
    </div>
  )
}

export default function Zoo({ modelZoo }) {
  const [refreshKey, setRefreshKey] = useState(0)

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
    <div className="h-full">
      <div className="flex justify-end px-8 pt-4">
        <button
          onClick={() => handleClearAllMLModels()}
          className="bg-white cursor-pointer w-32 transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md hover:bg-gray-50"
        >
          <CircleX color="black" size={14} />
          Clear All
        </button>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(384px,1fr))] px-8 pb-8 pt-4 gap-3">
        {modelZoo.map((entry) => (
          <ModelCard
            key={entry.reference.id}
            model={entry}
            pythonEnvironment={findPythonEnvironment(entry.pythonEnvironment)}
            platform={window.electron.process.platform}
            isDev={window.electron.process.env.NODE_ENV == 'development'}
            refreshKey={refreshKey}
          />
        ))}
        <CustomModelCard />
      </div>
    </div>
  )
}
