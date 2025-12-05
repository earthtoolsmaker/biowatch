import { MapPin } from 'lucide-react'
import { MapContainer, TileLayer } from 'react-leaflet'
import { Link } from 'react-router'

/**
 * PlaceholderMap - Shows a world map with an overlay message when deployment coordinates are missing.
 *
 * @param {string} title - Main heading text for the overlay
 * @param {string} description - Explanatory text
 * @param {string} linkTo - Optional route path for action button (relative to study)
 * @param {string} linkText - Optional button text
 * @param {string} studyId - Study ID for constructing navigation links
 * @param {Component} icon - Lucide icon component (default: MapPin)
 */
function PlaceholderMap({ title, description, linkTo, linkText, studyId, icon: Icon = MapPin }) {
  return (
    <div className="w-full h-full bg-white rounded border border-gray-200 relative">
      <MapContainer
        center={[5, 20]}
        zoom={3}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
      </MapContainer>

      {/* Semi-transparent overlay with message */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[1000]">
        <div className="bg-white/90 backdrop-blur-sm rounded-lg shadow-lg p-6 max-w-md text-center pointer-events-auto">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-blue-100 rounded-full">
              <Icon className="text-blue-600" size={32} />
            </div>
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-2">{title}</h3>
          <p className="text-sm text-gray-600 mb-4">{description}</p>
          {linkTo && linkText && studyId && (
            <Link
              to={`/study/${studyId}${linkTo}`}
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 transition-colors"
            >
              {linkText}
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

export default PlaceholderMap
