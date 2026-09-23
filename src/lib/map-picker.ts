import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import { attachMapPois } from './map-pois'

// Use L.icon (not Icon.Default): Default prefixes imagePath onto URLs and breaks Vite asset paths.
const pinIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41],
})

const DEFAULT_CENTER: L.LatLngExpression = [20, 0]
const DEFAULT_ZOOM = 2
const MARKER_ZOOM = 14
const PLACE_ZOOM = 12
const COORD_DECIMALS = 6
const SEARCH_DEBOUNCE_MS = 350
const SEARCH_LIMIT = 6

interface NominatimResult {
  display_name: string
  lat: string
  lon: string
  type?: string
  class?: string
  boundingbox?: [string, string, string, string]
}

export interface MapPickerOptions {
  container: HTMLElement
  latInput: HTMLInputElement
  lonInput: HTMLInputElement
}

export interface MapPicker {
  syncFromInputs: () => void
  invalidateSize: () => void
  reset: () => void
}

function parseCoord(value: string): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function formatCoord(n: number): string {
  return n.toFixed(COORD_DECIMALS)
}

function isValidLatLon(lat: number, lon: number): boolean {
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function searchPlaces(query: string, signal: AbortSignal): Promise<NominatimResult[]> {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', query)
  url.searchParams.set('format', 'json')
  url.searchParams.set('limit', String(SEARCH_LIMIT))
  url.searchParams.set('addressdetails', '0')

  const res = await fetch(url.toString(), {
    signal,
    headers: {
      Accept: 'application/json',
    },
  })
  if (!res.ok) throw new Error(`Search failed (${res.status})`)
  return (await res.json()) as NominatimResult[]
}

function createPlaceSearchControl(
  onSelect: (lat: number, lon: number, bbox?: L.LatLngBoundsExpression) => void,
): L.Control {
  const control = new L.Control({ position: 'topleft' })

  control.onAdd = () => {
    const root = L.DomUtil.create('div', 'map-search')
    L.DomEvent.disableClickPropagation(root)
    L.DomEvent.disableScrollPropagation(root)

    root.innerHTML = `
      <form class="map-search-form" autocomplete="off">
        <input
          type="search"
          class="map-search-input"
          placeholder="Search place…"
          aria-label="Search place"
        />
        <button type="submit" class="map-search-btn" aria-label="Search">Go</button>
      </form>
      <ul class="map-search-results" hidden role="listbox"></ul>
      <p class="map-search-status" hidden></p>
    `

    const form = root.querySelector<HTMLFormElement>('.map-search-form')!
    const input = root.querySelector<HTMLInputElement>('.map-search-input')!
    const resultsEl = root.querySelector<HTMLUListElement>('.map-search-results')!
    const statusEl = root.querySelector<HTMLParagraphElement>('.map-search-status')!

    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    let abort: AbortController | null = null

    function setStatus(text: string | null) {
      if (!text) {
        statusEl.hidden = true
        statusEl.textContent = ''
        return
      }
      statusEl.hidden = false
      statusEl.textContent = text
    }

    function clearResults() {
      resultsEl.innerHTML = ''
      resultsEl.hidden = true
    }

    function renderResults(items: NominatimResult[]) {
      clearResults()
      setStatus(null)
      if (items.length === 0) {
        setStatus('No places found')
        return
      }
      resultsEl.hidden = false
      for (const item of items) {
        const li = document.createElement('li')
        li.setAttribute('role', 'option')
        li.innerHTML = `<button type="button">${escapeHtml(item.display_name)}</button>`
        li.querySelector('button')!.addEventListener('click', () => {
          const lat = Number(item.lat)
          const lon = Number(item.lon)
          if (!isValidLatLon(lat, lon)) return
          let bbox: L.LatLngBoundsExpression | undefined
          if (item.boundingbox?.length === 4) {
            const [south, north, west, east] = item.boundingbox.map(Number)
            if ([south, north, west, east].every(Number.isFinite)) {
              bbox = [
                [south, west],
                [north, east],
              ]
            }
          }
          onSelect(lat, lon, bbox)
          input.value = item.display_name.split(',')[0]?.trim() ?? item.display_name
          clearResults()
          setStatus(null)
        })
        resultsEl.appendChild(li)
      }
    }

    async function runSearch(query: string) {
      const q = query.trim()
      if (q.length < 2) {
        clearResults()
        setStatus(null)
        return
      }
      abort?.abort()
      abort = new AbortController()
      setStatus('Searching…')
      clearResults()
      try {
        const items = await searchPlaces(q, abort.signal)
        renderResults(items)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
        setStatus('Search unavailable')
        clearResults()
      }
    }

    function scheduleSearch() {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        void runSearch(input.value)
      }, SEARCH_DEBOUNCE_MS)
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault()
      if (debounceTimer) clearTimeout(debounceTimer)
      void runSearch(input.value)
    })

    input.addEventListener('input', scheduleSearch)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        clearResults()
        setStatus(null)
        input.blur()
      }
    })

    return root
  }

  return control
}

