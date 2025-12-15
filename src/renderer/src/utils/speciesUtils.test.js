import { describe, test, expect } from 'vitest'
import { isHumanOrVehicle, sortSpeciesHumansLast, getTopNonHumanSpecies } from './speciesUtils'

describe('isHumanOrVehicle', () => {
  describe('exact human matches', () => {
    test('returns true for Homo sapiens', () => {
      expect(isHumanOrVehicle('Homo sapiens')).toBe(true)
    })

    test('returns true for human (case insensitive)', () => {
      expect(isHumanOrVehicle('human')).toBe(true)
      expect(isHumanOrVehicle('Human')).toBe(true)
      expect(isHumanOrVehicle('HUMAN')).toBe(true)
    })

    test('returns true for person', () => {
      expect(isHumanOrVehicle('person')).toBe(true)
      expect(isHumanOrVehicle('Person')).toBe(true)
    })

    test('returns true for people', () => {
      expect(isHumanOrVehicle('people')).toBe(true)
    })
  })

  describe('exact vehicle matches', () => {
    test('returns true for vehicle', () => {
      expect(isHumanOrVehicle('vehicle')).toBe(true)
      expect(isHumanOrVehicle('Vehicle')).toBe(true)
    })

    test('returns true for car', () => {
      expect(isHumanOrVehicle('car')).toBe(true)
      expect(isHumanOrVehicle('Car')).toBe(true)
    })

    test('returns true for truck', () => {
      expect(isHumanOrVehicle('truck')).toBe(true)
    })

    test('returns true for motorcycle', () => {
      expect(isHumanOrVehicle('motorcycle')).toBe(true)
    })

    test('returns true for bike and bicycle', () => {
      expect(isHumanOrVehicle('bike')).toBe(true)
      expect(isHumanOrVehicle('bicycle')).toBe(true)
    })
  })

  describe('partial matches', () => {
    test('returns true for strings containing human', () => {
      expect(isHumanOrVehicle('Human activity')).toBe(true)
      expect(isHumanOrVehicle('Non-human primate')).toBe(true)
    })

    test('returns true for strings containing person', () => {
      expect(isHumanOrVehicle('Unknown person')).toBe(true)
    })

    test('returns true for strings containing vehicle', () => {
      expect(isHumanOrVehicle('Motor vehicle')).toBe(true)
      expect(isHumanOrVehicle('Unknown vehicle')).toBe(true)
    })
  })

  describe('regular species (should return false)', () => {
    test('returns false for common animal species', () => {
      expect(isHumanOrVehicle('Vulpes vulpes')).toBe(false)
      expect(isHumanOrVehicle('Canis lupus')).toBe(false)
      expect(isHumanOrVehicle('Ursus arctos')).toBe(false)
      expect(isHumanOrVehicle('Cervus elaphus')).toBe(false)
    })

    test('returns false for bird species', () => {
      expect(isHumanOrVehicle('Aquila chrysaetos')).toBe(false)
      expect(isHumanOrVehicle('Strix aluco')).toBe(false)
    })

    test('returns false for null or undefined', () => {
      expect(isHumanOrVehicle(null)).toBe(false)
      expect(isHumanOrVehicle(undefined)).toBe(false)
    })

    test('returns false for empty string', () => {
      expect(isHumanOrVehicle('')).toBe(false)
    })
  })
})

