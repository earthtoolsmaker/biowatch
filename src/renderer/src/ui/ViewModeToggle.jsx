import { useLayoutEffect, useRef, useState } from 'react'
import { Map as MapIcon, Images, Columns2 } from 'lucide-react'
import * as Tooltip from '@radix-ui/react-tooltip'

const MODE_META = {
  map: {
    label: 'Map',
    icon: MapIcon,
    description: 'Species distribution across camera-trap locations.'
  },
  gallery: {
    label: 'Gallery',
    icon: Images,
    description: 'Browse the captured media as a sequence grid.'
  },
  both: {
    label: 'Both',
    icon: Columns2,
    description: 'Show the map and gallery side by side.'
  }
}

/**
 * Segmented control for the Explore tab's main view. `modes` is the list of
 * modes available at the current breakpoint (from getAvailableViewModes), so
 * 'both' is omitted on narrow windows. Each segment carries a title+description
 * tooltip in the same style as the Deployments tab.
 *
 * A single elevated pill is absolutely positioned behind the buttons and
 * slides (transitioning left/width) to the active segment, instead of each
 * button toggling its own background. Positions are measured from the button
 * elements and re-measured on resize / when the available modes change.
 */
export default function ViewModeToggle({ value, modes, onChange }) {
  const containerRef = useRef(null)
  const btnRefs = useRef({})
  const [pill, setPill] = useState(null)

  useLayoutEffect(() => {
    const container = containerRef.current
    const measure = () => {
      const btn = btnRefs.current[value]
      if (!container || !btn) return
      setPill({ left: btn.offsetLeft, width: btn.offsetWidth })
    }
    measure()
    if (!container) return
    const observer = new ResizeObserver(measure)
    observer.observe(container)
    return () => observer.disconnect()
  }, [value, modes])

  return (
    <div ref={containerRef} className="relative inline-flex items-center gap-1">
      {pill && (
        <span
          aria-hidden="true"
          className="absolute top-0 h-7 rounded-md bg-card border border-border shadow-sm transition-[left,width] duration-200 ease-out"
          style={{ left: pill.left, width: pill.width }}
        />
      )}
      {modes.map((mode) => {
        const { label, icon: Icon, description } = MODE_META[mode]
        const active = value === mode
        return (
          <Tooltip.Root key={mode}>
            <Tooltip.Trigger asChild>
              <button
                ref={(el) => {
                  btnRefs.current[mode] = el
                }}
                type="button"
                onClick={() => onChange(mode)}
                aria-pressed={active}
                className={`relative z-10 flex items-center gap-1.5 px-2.5 h-7 rounded-md text-sm transition-colors ${
                  active
                    ? 'text-blue-700 dark:text-blue-300'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon size={16} />
                {label}
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content
                side="bottom"
                sideOffset={8}
                className="z-[10000] max-w-[16rem] px-3 py-2 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
              >
                <div className="font-medium mb-1">{label}</div>
                <p className="text-muted-foreground leading-snug">{description}</p>
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        )
      })}
    </div>
  )
}
