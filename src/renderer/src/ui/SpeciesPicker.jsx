import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, Plus } from 'lucide-react'
import { searchSpecies } from '../utils/dictionarySearch'
import { formatScientificName } from '../utils/scientificName'
import { resolveCommonName } from '../../../shared/commonNames/index.js'

/**
 * Species picker for one observation.
 *
 * Behavior:
 *  - Search input with 150ms debounce, fuzzy-matched against study species
 *    and the bundled dictionary (3+ chars).
 *  - Keyboard navigation: ↑/↓ moves highlight, Enter commits.
 *  - Custom-species fallback when the query has no results.
 *  - Browse mode (`initialBrowse`): on mount, dropdown is open with the empty
 *    query showing the full study species list and the current species
 *    pre-highlighted. Ends on first keystroke, Escape, or pick.
 *
 * Saves are committal: clicking a result or pressing Enter calls
 * onSelect(scientificName, commonName) and the parent collapses the picker.
 */
export default function SpeciesPicker({
  studyId,
  currentScientificName,
  onSelect,
  autoFocus = true,
  initialBrowse = false
}) {
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [browseOpen, setBrowseOpen] = useState(initialBrowse)
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
    if ((autoFocus || initialBrowse) && inputRef.current) inputRef.current.focus()
  }, [autoFocus, initialBrowse])

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(searchTerm), 150)
    return () => clearTimeout(handle)
  }, [searchTerm])

  const results = useMemo(() => {
    const base = searchSpecies(debouncedSearch, speciesList)
    // In browse mode with an empty query, pin the current species to the top
    // so it acts as a clear "this is what's set" anchor with alternatives
    // listed below. Once the user types, fall back to natural relevance order
    // — pinning would otherwise fight the search ranking.
    if (!browseOpen || debouncedSearch.trim().length > 0 || !currentScientificName) {
      return base
    }
    const idx = base.findIndex((s) => s.scientificName === currentScientificName)
    if (idx <= 0) return base
    return [base[idx], ...base.slice(0, idx), ...base.slice(idx + 1)]
  }, [debouncedSearch, speciesList, browseOpen, currentScientificName])

  const customSpeciesQuery = useMemo(
    () => debouncedSearch.trim().replace(/\s+/g, ' '),
    [debouncedSearch]
  )

  useEffect(() => {
    rowRefs.current.length = results.length
    if (results.length === 0) {
      setHighlightedIndex(-1)
      return
    }
    if (browseOpen && currentScientificName) {
      const idx = results.findIndex((s) => s.scientificName === currentScientificName)
      setHighlightedIndex(idx >= 0 ? idx : 0)
      return
    }
    setHighlightedIndex(0)
  }, [results, browseOpen, currentScientificName])

  useEffect(() => {
    if (highlightedIndex < 0) return
    const node = rowRefs.current[highlightedIndex]
    if (node) node.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex])

  // Wraps the parent's onSelect to immediately clear the search and refocus the
  // input. Clearing the search collapses the results dropdown — that is the
  // primary visual confirmation that the click registered.
  const handleSelect = (scientificName, commonName) => {
    setSearchTerm('')
    setDebouncedSearch('')
    setBrowseOpen(false)
    onSelect(scientificName, commonName)
    if (inputRef.current) inputRef.current.focus()
  }

  return (
    <div className="relative">
      <Search
        size={14}
        className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={inputRef}
        type="text"
        value={searchTerm}
        onChange={(e) => {
          setSearchTerm(e.target.value)
          setBrowseOpen(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Backspace' || e.key === 'Delete') {
            e.stopPropagation()
            return
          }
          if (e.key === 'Escape') {
            e.stopPropagation()
            if (searchTerm.length > 0) {
              // First Esc: clear the search query (collapses the dropdown).
              setSearchTerm('')
              setBrowseOpen(false)
            } else if (browseOpen) {
              // Browse-mode dropdown is open with empty input — close it
              // before letting subsequent Escape blur the input.
              setBrowseOpen(false)
            } else {
              // Second Esc (empty search): blur so the modal handler can act.
              e.currentTarget.blur()
            }
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
              handleSelect(picked.scientificName, picked.commonName)
              return
            }
            if (results.length === 0 && customSpeciesQuery.length >= 3) {
              e.preventDefault()
              handleSelect(customSpeciesQuery, null)
            }
          }
        }}
        placeholder="Search species…"
        className="w-full pl-7 pr-2 py-1.5 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-transparent"
      />

      {(debouncedSearch.trim().length > 0 || browseOpen) && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-52 overflow-y-auto border border-border rounded bg-card shadow-lg">
          {results.map((species, index) => (
            <button
              key={species.scientificName}
              type="button"
              ref={(node) => {
                rowRefs.current[index] = node
              }}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => handleSelect(species.scientificName, species.commonName)}
              className={`w-full px-3 py-1.5 text-left flex items-center justify-between ${
                index === highlightedIndex ? 'bg-[#f8f9fb] dark:bg-accent' : ''
              } ${species.scientificName === currentScientificName ? 'bg-gray-100 dark:bg-muted' : ''}`}
            >
              {(() => {
                // Prefer the dictionary's curated common name over whatever
                // the importer happened to drop in observations.commonName
                // (LILA stores the snake_case category there, e.g.
                // "yellow_baboon"). Falls through to the DB value, then to
                // the scientific name.
                const dictCommon = resolveCommonName(species.scientificName)
                const resolvedCommon = dictCommon || species.commonName
                const showSci = resolvedCommon && resolvedCommon !== species.scientificName
                const display = resolvedCommon || formatScientificName(species.scientificName)
                return (
                  <div className="min-w-0 truncate">
                    <span className={`text-sm font-medium ${showSci ? 'capitalize' : 'italic'}`}>
                      {display}
                    </span>
                    {showSci && (
                      <span className="text-xs text-muted-foreground ml-2 italic normal-case">
                        ({formatScientificName(species.scientificName)})
                      </span>
                    )}
                  </div>
                )
              })()}
              {species.inStudy !== false && typeof species.observationCount === 'number' && (
                <span className="flex items-center gap-1 text-xs text-muted-foreground shrink-0 ml-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-foreground" aria-hidden="true" />
                  {species.observationCount}
                </span>
              )}
            </button>
          ))}

          {results.length === 0 &&
            debouncedSearch.trim().length > 0 &&
            debouncedSearch.trim().length < 3 && (
              <div className="px-3 py-3 text-sm text-muted-foreground text-center">
                Type at least 3 characters to search the species dictionary.
              </div>
            )}

          {results.length === 0 && customSpeciesQuery.length >= 3 && (
            <div className="px-3 py-3 text-center space-y-2">
              <p className="text-sm text-muted-foreground">No species found.</p>
              <button
                type="button"
                onClick={() => handleSelect(customSpeciesQuery, null)}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-sm rounded bg-foreground text-background hover:bg-foreground/80 max-w-full"
              >
                <Plus size={14} className="shrink-0" />
                <span className="truncate">
                  Add &ldquo;{customSpeciesQuery}&rdquo; as custom species
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
