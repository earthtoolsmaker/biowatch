import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router'
import * as Tooltip from '@radix-ui/react-tooltip'
import L from 'leaflet'
import '../../../src/renderer/src/assets/main.css'
import Explore from '../../../src/renderer/src/explore'

// Mount the actual Explore screen with deterministic IPC responses. All chart
// queries still run through their production React Query keys and bbox inputs.
const studyId = 'location-click-test'
const species = ['Taxonomy A', 'Taxonomy B']
const locations = [
  { lat: 50, lng: 4, rawCounts: { 'Taxonomy A': 8, 'Taxonomy B': 2 } },
  { lat: 50.1, lng: 4.1, rawCounts: { 'Taxonomy A': 1, 'Taxonomy B': 9 } }
].map((location) => ({ ...location, values: location.rawCounts, effortDays: 10 }))
const inArea = (location, bbox) =>
  !bbox ||
  (location.lat >= bbox.south &&
    location.lat <= bbox.north &&
    location.lng >= bbox.west &&
    location.lng <= bbox.east)
const totals = (bbox) =>
  Object.fromEntries(
    species.map((name) => [
      name,
      locations
        .filter((location) => inArea(location, bbox))
        .reduce((sum, l) => sum + l.values[name], 0)
    ])
  )
const calls = []
const respond = (method, query, data) => {
  calls.push({ method, ...query })
  return Promise.resolve({ data })
}
window.exploreLocationCalls = calls
L.Map.addInitHook(function () {
  window.exploreLocationMap = this
})
window.api = {
  getImportStatus: async () => ({ isRunning: false, done: 0 }),
  getSequenceGap: async () => ({ data: 60 }),
  getBestImagePerSpecies: async () => ({ data: [] }),
  getDeploymentLocations: async () => ({
    data: locations.map(({ lat, lng }) => ({ latitude: lat, longitude: lng }))
  }),
  getSequenceAwareSpeciesDistribution: (query) =>
    respond('distribution', query, {
      distribution: species.map((scientificName) => ({
        scientificName,
        count: totals(query.bbox)[scientificName]
      }))
    }),
  getSequenceAwareTimeseries: (query) =>
    respond('timeseries', query, {
      timeseries: ['2025-01-05', '2025-01-12', '2025-01-19'].map((date) => ({
        date,
        ...totals(query.bbox)
      }))
    }),
  getSequenceAwareDailyActivity: (query) =>
    respond(
      'dailyActivity',
      query,
      Array.from({ length: 24 }, (_, hour) => ({ hour, ...totals(query.bbox) }))
    ),
  getSequenceAwareHeatmap: (query) => respond('heatmap', query, { locations })
}
localStorage.removeItem(`areaFilter:${studyId}`)
localStorage.setItem(`showFilterCharts:${studyId}`, 'true')
localStorage.setItem(`mapEncoding:${studyId}`, 'pies')

createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MemoryRouter initialEntries={['/?view=map']}>
      <Tooltip.Provider delayDuration={0}>
        <Explore studyId={studyId} studyData={{ name: 'Location click test' }} />
      </Tooltip.Provider>
    </MemoryRouter>
  </QueryClientProvider>
)
