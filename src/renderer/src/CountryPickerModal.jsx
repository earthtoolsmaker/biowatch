import { useState, useEffect } from 'react'
import { countries, DEFAULT_COUNTRY } from '../../shared/countries.js'

function CountryPickerModal({ isOpen, onConfirm, onCancel }) {
  const [selectedCountry, setSelectedCountry] = useState(DEFAULT_COUNTRY)
  const [searchTerm, setSearchTerm] = useState('')

  const filteredCountries = countries.filter(
    (country) =>
      country.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      country.code.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // Handle Escape key
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onCancel])

  const handleConfirm = () => {
    onConfirm(selectedCountry)
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onCancel}
    >
      <div
        className="bg-card rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">Select Country for SpeciesNet</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Choose the country to optimize species predictions for your region
          </p>
        </div>

        <div className="px-6 py-4 border-b border-border">
          <input
            type="text"
            placeholder="Search countries..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-2 max-h-64">
            {filteredCountries.map((country) => (
              <label
                key={country.code}
                className="flex items-center space-x-3 cursor-pointer hover:bg-accent p-2 rounded"
              >
                <input
                  type="radio"
                  name="country"
                  value={country.code}
                  checked={selectedCountry === country.code}
                  onChange={() => setSelectedCountry(country.code)}
                  className="text-blue-600 focus:ring-blue-500 dark:text-blue-400"
                />
                <div className="flex-1">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium text-foreground">{country.name}</span>
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
                      {country.code}
                    </span>
                  </div>
                </div>
              </label>
            ))}
          </div>
          {filteredCountries.length === 0 && (
            <p className="text-muted-foreground text-center py-4">
              No countries found matching your search.
            </p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex justify-end space-x-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-foreground bg-muted hover:bg-accent rounded-md transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            Start Import
          </button>
        </div>
      </div>
    </div>
  )
}

export default CountryPickerModal
