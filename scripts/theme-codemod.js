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
  { from: /\bhover:bg-gray-50\b/g, to: 'hover:bg-accent' },
  { from: /\bhover:bg-gray-100\b/g, to: 'hover:bg-accent' },
  { from: /\bhover:bg-gray-200\b/g, to: 'hover:bg-accent' },
  { from: /\bhover:bg-gray-300\b/g, to: 'hover:bg-accent' },
  { from: /\bgroup-hover:bg-gray-100\b/g, to: 'group-hover:bg-accent' },
  { from: /\bgroup-hover:bg-gray-200\b/g, to: 'group-hover:bg-accent' },
  { from: /\bbg-gray-50\b/g, to: 'bg-muted' },
  { from: /\bbg-gray-100\b/g, to: 'bg-muted' },
  { from: /\bbg-gray-200\b/g, to: 'bg-muted' },

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
  { from: /\bborder-gray-100\b/g, to: 'border-border' },
  { from: /\bborder-gray-200\b/g, to: 'border-border' },
  { from: /\bborder-gray-300\b/g, to: 'border-border' },
  { from: /\bborder-gray-400\b/g, to: 'border-border' }
]

// Idioms to expand into light + dark: pairs. Matched as a single phrase.
// Each entry is [matcher (regex), replacement string]. We only append dark
// variants when none of the dark: substitutes are already present.
//
// Negative lookbehind `(?<![:\w-])` prevents matching inside variant
// prefixes — e.g., `bg-blue-600 text-white` must NOT match within
// `hover:bg-blue-600 text-white` (which would corrupt that idiom).
const COLORED_IDIOMS = [
  [
    /(?<![:\w-])bg-blue-50 text-blue-700\b/g,
    'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
  ],
  [
    /(?<![:\w-])bg-blue-600 text-white\b/g,
    'bg-blue-600 text-white dark:bg-blue-500 dark:text-white'
  ],
  [
    /(?<![:\w-])bg-blue-700 text-white\b/g,
    'bg-blue-700 text-white dark:bg-blue-600 dark:text-white'
  ],
  [
    /(?<![:\w-])bg-red-50 text-red-700\b/g,
    'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300'
  ],
  [
    /(?<![:\w-])bg-red-100 text-red-800\b/g,
    'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300'
  ],
  [/(?<![:\w-])bg-red-600 text-white\b/g, 'bg-red-600 text-white dark:bg-red-500 dark:text-white'],
  [
    /(?<![:\w-])bg-green-50 text-green-700\b/g,
    'bg-green-50 text-green-700 dark:bg-green-500/15 dark:text-green-300'
  ],
  [
    /(?<![:\w-])bg-green-100 text-green-800\b/g,
    'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300'
  ],
  [
    /(?<![:\w-])bg-yellow-50 text-yellow-700\b/g,
    'bg-yellow-50 text-yellow-700 dark:bg-yellow-500/15 dark:text-yellow-300'
  ],
  [
    /(?<![:\w-])bg-yellow-100 text-yellow-800\b/g,
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-300'
  ],
  [
    /(?<![:\w-])bg-orange-100 text-orange-800\b/g,
    'bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-300'
  ],
  [
    /(?<![:\w-])bg-red-200 text-red-900\b/g,
    'bg-red-200 text-red-900 dark:bg-red-500/30 dark:text-red-200'
  ],

  // Status banner idioms
  [
    /(?<![:\w-])bg-red-50 border border-red-200\b/g,
    'bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30'
  ],
  [
    /(?<![:\w-])bg-green-50 border border-green-200\b/g,
    'bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/30'
  ],
  [
    /(?<![:\w-])bg-yellow-50 border border-yellow-200\b/g,
    'bg-yellow-50 dark:bg-yellow-500/10 border border-yellow-200 dark:border-yellow-500/30'
  ],

  // Secondary gray button idiom (used in import-progress modals)
  [
    /(?<![:\w-])bg-gray-600 hover:bg-gray-700\b/g,
    'bg-gray-600 hover:bg-gray-700 dark:bg-gray-700 dark:hover:bg-gray-600'
  ]
]

