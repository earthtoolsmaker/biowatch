import { useState, useEffect } from 'react'
import {
  Download,
  LucideLoader,
  CircleX,
  CircleOff,
  PlayIcon,
  CpuIcon,
  Book,
  Server
} from 'lucide-react'
import { platformToKey, findPythonEnvironment } from '../../shared/mlmodels'

function modelDownloadStatusToInfo({ model, pythonEnvironment }) {
  const isPythonEnvironmentDownloading =
    model['state'] === 'success' && pythonEnvironment['state'] !== 'success'
  const progress = isPythonEnvironmentDownloading
    ? pythonEnvironment['progress']
    : model['progress']

  const getDownloadProgressMessage = (model, pythonEnvironment) => {
    const { state } = isPythonEnvironmentDownloading ? pythonEnvironment : model
    const suffix = isPythonEnvironmentDownloading ? 'the Python Environment' : 'the AI Model'
    switch (state) {
      case 'success':
        return `Successfuly installed ${suffix}`
      case 'failure':
        return `Failed installing ${suffix}`
      case 'download':
        return `Downloading ${suffix}`
      case 'extract':
        return `Extracting ${suffix}`
      default:
        return `Downloading ${suffix}`
    }
  }

  const message = getDownloadProgressMessage(model, pythonEnvironment)
  return { downloadMessage: message, downloadProgress: progress }
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

function ModelCard({ model, pythonEnvironment, platform, isDev = false }) {
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
        if (
          downloadStatus['model']['state'] === 'success' &&
          downloadStatus['pythonEnvironment']['state'] === 'success'
        ) {
          setIsDownloaded(true)
          setIsDownloading(false)
        }
      }, 500)
    }
    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [isDownloading])

  useEffect(() => {
    const getMLModelDownloadStatus = async () => {
      const downloadStatus = await window.api.getMLModelDownloadStatus({
        modelReference: model.reference,
        pythonEnvironmentReference: pythonEnvironment.reference
      })
      console.log(downloadStatus)
      if (
        downloadStatus['model']['state'] === 'success' &&
        downloadStatus['pythonEnvironment']['state'] === 'success'
      ) {
        setIsDownloaded(true)
        setIsDownloading(false)
      } else if (
        (downloadStatus['model']['state'] !== 'success' &&
          Object.keys(downloadStatus['model']).length !== 0) ||
        (downloadStatus['pythonEnvironment']['state'] !== 'success' &&
          Object.keys(downloadStatus['pythonEnvironment']).length !== 0)
      ) {
        setIsDownloading(true)
        setIsDownloaded(false)
      } else if (
        Object.keys(downloadStatus['pythonEnvironment']).length === 0 ||
        Object.keys(downloadStatus['model']).length === 0
      ) {
        setIsDownloaded(false)
      } else {
        console.warn('The download or electron app probably crashed...')
        setIsDownloading(false)
        setIsDownloaded(true)
      }
      setModelDownloadStatus(downloadStatus)
    }

    getMLModelDownloadStatus()
  }, [model.reference, pythonEnvironment.reference]) // Run this effect when the model reference changes

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
      await window.api.downloadPythonEnvironment({ ...pythonEnvironment.reference })
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

  const { name, description, reference, size_in_MiB } = model
  const { downloadMessage, downloadProgress } = modelDownloadStatusToInfo(modelDownloadStatus)
  const classNameMainContainer = isDownloaded
    ? 'min-w-[300px] flex flex-col justify-around border-gray-200 border p-4 rounded-md w-96 gap-2 shadow-sm'
    : 'min-w-[300px] flex bg-gray-50 flex-col justify-around border-gray-200 border p-4 rounded-md w-96 gap-2 shadow-sm'
  return (
    <div className={classNameMainContainer}>
      <div className="p-2 text-l text-center">{name}</div>
      <div className="text-sm p-2">{description}</div>
      <ul className="text-sm p-2">
        <li>🧠 Model Size: {formatSizeInMiB(size_in_MiB)}</li>
        <li>
          🐍 Python Environment Size:{' '}
          {formatSizeInMiB(pythonEnvironment['platform'][platformToKey(platform)]['size_in_MiB'])}
        </li>
      </ul>
      <div>
        {isDownloading ? (
          <></>
        ) : isDownloaded ? (
          <>
            <div className="flex justify-center p-2 gap-2">
              <button
                onClick={() => handleDelete(reference)}
                className={` bg-red-300 cursor-pointer w-[55%] transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md hover:bg-red-400`}
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
                      className={` bg-blue-300 cursor-pointer w-[55%] transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md hover:bg-blue-400`}
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
                      className={` bg-blue-300 cursor-not-allowed w-[55%] transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md opacity-70`}
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
                      className={` bg-blue-300 cursor-pointer w-[55%] transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md hover:bg-blue-400`}
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
              className={` bg-blue-100 cursor-pointer w-[60%] transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md hover:bg-blue-200`}
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

export default function Zoo({ modelZoo }) {
  const handleClearAllMLModels = async () => {
    console.log('handling clear all...')
    try {
      await window.api.clearAllLocalMLModels()
    } catch (error) {
      console.error('Failed to clear all the local models:', error)
    }
  }
  return (
    <div className="h-full">
      <div className="relative">
        <button
          onClick={() => handleClearAllMLModels()}
          className={` absolute top-1 right-8 bg-white cursor-pointer w-32 transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md hover:bg-gray-50`}
        >
          <CircleX color="black" size={14} />
          Clear All
        </button>
      </div>
      <div className="flex flex-wrap p-8 pt-6 gap-4 justify-start">
        {modelZoo.map((entry) => (
          <ModelCard
            key={entry.reference.id}
            model={entry}
            pythonEnvironment={findPythonEnvironment(entry.pythonEnvironment)}
            platform={window.electron.process.platform}
            isDev={window.electron.process.env.NODE_ENV == 'development'}
          />
        ))}
      </div>
    </div>
  )
}
