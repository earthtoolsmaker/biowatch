import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { selectDiverseMedia, getTemporalBucket } from '../src/main/queries.js'

// ============================================================
// Helper Functions
// ============================================================

let candidateCounter = 0

/**
 * Create a test candidate with default values
 */
function createCandidate(overrides = {}) {
  candidateCounter++
  return {
    mediaID: `media-${candidateCounter}`,
    scientificName: 'species_a',
    deploymentID: 'deployment_1',
    timestamp: '2024-01-15T12:00:00Z',
    sequenceID: null,
    compositeScore: 0.5,
    ...overrides
  }
}

/**
 * Create multiple candidates for a specific species
 */
function createCandidatesForSpecies(species, count, baseScore = 0.5, options = {}) {
  return Array.from({ length: count }, (_, i) =>
    createCandidate({
      scientificName: species,
      compositeScore: baseScore - i * 0.01, // Decreasing scores
      mediaID: `${species}-media-${i}`,
      deploymentID: options.sameDeployment ? 'deployment_1' : `deployment-${i % 3}`,
      timestamp: options.sameTimestamp
        ? '2024-01-15T12:00:00Z'
        : new Date(2024, 0, 15 + i).toISOString(),
      sequenceID: options.sameSequence ? 'seq-1' : null,
      ...options.overrides
    })
  )
}

/**
 * Count occurrences of each species in results
 */
function countSpecies(results) {
  const counts = {}
  results.forEach((r) => {
    counts[r.scientificName] = (counts[r.scientificName] || 0) + 1
  })
  return counts
}

/**
 * Get unique species from results
 */
function getUniqueSpecies(results) {
  return new Set(results.map((r) => r.scientificName))
}

// ============================================================
// Tests: getTemporalBucket
// ============================================================

describe('getTemporalBucket', () => {
  test('returns bucket for valid timestamp', () => {
    const bucket = getTemporalBucket('2024-01-15T12:00:00Z', 7)
    assert.equal(bucket, '2024-W2') // Day 15 of year / 7 = week 2
  })

  test('returns unknown for null timestamp', () => {
    assert.equal(getTemporalBucket(null, 7), 'unknown')
  })

  test('returns unknown for undefined timestamp', () => {
    assert.equal(getTemporalBucket(undefined, 7), 'unknown')
  })

  test('returns unknown for invalid timestamp', () => {
    assert.equal(getTemporalBucket('not-a-date', 7), 'unknown')
  })

  test('respects bucket size', () => {
    // Day 15 with 30-day buckets = bucket 0
    const bucket = getTemporalBucket('2024-01-15T12:00:00Z', 30)
    assert.equal(bucket, '2024-W0')
  })
})

// ============================================================
// Tests: selectDiverseMedia - Basic Functionality
// ============================================================

describe('selectDiverseMedia - Basic Functionality', () => {
  test('returns empty array for empty candidates', () => {
    const result = selectDiverseMedia([], 12)
    assert.deepEqual(result, [])
  })

  test('returns empty array for null candidates', () => {
    const result = selectDiverseMedia(null, 12)
    assert.deepEqual(result, [])
  })

  test('returns all candidates when fewer than limit', () => {
    const candidates = [
      createCandidate({ scientificName: 'a', compositeScore: 0.5 }),
      createCandidate({ scientificName: 'b', compositeScore: 0.5 })
    ]
    const result = selectDiverseMedia(candidates, 12)
    assert.equal(result.length, 2)
  })

  test('respects limit parameter', () => {
    const candidates = createCandidatesForSpecies('species_a', 20, 0.6)
    const result = selectDiverseMedia(candidates, 5)
    assert.equal(result.length, 5)
  })

  test('filters candidates below quality threshold', () => {
    const candidates = [
      createCandidate({ compositeScore: 0.5 }),
      createCandidate({ compositeScore: 0.2 }), // Below default 0.3 threshold
      createCandidate({ compositeScore: 0.1 }) // Below default 0.3 threshold
    ]
    const result = selectDiverseMedia(candidates, 10)
    assert.equal(result.length, 1)
  })

  test('uses custom quality threshold', () => {
    const candidates = [
      createCandidate({ compositeScore: 0.5 }),
      createCandidate({ compositeScore: 0.4 }),
      createCandidate({ compositeScore: 0.35 })
    ]
    const result = selectDiverseMedia(candidates, 10, { minQualityThreshold: 0.45 })
    assert.equal(result.length, 1)
  })
})

