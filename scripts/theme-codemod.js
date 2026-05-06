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
  { from: /\btext-gray-950\b/g, to: 'text-foreground' },
  { from: /\btext-gray-900\b/g, to: 'text-foreground' },
  { from: /\btext-gray-800\b/g, to: 'text-foreground' },
  { from: /\btext-gray-700\b/g, to: 'text-foreground' },
  { from: /\btext-gray-600\b/g, to: 'text-muted-foreground' },
  { from: /\btext-gray-500\b/g, to: 'text-muted-foreground' },
  { from: /\btext-gray-400\b/g, to: 'text-muted-foreground' },
  { from: /\btext-gray-300\b/g, to: 'text-muted-foreground' },

  // Borders
  { from: /\bborder-gray-200\b/g, to: 'border-border' },
  { from: /\bborder-gray-300\b/g, to: 'border-border' },
  { from: /\bborder-gray-100\b/g, to: 'border-border' },
  { from: /\bborder-gray-400\b/g, to: 'border-border' }
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
  ],
  [
    /\bbg-orange-100 text-orange-800\b/g,
    'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300'
  ],
  [
    /\bbg-red-200 text-red-900\b/g,
    'bg-red-200 text-red-900 dark:bg-red-500/30 dark:text-red-200'
  ]
]

// Bare colored utilities to pair with dark variants. Appended to the end
// of the class string when present (Tailwind doesn't care about order).
// Idempotent via .includes(darkVariant) check.
const BARE_DARK_PAIRS = [
  { from: /\btext-blue-600\b/, dark: 'dark:text-blue-400' },
  { from: /\btext-blue-500\b/, dark: 'dark:text-blue-400' },
  { from: /\btext-blue-400\b/, dark: 'dark:text-blue-300' },
  { from: /\btext-red-600\b/, dark: 'dark:text-red-400' },
  { from: /\btext-red-500\b/, dark: 'dark:text-red-400' },
  { from: /\btext-red-400\b/, dark: 'dark:text-red-300' },
  { from: /\btext-amber-700\b/, dark: 'dark:text-amber-300' },
  { from: /\btext-amber-600\b/, dark: 'dark:text-amber-300' },
  { from: /\btext-green-600\b/, dark: 'dark:text-green-400' },
  { from: /\btext-green-700\b/, dark: 'dark:text-green-400' },
  { from: /\bbg-blue-100\b/, dark: 'dark:bg-blue-500/20' },
  { from: /\bbg-blue-500\b/, dark: 'dark:bg-blue-400' },
  { from: /\bhover:bg-red-100\b/, dark: 'dark:hover:bg-red-500/20' },
  { from: /\bhover:bg-red-200\b/, dark: 'dark:hover:bg-red-500/30' },
  { from: /\bhover:bg-blue-50\b/, dark: 'dark:hover:bg-blue-500/15' },
  { from: /\bhover:bg-blue-700\b/, dark: 'dark:hover:bg-blue-600' },
  { from: /\bhover:text-red-600\b/, dark: 'dark:hover:text-red-400' }
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

  // 4. Bare-colored utilities: walk tokens, skip dark:-prefixed ones, append
  //    a dark counterpart for any bare pattern that matches and isn't already
  //    paired. Token-walk avoids false positives like \bbg-blue-500\b matching
  //    inside `dark:bg-blue-500/15`.
  const tokens = output.split(/\s+/).filter(Boolean)
  const seen = new Set(tokens)
  const toAppend = []
  for (const token of tokens) {
    if (token.startsWith('dark:')) continue
    for (const { from, dark } of BARE_DARK_PAIRS) {
      if (from.test(token)) {
        if (!seen.has(dark)) {
          toAppend.push(dark)
          seen.add(dark)
        }
        break
      }
    }
  }
  if (toAppend.length) {
    output = output.trimEnd() + ' ' + toAppend.join(' ')
  }

  return { output, flags }
}

// Match `className="..."` or `className={`...`}` (template literal).
const CLASSNAME_RE = /className=(?:"([^"]*)"|\{`([^`]*)`\})/g

// Match standalone string literals (single or double quoted) that look like
// Tailwind class strings. Used to catch class strings stored in object
// literal values, ternaries, and variables (e.g., `IucnBadge` lookup
// tables, `Tab` ternary class strings, `button.jsx` variants object).
const STRING_LITERAL_RE = /(['"])([^'"\\\n]+)\1/g

const TAILWIND_PREFIX_RE =
  /\b(?:bg|text|border|hover|focus|placeholder|ring|disabled|focus-visible)-/

// Permissive Tailwind-only character set (word, whitespace, : / [ ] ( ) . & -).
const TAILWIND_CHARSET_RE = /^[\s\w:/[\]().&-]+$/

function looksLikeTailwindString(s) {
  if (!s || s.length < 3 || s.length > 800) return false
  if (!TAILWIND_PREFIX_RE.test(s)) return false
  return TAILWIND_CHARSET_RE.test(s)
}

export function transformFile(source) {
  let touched = false
  const reviewMarkers = new Set()

  // Pass 1: transform class strings inside className= props (full transform,
  // including bg-white review flagging).
  let intermediate = source.replace(CLASSNAME_RE, (match, dq, tpl) => {
    const original = dq ?? tpl
    if (original == null) return match
    const { output, flags } = transformClassString(original)
    if (output === original) return match
    touched = true
    flags.forEach((f) => reviewMarkers.add(f))
    if (dq != null) return `className="${output}"`
    return `className={\`${output}\`}`
  })

  // Pass 2: transform Tailwind-looking string literals everywhere else
  // (object values, ternaries, const assignments). Same rules; we still
  // surface bg-white flags here since they're equally ambiguous.
  const next = intermediate.replace(STRING_LITERAL_RE, (match, quote, body) => {
    if (!looksLikeTailwindString(body)) return match
    const { output, flags } = transformClassString(body)
    if (output === body) return match
    touched = true
    flags.forEach((f) => reviewMarkers.add(f))
    return `${quote}${output}${quote}`
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
