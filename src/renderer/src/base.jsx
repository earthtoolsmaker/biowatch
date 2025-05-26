import { Plus, Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ErrorBoundary } from 'react-error-boundary'
import { HashRouter, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router'
import Import from './import'
import Study from './study'
import Zoo from './model_zoo'

function ErrorFallback({ error, resetErrorBoundary }) {
  console.log('ErrorFallback', error.stack)
  const navigate = useNavigate()

  const copyErrorToClipboard = () => {
    const errorDetails = `
      Error: ${error.message}
      Stack: ${error.stack}
      Time: ${new Date().toISOString()}
    `.trim()

    navigator.clipboard
      .writeText(errorDetails)

      .catch((err) => {
        console.error('Failed to copy error details:', err)
      })
  }

  return (
    <div className="p-4 bg-red-50 text-red-700 rounded-md m-4">
      <h3 className="font-semibold mb-2">Something went wrong</h3>
      <p className="text-sm mb-2">There was an error loading this content.</p>
      <details className="text-xs bg-white p-2 rounded border border-red-200">
        <summary>Error details</summary>
        <pre className="mt-2 whitespace-pre-wrap">{error.message}</pre>
      </details>
      <div className="flex gap-2 mt-3">
        <button
          onClick={() => {
            navigate('/import')
            // window.location.reload()
          }}
          className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded text-sm"
        >
          Back
        </button>

        <button
          onClick={resetErrorBoundary}
          className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded text-sm"
        >
          Try again
        </button>
        <button
          onClick={copyErrorToClipboard}
          className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded text-sm"
        >
          Copy error
        </button>

        <button
          onClick={() => {
            localStorage.clear()
            resetErrorBoundary()
            navigate('/import')
          }}
          className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-800 rounded text-sm"
        >
          Clear all Data
        </button>
      </div>
    </div>
  )
}

function AppContent() {
  const [studies, setStudies] = useState(JSON.parse(localStorage.getItem('studies')) || [])
  const navigate = useNavigate()
  const location = useLocation()
  const [isDragging, setIsDragging] = useState(false)
  const [isImporting, setIsImporting] = useState(false)

  useEffect(() => {
    const lastUrl = localStorage.getItem('lastUrl')

    if (studies.length === 0) {
      navigate('/import')
    } else if (lastUrl && lastUrl !== '/import') {
      navigate(lastUrl)
    } else {
      navigate(`/study/${studies[0].id}`)
    }
  }, [])

  // Store current URL in localStorage whenever it changes
  useEffect(() => {
    if (location.pathname === '/') {
      return
    }
    localStorage.setItem('lastUrl', location.pathname)
  }, [location])

  // Setup drag and drop event handlers
  useEffect(() => {
    const handleDragOver = (e) => {
      e.preventDefault()
      setIsDragging(true)
    }

    const handleDragLeave = (e) => {
      e.preventDefault()
      setIsDragging(false)
    }

    const handleDrop = async (e) => {
      e.preventDefault()
      setIsDragging(false)

      const files = e.dataTransfer.files
      if (!files || files.length === 0) return
      setIsImporting(true)

      try {
        const { id, data, path } = await window.api.importDroppedDataset(files[0])
        onNewStudy({ id, name: data.name, data, path })
        navigate(`/study/${id}`)
      } finally {
        setIsImporting(false)
      }
    }

    window.addEventListener('dragover', handleDragOver)
    window.addEventListener('dragleave', handleDragLeave)
    window.addEventListener('drop', handleDrop)

    return () => {
      window.removeEventListener('dragover', handleDragOver)
      window.removeEventListener('dragleave', handleDragLeave)
      window.removeEventListener('drop', handleDrop)
    }
  }, [studies])

  // Add listener for the delete study action
  useEffect(() => {
    const handleDeleteStudy = async (event, studyId) => {
      try {
        console.log('Deleting study with ID:', studyId)
        const updatedStudies = studies.filter((s) => s.id !== studyId)

        // Navigate away if we're on the deleted study
        if (location.pathname.includes(`/study/${studyId}`)) {
          if (updatedStudies.length > 0) {
            navigate(`/study/${updatedStudies[0].id}`)
          } else {
            navigate('/import')
          }
        }
        setStudies(updatedStudies)
        localStorage.setItem('studies', JSON.stringify(updatedStudies))
      } catch (error) {
        console.error('Failed to delete study:', error)
        alert('Failed to delete study: ' + error.message)
      }
    }

    // Register the IPC event listener
    window.electron.ipcRenderer.on('delete-study', handleDeleteStudy)

    return () => {
      // Clean up listener when component unmounts
      window.electron.ipcRenderer.removeListener('delete-study', handleDeleteStudy)
    }
  }, [studies, location, navigate])

  const onNewStudy = (study) => {
    const isValid = study && study.id && study.name && study.data && study.path
    if (!isValid) {
      console.warn('Invalid study data', study)
    }
    const newStudies = [...studies, study]
    setStudies(newStudies)
    localStorage.setItem('studies', JSON.stringify(newStudies))
  }

  const handleStudyContextMenu = (e, study) => {
    e.preventDefault()
    window.api.showStudyContextMenu(study.id)
  }

  // Add visual indicators for drag and import states
  const dragOverlay = isDragging ? (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999
      }}
    >
      <div
        style={{
          padding: '2rem',
          backgroundColor: 'white',
          borderRadius: '0.5rem',
          textAlign: 'center'
        }}
      >
        <h2>Drop Camera Trap Directory or ZIP File to Import</h2>
      </div>
    </div>
  ) : null

  const importingOverlay = isImporting ? (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999
      }}
    >
      <div
        style={{
          padding: '2rem',
          backgroundColor: 'white',
          borderRadius: '0.5rem',
          textAlign: 'center'
        }}
      >
        <h2>Importing Camera Trap Data...</h2>
        <p>This may take a few moments</p>
      </div>
    </div>
  ) : null

  return (
    <div className={`relative flex h-svh flex-row`}>
      <div className="w-52 h-full p-2 fixed">
        {/* <header className="p-2">
          <div className="text-base font-semibold p-2 flex items-center">
            <span className="pt-[3px]">Biowatch</span>
            <Camera color="black" size={24} className="rotate-[80deg]" />
          </div>
        </header> */}
        <ul className="flex w-full min-w-0 flex-col gap-4 p-2">
          <li>
            <NavLink
              to="/import"
              className="flex w-full items-center h-8 gap-2 text-sm font-medium hover:bg-gray-100 rounded-md p-2"
            >
              <span>Studies</span>
            </NavLink>
            <ul className="border-l mx-3.5 border-gray-200 flex w-full flex-col gap-2 px-1.5 py-0.5 text-[hsl(var(--sidebar-foreground))]">
              {studies.map((study) => (
                <li key={study.id}>
                  <NavLink
                    to={`/study/${study.id}`}
                    className={({ isActive }) =>
                      `break-anywhere flex w-full items-center text-sm hover:bg-gray-100 rounded-md px-2 ${isActive ? 'font-semibold' : ''}`
                    }
                    onContextMenu={(e) => handleStudyContextMenu(e, study)}
                  >
                    {study.name}
                  </NavLink>
                </li>
              ))}
            </ul>
          </li>
        </ul>
        <footer className="absolute left-0 bottom-8 w-full flex justify-center p-2 gap-1">
          {!(location.pathname === '/import' && studies.length === 0) && (
            <NavLink
              to="/import"
              className={` bg-white cursor-pointer w-[72%] transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md hover:bg-gray-50`}
            >
              <Plus color="black" size={14} />
              Add study
            </NavLink>
          )}
          <NavLink
            to="/settings/model_zoo"
            className={` bg-white cursor-pointer w-[20%] transition-colors flex justify-center flex-row items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md hover:bg-gray-50`}
          >
            <Settings className="text-gray-500" size={18} />
          </NavLink>
        </footer>
      </div>
      <main className="ml-52 relative flex w-[calc(100%-14rem)] flex-1 bg-transparent pt-3 pr-3">
        <div className="flex-col bg-white rounded-t-xl shadow w-full">
          <Routes>
            <Route path="/import" element={<Import onNewStudy={onNewStudy} />} />
            <Route path="/study/:id/*" element={<Study />} />
            <Route path="/settings/model_zoo/*" element={<Zoo />} />
          </Routes>
        </div>
      </main>

      {/* Drag overlay */}
      {dragOverlay}

      {/* Import loading overlay */}
      {importingOverlay}
    </div>
  )
}

export default function App() {
  return (
    <HashRouter>
      <ErrorBoundary FallbackComponent={ErrorFallback}>
        <AppContent />
      </ErrorBoundary>
    </HashRouter>
  )
}
