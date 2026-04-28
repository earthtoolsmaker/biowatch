import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'

const SECTION_LABELS = {
  added: 'Added',
  changed: 'Changed',
  fixed: 'Fixed'
}

const COLLAPSED_MAX_HEIGHT = 180

function ReleaseBlock({ release }) {
  const sections = ['added', 'changed', 'fixed'].filter(
    (key) => release[key] && release[key].length > 0
  )

  return (
    <div className="mb-5 last:mb-0">
      <div className="flex items-baseline gap-2 mb-2">
        <h3 className="text-sm font-semibold text-gray-900">{release.version}</h3>
        {release.date && <span className="text-xs text-gray-500">{release.date}</span>}
      </div>
      <div className="space-y-2">
        {sections.map((key) => (
          <div key={key}>
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">
              {SECTION_LABELS[key]}
            </div>
            <ul className="text-sm text-gray-700 space-y-0.5 list-disc list-inside marker:text-gray-300">
              {release[key].map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function RecentReleases() {
  const { data: releases = [], isLoading } = useQuery({
    queryKey: ['settings-info', 'changelog'],
    queryFn: () => window.api.getChangelog(3),
    staleTime: Infinity
  })

  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const contentRef = useRef(null)

  useEffect(() => {
    if (!contentRef.current) return
    setOverflowing(contentRef.current.scrollHeight > COLLAPSED_MAX_HEIGHT + 4)
  }, [releases])

  const isCollapsed = !expanded && overflowing

  return (
    <section className="py-6">
      <h2 className="text-base font-medium text-gray-900 mb-1">Recent releases</h2>
      <p className="text-sm text-gray-500 mb-4">What&apos;s new in the last few versions.</p>

      {isLoading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : releases.length === 0 ? (
        <div className="text-sm text-gray-400">No release notes available.</div>
      ) : (
        <div
          ref={contentRef}
          className={`relative ${isCollapsed ? 'overflow-hidden' : ''}`}
          style={isCollapsed ? { maxHeight: COLLAPSED_MAX_HEIGHT } : undefined}
        >
          {releases.map((r) => (
            <ReleaseBlock key={r.version} release={r} />
          ))}
          {isCollapsed && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white to-transparent" />
          )}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mt-3">
        {overflowing ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-sm text-blue-600 hover:underline"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        ) : (
          <span />
        )}
        <a
          href="https://github.com/earthtoolsmaker/biowatch/blob/main/CHANGELOG.md"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
        >
          View full changelog
          <ExternalLink size={12} />
        </a>
      </div>
    </section>
  )
}
