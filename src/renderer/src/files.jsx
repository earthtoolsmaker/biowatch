import { useParams } from 'react-router'
import { FolderIcon } from 'lucide-react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { useImportStatus } from '@renderer/hooks/import'

export default function Files({ studyId }) {
  const { id } = useParams()
  const actualStudyId = studyId || id
  const queryClient = useQueryClient()
  const { importStatus } = useImportStatus(actualStudyId)

  const {
    data: filesData,
    isLoading: loading,
    error
  } = useQuery({
    queryKey: ['filesData', actualStudyId, importStatus?.isRunning],
    queryFn: async () => {
      const response = await window.api.getFilesData(actualStudyId)
      if (response.error) {
        throw new Error(response.error)
      }
      return response.data
    },
    refetchInterval: () => {
      // Only poll if import is running
      return importStatus?.isRunning ? 3000 : false
    },
    enabled: !!actualStudyId
  })

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
        <div className="text-red-500">Error: {error.message}</div>
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

  const importFolders = Object.groupBy(filesData, (c) => c.importFolder)

  console.log('Files data:', filesData, importFolders)

  return (
    <div className="px-8 py-3 h-full overflow-y-auto space-y-6">
      <header>
        <button
          onClick={async () => {
            await window.api.selectMoreImagesDirectory(id)
            queryClient.invalidateQueries({ queryKey: ['importStatus', id] })
            queryClient.invalidateQueries({ queryKey: ['filesData', actualStudyId] })
          }}
          className={`cursor-pointer transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-10 text-sm shadow-sm rounded-md hover:bg-gray-50`}
        >
          Add Folder
        </button>
      </header>
      <div className="space-y-6">
        {Object.entries(importFolders).map(([importFolder, directories]) => (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200" key={importFolder}>
            <div className="px-6 py-4 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <div>{importFolder}</div>
                <div className="text-sm text-gray-500">
                  {directories.length} {directories.length === 1 ? 'directory' : 'directories'}
                </div>
              </div>
            </div>

            <div className="divide-y divide-gray-200">
              {directories.map((directory, index) => (
                <div key={index} className="px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-start space-x-3">
                      <FolderIcon className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {directory.folderName}
                        </div>
                        {directory.lastModelUsed && (
                          <div className="text-xs text-gray-500 truncate">
                            Model: {directory.lastModelUsed}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center space-x-6 ml-4">
                      <div className="text-right">
                        <div className="text-sm font-medium text-gray-900">
                          {directory.imageCount === 0 && directory.videoCount === 0
                            ? '0 media files'
                            : directory.imageCount === 0
                              ? `${directory.videoCount} videos`
                              : directory.videoCount > 0
                                ? `${directory.imageCount} images, ${directory.videoCount} videos`
                                : `${directory.imageCount} images`}
                        </div>
                        <div className="text-sm text-gray-500">
                          {directory.processedCount} processed
                        </div>
                      </div>

                      <div className="text-right min-w-[60px]">
                        <div className="text-sm font-medium text-gray-900">
                          {formatPercentage(
                            directory.processedCount,
                            directory.imageCount + (directory.videoCount || 0)
                          )}
                        </div>
                        <div className="w-16 bg-gray-200 rounded-full h-2 mt-1">
                          <div
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                            style={{
                              width: `${Math.min(
                                (directory.processedCount /
                                  (directory.imageCount + (directory.videoCount || 0))) *
                                  100,
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
        ))}
      </div>
    </div>
  )
}
