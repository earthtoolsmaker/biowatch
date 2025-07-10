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

// Add this style block at the top of the file after imports
const invisibleMarkerStyle = `
  .invisible-drag-marker {
    background: transparent !important;
    border: none !important;
    cursor: move;
  }
`

// Add the style to the document head
if (typeof document !== 'undefined' && !document.getElementById('invisible-marker-styles')) {
  const style = document.createElement('style')
  style.id = 'invisible-marker-styles'
  style.textContent = invisibleMarkerStyle
  document.head.appendChild(style)
}

function LocationMap({
  locations,
  selectedLocation,
  setSelectedLocation,
  onNewLatitude,
  onNewLongitude
}) {
  const mapRef = useRef(null)

  // useEffect(() => {
  //   if (mapRef.current && selectedLocation) {
  //     mapRef.current.setView(
  //       [parseFloat(selectedLocation.latitude), parseFloat(selectedLocation.longitude)],
  //       16
  //     )
  //   }
  // }, [selectedLocation])
  useEffect(() => {
    console.log('mount')
  }, [])

  if (!locations || locations.length === 0) {
    return <div className="text-gray-500">No location data available for map</div>
  }

  // Filter to include only locations with valid coordinates
  const validLocations = locations.filter((location) => location.latitude && location.longitude)

  // if (validLocations.length === 0) {
  //   return <div className="text-gray-500">No valid geographic coordinates found for locations</div>
  // }

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
    <div className="w-full h-full bg-white rounded border border-gray-200">
      <MapContainer
        {...(validLocations.length > 0
          ? { bounds: bounds, boundsOptions: { padding: [30, 30] } }
          : { center: [0, 0], zoom: 2 })}
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
            title={location.locationID}
            position={[parseFloat(location.latitude), parseFloat(location.longitude)]}
            icon={
              selectedLocation?.locationID === location.locationID ? activeCameraIcon : cameraIcon
            }
            draggable={selectedLocation?.locationID === location.locationID}
            zIndexOffset={selectedLocation?.locationID === location.locationID ? 1000 : 0}
            eventHandlers={{
              click: () => {
                console.log('clicked', location.locationID)
                setSelectedLocation(location)
              },
              dragend: (e) => {
                const marker = e.target
                const position = marker.getLatLng()
                console.log('marker dragged to:', position.lat, position.lng)
                onNewLatitude(location.deploymentID, position.lat.toFixed(6))
                onNewLongitude(location.deploymentID, position.lng.toFixed(6))
              }
            }}
          />
        ))}
      </MapContainer>
    </div>
  )
}

function LocationsList({
  activity,
  selectedLocation,
  setSelectedLocation,
  onNewLatitude,
  onNewLongitude
}) {
  useEffect(() => {
    if (selectedLocation && selectedLocation) {
      document
        .getElementById(selectedLocation.deploymentID)
        .scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [selectedLocation])

  if (!activity.deployments || activity.deployments.length === 0) {
    return <div className="text-gray-500">No deployment data available</div>
  }

  console.log('activity.deployments', activity.deployments)

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
    <div className="flex-1 overflow-y-auto">
      <div className="flex flex-col gap-2">
        <header className="sticky top-0 bg-white z-10 pl-68 flex justify-between text-sm text-gray-700 py-2">
          <span>{formatDate(activity.startDate)} </span>
          <span>{formatDate(activity.endDate)}</span>
        </header>
        <div className="flex flex-col divide-y divide-gray-200 mb-4">
          {activity.deployments
            .sort(
              (a, b) => {
                const aName = a.locationName || a.locationID || 'Unnamed Location'
                const bName = b.locationName || b.locationID || 'Unnamed Location'
                return aName.localeCompare(bName)
              }
              // a.localCompare(b)
              // new Date(a.periods.find((p) => p.count > 0)?.start) -
              // new Date(b.periods.find((p) => p.count > 0)?.start)
            )
            .map((location) => (
              <div
                key={location.deploymentID}
                id={location.deploymentID} // Use deploymentID as the ID for scrolling
                title={location.deploymentStart}
                onClick={() => setSelectedLocation(location)}
                className={`flex gap-4 items-center py-4 first:pt-2 hover:bg-gray-50 cursor-pointer px-2 ${selectedLocation?.locationID === location.locationID ? 'bg-gray-50' : ''}`}
              >
                <div className="flex flex-col gap-2">
                  <div
                    className={`cursor-pointer text-sm w-62 truncate text-gray-700 ${selectedLocation?.locationID === location.locationID ? 'font-medium' : ''}`}
                    title={location.deploymentStart}
                  >
                    {location.locationName || location.locationID || 'Unnamed Location'}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      step={0.00001}
                      min={-90}
                      max={90}
                      title="Latitude"
                      value={location.latitude}
                      onChange={(e) => onNewLatitude(location.deploymentID, e.target.value)}
                      placeholder="Lat"
                      className="max-w-20 text-xs border border-zinc-950/10 rounded px-2 py-1"
                      name="Latitude"
                    />
                    <input
                      step={0.00001}
                      min="-180"
                      max="180"
                      type="number"
                      title="Longitude"
                      value={location.longitude}
                      onChange={(e) => onNewLongitude(location.deploymentID, e.target.value)}
                      placeholder="Lng"
                      className="max-w-20 text-xs border border-zinc-950/10 rounded px-2 py-1"
                      name="longitude"
                    />
                  </div>
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
        const activityResponse = await window.api.getDeploymentsActivity(studyId)
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

  const onNewLatitude = async (deploymentID, latitude) => {
    try {
      const lat = parseFloat(latitude)
      const result = await window.api.setDeploymentLatitude(studyId, deploymentID, lat)
      setActivity((prevActivity) => {
        const updatedDeployments = prevActivity.deployments.map((deployment) => {
          if (deployment.deploymentID === deploymentID) {
            return { ...deployment, latitude: lat }
          }
          return deployment
        })
        return { ...prevActivity, deployments: updatedDeployments }
      })
      if (result.error) {
        console.error('Error updating latitude:', result.error)
      } else {
        console.log('Latitude updated successfully')
      }
    } catch (error) {
      console.error('Error updating latitude:', error)
    }
  }

  const onNewLongitude = async (deploymentID, longitude) => {
    try {
      const lng = parseFloat(longitude)
      const result = await window.api.setDeploymentLongitude(studyId, deploymentID, lng)
      setActivity((prevActivity) => {
        const updatedDeployments = prevActivity.deployments.map((deployment) => {
          if (deployment.deploymentID === deploymentID) {
            return { ...deployment, longitude: lng }
          }
          return deployment
        })
        return { ...prevActivity, deployments: updatedDeployments }
      })
      if (result.error) {
        console.error('Error updating longitude:', result.error)
      } else {
        console.log('Longitude updated successfully')
      }
    } catch (error) {
      console.error('Error updating longitude:', error)
    }
  }

  console.log('Activity data:', activity)

  return (
    <div className="flex flex-col px-4 h-full gap-4">
      <div className="flex-[0.7]">
        {activity && (
          <LocationMap
            locations={activity.deployments}
            selectedLocation={selectedLocation}
            setSelectedLocation={setSelectedLocation}
            onNewLatitude={onNewLatitude}
            onNewLongitude={onNewLongitude}
          />
        )}
      </div>
      {activity && (
        <LocationsList
          activity={activity}
          selectedLocation={selectedLocation}
          setSelectedLocation={setSelectedLocation}
          onNewLatitude={onNewLatitude}
          onNewLongitude={onNewLongitude}
        />
      )}
    </div>
  )
}
