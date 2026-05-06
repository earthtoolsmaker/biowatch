import { useQuery } from '@tanstack/react-query'
import BestMediaCarousel from '../ui/BestMediaCarousel'
import CommonSpeciesFallback from './CommonSpeciesFallback'

/**
 * Best captures band — section header + carousel. When the study has no
 * scored media yet, falls back to a "Most common species" band that uses
 * the bundled Wikipedia thumbnails. Hidden entirely if neither has anything
 * to show.
 *
 * The query here mirrors `BestMediaCarousel`'s — react-query dedupes by key,
 * so this is a free read once the carousel has cached data.
 */
export default function BestCapturesSection({ studyId, isRunning }) {
  const { data: bestMedia = [] } = useQuery({
    queryKey: ['bestMedia', studyId],
    queryFn: async () => {
      const response = await window.api.getBestMedia(studyId, { limit: 12 })
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studyId,
    staleTime: Infinity,
    refetchInterval: isRunning ? 5000 : false
  })

  if (bestMedia.length === 0) {
    return <CommonSpeciesFallback studyId={studyId} />
  }

  return (
    <section>
      <h3 className="text-[0.7rem] uppercase tracking-wider text-muted-foreground font-semibold mb-3">
        Best captures
      </h3>
      <BestMediaCarousel studyId={studyId} isRunning={isRunning} />
    </section>
  )
}
