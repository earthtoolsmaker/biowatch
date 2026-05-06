# Sanitize dataset descriptions at import time — design

**Date:** 2026-05-02
**Status:** Approved (pending implementation plan)

## Goal

Strip XML/DocBook inline markup from dataset descriptions at import time so the
text rendered in the overview tab no longer shows literal tags like
`<emphasis>...</emphasis>` or `<ulink url="..."><citetitle>...</citetitle></ulink>`.

URLs from `<ulink>` are preserved as inline `text (url)` so the user can still
read and copy them.

## Non-goals

- Backfilling descriptions already in existing study databases — re-importing
  the dataset is sufficient.
- Sanitizing at display time (renderer stays unchanged).
- Rendering Markdown or HTML in the description (the field stays plain text).
- Full DocBook conversion — only the inline markup we actually see in
  GBIF/EML-sourced Camtrap DP descriptions.

## Background

GBIF dataset metadata is authored in EML, which uses DocBook inline markup
(`<emphasis>`, `<ulink>`, `<citetitle>`, `<para>`, `<itemizedlist>`, ...).
When such a dataset is exported as a Camtrap DP package, those tags leak into
the `description` field of `datapackage.json` even though the Camtrap DP spec
states descriptions are Markdown.

The Camtrap DP importer copies that field straight into `studies.description`
(`src/main/services/import/parsers/camtrapDP.js:193`), and the overview tab
renders it as plain text in a `<div>` (`src/renderer/src/overview/EditorialHeader.jsx:232`).
The result: tags appear literally in the UI. Example seen with the GMU8 Leuven
dataset:

> `<emphasis>GMU8_LEUVEN - …</emphasis> is a dataset published by the
<ulink url="https://www.inbo.be/en"><citetitle>Research Institute for Nature
and Forest (INBO)</citetitle></ulink>. …`

## Architecture

A single pure helper module wired into the two importers that consume an
externally-provided description string. No DB schema changes, no migration, no
renderer changes.

### New module — `src/main/services/import/sanitizeDescription.js`

Exports one function:

```js
sanitizeDescription(input: string | null | undefined): string | null
```

- Returns `null` for `null` / `undefined` / empty / whitespace-only input.
- Otherwise applies the passes below in order and returns the cleaned string.

**Passes** (regex-only, no external library):

1. **`<ulink url="X">...inner...</ulink>` → `inner (X)`**
   Non-greedy match on inner. Inner may contain other tags (e.g. `<citetitle>`);
   those are unwrapped by pass 4. Both single and double quotes around the URL
   are accepted. If the `url` attribute is missing, the tag is treated by pass 4
   (just unwrap).

2. **`<para>...</para>` → `\n\ninner\n\n`**
   Preserves paragraph boundaries.

3. **List tags** — `<itemizedlist>` and `<orderedlist>` containers become
   newline-padded blocks; each `<listitem>...</listitem>` becomes `\n- inner`.
   No nesting support; nested lists collapse to flat ones (acceptable trade-off).

4. **Strip any remaining tag, keep inner text** — generic
   `/<\/?[a-zA-Z][^>]*>/g` replace. This is what catches `<emphasis>`,
   `<citetitle>`, `<superscript>`, and anything else we have not explicitly
   mapped.

5. **Decode common HTML entities** — `&amp;` `&lt;` `&gt;` `&quot;` `&apos;`
   `&#39;` `&nbsp;` only. Not a full entity decoder; these are the realistic
   set seen in GBIF descriptions.

6. **Whitespace cleanup**:
   - Collapse runs of spaces/tabs (within a line) to a single space.
   - Trim each line.
   - Collapse 3+ consecutive blank lines to exactly 2 (one blank line between
     paragraphs).
   - Trim leading/trailing whitespace on the whole string.

The function is synchronous, side-effect free, and does not log.

### Call sites

- **`src/main/services/import/parsers/camtrapDP.js:193`**
  Replace `description: data.description || null` with
  `description: sanitizeDescription(data.description)`.
- **`src/main/services/import/parsers/wildlifeInsights.js:135`**
  Replace `description: data.data?.description || null` with
  `description: sanitizeDescription(data.data?.description)`.
  (No-op on clean text; cheap insurance if WI ever surfaces similar metadata.)

Skipped:

- `lila.js` — descriptions are hardcoded English strings in the parser.
- `deepfaune.js` — always sets `description: null`.

### Data flow

```
GBIF dataset → datapackage.json → camtrapDP parser
                                    ├── data.description (raw, with DocBook tags)
                                    │
                                    ▼
                              sanitizeDescription()
                                    │
                                    ▼
                       studies.description (clean plain text)
                                    │
                                    ▼
                       EditorialHeader.jsx (unchanged)
```

## Testing

New file: **`test/main/services/import/sanitizeDescription.test.js`**

Pure unit tests, no DB, no Electron. Cases:

- `null` / `undefined` / `''` / `'   '` → `null`
- `'plain text'` → unchanged
- `<emphasis>x</emphasis>` → `x`
- `<ulink url="https://e.com"><citetitle>Site</citetitle></ulink>` → `Site (https://e.com)`
- `<ulink url='https://e.com'>Site</ulink>` (single quotes) → `Site (https://e.com)`
- `<para>A</para><para>B</para>` → `A\n\nB`
- `<superscript>2</superscript>` (unmapped tag) → `2`
- Each entity decoded individually: `'a &amp; b'` → `'a & b'`,
  `'&lt;tag&gt;'` → `'<tag>'`, `'&quot;'` → `'"'`, `'&apos;'` → `"'"`,
  `'&#39;'` → `"'"`, `'foo&nbsp;bar'` → `'foo bar'`
- Trimmed slice of the GMU8 description (committed as a literal string in the
  test) → cleaned output asserted character-for-character.

The test fixture string lives in the test file itself, not on disk.

## Edge cases & accepted trade-offs

- **Malformed XML** (unclosed tags, mismatched tags): pass 4's generic strip
  removes them token-by-token. The result may have weird spacing but no broken
  HTML can survive into the DB. Accepted.
- **Tags in user-authored descriptions**: editing the description in the UI
  goes through `updateStudy`, which does **not** re-sanitize. If a user types
  literal `<para>` they get literal `<para>`. Considered correct — sanitizer is
  for parsed-on-import data, not user input.
- **Lost structure**: nested lists collapse to flat; `<title>` headings inside
  descriptions become plain text (no Markdown `#`). Acceptable — the renderer
  is plain text anyway.
- **No HTML escape for `<` / `>` / `&`**: the cleaned string is not HTML; it is
  set as a React text node. React escapes for us.

## Documentation updates

- **`docs/import-export.md`** — add a one-paragraph note under the Camtrap DP
  import section explaining that descriptions pass through a tag sanitizer that
  converts DocBook inline markup to plain text and preserves URLs as
  `text (url)`.
- **`docs/data-formats.md`** — note that the imported `description` is the
  sanitized form, not the raw `datapackage.json` value.

No changes needed to `database-schema.md`, `ipc-api.md`, `architecture.md`,
`development.md`, or `troubleshooting.md`.

## Out of scope (explicitly)

- Backfill of `studies.description` for already-imported datasets.
- Re-running the sanitizer when the user re-edits the description in the UI.
- Markdown or HTML rendering in the overview tab.
- Sanitization of any other text field (contributors, names, titles).
