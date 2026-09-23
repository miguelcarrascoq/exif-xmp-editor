import L from 'leaflet'

const MIN_ZOOM = 11
const DEBOUNCE_MS = 400
const MAX_POIS = 50
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

export interface MapPoi {
  id: string
  name: string
  lat: number
  lon: number
  kind: string
}

interface OverpassElement {
  type: string
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

interface OverpassResponse {
  elements?: OverpassElement[]
}

function buildQuery(bounds: L.LatLngBounds): string {
  const s = bounds.getSouth()
  const w = bounds.getWest()
  const n = bounds.getNorth()
  const e = bounds.getEast()
  const bbox = `${s},${w},${n},${e}`

  return `
[out:json][timeout:25];
(
  node["name"]["natural"~"^(volcano|peak)$"](${bbox});
  node["name"]["place"](${bbox});
  node["name"]["tourism"](${bbox});
  node["name"]["leisure"="park"](${bbox});
  way["name"]["natural"~"^(volcano|peak)$"](${bbox});
  way["name"]["tourism"](${bbox});
  way["name"]["leisure"="park"](${bbox});
  relation["name"]["boundary"="national_park"](${bbox});
  relation["name"]["leisure"="park"](${bbox});
);
out center ${MAX_POIS};
`.trim()
}

function kindOf(tags: Record<string, string> | undefined): string {
  if (!tags) return 'place'
  if (tags.natural === 'volcano') return 'volcano'
  if (tags.natural === 'peak') return 'peak'
  if (tags.tourism) return tags.tourism
  if (tags.place) return tags.place
  if (tags.boundary === 'national_park' || tags.leisure === 'park') return 'park'
  return 'place'
}

function parseElements(data: OverpassResponse): MapPoi[] {
  const out: MapPoi[] = []
  const seen = new Set<string>()

  for (const el of data.elements ?? []) {
    const name = el.tags?.name?.trim()
    if (!name) continue
    const lat = el.lat ?? el.center?.lat
    const lon = el.lon ?? el.center?.lon
    if (lat === undefined || lon === undefined) continue
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue

    const id = `${el.type}/${el.id}`
    if (seen.has(id)) continue
    seen.add(id)

    out.push({
      id,
      name,
      lat,
      lon,
      kind: kindOf(el.tags),
    })
    if (out.length >= MAX_POIS) break
  }

  return out
}

async function fetchPois(
  bounds: L.LatLngBounds,
  signal: AbortSignal,
): Promise<MapPoi[]> {
  const body = `data=${encodeURIComponent(buildQuery(bounds))}`
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Accept: 'application/json',
    },
    body,
    signal,
  })
  if (!res.ok) throw new Error(`Overpass failed (${res.status})`)
  const data = (await res.json()) as OverpassResponse
  return parseElements(data)
}

function poiIcon(name: string, kind: string): L.DivIcon {
  const short =
    name.length > 28 ? `${name.slice(0, 26).trimEnd()}…` : name
  return L.divIcon({
    className: `map-poi map-poi--${kind}`,
    html: `<span class="map-poi-dot"></span><span class="map-poi-label">${escapeHtml(short)}</span>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  })
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface MapPoisOptions {
  map: L.Map
  onSelect: (lat: number, lon: number) => void
}

export interface MapPoisController {
  layer: L.LayerGroup
  destroy: () => void
  clear: () => void
}

export function attachMapPois(options: MapPoisOptions): MapPoisController {
  const { map, onSelect } = options
  const layer = L.layerGroup([], {
    attribution:
      'Places &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> / <a href="https://overpass-api.de/">Overpass</a>',
  })

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let abort: AbortController | null = null
  let enabled = false

  function clear() {
    layer.clearLayers()
  }

  function render(pois: MapPoi[]) {
    clear()
    for (const poi of pois) {
      const marker = L.marker([poi.lat, poi.lon], {
        icon: poiIcon(poi.name, poi.kind),
        keyboard: false,
        zIndexOffset: -200,
      })
      marker.bindTooltip(poi.name, {
        direction: 'top',
        offset: [0, -8],
        opacity: 0.95,
      })
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e)
        onSelect(poi.lat, poi.lon)
      })
      marker.addTo(layer)
    }
  }

  async function refresh() {
    if (!enabled || map.getZoom() < MIN_ZOOM) {
      clear()
      return
    }
    abort?.abort()
    abort = new AbortController()
    try {
      const pois = await fetchPois(map.getBounds(), abort.signal)
      if (!enabled) return
      render(pois)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      // Keep previous markers on transient Overpass errors.
    }
  }

  function scheduleRefresh() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      void refresh()
    }, DEBOUNCE_MS)
  }

  const onMoveEnd = () => scheduleRefresh()

  map.on('moveend', onMoveEnd)
  map.on('zoomend', onMoveEnd)

  layer.on('add', () => {
    enabled = true
    scheduleRefresh()
  })
  layer.on('remove', () => {
    enabled = false
    abort?.abort()
    clear()
  })

  function destroy() {
    if (debounceTimer) clearTimeout(debounceTimer)
    abort?.abort()
    map.off('moveend', onMoveEnd)
    map.off('zoomend', onMoveEnd)
    clear()
    layer.remove()
  }

  return { layer, destroy, clear }
}