export function initMapPicker(options: MapPickerOptions): MapPicker {
  const { container, latInput, lonInput } = options

  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  })

  const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    attribution:
      'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
  })

  const satelliteImagery = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 19,
      attribution:
        'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    },
  )

  // Place names / city labels over imagery (free Esri reference layer).
  const placeLabels = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    {
      maxZoom: 19,
      attribution: 'Labels &copy; Esri',
      opacity: 0.95,
    },
  )

  const satellite = L.layerGroup([satelliteImagery, placeLabels])

  const map = L.map(container, {
    center: DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    layers: [osm],
  })

  let marker: L.Marker | null = null
  let syncingFromMap = false

  function writeInputs(lat: number, lon: number) {
    syncingFromMap = true
    latInput.value = formatCoord(lat)
    lonInput.value = formatCoord(lon)
    latInput.dispatchEvent(new Event('input', { bubbles: true }))
    lonInput.dispatchEvent(new Event('input', { bubbles: true }))
    syncingFromMap = false
  }

  function setMarker(lat: number, lon: number, pan: boolean, zoom = MARKER_ZOOM) {
    const latlng: L.LatLngExpression = [lat, lon]
    if (!marker) {
      marker = L.marker(latlng, { draggable: true, icon: pinIcon }).addTo(map)
      marker.on('dragend', () => {
        if (!marker) return
        const pos = marker.getLatLng()
        writeInputs(pos.lat, pos.lng)
      })
    } else {
      marker.setLatLng(latlng)
    }
    if (pan) {
      map.setView(latlng, Math.max(map.getZoom(), zoom))
    }
  }

  const pois = attachMapPois({
    map,
    onSelect: (lat, lon) => {
      writeInputs(lat, lon)
      setMarker(lat, lon, false)
    },
  })

  L.control
    .layers(
      {
        Map: osm,
        Topo: topo,
        Satellite: satellite,
      },
      {
        Places: pois.layer,
      },
      { position: 'topright' },
    )
    .addTo(map)

  // Places overlay on by default (loads data once zoomed in).
  pois.layer.addTo(map)

  function syncFromInputs() {
    if (syncingFromMap) return
    const lat = parseCoord(latInput.value)
    const lon = parseCoord(lonInput.value)
    if (lat === null || lon === null || !isValidLatLon(lat, lon)) return
    setMarker(lat, lon, true)
  }

  map.on('click', (e: L.LeafletMouseEvent) => {
    const { lat, lng } = e.latlng
    setMarker(lat, lng, false)
    writeInputs(lat, lng)
  })

  createPlaceSearchControl((lat, lon, bbox) => {
    writeInputs(lat, lon)
    setMarker(lat, lon, false)
    if (bbox) {
      map.fitBounds(bbox, { maxZoom: PLACE_ZOOM + 2, padding: [24, 24] })
    } else {
      map.setView([lat, lon], PLACE_ZOOM)
    }
  }).addTo(map)

  const onInputChange = () => syncFromInputs()
  latInput.addEventListener('input', onInputChange)
  lonInput.addEventListener('change', onInputChange)
  lonInput.addEventListener('input', onInputChange)
  latInput.addEventListener('change', onInputChange)

  function reset() {
    if (marker) {
      marker.remove()
      marker = null
    }
    pois.clear()
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM)
  }

  function invalidateSize() {
    map.invalidateSize()
  }

  return { syncFromInputs, invalidateSize, reset }
}
