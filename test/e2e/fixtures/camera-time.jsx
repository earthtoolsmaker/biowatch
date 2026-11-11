import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import * as Tooltip from '@radix-ui/react-tooltip'
import DeploymentSettingsPopover from '../../../src/renderer/src/deployments/DeploymentSettingsPopover'
import '../../../src/renderer/src/assets/main.css'

const studyId = 'camera-clock-fixture'
let deployment = {
  deploymentID: 'camera',
  locationName: 'Forest',
  cameraTimeZone: null,
  sourceDeploymentStart: '2024-05-01 00:00:00',
  sourceDeploymentEnd: '2024-05-02 00:00:00',
  deploymentStart: null,
  deploymentEnd: null,
  unresolvedTimestampCount: 3,
  cameraEffortTimeZone: null
}
window.cameraTimeCalls = []
window.api = {
  getDeploymentStats: async () => ({
    data: { mediaCount: 3, observationCount: 3, blankCount: 0, sequenceCount: 3 }
  }),
  setCameraTimeZone: async (study, id, timeZone) => {
    window.cameraTimeCalls.push({ study, id, timeZone })
    if (timeZone && !['Europe/Paris', 'UTC+02:00'].includes(timeZone))
      return { error: 'Use an IANA timezone, UTC, or a fixed offset' }
    deployment = {
      ...deployment,
      cameraTimeZone: timeZone,
      cameraEffortTimeZone: timeZone,
      unresolvedTimestampCount: timeZone ? 0 : 3
    }
    return { data: { unresolvedCount: deployment.unresolvedTimestampCount } }
  }
}
export function Fixture() {
  const { data } = useQuery({
    queryKey: ['deploymentsAll', studyId],
    queryFn: async () => ({ ...deployment })
  })
  return (
    <div className="p-8 flex justify-end w-[600px]">
      {data && <DeploymentSettingsPopover studyId={studyId} deployment={data} />}
    </div>
  )
}
createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <Tooltip.Provider>
      <Fixture />
    </Tooltip.Provider>
  </QueryClientProvider>
)