// Bare colored utilities to pair with dark variants. Appended to the end
// of the class string when the exact token is present and the dark
// counterpart isn't already there. Exact-token map (no regex) so we don't
// match `bg-blue-100` inside `hover:bg-blue-100` etc.
const BARE_DARK_PAIRS = new Map([
  ['text-blue-600', 'dark:text-blue-400'],
  ['text-blue-500', 'dark:text-blue-400'],
  ['text-blue-400', 'dark:text-blue-300'],
  ['text-red-600', 'dark:text-red-400'],
  ['text-red-500', 'dark:text-red-400'],
  ['text-red-400', 'dark:text-red-300'],
  ['text-amber-700', 'dark:text-amber-300'],
  ['text-amber-600', 'dark:text-amber-300'],
  ['text-green-600', 'dark:text-green-400'],
  ['text-green-700', 'dark:text-green-400'],
  ['bg-blue-50', 'dark:bg-blue-500/15'],
  ['bg-blue-100', 'dark:bg-blue-500/20'],
  ['bg-red-50', 'dark:bg-red-500/15'],
  ['bg-red-100', 'dark:bg-red-500/20'],
  ['bg-yellow-50', 'dark:bg-yellow-500/15'],
  ['bg-green-50', 'dark:bg-green-500/15'],
  ['bg-green-100', 'dark:bg-green-500/20'],
  ['bg-blue-500', 'dark:bg-blue-400'],
  ['bg-blue-600', 'dark:bg-blue-500'],
  ['hover:bg-red-100', 'dark:hover:bg-red-500/20'],
  ['hover:bg-red-200', 'dark:hover:bg-red-500/30'],
  ['hover:bg-blue-50', 'dark:hover:bg-blue-500/15'],
  ['hover:bg-blue-100', 'dark:hover:bg-blue-500/25'],
  ['hover:bg-blue-600', 'dark:hover:bg-blue-500'],
  ['hover:bg-blue-700', 'dark:hover:bg-blue-600'],
  ['hover:text-red-600', 'dark:hover:text-red-400'],
  ['hover:text-blue-700', 'dark:hover:text-blue-400'],
  ['bg-red-300', 'dark:bg-red-500/40'],
  ['bg-red-600', 'dark:bg-red-500'],
  ['bg-red-700', 'dark:bg-red-600'],
  ['hover:bg-red-700', 'dark:hover:bg-red-600'],
  ['hover:bg-red-100', 'dark:hover:bg-red-500/20'],
  ['text-red-800', 'dark:text-red-300'],
  ['text-red-700', 'dark:text-red-300'],
  ['text-green-800', 'dark:text-green-300'],
  ['group-hover:bg-blue-50', 'dark:group-hover:bg-blue-500/15'],
  ['group-hover:text-blue-600', 'dark:group-hover:text-blue-400']
])

// Phrases that are ambiguous and need human review.
const REVIEW_FLAGS = [/\bbg-white\b/]

const BG_WHITE_TO_CARD = /\bbg-white\b/g

// `append` controls whether bare-pair darks are appended at the end of the
// string. Set to false when transforming the body of a template literal —
// the body contains `${...}` interpolations and trailing tokens; appending
// outside the inner string literals would land outside the template.
// Inner string literals are handled by transformFile's pass 2 with
// `append: true`, so the appending happens at the right place.
export function transformClassString(input, { append = true } = {}) {
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

  if (!append) return { output, flags }

  // 4. Bare-colored utilities: walk tokens, look up exact-match dark pair,
  //    append if not already present. Tokens may have trailing punctuation
  //    from string-literal context (e.g., `hover:bg-blue-100'`) — strip
  //    that before matching. Skip dark:-prefixed tokens entirely.
  const tokens = output.split(/\s+/).filter(Boolean)
  const seen = new Set(tokens)
  const toAppend = []
  for (const rawToken of tokens) {
    if (rawToken.startsWith('dark:')) continue
    // Strip leading/trailing non-Tailwind chars (quotes, parens, commas)
    const token = rawToken.replace(/^[^\w]+|[^\w/\][]+$/g, '')
    const dark = BARE_DARK_PAIRS.get(token)
    if (dark && !seen.has(dark)) {
      toAppend.push(dark)
      seen.add(dark)
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

  // Pass 1: transform class strings inside className= props.
  // - Double-quoted simple values: full transform incl. bare-pair appending.
  // - Template-literal values: only substitutions/idioms (in-place edits).
  //   The inner string literals inside `${...}` interpolations get the
  //   bare-pair appending in pass 2, where they are matched as standalone
  //   string literals and the append lands at the right place.
  let intermediate = source.replace(CLASSNAME_RE, (match, dq, tpl) => {
    const original = dq ?? tpl
    if (original == null) return match
    const isTemplate = tpl != null
    const { output, flags } = transformClassString(original, { append: !isTemplate })
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
