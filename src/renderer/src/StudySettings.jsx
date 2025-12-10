import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import DeleteStudyModal from './DeleteStudyModal'

export default function StudySettings({ studyId, studyName }) {
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

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
