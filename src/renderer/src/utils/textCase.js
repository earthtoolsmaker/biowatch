// Capitalize the first letter of each space-separated word, e.g.
// "african elephant" -> "African Elephant". Leaves the rest of each word as-is
// so existing capitals (acronyms, apostrophes like "grant's") are preserved.
// Intended for common/vernacular names — do NOT use on scientific names, where
// only the genus is capitalized ("Vulpes vulpes").
export function toTitleCase(s) {
  if (!s) return s
  return s
    .split(' ')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ')
}
