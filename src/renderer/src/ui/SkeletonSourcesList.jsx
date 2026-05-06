/**
 * SkeletonSourcesList - Loading placeholder for the Sources tab
 * Mirrors the SourceRow layout: chevron, icon, name + path, counts, status
 *
 * @param {number} itemCount - Number of skeleton rows to display (default: 4)
 */
function SkeletonSourcesList({ itemCount = 4 }) {
  return (
    <div>
      {/* Header skeleton */}
      <div className="flex items-center justify-between pb-3">
        <div className="h-4 w-48 bg-muted rounded animate-pulse" />
        <div className="h-8 w-28 bg-muted rounded animate-pulse" />
      </div>

      {/* Row skeletons */}
      <div>
        {Array.from({ length: itemCount }).map((_, index) => (
          <div key={index} className="flex items-center gap-4 px-2 py-4 border-b border-border">
            {/* Chevron */}
            <div className="w-5">
              <div className="h-4 w-4 bg-muted rounded animate-pulse" />
            </div>
            {/* Icon */}
            <div className="w-[22px] flex justify-center">
              <div className="h-5 w-5 bg-muted rounded animate-pulse" />
            </div>
            {/* Name + path */}
            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
              <div
                className="h-4 bg-muted rounded animate-pulse"
                style={{ width: `${40 + ((index * 13) % 30)}%` }}
              />
              <div
                className="h-3 bg-muted rounded animate-pulse"
                style={{ width: `${55 + ((index * 7) % 25)}%` }}
              />
            </div>
            {/* Counts */}
            <div className="h-3 w-32 bg-muted rounded animate-pulse" />
            {/* Status */}
            <div className="w-[200px] flex justify-end">
              <div className="h-[18px] w-[18px] rounded-full bg-muted animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default SkeletonSourcesList
