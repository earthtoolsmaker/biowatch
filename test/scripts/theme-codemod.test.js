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
})
