# Media observation rail — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the floating `ObservationEditor` popover and the footer species labels in the media modal with a single persistent right-side `ObservationRail` that lists every observation on a media (bbox or whole-image) and edits the focused row inline.

**Architecture:** New `ObservationRail` component owns observation editing for the entire modal. Selectors (`SpeciesPicker`, `SexSelector`, `LifeStageSelector`, `BehaviorSelector`) are extracted from `media.jsx` into individual files and restyled to Biowatch's monochrome palette. `BboxLabelMinimal` replaces today's `BboxLabel` with a species-only pill. A new mode invariant (`empty` / `bbox` / `whole-image`) is enforced in the create menu via a pure helper. Strategy: build new components alongside the old ones (kept dormant), then switch `ImageModal` over in one cohesive task, then delete the old code.

**Tech stack:** React 18, TailwindCSS 4, TanStack Query, lucide-react icons, `node --test` for pure-function tests.

**Spec:** `docs/specs/2026-04-30-media-observation-rail-design.md`

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `src/renderer/src/utils/mediaMode.js` | Pure helper: `getMediaMode(observations) → 'empty' \| 'bbox' \| 'whole-image' \| 'mixed'` |
| `src/renderer/src/ui/SexSelector.jsx` | 3-pill row, monochrome |
| `src/renderer/src/ui/LifeStageSelector.jsx` | 3-pill row, monochrome |
| `src/renderer/src/ui/BehaviorSelector.jsx` | Grouped checkbox dropdown, monochrome |
| `src/renderer/src/ui/SpeciesPicker.jsx` | Search input + ranked list + custom-species fallback + current-species chip |
| `src/renderer/src/ui/BboxLabelMinimal.jsx` | Species-only pill on the image, click selects row |
| `src/renderer/src/ui/AddObservationMenu.jsx` | Mode-aware 2-item dropdown |
| `src/renderer/src/ui/ObservationRow.jsx` | Collapsed/expanded row; mounts editor body when expanded |
| `src/renderer/src/ui/ObservationRail.jsx` | Top-level rail; owns header, list, empty state, bottom-row affordance |
| `test/renderer/mediaMode.test.js` | Unit tests for `getMediaMode` |

### Modified files

| Path | Change |
|---|---|
| `src/renderer/src/media.jsx` | Replace `selectedBboxId` + `showObservationEditor` with `selectedObservationId`; mount `ObservationRail`; replace `BboxLabel` with `BboxLabelMinimal`; wire create menu; remove dead code |
| `docs/architecture.md` | Note the rail in the modal section if relevant |

---

## Task 1: Pure helper for media mode

**Files:**
- Create: `src/renderer/src/utils/mediaMode.js`
- Test: `test/renderer/mediaMode.test.js`

The mode invariant from the spec needs to live in pure logic so the rail UI and the create menu can both consult it. This is the only piece that's testable as pure logic, so it's the right place to start TDD-style.

- [ ] **Step 1: Write the failing tests**

Create `test/renderer/mediaMode.test.js`:

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { getMediaMode } from '../../src/renderer/src/utils/mediaMode.js'

const bboxObs = (id) => ({
  observationID: id,
  bboxX: 0.1,
  bboxY: 0.1,
  bboxWidth: 0.2,
  bboxHeight: 0.2
})

const wholeImageObs = (id) => ({
  observationID: id,
  bboxX: null,
  bboxY: null,
  bboxWidth: null,
  bboxHeight: null
})

test('empty list → empty', () => {
  assert.equal(getMediaMode([]), 'empty')
})

test('only bbox observations → bbox', () => {
  assert.equal(getMediaMode([bboxObs('a'), bboxObs('b')]), 'bbox')
})

test('one whole-image observation → whole-image', () => {
  assert.equal(getMediaMode([wholeImageObs('a')]), 'whole-image')
})

test('bbox + whole-image → mixed', () => {
  assert.equal(getMediaMode([bboxObs('a'), wholeImageObs('b')]), 'mixed')
})

test('null/undefined input → empty', () => {
  assert.equal(getMediaMode(null), 'empty')
  assert.equal(getMediaMode(undefined), 'empty')
})

