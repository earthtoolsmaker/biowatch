import { Eye, EyeOff } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import * as Tooltip from '@radix-ui/react-tooltip'
import { useShowThumbnailBboxes } from '../hooks/useShowThumbnailBboxes'

/**
 * Toggle for drawing AI-detected bounding boxes on gallery thumbnails. Hidden
 * when the study has no bbox observations. Per-study state via
 * useShowThumbnailBboxes. Extracted from GalleryDisplayStrip so the Explore
 * tab's control bar and the Media tab's strip share one implementation.
 *
 * On IPC failure `studyHasBboxes` falls back to false (toggle hidden) — the
 * safer default than a button that does nothing.
 */
export default function ThumbnailBboxToggle({ studyId }) {
  const { showThumbnailBboxes, setShowThumbnailBboxes } = useShowThumbnailBboxes(studyId)

  const { data: studyHasBboxes = false } = useQuery({
    queryKey: ['studyHasAnyBboxes', studyId],
    queryFn: async () => {
      const response = await window.api.studyHasAnyBboxes(studyId)
      if (response.error) throw new Error(response.error)
      return response.data
    },
    enabled: !!studyId,
    staleTime: Infinity,
    retry: 1,
    throwOnError: false
  })

  if (!studyHasBboxes) return null

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          onClick={() => setShowThumbnailBboxes((prev) => !prev)}
          className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
            showThumbnailBboxes
              ? 'text-blue-600 bg-blue-50 hover:bg-blue-100 dark:text-blue-400 dark:bg-blue-500/15 dark:hover:bg-blue-500/25'
              : 'text-muted-foreground hover:bg-accent'
          }`}
          aria-label={showThumbnailBboxes ? 'Hide bounding boxes' : 'Show bounding boxes'}
        >
          {showThumbnailBboxes ? <Eye size={16} /> : <EyeOff size={16} />}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="bottom"
          sideOffset={10}
          align="end"
          className="z-[10000] max-w-[16rem] px-3 py-2 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-md"
        >
          <p className="font-medium mb-1">
            {showThumbnailBboxes ? 'Hide bounding boxes' : 'Show bounding boxes'}
          </p>
          <p className="text-muted-foreground leading-snug">
            Outlines AI-detected animals on each thumbnail.
          </p>
          <Tooltip.Arrow className="fill-popover" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