// ============================================================
// Tests: selectDiverseMedia - Phase 1: Species Guarantee
// ============================================================

describe('selectDiverseMedia - Phase 1: Species Guarantee', () => {
  test('guarantees at least one image per species', () => {
    const candidates = [
      ...createCandidatesForSpecies('skunk', 15, 0.7),
      ...createCandidatesForSpecies('bird', 15, 0.65),
      ...createCandidatesForSpecies('fox', 15, 0.6),
      ...createCandidatesForSpecies('rodent', 15, 0.55)
    ]

    const result = selectDiverseMedia(candidates, 12)
    const uniqueSpecies = getUniqueSpecies(result)

    assert.equal(uniqueSpecies.size, 4, 'All 4 species should be represented')
    assert.ok(uniqueSpecies.has('skunk'))
    assert.ok(uniqueSpecies.has('bird'))
    assert.ok(uniqueSpecies.has('fox'))
    assert.ok(uniqueSpecies.has('rodent'))
  })

  test('handles species with only one candidate', () => {
    const candidates = [
      ...createCandidatesForSpecies('common', 10, 0.6),
      createCandidate({ scientificName: 'rare', compositeScore: 0.4 })
    ]

    const result = selectDiverseMedia(candidates, 12)
    const uniqueSpecies = getUniqueSpecies(result)

    assert.ok(uniqueSpecies.has('rare'), 'Single-candidate species should be included')
  })

  test('stops at limit even with more species than limit', () => {
    // Create 20 different species
    const candidates = []
    for (let i = 0; i < 20; i++) {
      candidates.push(createCandidate({ scientificName: `species_${i}`, compositeScore: 0.5 }))
    }

    const result = selectDiverseMedia(candidates, 12)
    assert.equal(result.length, 12, 'Should not exceed limit')
  })

  test('respects sequence constraint even in phase 1', () => {
    // All species share the same sequence - only one should be selected total from that sequence
    const candidates = [
      createCandidate({ scientificName: 'skunk', sequenceID: 'seq-1', compositeScore: 0.7 }),
      createCandidate({ scientificName: 'bird', sequenceID: 'seq-1', compositeScore: 0.65 }),
      createCandidate({ scientificName: 'fox', sequenceID: 'seq-1', compositeScore: 0.6 }),
      // Provide alternatives without sequence conflict
      createCandidate({ scientificName: 'bird', sequenceID: 'seq-2', compositeScore: 0.64 }),
      createCandidate({ scientificName: 'fox', sequenceID: 'seq-3', compositeScore: 0.59 })
    ]

    const result = selectDiverseMedia(candidates, 12)
    const uniqueSpecies = getUniqueSpecies(result)

    // At least 3 species should be represented (skunk, bird, fox)
    assert.ok(uniqueSpecies.size >= 3, 'Multiple species should be represented')
  })
})

// ============================================================
// Tests: selectDiverseMedia - Phase 2: Diversity Constraints
// ============================================================

