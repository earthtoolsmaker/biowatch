/**
 * SkeletonDeploymentsList - Loading placeholder for the deployments list
 * Displays multiple skeleton rows mimicking the real deployment items
 *
 * @param {number} itemCount - Number of skeleton rows to display (default: 5)
 */
function SkeletonDeploymentsList({ itemCount = 5 }) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex flex-col gap-2">
        {/* Skeleton header */}
        <header className="sticky top-0 bg-white z-10 pl-68 flex justify-between text-sm text-gray-700 py-2">
          <span className="h-4 w-20 bg-gray-200 rounded animate-pulse" />
          <span className="h-4 w-20 bg-gray-200 rounded animate-pulse" />
        </header>

        {/* Skeleton rows */}
        <div className="flex flex-col divide-y divide-gray-200 mb-4">
          {Array.from({ length: itemCount }).map((_, index) => (
            <div key={index} className="flex gap-4 items-center py-4 first:pt-2 px-2">
              <div className="flex flex-col gap-2">
                {/* Location name skeleton */}
                <div className="h-4 w-48 bg-gray-200 rounded animate-pulse" />
                {/* Coordinate inputs skeleton */}
                <div className="flex gap-2 items-center">
                  <div className="h-6 w-20 bg-gray-200 rounded animate-pulse" />
                  <div className="h-6 w-20 bg-gray-200 rounded animate-pulse" />
                  <div className="h-6 w-6 bg-gray-200 rounded animate-pulse" />
                </div>
              </div>
              {/* Activity periods skeleton */}
              <div className="flex gap-2 flex-1">
                {Array.from({ length: 10 }).map((_, periodIndex) => (
                  <div
                    key={periodIndex}
                    className="flex items-center justify-center aspect-square w-[5%]"
                  >
                    <div
                      className="rounded-full bg-gray-200 aspect-square animate-pulse"
                      style={{ width: `${20 + ((periodIndex * 7) % 60)}%` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default SkeletonDeploymentsList
