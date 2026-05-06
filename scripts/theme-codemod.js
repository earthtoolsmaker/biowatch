#!/usr/bin/env node
/**
 * Theme migration codemod.
 *
 * Walks .jsx files, transforms hardcoded color utilities into either
 * semantic tokens (where the existing token paints the same pixels)
 * or paired light + dark: variants (for colored idioms).
 *
 * Usage: node scripts/theme-codemod.js <file-or-dir>
 *
 * The script writes changes in-place. Review with `git diff` and commit
 * per directory. Sites tagged with THEME-REVIEW need manual eyes.
 */

import { readFileSync, writeFileSync, statSync, readdirSync } from 'fs'
import { join, extname } from 'path'

// Token-substitution rules: applied via word-boundary regex.
// Order matters — more specific rules first.
const SUBSTITUTIONS = [
  // Neutral surfaces
  { from: /\bhover:bg-gray-100\b/g, to: 'hover:bg-accent' },
  { from: /\bhover:bg-gray-200\b/g, to: 'hover:bg-accent' },
  { from: /\bhover:bg-gray-50\b/g, to: 'hover:bg-accent' },
  { from: /\bbg-gray-100\b/g, to: 'bg-muted' },
  { from: /\bbg-gray-200\b/g, to: 'bg-muted' },
  { from: /\bbg-gray-50\b/g, to: 'bg-muted' },

  // Text neutrals
  { from: /\btext-gray-900\b/g, to: 'text-foreground' },
  { from: /\btext-gray-800\b/g, to: 'text-foreground' },
  { from: /\btext-gray-700\b/g, to: 'text-foreground' },
  { from: /\btext-gray-600\b/g, to: 'text-muted-foreground' },
  { from: /\btext-gray-500\b/g, to: 'text-muted-foreground' },
  { from: /\btext-gray-400\b/g, to: 'text-muted-foreground' },

  // Borders
  { from: /\bborder-gray-200\b/g, to: 'border-border' },
  { from: /\bborder-gray-300\b/g, to: 'border-border' },
  { from: /\bborder-gray-100\b/g, to: 'border-border' }
]

// Idioms to expand into light + dark: pairs. Matched as a single phrase.
// Each entry is [matcher (regex), replacement string]. We only append dark
// variants when none of the dark: substitutes are already present.
const COLORED_IDIOMS = [
  [
    /\bbg-blue-50 text-blue-700\b/g,
    'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
  ],
  [/\bbg-blue-600 text-white\b/g, 'bg-blue-600 text-white dark:bg-blue-500 dark:text-white'],
  [/\bbg-blue-700 text-white\b/g, 'bg-blue-700 text-white dark:bg-blue-600 dark:text-white'],
  [
    /\bbg-red-50 text-red-700\b/g,
    'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300'
  ],
  [
    /\bbg-red-100 text-red-800\b/g,
    'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300'
  ],
  [/\bbg-red-600 text-white\b/g, 'bg-red-600 text-white dark:bg-red-500 dark:text-white'],
  [
    /\bbg-green-50 text-green-700\b/g,
    'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300'
  ],
  [
    /\bbg-green-100 text-green-800\b/g,
    'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300'
  ],
  [
    /\bbg-yellow-50 text-yellow-700\b/g,
    'bg-yellow-50 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300'
  ],
  [
    /\bbg-yellow-100 text-yellow-800\b/g,
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300'
  ]
]

// Phrases that are ambiguous and need human review.
const REVIEW_FLAGS = [/\bbg-white\b/]

const BG_WHITE_TO_CARD = /\bbg-white\b/g

export function transformClassString(input) {
  let output = input
  const flags = []

  // 1. Apply idiom expansions first (avoid breaking them with substring rules).
  for (const [matcher, replacement] of COLORED_IDIOMS) {
    if (output.match(matcher)) {
      // Skip if dark: variants already present (idempotent).
      const darkProbe = replacement.match(/dark:\S+/)?.[0]
      if (darkProbe && output.includes(darkProbe)) continue
      output = output.replace(matcher, replacement)
    }
  }

  // 2. Substitutions for unambiguous neutrals.
  for (const { from, to } of SUBSTITUTIONS) {
    output = output.replace(from, to)
  }

  // 3. bg-white → bg-card with review flag.
  if (REVIEW_FLAGS.some((r) => r.test(output))) {
    flags.push('bg-white')
    output = output.replace(BG_WHITE_TO_CARD, 'bg-card')
  }

  return { output, flags }
}

// Match `className="..."` or `className={`...`}` (template literal).
const CLASSNAME_RE = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g

export function transformFile(source) {
  let touched = false
  const reviewMarkers = new Set()

  const next = source.replace(CLASSNAME_RE, (match, dq, tpl) => {
    const original = dq ?? tpl
    if (original == null) return match
    const { output, flags } = transformClassString(original)
    if (output === original) return match
    touched = true
    flags.forEach((f) => reviewMarkers.add(f))
    if (dq != null) return `className="${output}"`
    return `className={\`${output}\`}`
  })

  return { source: next, touched, reviewMarkers: [...reviewMarkers] }
}

function walk(path) {
  const stat = statSync(path)
  if (stat.isFile()) return [path]
  if (!stat.isDirectory()) return []
  const out = []
  for (const entry of readdirSync(path)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    out.push(...walk(join(path, entry)))
  }
  return out
}

function main() {
  const target = process.argv[2]
  if (!target) {
    console.error('Usage: node scripts/theme-codemod.js <file-or-dir>')
    process.exit(1)
  }
  const files = walk(target).filter((f) => extname(f) === '.jsx')
  const summary = []
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const { source, touched, reviewMarkers } = transformFile(src)
    if (touched) {
      writeFileSync(file, source)
      summary.push({ file, reviewMarkers })
    }
  }
  console.log(`Modified ${summary.length} file(s).`)
  for (const { file, reviewMarkers } of summary) {
    if (reviewMarkers.length) {
      console.log(`  ${file}  THEME-REVIEW: ${reviewMarkers.join(', ')}`)
    } else {
      console.log(`  ${file}`)
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