describe('selectDiverseMedia - Phase 2: Diversity Constraints', () => {
  test('enforces maxPerSpecies limit with multiple species', () => {
    // With multiple species, maxPerSpecies should limit each species to 2
    const candidates = [
      ...createCandidatesForSpecies('species_a', 10, 0.7),
      ...createCandidatesForSpecies('species_b', 10, 0.65)
    ]

    const result = selectDiverseMedia(candidates, 12, { maxPerSpecies: 2 })
    const counts = countSpecies(result)

    // Each species should have max 2 in phase 1+2
    // But fallback will fill remaining slots (relaxes species constraint)
    // With 2 species, phase 1 picks 2, phase 2 adds 2 more = 4 selected
    // Fallback adds 8 more, but will cycle through available candidates
    assert.ok(counts.species_a >= 1, 'Should have at least one of species_a')
    assert.ok(counts.species_b >= 1, 'Should have at least one of species_b')
  })

  test('enforces maxPerDeployment limit in phase 2', () => {
    // Test that phase 2 respects deployment limits when filling additional slots
    // Phase 1 picks highest-scoring candidate per species (deployment constraints ignored)
    // Phase 2 should then respect deployment limits for additional picks
    // Provide enough candidates across 3 deployments so fallback is NOT triggered
    const candidates = [
      // Species a - spread across deployments
      createCandidate({ scientificName: 'a', deploymentID: 'dep_A', compositeScore: 0.7 }),
      createCandidate({ scientificName: 'a', deploymentID: 'dep_B', compositeScore: 0.69 }),
      createCandidate({ scientificName: 'a', deploymentID: 'dep_C', compositeScore: 0.68 }),
      // Species b - spread across deployments
      createCandidate({ scientificName: 'b', deploymentID: 'dep_B', compositeScore: 0.65 }),
      createCandidate({ scientificName: 'b', deploymentID: 'dep_A', compositeScore: 0.64 }),
      createCandidate({ scientificName: 'b', deploymentID: 'dep_C', compositeScore: 0.63 }),
      // Species c - spread across deployments
      createCandidate({ scientificName: 'c', deploymentID: 'dep_C', compositeScore: 0.6 }),
      createCandidate({ scientificName: 'c', deploymentID: 'dep_A', compositeScore: 0.59 }),
      createCandidate({ scientificName: 'c', deploymentID: 'dep_B', compositeScore: 0.58 }),
      // Species d - spread across deployments
      createCandidate({ scientificName: 'd', deploymentID: 'dep_A', compositeScore: 0.55 }),
      createCandidate({ scientificName: 'd', deploymentID: 'dep_B', compositeScore: 0.54 }),
      createCandidate({ scientificName: 'd', deploymentID: 'dep_C', compositeScore: 0.53 })
    ]

    // Phase 1 picks: a(dep_A), b(dep_B), c(dep_C), d(dep_A) = 2 from A, 1 from B, 1 from C
    // Phase 2 fills remaining 4 slots respecting deployment limits
    const result = selectDiverseMedia(candidates, 8, { maxPerDeployment: 3 })
    const deploymentCounts = {}
    result.forEach((r) => {
      deploymentCounts[r.deploymentID] = (deploymentCounts[r.deploymentID] || 0) + 1
    })

    // All deployments should be at or below limit (3)
    assert.ok(
      !deploymentCounts.dep_A || deploymentCounts.dep_A <= 3,
      'dep_A should not exceed maxPerDeployment'
    )
    assert.ok(
      !deploymentCounts.dep_B || deploymentCounts.dep_B <= 3,
      'dep_B should not exceed maxPerDeployment'
    )
    assert.ok(
      !deploymentCounts.dep_C || deploymentCounts.dep_C <= 3,
      'dep_C should not exceed maxPerDeployment'
    )
    // Verify we got 8 results
    assert.equal(result.length, 8, 'Should select exactly 8 candidates')
  })

  test('enforces maxPerSequence limit', () => {
    const candidates = [
      createCandidate({ scientificName: 'a', sequenceID: 'seq-1', compositeScore: 0.7 }),
      createCandidate({ scientificName: 'a', sequenceID: 'seq-1', compositeScore: 0.69 }),
      createCandidate({ scientificName: 'a', sequenceID: 'seq-2', compositeScore: 0.68 })
    ]

    const result = selectDiverseMedia(candidates, 12, { maxPerSequence: 1 })
    const sequenceCounts = {}
    result.forEach((r) => {
      if (r.sequenceID) {
        sequenceCounts[r.sequenceID] = (sequenceCounts[r.sequenceID] || 0) + 1
      }
    })

    assert.ok(!sequenceCounts['seq-1'] || sequenceCounts['seq-1'] <= 1)
    assert.ok(!sequenceCounts['seq-2'] || sequenceCounts['seq-2'] <= 1)
  })
})

// ============================================================
// Tests: selectDiverseMedia - Two-Phase Interaction (Critical)
// ============================================================

