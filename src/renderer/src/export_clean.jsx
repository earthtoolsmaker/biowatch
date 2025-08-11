import { useState } from 'react'
import { Upload } from 'lucide-react'

function ExportButton({ onClick, children, className = '', disabled = false }) {
  const [isExporting, setIsExporting] = useState(false)

  const handleClick = async () => {
    setIsExporting(true)
    try {
      await onClick()
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={isExporting || disabled}
      className={`cursor-pointer transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-10 text-sm shadow-sm rounded-md hover:bg-gray-50 ${
        isExporting || disabled ? 'opacity-70' : ''
      } ${className}`}
    >
      {isExporting ? <span className="animate-pulse">Exporting...</span> : children}
    </button>
  )
}

function CamtrapDPExportCard({ studyData, onExport }) {
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({
    profile: 'https://raw.githubusercontent.com/tdwg/camtrap-dp/1.0/camtrap-dp-profile.json',
    created: new Date().toISOString(),
    contributors: [{ title: '', role: 'contact' }],
    project: {
      title: '',
      samplingDesign: 'simpleRandom',
      captureMethod: ['activityDetection'],
      individualAnimals: false,
      observationLevel: ['media']
    },
    spatial: {
      type: 'Polygon',
      coordinates: [[]]
    },
    temporal: {
      start: '',
      end: ''
    },
    taxonomic: [],
    name: '',
    id: '',
    title: '',
    description: '',
    version: '1.0.0',
    keywords: [],
    image: '',
    homepage: '',
    sources: [],
    licenses: [],
    bibliographicCitation: '',
    coordinatePrecision: 0.001,
    relatedIdentifiers: [],
    references: []
  })

  const initializeFormData = () => {
    const initialData = { ...formData }

    if (studyData) {
      if (studyData.name) initialData.name = studyData.name
      if (studyData.title) initialData.title = studyData.title
      if (studyData.description) initialData.description = studyData.description
      if (studyData.project?.title) initialData.project.title = studyData.project.title
      if (studyData.contributors) initialData.contributors = studyData.contributors
      if (studyData.temporal) initialData.temporal = studyData.temporal
      if (studyData.spatial) initialData.spatial = studyData.spatial
      if (studyData.taxonomic) initialData.taxonomic = studyData.taxonomic
    }

    setFormData(initialData)
  }

  const handleExportClick = () => {
    initializeFormData()
    setShowForm(true)
  }

  const handleFormSubmit = async (e) => {
    e.preventDefault()
    await onExport(formData)
    setShowForm(false)
  }

  const updateField = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const updateProjectField = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      project: { ...prev.project, [field]: value }
    }))
  }

  const updateTemporalField = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      temporal: { ...prev.temporal, [field]: value }
    }))
  }

  if (showForm) {
    return (
      <div className="border border-gray-200 rounded-lg p-6 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg">Camtrap DP Export Configuration</h3>
          <button onClick={() => setShowForm(false)} className="text-gray-500 hover:text-gray-700">
            Cancel
          </button>
        </div>

        <form onSubmit={handleFormSubmit} className="space-y-6">
          <div className="border-l-4 border-red-500 pl-4">
            <h4 className="font-semibold text-red-700 mb-3">Required Fields</h4>

            <div className="mb-4">
              <label className="block text-sm font-bold text-gray-700 mb-2">Contributors *</label>
              <input
                type="text"
                placeholder="Contact name/organization"
                value={formData.contributors[0]?.title || ''}
                onChange={(e) => {
                  const newContributors = [...formData.contributors]
                  newContributors[0] = { ...newContributors[0], title: e.target.value }
                  updateField('contributors', newContributors)
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                required
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-bold text-gray-700 mb-2">Project Title *</label>
              <input
                type="text"
                value={formData.project.title}
                onChange={(e) => updateProjectField('title', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                required
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Sampling Design *
              </label>
              <select
                value={formData.project.samplingDesign}
                onChange={(e) => updateProjectField('samplingDesign', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                required
              >
                <option value="simpleRandom">Simple Random</option>
                <option value="systematicRandom">Systematic Random</option>
                <option value="clusteredRandom">Clustered Random</option>
                <option value="experimental">Experimental</option>
                <option value="targeted">Targeted</option>
                <option value="opportunistic">Opportunistic</option>
              </select>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-bold text-gray-700 mb-2">
                Temporal Coverage *
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={formData.temporal.start}
                    onChange={(e) => updateTemporalField('start', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">End Date</label>
                  <input
                    type="date"
                    value={formData.temporal.end}
                    onChange={(e) => updateTemporalField('end', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    required
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="border-l-4 border-blue-500 pl-4">
            <h4 className="font-semibold text-blue-700 mb-3">Optional Fields</h4>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Package Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => updateField('name', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="e.g., my-camera-trap-study"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Package Title</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => updateField('title', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="Human-readable title for the data package"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => updateField('description', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                rows="3"
                placeholder="Description of the data package"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Version</label>
              <input
                type="text"
                value={formData.version}
                onChange={(e) => updateField('version', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="1.0.0"
              />
            </div>
          </div>

          <div className="flex gap-2 pt-4 border-t">
            <ExportButton
              onClick={() => {}}
              className="bg-blue-600 text-white hover:bg-blue-700 flex-1"
            >
              Export Camtrap DP
            </ExportButton>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div className="border border-gray-200 rounded-lg p-6 shadow-sm hover:shadow-md transition-shadow">
      <h3 className="text-lg mb-2">Camtrap DP Export</h3>
      <p className="text-sm text-gray-500 mb-4">
        Export your study data as a Camera Trap Data Package with standardized metadata and
        observations compatible with the Camtrap DP specification.
      </p>
      <div className="flex justify-start">
        <ExportButton
          onClick={handleExportClick}
          className="bg-green-600 text-white hover:bg-green-700"
        >
          <Upload size={16} />
          Export Camtrap DP
        </ExportButton>
      </div>
    </div>
  )
}

export default function Export({ studyId, studyData }) {
  const handleCamtrapDPExport = async (exportData) => {
    try {
      await window.api.exportCamtrapDP(studyId, exportData)
      console.log('Export completed successfully')
    } catch (error) {
      console.error('Export failed:', error)
    }
  }

  return (
    <div className="flex items-center justify-start h-full p-8">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Export Study Data</h2>
          <p className="text-gray-500">
            Export your study data in various standardized formats for sharing and archiving.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <CamtrapDPExportCard studyData={studyData} onExport={handleCamtrapDPExport} />
        </div>
      </div>
    </div>
  )
}
