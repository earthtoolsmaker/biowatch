import { useEffect, useState } from 'react'
import TypePicker from './AddSource/TypePicker.jsx'
import FolderStep from './AddSource/FolderStep.jsx'
import StudyPicker from './AddSource/StudyPicker.jsx'
import ReviewStep from './AddSource/ReviewStep.jsx'

/**
 * Add Source wizard shell.
 *
 * Step 1 (TypePicker): user picks "folder" or "merge".
 * Step 2 (folder path):  FolderStep — today's folder import flow.
 * Step 2 (merge path):   StudyPicker — pick a local study.
 * Step 3 (merge path):   ReviewStep — review metadata + confirm merge.
 *
 * Each step renders its own full modal frame; this component is a thin
 * state machine that decides which step is mounted.
 */
export default function AddSourceModal({ isOpen, studyId, onClose, onImported }) {
  const [step, setStep] = useState('type')
  const [pickedStudy, setPickedStudy] = useState(null)

  // Reset wizard state every time the modal closes.
  useEffect(() => {
    if (!isOpen) {
      setStep('type')
      setPickedStudy(null)
    }
  }, [isOpen])

  if (!isOpen) return null

  if (step === 'type') {
    return (
      <TypePicker
        isOpen
        onPick={(type) => setStep(type === 'folder' ? 'folder' : 'study-pick')}
        onCancel={onClose}
      />
    )
  }
  if (step === 'folder') {
    return (
      <FolderStep
        isOpen
        studyId={studyId}
        onBack={() => setStep('type')}
        onClose={onClose}
        onImported={onImported}
      />
    )
  }
  if (step === 'study-pick') {
    return (
      <StudyPicker
        isOpen
        currentStudyId={studyId}
        onBack={() => setStep('type')}
        onCancel={onClose}
        onPicked={(study) => {
          setPickedStudy(study)
          setStep('review')
        }}
      />
    )
  }
  if (step === 'review' && pickedStudy) {
    return (
      <ReviewStep
        isOpen
        targetStudyId={studyId}
        sourceStudy={pickedStudy}
        onBack={() => setStep('study-pick')}
        onCancel={onClose}
        onMerged={() => {
          onImported?.()
          onClose()
        }}
      />
    )
  }
  return null
}
