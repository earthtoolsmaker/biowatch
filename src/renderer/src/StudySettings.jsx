import { useState } from 'react'
import { HelpCircle } from 'lucide-react'
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
    } catch (error) {
      console.error('Failed to delete study:', error)
    }
  }

  return (
    <div className="px-4 sm:px-6">
      <div className="max-w-2xl mx-auto divide-y divide-gray-200">
        <section className="py-6">
          <div className="flex items-center gap-1.5 mb-1">
            <h2 className="text-base font-medium text-gray-900">Sequence Grouping</h2>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button className="text-gray-400 hover:text-gray-600 transition-colors">
                  <HelpCircle size={14} />
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
          <p className="text-sm text-gray-500 mb-4">
            Group nearby photos and videos into sequences based on time gaps.
          </p>
          {isLoadingSequenceGap ? (
            <div className="flex items-center justify-center py-4">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-500 border-t-transparent" />
            </div>
          ) : (
            <SequenceGapSlider
              value={sequenceGap}
              onChange={setSequenceGap}
              variant="full"
              showDescription={true}
            />
          )}
        </section>

        <section className="py-6">
          <h2 className="text-base font-medium text-gray-900 mb-1">Export</h2>
          <p className="text-sm text-gray-500 mb-4">
            Export this study&apos;s data in standard formats.
          </p>
          <Export studyId={studyId} />
        </section>

        <section className="py-6">
          <h2 className="text-base font-medium text-red-700 mb-4">Danger Zone</h2>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-medium text-gray-900">Delete this study</h3>
              <p className="text-sm text-gray-500 mt-1">
                Once deleted, all data associated with this study will be permanently removed.
              </p>
            </div>
            <button
              onClick={() => setIsDeleteModalOpen(true)}
              className="cursor-pointer flex items-center justify-center px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-300 rounded-md hover:bg-red-50 transition-colors w-full sm:w-auto"
            >
              Delete
            </button>
          </div>
        </section>
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