test('observation with partial bbox columns counts as bbox', () => {
  // Defensive: if any of the 4 bbox columns are present, treat as bbox.
  assert.equal(getMediaMode([{ observationID: 'x', bboxX: 0.1 }]), 'bbox')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test test/renderer/mediaMode.test.js`
Expected: 6 fails with `Cannot find package` or `getMediaMode is not a function`.

- [ ] **Step 3: Write the helper**

Create `src/renderer/src/utils/mediaMode.js`:

```js
/**
 * Classifies a media's observations into one of four modes.
 *
 * - 'empty'        — no observations
 * - 'bbox'         — 1+ bbox observations, 0 whole-image
 * - 'whole-image'  — exactly 1 whole-image observation, 0 bbox
 * - 'mixed'        — both kinds present (data inconsistency from imports)
 *
 * An observation is "bbox" if any of bboxX/bboxY/bboxWidth/bboxHeight is
 * non-null; otherwise it is "whole-image".
 */
export function getMediaMode(observations) {
  if (!observations || observations.length === 0) return 'empty'

  let hasBbox = false
  let hasWhole = false

  for (const obs of observations) {
    const isBbox =
      obs.bboxX != null ||
      obs.bboxY != null ||
      obs.bboxWidth != null ||
      obs.bboxHeight != null
    if (isBbox) hasBbox = true
    else hasWhole = true
  }

  if (hasBbox && hasWhole) return 'mixed'
  if (hasBbox) return 'bbox'
  return 'whole-image'
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test test/renderer/mediaMode.test.js`
Expected: 6 pass.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/utils/mediaMode.js test/renderer/mediaMode.test.js
git commit -m "feat(media): add getMediaMode helper for observation-mode invariant"
```

---

## Task 2: Extract and restyle `SexSelector`

**Files:**
- Create: `src/renderer/src/ui/SexSelector.jsx`

Extracts the inline `SexSelector` (currently `media.jsx:156-211`) and the `FemaleIcon` / `MaleIcon` / `UnknownIcon` SVGs (currently `media.jsx:99-134`) into their own file, restyled to monochrome pills per the spec.

- [ ] **Step 1: Create the file**

Create `src/renderer/src/ui/SexSelector.jsx`:

```jsx
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
      <text x="12" y="17" textAnchor="middle" fontSize="14" fill="currentColor">?</text>
    </svg>
  )
}

const OPTIONS = [
  { value: 'female', label: 'Female', Icon: FemaleIcon },
  { value: 'male', label: 'Male', Icon: MaleIcon },
  { value: 'unknown', label: 'Unknown', Icon: UnknownIcon }
]

/**
 * 3-pill row. Click a pill to select; click the selected pill to clear (sets to null).
 * Monochrome: unselected pills use white/border-gray; selected uses black fill.
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
```

- [ ] **Step 2: Quick smoke test — import doesn't break**

Run: `npm run dev` (or whatever the project uses to start Vite). Wait for the renderer to compile. Check the dev console — there should be no compile errors. The app behavior is unchanged because nothing imports the new file yet.

Stop the dev server.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/ui/SexSelector.jsx
git commit -m "feat(media): extract SexSelector to ui/ with monochrome pill styling"
```

---

## Task 3: Extract and restyle `LifeStageSelector`

**Files:**
- Create: `src/renderer/src/ui/LifeStageSelector.jsx`

Same shape as Task 2, applied to the life-stage selector (currently `media.jsx:217-273`) and its `AdultIcon` / `SubadultIcon` / `JuvenileIcon` SVGs (`media.jsx:128-151`).

- [ ] **Step 1: Create the file**

Create `src/renderer/src/ui/LifeStageSelector.jsx`:

```jsx
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
```

- [ ] **Step 2: Smoke test the dev server compiles**

Run: `npm run dev`, wait for compile, check console for errors, stop.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/ui/LifeStageSelector.jsx
git commit -m "feat(media): extract LifeStageSelector to ui/ with monochrome pill styling"
```

---

## Task 4: Extract and restyle `BehaviorSelector`

**Files:**
- Create: `src/renderer/src/ui/BehaviorSelector.jsx`

Extract the inline `BehaviorSelector` (currently `media.jsx:279-411`). Keep its grouped-dropdown behavior and local-state-then-save-on-close logic; restyle the trigger and dropdown to monochrome.

- [ ] **Step 1: Create the file**

Create `src/renderer/src/ui/BehaviorSelector.jsx`:

```jsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { behaviorCategories } from '../utils/behaviorCategories'

/**
 * Grouped multi-select dropdown for the `behavior` field.
 * Local state holds in-flight checkbox edits; commits to onChange when the
 * dropdown closes (preserves today's behavior).
 */
export default function BehaviorSelector({ value = [], onChange }) {
  const [isOpen, setIsOpen] = useState(false)
  const [localBehaviors, setLocalBehaviors] = useState(value || [])
  const dropdownRef = useRef(null)
  const hasChangesRef = useRef(false)
  const wasOpenRef = useRef(false)

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setLocalBehaviors(value || [])
      hasChangesRef.current = false
    }
    wasOpenRef.current = isOpen
  }, [isOpen, value])

  const handleClose = useCallback(() => {
    if (hasChangesRef.current) {
      onChange(localBehaviors.length > 0 ? localBehaviors : null)
      hasChangesRef.current = false
    }
    setIsOpen(false)
  }, [localBehaviors, onChange])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        handleClose()
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, handleClose])

  const selectedCount = localBehaviors.length

  const handleToggle = (behavior) => {
    hasChangesRef.current = true
    setLocalBehaviors((prev) =>
      prev.includes(behavior) ? prev.filter((b) => b !== behavior) : [...prev, behavior]
    )
  }

  const handleClearAll = (e) => {
    e.stopPropagation()
    hasChangesRef.current = true
    setLocalBehaviors([])
  }

  const handleButtonClick = () => {
    if (isOpen) handleClose()
    else setIsOpen(true)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={handleButtonClick}
        className={`w-full flex items-center justify-between px-3 py-1.5 rounded-md border text-sm transition-colors ${
          selectedCount > 0
            ? 'bg-white border-gray-300 text-[#030213]'
            : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
        }`}
      >
        <span>
          {selectedCount > 0 ? `${selectedCount} behavior${selectedCount > 1 ? 's' : ''}` : 'None'}
        </span>
        <div className="flex items-center gap-1">
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              className="p-0.5 rounded hover:bg-gray-100 transition-colors"
              title="Clear all"
            >
              <X size={14} />
            </button>
          )}
          {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-30 bottom-full mb-1 w-full bg-white border border-gray-200 rounded-md shadow-lg max-h-64 overflow-y-auto">
          {Object.entries(behaviorCategories).map(([category, behaviors]) => (
            <div key={category}>
              <div className="px-3 py-1.5 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                {category}
              </div>
              {behaviors.map((behavior) => {
                const isChecked = localBehaviors.includes(behavior)
                return (
                  <label
                    key={behavior}
                    onClick={(e) => e.stopPropagation()}
                    className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-50 transition-colors ${
                      isChecked ? 'bg-gray-50' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(e) => {
                        e.stopPropagation()
                        handleToggle(behavior)
                      }}
                      className="w-4 h-4 rounded border-gray-300 text-[#030213] focus:ring-gray-400 focus:ring-offset-0"
                    />
                    <span className="text-sm text-gray-700">{behavior}</span>
                  </label>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify `behaviorCategories` import path**

Run: `find src/renderer/src/utils -name "behaviorCategories*"` to confirm the export location. If the export is at a different path, adjust the import in the file you just created.

- [ ] **Step 3: Smoke test the dev server compiles**

Run: `npm run dev`, wait for compile, check console for errors, stop.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/ui/BehaviorSelector.jsx
git commit -m "feat(media): extract BehaviorSelector to ui/ with monochrome restyle"
```

---

## Task 5: Extract and restyle `SpeciesPicker`

**Files:**
- Create: `src/renderer/src/ui/SpeciesPicker.jsx`

Extract the species-tab content from today's `ObservationEditor` (`media.jsx:592-732`): current-species chip, search input, ranked results, custom-species fallback, mark-blank affordance. Restyle from lime accents to monochrome neutrals + the focused-row `#f8f9fb` hover state. Keep all behavior (debounce, fuzzy search, keyboard navigation, custom species).

- [ ] **Step 1: Create the file**

Create `src/renderer/src/ui/SpeciesPicker.jsx`:

```jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, X, Plus } from 'lucide-react'
import { searchSpecies } from '../utils/speciesUtils'

/**
 * Species picker for one observation.
 *
 * Behavior:
 *  - Shows the current classification chip with a "mark blank" `×`.
 *  - Search input with 150ms debounce, fuzzy-matched against study species
 *    and the bundled dictionary (3+ chars).
 *  - Keyboard navigation: ↑/↓ moves highlight, Enter commits.
 *  - Custom-species fallback when the query has no results.
 *
 * Saves are committal: clicking a result or pressing Enter calls
 * onSelect(scientificName, commonName) and the parent collapses the picker.
 */
export default function SpeciesPicker({
  studyId,
  currentScientificName,
  currentCommonName,
  onSelect,           // (scientificName, commonName) → void
  onMarkBlank,        // () → void
  autoFocus = true
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const inputRef = useRef(null)
  const rowRefs = useRef([])

  const { data: speciesList = [] } = useQuery({
    queryKey: ['distinctSpecies', studyId],
    queryFn: async () => {
      const response = await window.api.getDistinctSpecies(studyId)
      return response.data || []
    },
    staleTime: 30000
  })

  useEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus()
  }, [autoFocus])

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchTerm), 150)
    return () => clearTimeout(handle)
  }, [searchTerm])

  const results = useMemo(
    () => searchSpecies(debouncedSearch, speciesList),
    [debouncedSearch, speciesList]
  )

  const customSpeciesQuery = useMemo(
    () => debouncedSearch.trim().replace(/\s+/g, ' '),
    [debouncedSearch]
  )

  useEffect(() => {
    setHighlightedIndex(results.length > 0 ? 0 : -1)
    rowRefs.current.length = results.length
  }, [results])

  useEffect(() => {
    if (highlightedIndex < 0) return
    const node = rowRefs.current[highlightedIndex]
    if (node) node.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  return (
    <div className="flex flex-col">
      {currentScientificName && (
        <div className="flex items-center gap-2 mb-2">
          <div
            className="flex-1 min-w-0 inline-flex items-center gap-1 px-2 py-1 rounded bg-gray-50 text-[#030213] text-sm border border-gray-200"
            title={
              currentCommonName
                ? `${currentCommonName} (${currentScientificName})`
                : currentScientificName
            }
          >
            <span className="truncate">
              <span className="font-medium">{currentCommonName || currentScientificName}</span>
              {currentCommonName && (
                <span className="ml-1 italic text-gray-500">({currentScientificName})</span>
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={onMarkBlank}
            aria-label="Mark as blank (no species)"
            title="Mark as blank (no species)"
            className="shrink-0 p-1 rounded text-gray-500 hover:bg-gray-100"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="relative mb-2">
        <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' || e.key === 'Delete') {
              e.stopPropagation()
              return
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              if (results.length === 0) return
              setHighlightedIndex((i) => (i + 1) % results.length)
              return
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault()
              if (results.length === 0) return
              setHighlightedIndex((i) => (i <= 0 ? results.length - 1 : i - 1))
              return
            }
            if (e.key === 'Enter') {
              if (highlightedIndex >= 0 && highlightedIndex < results.length) {
                e.preventDefault()
                const picked = results[highlightedIndex]
                onSelect(picked.scientificName, picked.commonName)
                return
              }
              if (results.length === 0 && customSpeciesQuery.length >= 3) {
                e.preventDefault()
                onSelect(customSpeciesQuery, null)
              }
            }
          }}
          placeholder="Search species…"
          className="w-full pl-7 pr-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-transparent"
        />
      </div>

      <div className="max-h-52 overflow-y-auto border border-gray-200 rounded">
        {results.map((species, index) => (
          <button
            key={species.scientificName}
            type="button"
            ref={(node) => {
              rowRefs.current[index] = node
            }}
            onMouseEnter={() => setHighlightedIndex(index)}
            onClick={() => onSelect(species.scientificName, species.commonName)}
            className={`w-full px-3 py-1.5 text-left flex items-center justify-between ${
              index === highlightedIndex ? 'bg-[#f8f9fb]' : ''
            } ${species.scientificName === currentScientificName ? 'bg-gray-100' : ''}`}
          >
            <div className="min-w-0 truncate">
              <span className="text-sm font-medium">
                {species.commonName || species.scientificName}
              </span>
              {species.commonName && (
                <span className="text-xs text-gray-500 ml-2 italic">
                  ({species.scientificName})
                </span>
              )}
            </div>
            {species.inStudy !== false && typeof species.observationCount === 'number' && (
              <span className="flex items-center gap-1 text-xs text-gray-400 shrink-0 ml-2">
                <span className="w-1.5 h-1.5 rounded-full bg-[#030213]" aria-hidden="true" />
                {species.observationCount}
              </span>
            )}
          </button>
        ))}

        {results.length === 0 &&
          debouncedSearch.trim().length > 0 &&
          debouncedSearch.trim().length < 3 && (
            <div className="px-3 py-3 text-sm text-gray-500 text-center">
              Type at least 3 characters to search the species dictionary.
            </div>
          )}

        {results.length === 0 && customSpeciesQuery.length >= 3 && (
          <div className="px-3 py-3 text-center space-y-2">
            <p className="text-sm text-gray-500">No species found.</p>
            <button
              type="button"
              onClick={() => onSelect(customSpeciesQuery, null)}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded bg-[#030213] text-white hover:bg-black max-w-full"
            >
              <Plus size={14} className="shrink-0" />
              <span className="truncate">
                Add &ldquo;{customSpeciesQuery}&rdquo; as custom species
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Smoke test the dev server compiles**

Run: `npm run dev`, wait for compile, check console for errors, stop.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/ui/SpeciesPicker.jsx
git commit -m "feat(media): extract SpeciesPicker to ui/ with monochrome restyle"
```

---

## Task 6: Build `BboxLabelMinimal`

**Files:**
- Create: `src/renderer/src/ui/BboxLabelMinimal.jsx`

A simplified replacement for today's `BboxLabel` (currently `media.jsx:760-878`). Species name only — no confidence, no chips, no edit affordances. Single click handler that selects the row.

- [ ] **Step 1: Create the file**

Create `src/renderer/src/ui/BboxLabelMinimal.jsx`:

```jsx
import { forwardRef } from 'react'
import { computeBboxLabelPosition } from '../utils/bboxCoordinates'

/**
 * Species-only label pill anchored above a bbox on the image.
 * Click selects the matching observation in the rail.
 *
 * Color encodes validation:
 *   - Selected: filled near-black
 *   - Validated (human): filled #2563eb
 *   - Predicted (model): filled #60a5fa
 */
const BboxLabelMinimal = forwardRef(function BboxLabelMinimal(
  { bbox, isSelected, isValidated, onClick },
  ref
) {
  const displayName = bbox.commonName || bbox.scientificName || 'Blank'
  const { left: leftPos, top: topPos, transform: transformVal } = computeBboxLabelPosition(bbox)

  const bg = isSelected
    ? 'bg-[#030213]'
    : isValidated
      ? 'bg-[#2563eb]'
      : 'bg-[#60a5fa]'

  return (
    <button
      ref={ref}
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`absolute pointer-events-auto px-2 py-0.5 rounded text-white text-xs font-medium whitespace-nowrap max-w-full truncate shadow-sm ${bg} ${
        isSelected ? 'ring-2 ring-white/60' : ''
      }`}
      style={{
        left: leftPos,
        top: topPos,
        transform: transformVal
      }}
      title={
        bbox.commonName
          ? `${bbox.commonName} (${bbox.scientificName})`
          : bbox.scientificName || 'Blank'
      }
    >
      {displayName}
    </button>
  )
})

export default BboxLabelMinimal
```

- [ ] **Step 2: Smoke test**

Run: `npm run dev`, wait for compile, check console, stop.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/ui/BboxLabelMinimal.jsx
git commit -m "feat(media): add BboxLabelMinimal — species-only image label"
```

---

## Task 7: Build `AddObservationMenu`

**Files:**
- Create: `src/renderer/src/ui/AddObservationMenu.jsx`

Mode-aware 2-item dropdown. Visible only when `mode` is `'empty'` or `'bbox'`; in `'bbox'` mode the "Whole image" item is omitted. Uses `getMediaMode` from Task 1 indirectly via the parent.

- [ ] **Step 1: Create the file**

Create `src/renderer/src/ui/AddObservationMenu.jsx`:

```jsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'

const BBOX_ICON = (
  <span
    className="w-4 h-4 rounded-sm border-[1.5px] border-[#2563eb]"
    style={{ background: 'rgba(37,99,235,0.08)' }}
    aria-hidden="true"
  />
)

const WHOLE_ICON = (
  <span
    className="w-4 h-4 rounded-sm border-[1.5px] border-dashed border-gray-400 bg-gray-100"
    aria-hidden="true"
  />
)

/**
 * Bottom-of-rail "+ Add observation" affordance with a 2-item menu.
 *
 * Props:
 *  - mode: 'empty' | 'bbox' | 'whole-image' | 'mixed'
 *  - onDrawRectangle: () → void
 *  - onWholeImage:    () → void
 *  - variant: 'bottom-row' (default) | 'centered-button' (empty-state)
 *
 * Hidden entirely when mode === 'whole-image' or 'mixed'.
 */
export default function AddObservationMenu({
  mode,
  onDrawRectangle,
  onWholeImage,
  variant = 'bottom-row'
}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef(null)

  const close = useCallback(() => setIsOpen(false), [])

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) close()
    }
    const handleEsc = (e) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [isOpen, close])

  if (mode === 'whole-image' || mode === 'mixed') return null

  const showWhole = mode === 'empty'

  const trigger =
    variant === 'centered-button' ? (
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#030213] text-white text-sm font-medium hover:bg-black"
      >
        <Plus size={14} />
        Add observation
      </button>
    ) : (
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="w-full text-left px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 flex items-center gap-1.5 border-t border-gray-100"
      >
        <Plus size={14} />
        Add observation
      </button>
    )

  return (
    <div className="relative" ref={containerRef}>
      {trigger}

      {isOpen && (
        <div
          className={`absolute z-30 ${
            variant === 'centered-button' ? 'top-full mt-1 left-1/2 -translate-x-1/2' : 'bottom-full mb-1 left-3'
          } w-56 bg-white border border-gray-200 rounded-md shadow-lg overflow-hidden`}
        >
          <button
            type="button"
            onClick={() => {
              close()
              onDrawRectangle()
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#030213] hover:bg-[#f8f9fb] text-left"
          >
            {BBOX_ICON}
            <span className="flex flex-col">
              <span>Draw rectangle</span>
              <span className="text-xs text-gray-400">Click and drag on the image</span>
            </span>
          </button>
          {showWhole && (
            <button
              type="button"
              onClick={() => {
                close()
                onWholeImage()
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#030213] hover:bg-[#f8f9fb] text-left border-t border-gray-100"
            >
              {WHOLE_ICON}
              <span className="flex flex-col">
                <span>Whole image</span>
                <span className="text-xs text-gray-400">No rectangle, image-level</span>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Smoke test**

Run: `npm run dev`, wait for compile, check console, stop.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/ui/AddObservationMenu.jsx
git commit -m "feat(media): add AddObservationMenu (mode-aware Draw/Whole-image)"
```

---

## Task 8: Build `ObservationRow`

**Files:**
- Create: `src/renderer/src/ui/ObservationRow.jsx`

A single row in the rail. Collapsed by default; expanded when selected. Owns its own header (type icon, validation glyph, species name, confidence, summary mini-badges) and, when expanded, mounts the species picker and attribute selectors.

- [ ] **Step 1: Create the file**

Create `src/renderer/src/ui/ObservationRow.jsx`:

```jsx
import { useEffect, useRef } from 'react'
import { Check, ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import SexSelector from './SexSelector'
import LifeStageSelector from './LifeStageSelector'
import BehaviorSelector from './BehaviorSelector'
import SpeciesPicker from './SpeciesPicker'

const BBOX_TYPE_ICON = (
  <span
    className="inline-flex w-4 h-4 rounded-sm border-[1.5px] border-[#2563eb] flex-shrink-0"
    style={{ background: 'rgba(37,99,235,0.08)' }}
    aria-hidden="true"
  />
)

const WHOLE_TYPE_ICON = (
  <span
    className="inline-flex w-4 h-4 rounded-sm border-[1.5px] border-dashed border-gray-400 bg-gray-100 flex-shrink-0"
    aria-hidden="true"
  />
)

/**
 * One row in the observation rail.
 *
 * Props:
 *  - observation: full observation record from the DB
 *  - studyId: string
 *  - isSelected: boolean — when true, the row is expanded
 *  - onSelect: () → void
 *  - onUpdateClassification: (updates: object) → void
 *  - onDelete: () → void
 */
export default function ObservationRow({
  observation,
  studyId,
  isSelected,
  onSelect,
  onUpdateClassification,
  onDelete
}) {
  const rowRef = useRef(null)

  // Auto-scroll into view when this row becomes selected.
  useEffect(() => {
    if (isSelected && rowRef.current) {
      rowRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [isSelected])

  const isBbox = observation.bboxX != null
  const isHuman = observation.classificationMethod === 'human'

  const displayName =
    observation.commonName ||
    observation.scientificName ||
    (observation.observationType === 'blank' ? 'Blank' : '—')

  const confidence =
    observation.classificationProbability != null && !isHuman
      ? `${Math.round(observation.classificationProbability * 100)}%`
      : null

  const sexBadge =
    observation.sex === 'female' ? '♀' : observation.sex === 'male' ? '♂' : null
  const stageBadge =
    observation.lifeStage === 'adult'
      ? 'A'
      : observation.lifeStage === 'subadult'
        ? 'SA'
        : observation.lifeStage === 'juvenile'
          ? 'J'
          : null

  const handleSpeciesSelect = (scientificName, commonName) => {
    onUpdateClassification({
      scientificName,
      commonName,
      observationType: 'animal'
    })
  }

  const handleMarkBlank = () => {
    onUpdateClassification({
      scientificName: null,
      commonName: null,
      observationType: 'blank'
    })
  }

  return (
    <div
      ref={rowRef}
      className={`relative border-b border-gray-100 ${
        isSelected ? 'bg-[#f8f9fb] sticky top-0 z-10' : ''
      }`}
    >
      {isSelected && <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-[#2563eb]" aria-hidden="true" />}

      <button
        type="button"
        onClick={onSelect}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#f8f9fb] transition-colors"
      >
        {isBbox ? BBOX_TYPE_ICON : WHOLE_TYPE_ICON}

        {isHuman && <Check size={12} className="text-gray-500 flex-shrink-0" aria-label="Human-validated" />}

        <span className={`text-sm flex-1 min-w-0 truncate ${observation.observationType === 'blank' ? 'italic text-gray-400' : 'text-[#030213] font-medium'}`}>
          {displayName}
          {!isBbox && <span className="ml-1 text-xs text-gray-400 font-normal">· whole image</span>}
        </span>

        {confidence && (
          <span className="text-xs text-gray-400 flex-shrink-0">{confidence}</span>
        )}

        {!isSelected && stageBadge && (
          <span className="text-[10px] px-1.5 py-px rounded bg-gray-100 text-gray-600">
            {stageBadge}
          </span>
        )}
        {!isSelected && sexBadge && (
          <span className="text-[10px] px-1.5 py-px rounded bg-gray-100 text-gray-600">
            {sexBadge}
          </span>
        )}

        {isSelected ? (
          <ChevronUp size={14} className="text-gray-400 flex-shrink-0" />
        ) : (
          <ChevronDown size={14} className="text-gray-400 flex-shrink-0" />
        )}
      </button>

      {isSelected && (
        <div className="px-3 pb-3 pt-1 space-y-3" onClick={(e) => e.stopPropagation()}>
          <SpeciesPicker
            studyId={studyId}
            currentScientificName={observation.scientificName}
            currentCommonName={observation.commonName}
            onSelect={handleSpeciesSelect}
            onMarkBlank={handleMarkBlank}
            autoFocus
          />

          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1.5">Sex</div>
            <SexSelector
              value={observation.sex}
              onChange={(sex) => onUpdateClassification({ sex })}
            />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1.5">Life stage</div>
            <LifeStageSelector
              value={observation.lifeStage}
              onChange={(lifeStage) => onUpdateClassification({ lifeStage })}
            />
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-medium mb-1.5">Behavior</div>
            <BehaviorSelector
              value={observation.behavior}
              onChange={(behavior) => onUpdateClassification({ behavior })}
            />
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onDelete}
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 px-2 py-1 rounded hover:bg-red-50 transition-colors"
              title="Delete observation"
            >
              <Trash2 size={12} />
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Smoke test**

Run: `npm run dev`, wait for compile, check console, stop.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/ui/ObservationRow.jsx
git commit -m "feat(media): add ObservationRow (collapsed/expanded with inline editor)"
```

---

## Task 9: Build `ObservationRail`

**Files:**
- Create: `src/renderer/src/ui/ObservationRail.jsx`

Top-level rail component. Renders header, list, empty state, bottom-row create affordance. Selects the first observation by default when nothing is selected and observations exist.

- [ ] **Step 1: Create the file**

Create `src/renderer/src/ui/ObservationRail.jsx`:

```jsx
import { useEffect } from 'react'
import ObservationRow from './ObservationRow'
import AddObservationMenu from './AddObservationMenu'
import { getMediaMode } from '../utils/mediaMode'

/**
 * Persistent right-side rail listing every observation on the current media.
 *
 * Props:
 *  - observations: array of observation records (bbox or whole-image)
 *  - studyId: string
 *  - selectedObservationId: string | null
 *  - onSelectObservation: (id: string | null) → void
 *  - onUpdateClassification: (id, updates) → void
 *  - onDeleteObservation: (id) → void
 *  - onDrawRectangle: () → void   — enters bbox-draw mode
 *  - onAddWholeImage: () → void   — creates a whole-image observation now
 */
export default function ObservationRail({
  observations = [],
  studyId,
  selectedObservationId,
  onSelectObservation,
  onUpdateClassification,
  onDeleteObservation,
  onDrawRectangle,
  onAddWholeImage
}) {
  const mode = getMediaMode(observations)

  // Auto-select the first observation when nothing is selected and the list is
  // non-empty (matches the spec).
  useEffect(() => {
    if (!selectedObservationId && observations.length > 0) {
      onSelectObservation(observations[0].observationID)
    }
  }, [selectedObservationId, observations, onSelectObservation])

  return (
    <aside
      className="w-[300px] flex-shrink-0 bg-white border-l border-gray-200 flex flex-col h-full"
      aria-label="Observations"
    >
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 flex-shrink-0">
        <span className="text-sm font-semibold text-[#030213]">Observations</span>
        <span className="text-xs text-gray-500 font-medium">{observations.length}</span>
      </header>

      {mode === 'empty' ? (
        <div className="flex-1 flex flex-col items-center justify-center px-8 text-center gap-3">
          <span
            className="w-9 h-9 rounded-md border-[1.5px] border-dashed border-gray-300 bg-gray-50"
            aria-hidden="true"
          />
          <div className="text-sm text-gray-500 leading-relaxed">
            <strong className="text-[#030213] block">No observations yet</strong>
            Add one to start labelling this media.
          </div>
          <AddObservationMenu
            mode={mode}
            onDrawRectangle={onDrawRectangle}
            onWholeImage={onAddWholeImage}
            variant="centered-button"
          />
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto min-h-0">
            {observations.map((obs) => (
              <ObservationRow
                key={obs.observationID}
                observation={obs}
                studyId={studyId}
                isSelected={obs.observationID === selectedObservationId}
                onSelect={() => onSelectObservation(obs.observationID)}
                onUpdateClassification={(updates) =>
                  onUpdateClassification(obs.observationID, updates)
                }
                onDelete={() => onDeleteObservation(obs.observationID)}
              />
            ))}
          </div>

          <AddObservationMenu
            mode={mode}
            onDrawRectangle={onDrawRectangle}
            onWholeImage={onAddWholeImage}
            variant="bottom-row"
          />
        </>
      )}
    </aside>
  )
}
```

- [ ] **Step 2: Smoke test**

Run: `npm run dev`, wait for compile, check console, stop.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/ui/ObservationRail.jsx
git commit -m "feat(media): add ObservationRail — persistent right-side editor list"
```

---

## Task 10: Wire `ObservationRail` into `ImageModal`

**Files:**
- Modify: `src/renderer/src/media.jsx`

Replace the popover editor and footer species labels with the rail. State migrates from `selectedBboxId` + `showObservationEditor` + `editorInitialTab` to a single `selectedObservationId`. The modal card gains a horizontal flex split: image area on the left, rail on the right.

This is the largest task. Do it as one cohesive change so the modal renders end-to-end.

- [ ] **Step 1: Add imports at the top of `media.jsx`**

Find the existing import block. Add these imports near the existing `./ui/EditableBbox` import:

```jsx
import ObservationRail from './ui/ObservationRail'
import BboxLabelMinimal from './ui/BboxLabelMinimal'
```

- [ ] **Step 2: Replace state in `ImageModal`**

Find these lines (search for `selectedBboxId` and `showObservationEditor`):

```jsx
const [selectedBboxId, setSelectedBboxId] = useState(null)
const [showObservationEditor, setShowObservationEditor] = useState(false)
const [editorInitialTab, setEditorInitialTab] = useState('species')
```

Replace with:

```jsx
const [selectedObservationId, setSelectedObservationId] = useState(null)
```

Then sweep the file: replace every read of `selectedBboxId` with `selectedObservationId`, and every write `setSelectedBboxId(x)` with `setSelectedObservationId(x)`. Remove all references to `showObservationEditor`, `setShowObservationEditor`, `editorInitialTab`, `setEditorInitialTab`. Search-and-confirm at the end:

```bash
grep -n "selectedBboxId\|showObservationEditor\|editorInitialTab" src/renderer/src/media.jsx
```

Expected: no matches.

- [ ] **Step 3: Wrap the modal body in a flex split**

Find the modal-card root (around `media.jsx:1918`):

```jsx
className="bg-white rounded-lg overflow-hidden shadow-2xl max-h-[90vh] flex flex-col max-w-full"
```

The rail needs a horizontal split. The current structure is `flex flex-col` with a header, body, and footer stacking vertically. Change the **body** (image area) to be a horizontal `flex` containing the existing image content on the left and the new rail on the right.

Find the `<div>` that wraps the image content (search for `imageContainerRef` — it should be a few divs deep). Wrap that subtree's parent — the one between the modal header and the footer — with `<div className="flex flex-1 min-h-0 overflow-hidden">`. Then add `<ObservationRail … />` as a sibling.

Concretely, the new structure:

```jsx
<div className="bg-white rounded-lg overflow-hidden shadow-2xl max-h-[90vh] flex flex-col max-w-full">
  {/* header — unchanged */}
  …
  {/* body */}
  <div className="flex flex-1 min-h-0 overflow-hidden">
    <div className="flex-1 min-w-0 flex flex-col">
      {/* existing image content goes here, including all overlays */}
      …
    </div>
    <ObservationRail
      observations={bboxes}
      studyId={studyId}
      selectedObservationId={selectedObservationId}
      onSelectObservation={setSelectedObservationId}
      onUpdateClassification={(observationID, updates) => {
        window.api.updateObservationClassification(studyId, observationID, updates)
        // Optimistic refresh: TanStack Query invalidation already wired below.
      }}
      onDeleteObservation={handleDeleteObservation}
      onDrawRectangle={() => setIsDrawMode(true)}
      onAddWholeImage={() => {
        // Implemented in Task 12.
      }}
    />
  </div>
  {/* footer — unchanged for now; we'll trim it in Task 13 */}
</div>
```

The `bboxes` variable currently contains all observations on the media (includes whole-image rows when `bboxX` is null). Confirm with:

```bash
grep -n "const bboxes" src/renderer/src/media.jsx
```

If `bboxes` is filtered to only-bbox observations, replace its derivation so it returns all observations. Otherwise pass that source array directly to the rail. Name the rail prop `observations` to be honest about what it carries, regardless of the local variable name.

- [ ] **Step 4: Replace `BboxLabel` with `BboxLabelMinimal`**

Find the `BboxLabel` mounts (around `media.jsx:2284`). Replace each with:

```jsx
<BboxLabelMinimal
  key={bbox.observationID}
  ref={(el) => {
    bboxLabelRefs.current[bbox.observationID] = el
  }}
  bbox={bbox}
  isSelected={bbox.observationID === selectedObservationId}
  isValidated={bbox.classificationMethod === 'human'}
  onClick={() => setSelectedObservationId(bbox.observationID)}
/>
```

Drop all the `onSexClick`, `onLifeStageClick`, `onBehaviorClick`, `onDelete` callbacks — they no longer exist on the new label.

Update the `EditableBbox.onSelect` callback similarly: clicking a bbox rectangle should now ALSO open the editor (matches spec). Find `onSelect={() => { … }}` near `media.jsx:2265` and change to:

```jsx
onSelect={() => {
  setSelectedObservationId(
    bbox.observationID === selectedObservationId ? null : bbox.observationID
  )
}}
```

(Old code split selection-for-geometry from selection-for-editor; the rail unifies both.)

- [ ] **Step 5: Remove the popover `<ObservationEditor … />` mount**

Find `<ObservationEditor` in the JSX (one mount, around `media.jsx:2492+`). Delete the entire `<ObservationEditor … />` block and any wrapping positioning `<div>` that exists solely to anchor it. Also remove the related state for popover position if any (search for `editorPosition`).

- [ ] **Step 6: Run dev server and visually verify**

Run: `npm run dev`. Open a study, open the media tab, click into a media with bbox observations.

Expected:
- Right rail appears, ~300px wide, listing every observation.
- Clicking a bbox label or rectangle on the image highlights its row in the rail and expands the editor inline.
- Clicking a row highlights its rectangle on the image.
- Editing species, sex, life-stage, behavior in the rail saves (refresh the modal to confirm persistence).
- Image with no observations shows the empty state in the rail with the "+ Add observation" button.
- Whole-image observations appear as rows with the dashed `⊡` icon and no rectangle on the image.

If anything renders broken, fix in this task before committing.

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/media.jsx
git commit -m "feat(media): wire ObservationRail into ImageModal, replace popover"
```

---

## Task 11: Wire whole-image creation

**Files:**
- Modify: `src/renderer/src/media.jsx`

Currently `onAddWholeImage` in the rail is a no-op. Implement it: create a new whole-image observation via the existing `window.api.createObservation` IPC, then auto-select it.

- [ ] **Step 1: Inspect the existing `createObservation` signature**

Run:

```bash
grep -A 15 "createObservation:" src/preload/index.js
```

Note the expected `observationData` shape — at minimum `mediaID`, `observationType: 'animal'`, no bbox columns. If a `deploymentID` is required, the existing media record carries it (search for `media.deploymentID` in `media.jsx` to confirm).

- [ ] **Step 2: Add the handler**

Find `handleDrawComplete` (around `media.jsx:1701`) — it's the closest sibling for new-observation handlers. Add a sibling `handleAddWholeImage`:

```jsx
const handleAddWholeImage = useCallback(async () => {
  const newObservation = {
    mediaID: media.mediaID,
    deploymentID: media.deploymentID,
    observationType: 'animal',
    scientificName: null,
    commonName: null
  }

  const response = await window.api.createObservation(studyId, newObservation)
  if (response?.observationID) {
    setSelectedObservationId(response.observationID)
    // The query that drives `bboxes` should auto-refetch on observation
    // changes. If it doesn't (verify in step 3), trigger an invalidation
    // here using the existing TanStack Query client.
  }
}, [media, studyId])
```

If `media.mediaID` / `media.deploymentID` field names differ in this codebase, adjust to match. Use `grep -n "media\.\(mediaID\|deploymentID\)" src/renderer/src/media.jsx` to confirm.

- [ ] **Step 3: Wire the handler into the rail prop**

Update the `<ObservationRail … />` mount from Task 10:

```jsx
onAddWholeImage={handleAddWholeImage}
```

- [ ] **Step 4: Verify query invalidation**

Inspect the bboxes query setup (search for `useQuery` + `getBboxesForMedia` or similar). After `createObservation` resolves, the bboxes list should refetch. If it doesn't, add `queryClient.invalidateQueries(['bboxesForMedia', media.mediaID])` (use the existing query key) inside `handleAddWholeImage`.

- [ ] **Step 5: Manual test**

Run: `npm run dev`. Open a media with no observations, click "+ Add observation → Whole image". A new row appears with `⊡` icon, expanded, picker focused. Pick a species — saved. Refresh the modal — observation persists.

Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/media.jsx
git commit -m "feat(media): wire whole-image observation creation in rail"
```

---

## Task 12: Wire the draw-rectangle handoff

**Files:**
- Modify: `src/renderer/src/media.jsx`

When the user draws a rectangle via `DrawingOverlay`, the new observation must be auto-selected so the rail expands its row with the picker focused.

- [ ] **Step 1: Locate `handleDrawComplete`**

Read `media.jsx:1701-1745` (use Read tool). Find where the new observation is created (likely a `createObservation` call). Note the variable holding the new observation ID.

- [ ] **Step 2: Set `selectedObservationId` to the new ID**

After the new observation is persisted, add:

```jsx
setSelectedObservationId(newObservation.observationID)
```

(Adjust `newObservation.observationID` to match the actual variable name found in step 1.)

Also exit draw mode: `setIsDrawMode(false)` (likely already there — just verify).

- [ ] **Step 3: Manual test**

Run: `npm run dev`. Open a media in bbox mode (or empty media after drawing one). Click "+ Add observation → Draw rectangle". Drag a rectangle. New row appears in the rail, expanded, picker focused. Pick a species — saved.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/media.jsx
git commit -m "feat(media): auto-select new bbox observation after draw-complete"
```

---

## Task 13: Remove dead code

**Files:**
- Modify: `src/renderer/src/media.jsx`

The popover `ObservationEditor`, the inline `BboxLabel` (full version with chips), the inline `SexSelector` / `LifeStageSelector` / `BehaviorSelector`, the `Female/Male/Unknown/Adult/Subadult/Juvenile` icon components, and the footer species-label code paths are now unused. Remove them.

- [ ] **Step 1: Locate and delete the inline `ObservationEditor` definition**

Read `media.jsx:413-755`. Confirm it's the popover editor defined in step "Observation editor with tabs for species selection and attributes". Delete the entire function definition.

- [ ] **Step 2: Locate and delete the inline `BboxLabel` definition**

Read `media.jsx:756-878` (line numbers will shift after step 1 — rely on the function-name boundary). Delete the entire `forwardRef` definition.

- [ ] **Step 3: Locate and delete the inline `SexSelector` / `LifeStageSelector` / `BehaviorSelector` definitions and their icon helpers**

Read the icon helpers (originally `media.jsx:99-151`) and the three selector functions (originally `media.jsx:152-411`). Delete them all — they're now imported from `./ui/`.

- [ ] **Step 4: Delete the footer species-label buttons**

Locate `imageSpeciesLabelRef` and `videoSpeciesLabelRef` (around `media.jsx:1093-1094`) and the footer-row JSX block (around `media.jsx:2421-2480`). The footer species-label functionality is now in the rail. Two options:

- **a)** Delete the entire footer row that holds the filename + species label. Filename moves to the modal title bar (verify it's already there; if not, surface it by reading `media.jsx:1918+`).
- **b)** Keep the footer row but remove only the species-label button, leaving the filename pinned to the right.

Pick **(b)** — simpler and preserves filename visibility. Delete only the `<SpeciesLabel … />` `<button>` and surrounding wrapper, keep the filename.

Also delete `videoSpeciesLabelRef`, `imageSpeciesLabelRef`, and any code paths that reference them (search the file).

- [ ] **Step 5: Delete `handleImageWithoutBboxClick`**

It's referenced only by the now-removed footer buttons. Find with `grep -n "handleImageWithoutBboxClick" src/renderer/src/media.jsx`. Delete the definition and any remaining references.

- [ ] **Step 6: Sweep imports**

Search for now-unused imports in `media.jsx`:

```bash
grep -n "from 'lucide-react'" src/renderer/src/media.jsx
```

Likely `Pencil`, `Search`, `Plus`, `X`, `ChevronUp`, `ChevronDown`, `ChevronsUp`, sex/lifestage SVG-helper imports — anything that no longer has a referenced usage. For each one, run:

```bash
grep -c "<IconName" src/renderer/src/media.jsx
```

If 0, remove from the import list.

- [ ] **Step 7: Run tests and lint**

```bash
npm test
```

Expected: all existing tests pass (none were modified).

```bash
npx eslint src/renderer/src/media.jsx
```

Expected: no errors. Fix any unused-variable warnings.

- [ ] **Step 8: Manual smoke test**

Run: `npm run dev`. Quick walk-through:
- Image with bboxes: rail lists them, click row → expanded editor, edits save.
- Image with no observations: empty state appears, "+ Add observation" works for both options.
- Image with one whole-image observation: row expanded, "+ Add observation" affordance hidden.
- Video with observations: rail shows them; bbox overlay (read-only) on video unchanged.
- Drawing a new bbox: new row auto-selected.
- Deleting an observation: row vanishes; if it was selected, rail auto-selects the next.

Stop the dev server.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/media.jsx
git commit -m "refactor(media): remove popover ObservationEditor, BboxLabel, footer species labels"
```

---

## Task 14: Documentation updates

**Files:**
- Modify: `docs/architecture.md` (if relevant)

- [ ] **Step 1: Check whether `architecture.md` documents the modal layout**

```bash
grep -nE "ObservationEditor|BboxLabel|popover|annotation" docs/architecture.md
```

If matches exist, update them to describe the rail. If no matches, no changes needed for this file.

- [ ] **Step 2: Check the other docs flagged by `CLAUDE.md`**

The project's `CLAUDE.md` lists doc files to keep in sync. Run:

```bash
grep -lE "ObservationEditor|BboxLabel|footer species" docs/*.md
```

Update each match to describe the rail.

- [ ] **Step 3: Commit (if any docs changed)**

```bash
git add docs/
git commit -m "docs: describe ObservationRail in architecture overview"
```

If no docs changed, skip this commit.

---

## Self-review

**Spec coverage:**

| Spec section | Covered by |
|---|---|
| Mode invariant | Task 1 (helper), Task 7 (menu uses it), Task 9 (rail uses it) |
| Architecture (component tree) | Tasks 2–10 |
| Two-way coupling image ↔ rail | Task 10 step 4 |
| Save semantics | Tasks 5, 8 (committal species pick; live attribute saves) |
| Keyboard | Task 5 (picker keys); modal-level Esc inherited from existing code |
| Add-observation menu | Tasks 7 (component), 11 (whole-image wiring), 12 (draw wiring) |
| Density at scale (sticky focused row, compact rows) | Task 8 (sticky CSS, mini-badges) |
| Visual language (palette, type icons, accent stripe, pills) | Tasks 2, 3, 4, 5, 6, 8 |
| Empty state | Task 9 |
| BboxLabelMinimal | Task 6, Task 10 step 4 |
| Confidence + validation indicator in row | Task 8 |
| Mixed-mode handling (menu hidden) | Task 7 (returns null for mixed) |
| Out-of-scope items left untouched | EditableBbox, VideoBboxOverlay, gallery thumbs, schema, IPC |

No gaps.

**Placeholder scan:** spot-checked. No "TBD", "TODO", "implement later", "similar to Task N", or unspecified validation. The plan repeats code where each task uses it.

**Type / name consistency:**
- `selectedObservationId` used consistently across Tasks 9, 10.
- `onUpdateClassification(id, updates)` shape consistent: rail passes `id` as the observation's ID; rows omit the ID and let the rail bind it.
- `getMediaMode(observations)` returns `'empty' | 'bbox' | 'whole-image' | 'mixed'` — Tasks 7, 9 consume the same string set.
- `bboxes` variable: Task 10 step 3 acknowledges the rename ambiguity and tells the engineer to verify the source array.
