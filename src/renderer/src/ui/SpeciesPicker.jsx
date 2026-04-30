import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, X, Plus } from 'lucide-react'
import { searchSpecies } from '../utils/dictionarySearch'

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
  onSelect,
  onMarkBlank,
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
      <div className="relative">
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

        {debouncedSearch.trim().length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 z-20 max-h-52 overflow-y-auto border border-gray-200 rounded bg-white shadow-lg">
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
        )}
      </div>

      {currentScientificName && (
        <button
          type="button"
          onClick={onMarkBlank}
          className="self-start mt-2 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-[#030213] hover:bg-gray-100 px-2 py-1 rounded transition-colors"
          title="Clear species classification"
        >
          <X size={12} />
          Mark as blank
        </button>
      )}
    </div>
  )
}
