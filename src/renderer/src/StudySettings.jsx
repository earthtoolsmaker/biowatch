import { useState } from 'react'
import { Trash2, HelpCircle } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'
import DeleteStudyModal from './DeleteStudyModal'
import Export from './export'
import { useSequenceGap } from './hooks/useSequenceGap'
import { SequenceGapSlider } from './ui/SequenceGapSlider'

export default function StudySettings({ studyId, studyName }) {
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const { sequenceGap, setSequenceGap, isLoading: isLoadingSequenceGap } = useSequenceGap(studyId)

  const handleDeleteStudy = async () => {
    try {
      await window.api.deleteStudyDatabase(studyId)
      // The existing listener in base.jsx will handle navigation and query invalidation
      // after receiving the 'study:delete' event
    } catch (error) {
      console.error('Failed to delete study:', error)
    }
  }

  return (
    <div className="px-4">
      {/* Sequence Grouping Section */}
      <div className="border border-blue-200 rounded-lg mb-6">
        <div className="px-4 py-3 bg-blue-50 border-b border-blue-200 rounded-t-lg">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-medium text-blue-800">Sequence Grouping</h2>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button className="text-blue-400 hover:text-blue-600 transition-colors">
                  <HelpCircle size={16} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  side="right"
                  sideOffset={8}
                  className="z-[10000] max-w-xs px-3 py-2 bg-gray-900 text-white text-xs rounded-md shadow-lg"
                >
                  <p className="text-gray-300 mb-1.5">
                    Groups nearby photos/videos into sequences based on time gaps for easier
                    browsing and analysis.
                  </p>
                  <ul className="text-gray-300 space-y-0.5">
                    <li>
                      <span className="text-white font-medium">Off:</span> Preserves original event
                      groupings from import
                    </li>
                    <li>
                      <span className="text-white font-medium">On:</span> Groups media taken within
                      the specified time gap
                    </li>
                  </ul>
                  <Tooltip.Arrow className="fill-gray-900" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </div>
        </div>
        <div className="p-4">
          {isLoadingSequenceGap ? (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-500 border-t-transparent" />
            </div>
          ) : (
            <>
              <SequenceGapSlider
                value={sequenceGap}
                onChange={setSequenceGap}
                variant="full"
                showDescription={true}
              />
              <p className="text-xs text-gray-500 mt-3">
                Changes are saved automatically and apply across all views.
              </p>
            </>
          )}
        </div>
      </div>

      {/* Export Section */}
      <div className="border border-blue-200 rounded-lg mb-6">
        <div className="px-4 py-3 bg-blue-50 border-b border-blue-200 rounded-t-lg">
          <h2 className="text-lg font-medium text-blue-800">Export</h2>
        </div>
        <div className="p-4">
          <Export studyId={studyId} />
        </div>
      </div>

      <div className="border border-red-200 rounded-lg">
        <div className="px-4 py-3 bg-red-50 border-b border-red-200 rounded-t-lg">
          <h2 className="text-lg font-medium text-red-800">Danger Zone</h2>
        </div>

        <div className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900">Delete this study</h3>
              <p className="text-sm text-gray-500 mt-1">
                Once deleted, all data associated with this study will be permanently removed.
              </p>
            </div>
            <button
              onClick={() => setIsDeleteModalOpen(true)}
              className="cursor-pointer flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-300 rounded-md hover:bg-red-50 transition-colors"
            >
              <Trash2 size={16} />
              Delete Study
            </button>
          </div>
        </div>
      </div>

      <DeleteStudyModal
        isOpen={isDeleteModalOpen}
        onConfirm={handleDeleteStudy}
        onCancel={() => setIsDeleteModalOpen(false)}
        studyName={studyName}
      />
    </div>
  )
}
