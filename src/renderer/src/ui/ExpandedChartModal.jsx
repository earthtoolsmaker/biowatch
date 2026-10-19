import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

import { SpeciesName } from './timeseries'

// A small uppercase caption in front of a group of header controls.
export function ControlGroup({ label, children }) {
  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  )
}

// Outlined single-choice switch, styled like the boxed metric switch.
// `options` are { value, label, Icon }.
export function ChoiceToggle({ label, options, value, onChange }) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex shrink-0 rounded-md border border-border bg-card p-0.5"
    >
      {options.map(({ value: option, label: optionLabel, Icon }) => {
        const selected = value === option
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option)}
            className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium whitespace-nowrap transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
              selected
                ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            }`}
          >
            <Icon size={11} />
            {optionLabel}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Frame shared by the Explore chart windows: a large dialog with a header
 * (title, `controls`, then `headerRight` and close on the right), a species
 * legend row, and the chart body (`children`, or "Loading…" while
 * `isLoading`). Closes on ✕, Esc and a click outside.
 */
export default function ExpandedChartModal({
  isOpen,
  onClose,
  title,
  subtitle,
  ariaLabel,
  controls,
  headerRight,
  selectedSpecies,
  palette,
  scientificToCommon,
  isLoading,
  children
}) {
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e) => {
      // Radix closes its own popover (e.g. the date pill's calendar) on this
      // same Esc; let that press only dismiss the popover, not the window.
      if (e.key !== 'Escape') return
      if (document.querySelector('[data-radix-popper-content-wrapper]')) return
      onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[5000] bg-black/50 flex items-center justify-center p-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        className="bg-card rounded-lg shadow-xl w-full h-[min(80vh,50vw)] min-h-[360px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-3 flex items-center gap-4 border-b border-border">
          <div className="flex items-baseline gap-2 shrink-0">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
          </div>
          {controls}
          <div className="ml-auto shrink-0 flex items-center">{headerRight}</div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="px-5 pt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {selectedSpecies.map((species, index) => (
            <span key={species.scientificName} className="inline-flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: palette[index % palette.length] }}
              />
              <SpeciesName
                scientificName={species.scientificName}
                scientificToCommon={scientificToCommon}
              />
            </span>
          ))}
        </div>
        <div className="flex-1 min-h-0 px-5 py-4">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
              Loading…
            </div>
          ) : (
            children
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