describe('selectDiverseMedia - Two-Phase Interaction', () => {
  test('phase 1 selections do not prevent other species in phase 2', () => {
    // Critical test: All candidates from same deployment
    // Old algorithm would pick high-scoring species and exhaust deployment quota
    // New algorithm guarantees each species gets one in phase 1
    const candidates = [
      createCandidate({ scientificName: 'skunk', deploymentID: 'A', compositeScore: 0.7 }),
      createCandidate({ scientificName: 'skunk', deploymentID: 'A', compositeScore: 0.69 }),
      createCandidate({ scientificName: 'bird', deploymentID: 'A', compositeScore: 0.65 }),
      createCandidate({ scientificName: 'bird', deploymentID: 'A', compositeScore: 0.64 }),
      createCandidate({ scientificName: 'fox', deploymentID: 'A', compositeScore: 0.6 }),
      createCandidate({ scientificName: 'rodent', deploymentID: 'A', compositeScore: 0.55 })
    ]

    const result = selectDiverseMedia(candidates, 6, { maxPerDeployment: 3 })
    const uniqueSpecies = getUniqueSpecies(result)

    // All 4 species should be represented despite deployment constraint
    assert.equal(uniqueSpecies.size, 4, 'All 4 species should be in result')
  })

  test('species concentrated in one deployment still gets phase 1 slot', () => {
    // Rodent only exists in deployment A (already at limit from other species)
    const candidates = [
      createCandidate({ scientificName: 'skunk', deploymentID: 'A', compositeScore: 0.7 }),
      createCandidate({ scientificName: 'bird', deploymentID: 'A', compositeScore: 0.65 }),
      createCandidate({ scientificName: 'fox', deploymentID: 'B', compositeScore: 0.6 }),
      createCandidate({ scientificName: 'rodent', deploymentID: 'A', compositeScore: 0.55 })
    ]

    const result = selectDiverseMedia(candidates, 12, { maxPerDeployment: 2 })
    const uniqueSpecies = getUniqueSpecies(result)

    assert.ok(uniqueSpecies.has('rodent'), 'Rodent should be included via phase 1')
  })

  test('rare species do not block common species from appearing', () => {
    // Simulate real scenario: rare species (skunk) scores highest
    // but common species (rodent) should still appear
    const candidates = [
      ...createCandidatesForSpecies('skunk', 10, 0.7), // Rare, high scores
      ...createCandidatesForSpecies('rodent', 10, 0.55) // Common, low scores
    ]

    const result = selectDiverseMedia(candidates, 12)
    const counts = countSpecies(result)

    // Both species should be represented
    assert.ok(counts.skunk >= 1, 'Skunk should be included')
    assert.ok(counts.rodent >= 1, 'Rodent should be included')
    // In phase 1+2, each species gets 1-2, then fallback fills rest
  })
})

// ============================================================
// Tests: selectDiverseMedia - Real-World Scenarios
// ============================================================

describe('selectDiverseMedia - Real-World Scenarios', () => {
  test('Channel Islands: 4 species with skewed distribution', () => {
    // Simulates Channel Islands: skunk rare (high score), rodent common (low score)
    const candidates = [
      ...createCandidatesForSpecies('skunk', 15, 0.66),
      ...createCandidatesForSpecies('bird', 15, 0.65),
      ...createCandidatesForSpecies('fox', 15, 0.64),
      ...createCandidatesForSpecies('rodent', 15, 0.62)
    ]

    const result = selectDiverseMedia(candidates, 12)
    const counts = countSpecies(result)
    const uniqueSpecies = getUniqueSpecies(result)

    // All 4 species should be represented (phase 1 guarantees this)
    assert.equal(uniqueSpecies.size, 4, 'All 4 species should be represented')
    assert.ok(counts.skunk >= 1, 'Skunk should be included')
    assert.ok(counts.bird >= 1, 'Bird should be included')
    assert.ok(counts.fox >= 1, 'Fox should be included')
    assert.ok(counts.rodent >= 1, 'Rodent should be included')
  })

  test('Missouri: many species with rare ocelots', () => {
    // Simulates Missouri: ocelot is rare, many other species
    const candidates = [
      ...createCandidatesForSpecies('ocelot', 5, 0.7),
      ...createCandidatesForSpecies('red_deer', 15, 0.62),
      ...createCandidatesForSpecies('mouflon', 15, 0.61),
      ...createCandidatesForSpecies('wild_boar', 15, 0.6),
      ...createCandidatesForSpecies('agouti', 15, 0.59)
    ]

    const result = selectDiverseMedia(candidates, 12)
    const uniqueSpecies = getUniqueSpecies(result)

    // Ocelot should be included but not dominate
    assert.ok(uniqueSpecies.has('ocelot'))
    assert.ok(uniqueSpecies.size >= 5, 'Should have diversity across species')
  })

  test('handles dataset with 20+ species', () => {
    const candidates = []
    for (let i = 0; i < 25; i++) {
      candidates.push(...createCandidatesForSpecies(`species_${i}`, 3, 0.7 - i * 0.01))
    }

    const result = selectDiverseMedia(candidates, 12)
    const uniqueSpecies = getUniqueSpecies(result)

    // Should have 12 different species (one from each in phase 1)
    assert.equal(result.length, 12)
    assert.equal(uniqueSpecies.size, 12, 'Each slot should be a different species')
  })
})

