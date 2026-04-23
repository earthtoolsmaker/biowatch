export const GBIF_TITLE_OVERRIDES = {
  '1290a78f-098c-4336-84e4-74de27a658f1': 'Farmland Birds 2020–2024, Luxembourg',
  '77972fac-09bc-460b-a0d6-34b87b1b4b72': 'Santiago de Cali Biodiversity, Colombia',
  'f0963153-077b-4676-a337-891a06fab52a': 'Forest First Mammals, Colombia',
  '13101e81-bc62-4553-9fd9-c5c8eb3fb9ab': 'Alpine Tundra Rodents, Norway',
  'fc3f505a-05d8-4b3e-908c-8880fc9899f7': 'Valerian 2023–2025, Luxembourg',
  '273ee7a0-4b59-4350-b220-3282b533ecde': 'Valerian 2020–2022, Luxembourg',
  'f0a42d7d-1eda-4ec8-ac66-c1343acea3bc': 'Snapshot Japan 2023, Japan',
  '74196cd9-7ebc-4b20-bc27-3c2d22e31ed7': 'Waterleidingduinen Pilot 1, Netherlands',
  'f9ba3c2e-0636-4f66-a4b5-b8c138046e9e': 'Waterleidingduinen Pilot 2, Netherlands',
  'bc0acb9a-131f-4085-93ae-a46e08564ac5': 'Waterleidingduinen Pilot 3, Netherlands',
  '8a5cbaec-2839-4471-9e1d-98df301095dd': 'MICA Muskrat & Coypu, Belgium / Netherlands / Germany',
  '3856c01f-5031-4cc1-a5b2-2daa9537411b': 'FIBRAS Casanare, Colombia',
  'd54b6dc3-48ab-4533-9e68-25ec45696737': 'Wet Tropics 2022–2023, Queensland',
  'a209cef2-cfad-460b-8ed4-0ccf211a8240': 'Muntjac Antwerp, Belgium',
  'c9cbc586-660e-4d89-ba14-0000c5770de1': 'GMU8 Leuven, Belgium',
  '0c74050a-13f8-4206-bd29-8c464a441def': 'Wombat Burrows Gigafire, Australia',
  'dcdc214a-e8ec-467b-b5ed-c6b5e4993527': 'VIC–NSW Gigafire Impacts, Australia'
}

export const getGbifTitle = (key, fallback) => GBIF_TITLE_OVERRIDES[key] ?? fallback

// GBIF datasets that are not importable and should be hidden from the picker.
// Reasons: CAMTRAP_DP endpoint returns 403, no CAMTRAP_DP endpoint exists, or the
// data package fails import (e.g. foreign-key violations).
// Re-check periodically and remove keys that come back online.
export const GBIF_UNAVAILABLE = new Set([
  '13101e81-bc62-4553-9fd9-c5c8eb3fb9ab', // Norwegian Alpine Tundra Rodents — 403
  'f0a42d7d-1eda-4ec8-ac66-c1343acea3bc', // Snapshot Japan 2023 — 403
  'd54b6dc3-48ab-4533-9e68-25ec45696737', // Wet Tropics Queensland — no CAMTRAP_DP endpoint
  '0c74050a-13f8-4206-bd29-8c464a441def', // Wombat Burrows Gigafire — no CAMTRAP_DP endpoint
  'dcdc214a-e8ec-467b-b5ed-c6b5e4993527', // VIC–NSW Gigafire Impacts — no CAMTRAP_DP endpoint
  'f0963153-077b-4676-a337-891a06fab52a' // Forest First Mammals, Colombia — foreign-key constraint fails on import
])

export const isGbifAvailable = (key) => !GBIF_UNAVAILABLE.has(key)
