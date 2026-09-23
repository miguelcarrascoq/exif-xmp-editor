/**
 * Minimal TIFF/EXIF GPS IFD writer (little-endian).
 * Builds a standalone TIFF blob suitable for a JPEG APP1 "Exif\0\0" segment.
 */

export interface GpsCoords {
  latitude: number
  longitude: number
  altitude?: number
}

const TYPE_ASCII = 2
const TYPE_SHORT = 3
const TYPE_LONG = 4
const TYPE_RATIONAL = 5
const TYPE_BYTE = 1

interface PendingValue {
  tag: number
  type: number
  count: number
  /** Inline 4-byte value, or offset placeholder resolved later */
  valueOrOffset: number
  extra?: Uint8Array
}

export function buildGpsExifTiff(gps: GpsCoords): Uint8Array {
  const latRef = gps.latitude >= 0 ? 'N' : 'S'
  const lonRef = gps.longitude >= 0 ? 'E' : 'W'
  const latAbs = Math.abs(gps.latitude)
  const lonAbs = Math.abs(gps.longitude)

  const gpsEntries: PendingValue[] = [
    { tag: 0x0000, type: TYPE_BYTE, count: 4, valueOrOffset: packBytes([2, 3, 0, 0]) }, // GPSVersionID 2.3.0.0
    { tag: 0x0001, type: TYPE_ASCII, count: 2, valueOrOffset: packAsciiInline(latRef) },
    {
      tag: 0x0002,
      type: TYPE_RATIONAL,
      count: 3,
      valueOrOffset: 0,
      extra: encodeDmsRational(latAbs),
    },
    { tag: 0x0003, type: TYPE_ASCII, count: 2, valueOrOffset: packAsciiInline(lonRef) },
    {
      tag: 0x0004,
      type: TYPE_RATIONAL,
      count: 3,
      valueOrOffset: 0,
      extra: encodeDmsRational(lonAbs),
    },
  ]

  if (gps.altitude !== undefined && Number.isFinite(gps.altitude)) {
    const alt = Math.abs(gps.altitude)
    gpsEntries.push(
      {
        tag: 0x0005,
        type: TYPE_BYTE,
        count: 1,
        valueOrOffset: gps.altitude < 0 ? 1 : 0, // 0 = above sea level
      },
      {
        tag: 0x0006,
        type: TYPE_RATIONAL,
        count: 1,
        valueOrOffset: 0,
        extra: encodeRational(alt, 1000),
      },
    )
  }

  // Layout:
  // 0:  TIFF header (8 bytes) — II*\0 + offset to IFD0
  // 8:  IFD0 (2 + 12*n + 4) — pointer to GPS IFD
  // after IFD0: GPS IFD
  // after GPS IFD: extra data blobs

  const ifd0Entries: PendingValue[] = [
    // Orientation = 1
    { tag: 0x0112, type: TYPE_SHORT, count: 1, valueOrOffset: 1 },
    // GPS IFD pointer (tag 0x8825)
    { tag: 0x8825, type: TYPE_LONG, count: 1, valueOrOffset: 0 },
  ]

  // Sort entries by tag number (EXIF requirement)
  ifd0Entries.sort((a, b) => a.tag - b.tag)
  gpsEntries.sort((a, b) => a.tag - b.tag)

  const headerSize = 8
  const ifd0Size = 2 + ifd0Entries.length * 12 + 4
  const gpsIfdOffset = headerSize + ifd0Size
  const gpsIfdSize = 2 + gpsEntries.length * 12 + 4
  let extraOffset = gpsIfdOffset + gpsIfdSize

  // Assign offsets for extras in GPS IFD
  for (const e of gpsEntries) {
    if (e.extra) {
      e.valueOrOffset = extraOffset
      extraOffset += e.extra.length
    }
  }

  // Set GPS IFD pointer in IFD0
  const gpsPtr = ifd0Entries.find((e) => e.tag === 0x8825)!
  gpsPtr.valueOrOffset = gpsIfdOffset

  const buffer = new ArrayBuffer(extraOffset)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)

  // TIFF header little-endian
  view.setUint16(0, 0x4949, true) // II
  view.setUint16(2, 42, true)
  view.setUint32(4, headerSize, true) // offset to IFD0

  writeIfd(view, headerSize, ifd0Entries)
  writeIfd(view, gpsIfdOffset, gpsEntries)

  // Write extras
  for (const e of gpsEntries) {
    if (e.extra && e.valueOrOffset > 0) {
      bytes.set(e.extra, e.valueOrOffset)
    }
  }

  return bytes
}

function writeIfd(view: DataView, offset: number, entries: PendingValue[]): void {
  view.setUint16(offset, entries.length, true)
  let p = offset + 2
  for (const e of entries) {
    view.setUint16(p, e.tag, true)
    view.setUint16(p + 2, e.type, true)
    view.setUint32(p + 4, e.count, true)
    // value/offset field
    if (e.type === TYPE_SHORT && e.count === 1 && !e.extra) {
      view.setUint16(p + 8, e.valueOrOffset, true)
      view.setUint16(p + 10, 0, true)
    } else if (e.type === TYPE_BYTE && e.count <= 4 && !e.extra) {
      view.setUint32(p + 8, e.valueOrOffset, true)
    } else if (e.type === TYPE_ASCII && e.count <= 4 && !e.extra) {
      view.setUint32(p + 8, e.valueOrOffset, true)
    } else if (e.type === TYPE_LONG && e.count === 1 && !e.extra) {
      view.setUint32(p + 8, e.valueOrOffset, true)
    } else {
      view.setUint32(p + 8, e.valueOrOffset, true)
    }
    p += 12
  }
  view.setUint32(p, 0, true) // next IFD = none
}

function packBytes(arr: number[]): number {
  // pack up to 4 bytes little-endian into a uint32 for inline storage
  let v = 0
  for (let i = 0; i < Math.min(4, arr.length); i++) {
    v |= (arr[i] & 0xff) << (8 * i)
  }
  return v
}

function packAsciiInline(ch: string): number {
  // single char + null, little-endian in 4 bytes
  return (ch.charCodeAt(0) & 0xff) | (0 << 8)
}

/** Degrees as deg/min/sec rationals (3 × 8 bytes). */
function encodeDmsRational(decimalDegrees: number): Uint8Array {
  const deg = Math.floor(decimalDegrees)
  const minFloat = (decimalDegrees - deg) * 60
  const min = Math.floor(minFloat)
  const sec = (minFloat - min) * 60

  const out = new Uint8Array(24)
  const view = new DataView(out.buffer)
  writeRational(view, 0, deg, 1)
  writeRational(view, 8, min, 1)
  // seconds with millisecond precision
  writeRational(view, 16, Math.round(sec * 10000), 10000)
  return out
}

function encodeRational(value: number, denom: number): Uint8Array {
  const out = new Uint8Array(8)
  const view = new DataView(out.buffer)
  writeRational(view, 0, Math.round(value * denom), denom)
  return out
}

function writeRational(view: DataView, offset: number, num: number, den: number): void {
  view.setUint32(offset, num >>> 0, true)
  view.setUint32(offset + 4, den >>> 0, true)
}

export function decimalToDmsString(decimal: number, isLat: boolean): string {
  const ref = isLat ? (decimal >= 0 ? 'N' : 'S') : decimal >= 0 ? 'E' : 'W'
  const abs = Math.abs(decimal)
  const deg = Math.floor(abs)
  const minFloat = (abs - deg) * 60
  const min = Math.floor(minFloat)
  const sec = (minFloat - min) * 60
  return `${deg}° ${min}' ${sec.toFixed(3)}" ${ref}`
}