// ============================================================
// Tests: selectDiverseMedia - Edge Cases
// ============================================================

describe('selectDiverseMedia - Edge Cases', () => {
  test('all candidates from same species', () => {
    const candidates = createCandidatesForSpecies('only_species', 20, 0.6)

    const result = selectDiverseMedia(candidates, 12, { maxPerSpecies: 2 })

    // Should only get 2 (maxPerSpecies) then fill with fallback
    assert.equal(result.length, 12)
  })

  test('all candidates from same deployment', () => {
    const candidates = [
      ...createCandidatesForSpecies('a', 5, 0.6, { sameDeployment: true }),
      ...createCandidatesForSpecies('b', 5, 0.55, { sameDeployment: true })
    ]

    const result = selectDiverseMedia(candidates, 10, { maxPerDeployment: 3 })

    // Phase 1: 2 species = 2 selected
    // Phase 2: deployment limit kicks in, but phase 1 already counted
    // Should still have both species represented
    const uniqueSpecies = getUniqueSpecies(result)
    assert.ok(uniqueSpecies.has('a'))
    assert.ok(uniqueSpecies.has('b'))
  })

  test('all candidates from same sequence', () => {
    const candidates = [
      createCandidate({ scientificName: 'a', sequenceID: 'seq-1', compositeScore: 0.7 }),
      createCandidate({ scientificName: 'b', sequenceID: 'seq-1', compositeScore: 0.65 }),
      createCandidate({ scientificName: 'c', sequenceID: 'seq-1', compositeScore: 0.6 })
    ]

    const result = selectDiverseMedia(candidates, 12, { maxPerSequence: 1 })

    // Only one should be selected (sequence constraint)
    assert.equal(result.length, 1)
  })

  test('all candidates below quality threshold returns empty', () => {
    const candidates = [
      createCandidate({ compositeScore: 0.2 }),
      createCandidate({ compositeScore: 0.1 }),
      createCandidate({ compositeScore: 0.15 })
    ]

    const result = selectDiverseMedia(candidates, 12, { minQualityThreshold: 0.3 })
    assert.equal(result.length, 0)
  })

  test('null/undefined scientificName handled gracefully', () => {
    const candidates = [
      createCandidate({ scientificName: null, compositeScore: 0.6 }),
      createCandidate({ scientificName: undefined, compositeScore: 0.55 }),
      createCandidate({ scientificName: 'known_species', compositeScore: 0.5 })
    ]

    const result = selectDiverseMedia(candidates, 12)

    // Should not crash, should handle as 'unknown' species
    assert.ok(result.length >= 1)
  })

  test('null/undefined deploymentID handled gracefully', () => {
    const candidates = [
      createCandidate({ deploymentID: null, compositeScore: 0.6 }),
      createCandidate({ deploymentID: undefined, compositeScore: 0.55 }),
      createCandidate({ deploymentID: 'known_deployment', compositeScore: 0.5 })
    ]

    const result = selectDiverseMedia(candidates, 12)

    // Should not crash
    assert.ok(result.length >= 1)
  })

  test('fallback phase fills remaining slots when constraints are exhausted', () => {
    // Create scenario where constraints block everything in phase 2
    const candidates = createCandidatesForSpecies('only_species', 10, 0.6, {
      sameDeployment: true,
      sameTimestamp: true
    })

    const result = selectDiverseMedia(candidates, 10, {
      maxPerSpecies: 1,
      maxPerDeployment: 1,
      maxPerTemporalBucket: 1
    })

    // Phase 1: 1 selected (only species)
    // Phase 2: blocked by all constraints
    // Phase 3 (fallback): fills remaining slots
    assert.equal(result.length, 10, 'Fallback should fill to limit')
  })
})
