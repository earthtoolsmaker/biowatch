import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

import { transformClassString } from '../../scripts/theme-codemod.js'

describe('transformClassString', () => {
  test('bg-white → bg-card and flags review', () => {
    const { output, flags } = transformClassString('bg-white p-4')
    assert.equal(output, 'bg-card p-4')
    assert.deepEqual(flags, ['bg-white'])
  })

  test('text-gray-900 → text-foreground', () => {
    const { output } = transformClassString('text-gray-900 font-bold')
    assert.equal(output, 'text-foreground font-bold')
  })

  test('text-gray-500 → text-muted-foreground', () => {
    const { output } = transformClassString('text-gray-500')
    assert.equal(output, 'text-muted-foreground')
  })

  test('border-gray-200 → border-border', () => {
    const { output } = transformClassString('border border-gray-200')
    assert.equal(output, 'border border-border')
  })

  test('hover:bg-gray-100 → hover:bg-accent', () => {
    const { output } = transformClassString('hover:bg-gray-100')
    assert.equal(output, 'hover:bg-accent')
  })

  test('bg-blue-50 text-blue-700 keeps light + appends dark variants', () => {
    const { output } = transformClassString('bg-blue-50 text-blue-700')
    assert.equal(output, 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300')
  })

  test('bg-blue-600 text-white CTA keeps light + appends dark variants', () => {
    const { output } = transformClassString('bg-blue-600 text-white')
    assert.equal(output, 'bg-blue-600 text-white dark:bg-blue-500 dark:text-white')
  })

  test('bg-red-50 text-red-700 keeps light + appends dark variants', () => {
    const { output } = transformClassString('bg-red-50 text-red-700')
    assert.equal(output, 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300')
  })

  test('does not double-apply if dark variants already present', () => {
    const { output } = transformClassString(
      'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
    )
    assert.equal(output, 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300')
  })

  test('preserves unknown classes untouched', () => {
    const { output } = transformClassString('flex items-center gap-2 px-3')
    assert.equal(output, 'flex items-center gap-2 px-3')
  })

  test('handles multiple rules in one string', () => {
    const { output } = transformClassString(
      'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'
    )
    assert.equal(output, 'bg-card text-foreground border border-border hover:bg-accent')
  })

  test('hover:bg-blue-100 does not trigger bare bg-blue-100 pair', () => {
    // Regression: \\bbg-blue-100\\b would match inside hover:bg-blue-100,
    // producing a stray `dark:bg-blue-500/20` instead of the correct
    // `dark:hover:bg-blue-500/25`.
    const { output } = transformClassString('hover:bg-blue-100')
    assert.equal(output, 'hover:bg-blue-100 dark:hover:bg-blue-500/25')
  })

  test('text-blue-700 inside string-literal token (with trailing apostrophe)', () => {
    // Tokens from object-literal class strings can carry a trailing quote
    // when split by whitespace. Bare-pair lookup must strip it.
    const { output } = transformClassString("'bg-blue-50 text-blue-700'")
    assert.ok(output.includes('dark:bg-blue-500/15'))
    assert.ok(output.includes('dark:text-blue-300'))
  })

  test('idiom does not match inside hover: prefix', () => {
    // Regression: `\\bbg-blue-600 text-white\\b` matched inside
    // `hover:bg-blue-600 text-white`, producing two corrupting expansions.
    const { output } = transformClassString('bg-blue-500 hover:bg-blue-600 text-white')
    // Must NOT contain a stray `dark:bg-blue-500 dark:text-white` from
    // the bg-blue-600 text-white idiom expansion.
    const occurrences = (output.match(/dark:bg-blue-500\b/g) || []).length
    assert.equal(occurrences, 0, `output should not duplicate dark:bg-blue-500: ${output}`)
    // The bare-pair logic should still pair bg-blue-500 → dark:bg-blue-400
    // and hover:bg-blue-600 → dark:hover:bg-blue-500.
    assert.ok(output.includes('dark:bg-blue-400'))
    assert.ok(output.includes('dark:hover:bg-blue-500'))
  })
})
