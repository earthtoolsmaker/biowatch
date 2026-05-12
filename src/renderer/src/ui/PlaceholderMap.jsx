import { MapPin } from 'lucide-react'
import { MapContainer, TileLayer } from 'react-leaflet'
import { Link } from 'react-router'
import HideLeafletAttribution from './HideLeafletAttribution'

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
    <div className="w-full h-full bg-card rounded-xl border border-border shadow-md overflow-hidden relative">
      <MapContainer
        center={[5, 20]}
        zoom={3}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
        scrollWheelZoom={true}
      >
        <HideLeafletAttribution />
        <TileLayer
          attribution='&copy; <a href="https://www.esri.com">Esri</a>'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        />
      </MapContainer>

      {/* Compact overlay card — leaves the map visible around it */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[1000] p-3">
        <div className="bg-card/90 backdrop-blur-sm rounded-lg shadow-lg px-4 py-3 max-w-[18rem] text-center pointer-events-auto">
          <div className="flex justify-center mb-2">
            <div className="p-2 bg-blue-100 rounded-full dark:bg-blue-500/20">
              <Icon className="text-blue-600 dark:text-blue-400" size={20} />
            </div>
          </div>
          <h3 className="text-sm font-medium text-foreground mb-1">{title}</h3>
          <p className="text-xs text-muted-foreground mb-3 leading-snug">{description}</p>
          {linkTo && linkText && studyId && (
            <Link
              to={`/study/${studyId}${linkTo}`}
              className="inline-flex items-center px-3 py-1.5 bg-blue-600 text-white dark:bg-blue-500 dark:text-white text-xs font-medium rounded-md hover:bg-blue-700 transition-colors dark:hover:bg-blue-600"
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
