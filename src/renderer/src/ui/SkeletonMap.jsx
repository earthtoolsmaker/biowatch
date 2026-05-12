import { MapPin } from 'lucide-react'

/**
 * SkeletonMap - Loading placeholder for map components
 * Displays a pulsing gray rectangle with a centered loading indicator
 *
 * @param {string} message - Loading message to display
 * @param {string} title - Main heading text (default: "Loading Deployments")
 */
function SkeletonMap({ message = 'Loading map data...', title = 'Loading Deployments' }) {
  return (
    <div className="w-full h-full bg-muted rounded border border-border relative">
      {/* Pulsing background to indicate loading */}
      <div className="absolute inset-0 bg-gradient-to-br from-gray-100 to-gray-200 animate-pulse" />

      {/* Semi-transparent overlay with loading message */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="bg-card/90 backdrop-blur-sm rounded-lg shadow-lg p-6 max-w-md text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-blue-100 rounded-full dark:bg-blue-500/20">
              <MapPin className="text-blue-600 dark:text-blue-400" size={32} />
            </div>
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">{title}</h3>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
    </div>
  )
}

export default SkeletonMap
