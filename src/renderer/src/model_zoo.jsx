import { useNavigate } from 'react-router'
import { useState } from 'react'
import { Download, CircleX } from 'lucide-react'

// TODO: store them somewhere else?
const ZOO = [
  {
    name: 'SpeciesNet',
    reference: {
      id: 'speciesnet',
      // version: '4.0.1a',
      version: '4.0.1z',
      downloadURL:
        'https://huggingface.co/earthtoolsmaker/speciesnet/resolve/main/4.0.1z.tar.gz?download=true'
      // downloadURL:
      //   'https://huggingface.co/earthtoolsmaker/speciesnet/resolve/main/README.md?download=true'
    },
    description:
      "Google's SpeciesNet is an open-source AI model launched in 2025, specifically designed for identifying animal species from images captured by camera traps. It boasts the capability to classify images into over 2,000 species labels, greatly enhancing the efficiency of wildlife data analysis for conservation initiatives.",
    website: 'https://github.com/google/cameratrapai'
  }
]

function ModelCard({ name, description, website, reference }) {
  const handleDelete = async (reference) => {
    console.log('handling delete...')
    try {
      const { data, id, path } = await window.api.deleteLocalMLModel(reference)
    } catch (error) {
      console.error('Failed to delete the local model:', error)
    }
  }
  const handleDownload = async (reference) => {
    console.log('handling download...')
    try {
      const { data, id, path } = await window.api.downloadMLModel(reference)
    } catch (error) {
      console.error('Failed to download model:', error)
    }
  }

  return (
    <div className="flex flex-col justify-around border-gray-200 border p-4 rounded-md w-96 gap-2 shadow-sm">
      <div className="p-2 text-l text-center">{name}</div>
      <div className="text-sm p-2">{description}</div>
      <div className="text-sm p-2">
        <a href="{website}">
          {/* <Globe size={14}></Globe> */}
          {website}
        </a>
      </div>
      <div className="flex p-2">
        <button
          onClick={() => handleDownload(reference)}
          className={` bg-white cursor-pointer w-[80%] transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md hover:bg-gray-50`}
        >
          <Download color="black" size={14} />
          Download {name}
        </button>
        <button
          onClick={() => handleDelete(reference)}
          className={` bg-white cursor-pointer w-[80%] transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md hover:bg-gray-50`}
        >
          <CircleX color="black" size={14} />
          Delete {name}
        </button>
      </div>
    </div>
  )
}

export default function Zoo() {
  const handleClearAllMLModels = async () => {
    console.log('handling clear all...')
    try {
      const { data, id, path } = await window.api.clearAllLocalMLModels()
    } catch (error) {
      console.error('Failed to clear all the local models:', error)
    }
  }
  return (
    <div>
      <button
        onClick={() => handleClearAllMLModels()}
        className={` bg-white cursor-pointer w-[80%] transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md hover:bg-gray-50`}
      >
        <CircleX color="black" size={14} />
        Clear All
      </button>
      <div className="flex h-full p-2">
        {ZOO.map((entry) => (
          <ModelCard key={entry.reference.id} {...entry} />
        ))}
      </div>
    </div>
  )
}
