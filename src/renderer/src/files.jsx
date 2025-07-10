import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { FolderIcon } from 'lucide-react'

export default function Files({ studyId }) {
  const { id } = useParams()
  const actualStudyId = studyId || id
  const [filesData, setFilesData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function fetchFilesData() {
      try {
        setLoading(true)
        const response = await window.api.getFilesData(actualStudyId)

        if (response.error) {
          setError(response.error)
        } else {
          setFilesData(response.data)
        }
      } catch (err) {
        setError(err.message || 'Failed to fetch files data')
      } finally {
        setLoading(false)
      }
    }

    if (actualStudyId) {
      fetchFilesData()
    }
  }, [actualStudyId])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Loading files data...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-500">Error: {error}</div>
      </div>
    )
  }

  if (!filesData || filesData.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">No files data available</div>
      </div>
    )
  }

  const formatPercentage = (processed, total) => {
    if (total === 0) return '0%'
    return `${Math.round((processed / total) * 100)}%`
  }

  return (
    <div className="px-8 py-6 h-full overflow-y-auto">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <div className="flex items-center justify-end">
            <div className="text-sm text-gray-500">
              {filesData.length} {filesData.length === 1 ? 'directory' : 'directories'}
            </div>
          </div>
        </div>

        <div className="divide-y divide-gray-200">
          {filesData.map((directory, index) => (
            <div key={index} className="px-6 py-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start space-x-3">
                  <FolderIcon className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {directory.locationID}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-6 ml-4">
                  <div className="text-right">
                    <div className="text-sm font-medium text-gray-900">
                      {directory.imageCount} images
                    </div>
                    <div className="text-sm text-gray-500">
                      {directory.processedCount} processed
                    </div>
                  </div>

                  <div className="text-right min-w-[60px]">
                    <div className="text-sm font-medium text-gray-900">
                      {formatPercentage(directory.processedCount, directory.imageCount)}
                    </div>
                    <div className="w-16 bg-gray-200 rounded-full h-2 mt-1">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(
                            (directory.processedCount / directory.imageCount) * 100,
                            100
                          )}%`
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
