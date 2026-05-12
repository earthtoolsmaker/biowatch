import { MapPin } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { parseCoordinates } from './coordinateParser'

/**
 * Triggered by the 📍 button in the detail pane header. Three input
 * surfaces all bound to the same lat/lon pair:
 *   1) Combined paste field — accepts "lat, lon" or "lat lon",
 *      auto-splits into the inputs below.
 *   2) Two number inputs — labeled, autosaves on blur.
 *   3) "Place on map" — closes the popover and engages place mode on
 *      the big map; the existing flow takes over.
 */
export default function LocationPopover({ deployment, onCommitLatLon, onEnterPlaceMode }) {
  const [isOpen, setIsOpen] = useState(false)
  const buttonRef = useRef(null)
  const popoverRef = useRef(null)

  const initialLat = deployment.latitude
  const initialLon = deployment.longitude

  const [latInput, setLatInput] = useState(initialLat ?? '')
  const [lonInput, setLonInput] = useState(initialLon ?? '')
  const [combinedInput, setCombinedInput] = useState(() =>
    initialLat != null && initialLon != null ? `${initialLat}, ${initialLon}` : ''
  )

  // Resync local state when the popover opens against a different deployment.
  useEffect(() => {
    setLatInput(initialLat ?? '')
    setLonInput(initialLon ?? '')
    setCombinedInput(initialLat != null && initialLon != null ? `${initialLat}, ${initialLon}` : '')
  }, [initialLat, initialLon])

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return
    const onDown = (e) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target)
      ) {
        setIsOpen(false)
      }
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [isOpen])

  // Esc closes
  useEffect(() => {
    if (!isOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen])

  const handleCombinedChange = useCallback((e) => {
    const value = e.target.value
    setCombinedInput(value)
    const parsed = parseCoordinates(value)
    if (parsed) {
      setLatInput(parsed.lat)
      setLonInput(parsed.lon)
    }
  }, [])

  const handleCombinedBlur = useCallback(() => {
    const parsed = parseCoordinates(combinedInput)
    if (parsed) {
      onCommitLatLon(deployment.deploymentID, parsed.lat, parsed.lon)
    }
  }, [combinedInput, deployment.deploymentID, onCommitLatLon])

  const handleLatChange = useCallback((e) => {
    setLatInput(e.target.value)
  }, [])
  const handleLonChange = useCallback((e) => {
    setLonInput(e.target.value)
  }, [])

  const handleLatBlur = useCallback(() => {
    const lat = parseFloat(latInput)
    if (!Number.isNaN(lat)) {
      onCommitLatLon(deployment.deploymentID, lat, parseFloat(lonInput))
      setCombinedInput(`${lat}, ${lonInput}`)
    }
  }, [latInput, lonInput, deployment.deploymentID, onCommitLatLon])

  const handleLonBlur = useCallback(() => {
    const lon = parseFloat(lonInput)
    if (!Number.isNaN(lon)) {
      onCommitLatLon(deployment.deploymentID, parseFloat(latInput), lon)
      setCombinedInput(`${latInput}, ${lon}`)
    }
  }, [latInput, lonInput, deployment.deploymentID, onCommitLatLon])

  const handlePlaceClick = useCallback(() => {
    setIsOpen(false)
    onEnterPlaceMode(deployment)
  }, [deployment, onEnterPlaceMode])

  const buttonClass = useMemo(
    () =>
      `p-1 rounded ${
        isOpen
          ? 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground'
      }`,
    [isOpen]
  )

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setIsOpen((v) => !v)}
        className={buttonClass}
        title="Edit location"
        aria-label="Edit location"
        aria-pressed={isOpen}
      >
        <MapPin size={16} />
      </button>
      {isOpen && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-1 w-[300px] bg-card border border-border rounded-lg shadow-lg z-[1100] p-3"
        >
          <div className="flex items-center justify-between mb-2">
            <h5 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Location
            </h5>
            <button
              onClick={handlePlaceClick}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-blue-500 hover:bg-blue-600 text-white text-[11px] rounded dark:bg-blue-400 dark:hover:bg-blue-500"
            >
              <MapPin size={12} />
              Place on map
            </button>
          </div>

          <div className="mb-2">
            <input
              type="text"
              value={combinedInput}
              onChange={handleCombinedChange}
              onBlur={handleCombinedBlur}
              placeholder="Paste lat, lon"
              className="w-full px-2.5 py-1.5 border border-border rounded text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <div className="text-[10px] text-muted-foreground mt-1">
              Paste from a spreadsheet, GPS, etc.
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Latitude
              </span>
              <input
                type="number"
                step="0.00001"
                min="-90"
                max="90"
                value={latInput ?? ''}
                onChange={handleLatChange}
                onBlur={handleLatBlur}
                className="px-2 py-1.5 border border-border rounded text-xs tabular-nums"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Longitude
              </span>
              <input
                type="number"
                step="0.00001"
                min="-180"
                max="180"
                value={lonInput ?? ''}
                onChange={handleLonChange}
                onBlur={handleLonBlur}
                className="px-2 py-1.5 border border-border rounded text-xs tabular-nums"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
