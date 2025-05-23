import { Download } from 'lucide-react'

// TODO: store them somewhere else?
const MODELS = [
  {
    name: 'SpeciesNet',
    description:
      "Google's SpeciesNet is an open-source AI model launched in 2025, specifically designed for identifying animal species from images captured by camera traps. It boasts the capability to classify images into over 2,000 species labels, greatly enhancing the efficiency of wildlife data analysis for conservation initiatives.",
    // download:
    //   'https://huggingface.co/earthtoolsmaker/speciesnet/resolve/main/4.0.1a.tar.gz?download=true'
    website: 'https://github.com/google/cameratrapai',
    download:
      'https://huggingface.co/earthtoolsmaker/speciesnet/resolve/main/README.md?download=true'
  }
]

export default function AIModels() {
  return (
    <div>
      <div className="flex h-full p-2">
        {MODELS.map((entry) => (
          <div className="flex flex-col justify-around border-gray-200 border p-4 rounded-md w-96 gap-2 shadow-sm">
            <div className="p-2 text-l text-center">{entry.name}</div>
            <div className="text-sm p-2">{entry.description}</div>
            <div className="text-sm p-2">
              <a href="{entry.website}">
                {/* <Globe size={14}></Globe> */}
                {entry.website}
              </a>
            </div>
            <div className="p-2">
              <button
                className={` bg-white cursor-pointer w-[80%] transition-colors flex justify-center flex-row gap-2 items-center border border-gray-200 px-2 h-8 text-sm shadow-sm rounded-md hover:bg-gray-50`}
              >
                <Download color="black" size={14} />
                Download {entry.name}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