describe('sortSpeciesHumansLast', () => {
  test('sorts humans/vehicles to bottom while maintaining count order', () => {
    const data = [
      { scientificName: 'Homo sapiens', count: 100 },
      { scientificName: 'Vulpes vulpes', count: 50 },
      { scientificName: 'Canis lupus', count: 30 }
    ]
    const sorted = sortSpeciesHumansLast(data)

    expect(sorted[0].scientificName).toBe('Vulpes vulpes')
    expect(sorted[1].scientificName).toBe('Canis lupus')
    expect(sorted[2].scientificName).toBe('Homo sapiens')
  })

  test('maintains count order within regular species', () => {
    const data = [
      { scientificName: 'Canis lupus', count: 30 },
      { scientificName: 'Vulpes vulpes', count: 50 },
      { scientificName: 'Ursus arctos', count: 10 }
    ]
    const sorted = sortSpeciesHumansLast(data)

    expect(sorted[0].scientificName).toBe('Vulpes vulpes')
    expect(sorted[1].scientificName).toBe('Canis lupus')
    expect(sorted[2].scientificName).toBe('Ursus arctos')
  })

  test('maintains count order within humans/vehicles at bottom', () => {
    const data = [
      { scientificName: 'Vehicle', count: 20 },
      { scientificName: 'Homo sapiens', count: 100 },
      { scientificName: 'Vulpes vulpes', count: 50 }
    ]
    const sorted = sortSpeciesHumansLast(data)

    expect(sorted[0].scientificName).toBe('Vulpes vulpes')
    expect(sorted[1].scientificName).toBe('Homo sapiens')
    expect(sorted[2].scientificName).toBe('Vehicle')
  })

  test('does not mutate original array', () => {
    const data = [
      { scientificName: 'Homo sapiens', count: 100 },
      { scientificName: 'Vulpes vulpes', count: 50 }
    ]
    const original = [...data]
    sortSpeciesHumansLast(data)

    expect(data[0].scientificName).toBe(original[0].scientificName)
    expect(data[1].scientificName).toBe(original[1].scientificName)
  })

  test('handles empty array', () => {
    expect(sortSpeciesHumansLast([])).toEqual([])
  })

  test('handles null/undefined', () => {
    expect(sortSpeciesHumansLast(null)).toEqual([])
    expect(sortSpeciesHumansLast(undefined)).toEqual([])
  })
})

describe('getTopNonHumanSpecies', () => {
  test('returns top N non-human species by count', () => {
    const data = [
      { scientificName: 'Homo sapiens', count: 100 },
      { scientificName: 'Vulpes vulpes', count: 50 },
      { scientificName: 'Canis lupus', count: 30 },
      { scientificName: 'Ursus arctos', count: 20 }
    ]
    const top2 = getTopNonHumanSpecies(data, 2)

    expect(top2).toHaveLength(2)
    expect(top2[0].scientificName).toBe('Vulpes vulpes')
    expect(top2[1].scientificName).toBe('Canis lupus')
  })

  test('excludes all human/vehicle categories', () => {
    const data = [
      { scientificName: 'Homo sapiens', count: 100 },
      { scientificName: 'Vehicle', count: 80 },
      { scientificName: 'Car', count: 60 },
      { scientificName: 'Vulpes vulpes', count: 50 },
      { scientificName: 'Human activity', count: 40 }
    ]
    const top2 = getTopNonHumanSpecies(data, 2)

    expect(top2).toHaveLength(1)
    expect(top2[0].scientificName).toBe('Vulpes vulpes')
  })

  test('defaults to returning 2 species', () => {
    const data = [
      { scientificName: 'Vulpes vulpes', count: 50 },
      { scientificName: 'Canis lupus', count: 30 },
      { scientificName: 'Ursus arctos', count: 20 }
    ]
    const result = getTopNonHumanSpecies(data)

    expect(result).toHaveLength(2)
  })

  test('handles case where N exceeds available species', () => {
    const data = [
      { scientificName: 'Homo sapiens', count: 100 },
      { scientificName: 'Vulpes vulpes', count: 50 }
    ]
    const result = getTopNonHumanSpecies(data, 5)

    expect(result).toHaveLength(1)
    expect(result[0].scientificName).toBe('Vulpes vulpes')
  })

  test('handles empty array', () => {
    expect(getTopNonHumanSpecies([], 2)).toEqual([])
  })

  test('handles null/undefined', () => {
    expect(getTopNonHumanSpecies(null, 2)).toEqual([])
    expect(getTopNonHumanSpecies(undefined, 2)).toEqual([])
  })
})
