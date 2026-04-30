function AdultIcon({ size = 14, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="10" fill="currentColor" />
    </svg>
  )
}

function SubadultIcon({ size = 14, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="7" fill="currentColor" />
    </svg>
  )
}

function JuvenileIcon({ size = 14, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="4" fill="currentColor" />
    </svg>
  )
}

const OPTIONS = [
  { value: 'adult', label: 'Adult', Icon: AdultIcon },
  { value: 'subadult', label: 'Subadult', Icon: SubadultIcon },
  { value: 'juvenile', label: 'Juvenile', Icon: JuvenileIcon }
]

/**
 * 3-pill row for life stage. Click a pill to select; click the selected pill to clear.
 * Monochrome.
 */
export default function LifeStageSelector({ value, onChange }) {
  const handleClick = (optionValue) => {
    onChange(value === optionValue ? null : optionValue)
  }

  return (
    <div className="flex gap-1.5">
      {OPTIONS.map((option) => {
        const isSelected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => handleClick(option.value)}
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              isSelected
                ? 'bg-[#030213] text-white border-[#030213]'
                : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
            }`}
            title={option.label}
          >
            <option.Icon size={14} />
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
