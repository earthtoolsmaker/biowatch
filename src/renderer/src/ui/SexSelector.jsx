function FemaleIcon({ size = 14, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
      <line x1="12" y1="15" x2="12" y2="22" stroke="currentColor" strokeWidth="2" />
      <line x1="9" y1="19" x2="15" y2="19" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

function MaleIcon({ size = 14, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <circle cx="10" cy="14" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
      <line x1="14.5" y1="9.5" x2="20" y2="4" stroke="currentColor" strokeWidth="2" />
      <polyline points="20,4 14,4 20,4 20,10" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

function UnknownIcon({ size = 14, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className}>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <text x="12" y="17" textAnchor="middle" fontSize="14" fill="currentColor">
        ?
      </text>
    </svg>
  )
}

const OPTIONS = [
  { value: 'female', label: 'Female', Icon: FemaleIcon },
  { value: 'male', label: 'Male', Icon: MaleIcon },
  { value: 'unknown', label: 'Unknown', Icon: UnknownIcon }
]

/**
 * 3-pill row for sex. Click a pill to select; click the selected pill to clear (sets to null).
 * Monochrome: unselected pills use white/border-gray; selected uses near-black fill.
 */
export default function SexSelector({ value, onChange }) {
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
