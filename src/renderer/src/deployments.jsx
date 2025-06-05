import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Camera } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import ReactDOMServer from 'react-dom/server'
import { MapContainer, Marker, TileLayer } from 'react-leaflet'

// Fix the default marker icon issue in react-leaflet
// This is needed because the CSS assets are not properly loaded
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png'
})

function LocationMap({ locations, selectedLocation, setSelectedLocation }) {
  const mapRef = useRef(null)

  // useEffect(() => {
  //   if (mapRef.current && selectedLocation) {
  //     mapRef.current.setView(
  //       [parseFloat(selectedLocation.latitude), parseFloat(selectedLocation.longitude)],
  //       16
  //     )
  //   }
  // }, [selectedLocation])

  if (!locations || locations.length === 0) {
    return <div className="text-gray-500">No location data available for map</div>
  }

  // Filter to include only locations with valid coordinates
  const validLocations = locations.filter((location) => location.latitude && location.longitude)

  if (validLocations.length === 0) {
    return <div className="text-gray-500">No valid geographic coordinates found for locations</div>
  }

  // Create bounds from all valid location coordinates
  const positions = validLocations.map((location) => [
    parseFloat(location.latitude),
    parseFloat(location.longitude)
  ])

  // Create a bounds object that encompasses all markers
  const bounds = L.latLngBounds(positions)

  // Create camera icon as a custom marker
  const createCameraIcon = (isActive) => {
    const cameraIcon = ReactDOMServer.renderToString(
      <div className="camera-marker">
        {isActive ? (
          <Camera color="#1E40AF" fill="#93C5FD" size={28} />
        ) : (
          <Camera color="#777" fill="#bbb" size={28} />
        )}
      </div>
    )

    return L.divIcon({
      html: cameraIcon,
      className: 'custom-camera-icon',
      iconSize: [18, 18],
      iconAnchor: [14, 14]
    })
  }

  // Create the camera icon outside of the map loop for better performance
  const cameraIcon = createCameraIcon(false)
  const activeCameraIcon = createCameraIcon(true)

  return (
    <div className="w-full h-[400px] bg-white rounded border border-gray-200">
      <MapContainer
        bounds={bounds}
        boundsOptions={{ padding: [30, 30] }}
        style={{ height: '100%', width: '100%' }}
        ref={mapRef}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {validLocations.map((location) => (
          <Marker
            key={location.locationID}
            position={[parseFloat(location.latitude), parseFloat(location.longitude)]}
            icon={
              selectedLocation?.locationID === location.locationID ? activeCameraIcon : cameraIcon
            }
            // opacity={selectedLocation?.locationID === location.locationID ? 1 : 0.5}
            zIndexOffset={selectedLocation?.locationID === location.locationID ? 1000 : 0}
            eventHandlers={{
              click: () => {
                console.log('clicked', location.locationID)
                setSelectedLocation(location)
              }
            }}
          >
            {/* <Popup>
              <div>
                <h3 className="font-medium">{location.locationName || 'Unnamed Location'}</h3>
                <p className="text-sm">
                  {formatDate(location.deploymentStart)} - {formatDate(location.deploymentEnd)}
                </p>
                <p className="text-xs text-gray-500">
                  Coordinates: {location.latitude}, {location.longitude}
                </p>
              </div>
            </Popup> */}
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}

function LocationsList({ activity, selectedLocation, setSelectedLocation }) {
  useEffect(() => {
    if (selectedLocation && selectedLocation) {
      document
        .getElementById(selectedLocation.locationID)
        .scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [selectedLocation])

  if (!activity.locations || activity.locations.length === 0) {
    return <div className="text-gray-500">No location data available</div>
  }

  console.log('activity.locations', activity.locations)

  // Format date to a more readable format
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A'
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      year: '2-digit',
      month: 'short',
      day: 'numeric'
    })
  }

  console.log('selectedLocation', selectedLocation)

  return (
    <div className="w-full flex-1 overflow-y-auto">
      <div className="flex flex-col gap-2">
        <div className="ml-56 pl-6 flex justify-between text-sm text-gray-700">
          <span>{formatDate(activity.startDate)} </span>
          <span>{formatDate(activity.endDate)}</span>
        </div>
        <div className="flex flex-col divide-y divide-gray-200 mb-4">
          {activity.locations
            .sort(
              (a, b) =>
                new Date(a.periods.find((p) => p.count > 0)?.start) -
                new Date(b.periods.find((p) => p.count > 0)?.start)
            )
            .map((location) => (
              <div
                key={location.locationID}
                id={location.locationID}
                title={location.deploymentStart}
                className="flex gap-4 items-center py-4 first:pt-1"
              >
                <div
                  className={`hover:font-bold cursor-pointer text-sm w-56 truncate text-gray-700 ${selectedLocation?.locationID === location.locationID ? 'font-bold' : ''}`}
                  onClick={() => setSelectedLocation(location)}
                  title={location.deploymentStart}
                >
                  {location.locationName || location.locationID || 'Unnamed Location'}
                </div>
                <div className="flex gap-2 flex-1">
                  {location.periods.map((period) => (
                    <div
                      key={period.start}
                      title={`${period.count} observations`}
                      className="flex items-center justify-center aspect-square w-[5%]"
                    >
                      <div
                        className="rounded-full bg-[#77b7ff] aspect-square max-w-[25px]"
                        style={{
                          width:
                            period.count > 0
                              ? `${Math.min((period.count / activity.percentile90Count) * 100, 100)}%`
                              : '0%',
                          minWidth: period.count > 0 ? '4px' : '0px'
                        }}
                      ></div>
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

export default function Deployments({ studyId }) {
  const [activity, setActivity] = useState(null)
  const [selectedLocation, setSelectedLocation] = useState(null)

  useEffect(() => {
    async function fetchData() {
      try {
        const activityResponse = await window.api.getLocationsActivity(studyId)
        console.log('Activity response:', activityResponse)

        if (activityResponse.error) {
          console.error('Locations error:', activityResponse.error)
          // Don't set main error if species data was successful
        } else {
          setActivity(activityResponse.data)
        }
      } catch (error) {
        console.error('Error fetching activity data:', error)
      }
    }

    fetchData()
  }, [studyId])

  console.log('Activity data:', activity)

  return (
    <div className="flex flex-col gap-6 px-4 h-full">
      {activity && (
        <LocationMap
          locations={activity.locations}
          selectedLocation={selectedLocation}
          setSelectedLocation={setSelectedLocation}
        />
      )}
      {activity && (
        <LocationsList
          activity={activity}
          selectedLocation={selectedLocation}
          setSelectedLocation={setSelectedLocation}
        />
      )}
    </div>
  )
}
