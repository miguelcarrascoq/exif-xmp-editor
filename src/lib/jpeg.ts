/** JPEG segment markers and helpers for APP1 injection. */

export const SOI = 0xffd8
export const EOI = 0xffd9
export const APP0 = 0xffe0
export const APP1 = 0xffe1

export interface JpegSegment {
  marker: number
  /** Full segment including marker (2) + length (2) + payload, or raw bytes for entropy-coded data. */
  data: Uint8Array
  /** True for SOS + compressed image data through EOI. */
  isImageData?: boolean
}

const EXIF_HEADER = 'Exif\0\0'
const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0'

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8
}

export function parseJpeg(bytes: Uint8Array): JpegSegment[] {
  if (!isJpeg(bytes)) {
    throw new Error('Not a valid JPEG file (missing SOI).')
  }

  const segments: JpegSegment[] = []
  let offset = 2

  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      throw new Error(`Invalid JPEG: expected marker at offset ${offset}.`)
    }

    // Skip fill bytes
    while (offset < bytes.length && bytes[offset] === 0xff) {
      offset++
    }
    if (offset >= bytes.length) break

    const marker = 0xff00 | bytes[offset]
    offset++

    // Standalone markers without length
    if (marker === EOI) {
      segments.push({ marker, data: new Uint8Array([0xff, 0xd9]) })
      break
    }

    // SOS: length + scan header, then entropy-coded data until EOI
    if (marker === 0xffda) {
      if (offset + 2 > bytes.length) throw new Error('Truncated SOS segment.')
      const length = (bytes[offset] << 8) | bytes[offset + 1]
      const sosEnd = offset + length
      // Find EOI
      let eoi = bytes.length - 2
      for (let i = sosEnd; i < bytes.length - 1; i++) {
        if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
          eoi = i
          break
        }
      }
      const start = offset - 2 // include FF DA
      segments.push({
        marker,
        data: bytes.slice(start, eoi),
        isImageData: true,
      })
      if (eoi + 2 <= bytes.length && bytes[eoi] === 0xff && bytes[eoi + 1] === 0xd9) {
        segments.push({ marker: EOI, data: bytes.slice(eoi, eoi + 2) })
      }
      break
    }

    // Markers without payload
    if (marker >= 0xffd0 && marker <= 0xffd7) {
      segments.push({ marker, data: new Uint8Array([0xff, marker & 0xff]) })
      continue
    }

    if (offset + 2 > bytes.length) throw new Error('Truncated JPEG segment length.')
    const length = (bytes[offset] << 8) | bytes[offset + 1]
    const end = offset + length
    if (end > bytes.length) throw new Error('JPEG segment extends past end of file.')
    const start = offset - 2
    segments.push({ marker, data: bytes.slice(start, end) })
    offset = end
  }

  return segments
}

export function rebuildJpeg(segments: JpegSegment[]): Uint8Array {
  let total = 2 // SOI
  for (const seg of segments) total += seg.data.length
  const out = new Uint8Array(total)
  out[0] = 0xff
  out[1] = 0xd8
  let offset = 2
  for (const seg of segments) {
    out.set(seg.data, offset)
    offset += seg.data.length
  }
  return out
}

export function getSegmentPayload(segment: JpegSegment): Uint8Array {
  // marker(2) + length(2) + payload
  return segment.data.slice(4)
}

export function isExifApp1(segment: JpegSegment): boolean {
  if (segment.marker !== APP1) return false
  const payload = getSegmentPayload(segment)
  return startsWithAscii(payload, EXIF_HEADER)
}

export function isXmpApp1(segment: JpegSegment): boolean {
  if (segment.marker !== APP1) return false
  const payload = getSegmentPayload(segment)
  return startsWithAscii(payload, XMP_HEADER)
}

export function createApp1Segment(payload: Uint8Array): JpegSegment {
  // length field = payload length + 2 (the length bytes themselves)
  const length = payload.length + 2
  if (length > 0xffff) {
    throw new Error('APP1 segment too large for JPEG (max 65535 bytes including length).')
  }
  const data = new Uint8Array(2 + 2 + payload.length)
  data[0] = 0xff
  data[1] = 0xe1
  data[2] = (length >> 8) & 0xff
  data[3] = length & 0xff
  data.set(payload, 4)
  return { marker: APP1, data }
}

export function createExifApp1(tiffBytes: Uint8Array): JpegSegment {
  const header = asciiBytes(EXIF_HEADER)
  const payload = new Uint8Array(header.length + tiffBytes.length)
  payload.set(header, 0)
  payload.set(tiffBytes, header.length)
  return createApp1Segment(payload)
}

export function createXmpApp1(xmpXml: string): JpegSegment {
  const header = asciiBytes(XMP_HEADER)
  const xmlBytes = new TextEncoder().encode(xmpXml)
  const payload = new Uint8Array(header.length + xmlBytes.length)
  payload.set(header, 0)
  payload.set(xmlBytes, header.length)
  return createApp1Segment(payload)
}

export function replaceOrInsertApp1(
  segments: JpegSegment[],
  predicate: (s: JpegSegment) => boolean,
  next: JpegSegment,
): JpegSegment[] {
  const result = [...segments]
  const idx = result.findIndex(predicate)
  if (idx >= 0) {
    result[idx] = next
    return result
  }
  // Insert after any APP0, otherwise at the start of segments (after SOI in rebuild)
  let insertAt = 0
  for (let i = 0; i < result.length; i++) {
    if (result[i].marker === APP0 || result[i].marker === APP1) {
      insertAt = i + 1
    } else if (result[i].marker >= 0xffe0 && result[i].marker <= 0xffef) {
      insertAt = i + 1
    } else {
      break
    }
  }
  result.splice(insertAt, 0, next)
  return result
}

export function removeApp1Matching(
  segments: JpegSegment[],
  predicate: (s: JpegSegment) => boolean,
): JpegSegment[] {
  return segments.filter((s) => !predicate(s))
}

/** Read image dimensions from SOF0/SOF2 markers. */
export function readJpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  const segments = parseJpeg(bytes)
  for (const seg of segments) {
    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
    const m = seg.marker
    const isSof =
      (m >= 0xffc0 && m <= 0xffc3) ||
      (m >= 0xffc5 && m <= 0xffc7) ||
      (m >= 0xffc9 && m <= 0xffcb) ||
      (m >= 0xffcd && m <= 0xffcf)
    if (!isSof) continue
    const payload = getSegmentPayload(seg)
    // precision(1) + height(2) + width(2)
    if (payload.length < 5) continue
    const height = (payload[1] << 8) | payload[2]
    const width = (payload[3] << 8) | payload[4]
    return { width, height }
  }
  throw new Error('Could not read JPEG dimensions (SOF marker missing).')
}

function asciiBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

function startsWithAscii(bytes: Uint8Array, ascii: string): boolean {
  if (bytes.length < ascii.length) return false
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[i] !== (ascii.charCodeAt(i) & 0xff)) return false
  }
  return true
}

export { EXIF_HEADER, XMP_HEADER }
