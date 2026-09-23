import exifr from 'exifr'
import {
  createExifApp1,
  createXmpApp1,
  getSegmentPayload,
  isExifApp1,
  isJpeg,
  isXmpApp1,
  parseJpeg,
  readJpegDimensions,
  rebuildJpeg,
  removeApp1Matching,
  replaceOrInsertApp1,
  XMP_HEADER,
} from './jpeg'
import { buildGpsExifTiff, type GpsCoords } from './exif-gps'
import {
  buildGPanoXmp,
  defaultGPanoForFullSphere,
  normalizeHeading,
  parseGPanoFromXmp,
  type GPanoFields,
} from './xmp-gpano'

export interface ImageMetadata {
  width: number
  height: number
  latitude?: number
  longitude?: number
  altitude?: number
  gpano: Partial<GPanoFields> | null
  aspectRatioWarning: boolean
}

export interface WriteOptions {
  latitude: number
  longitude: number
  altitude?: number
  poseHeadingDegrees: number
  posePitchDegrees?: number
  poseRollDegrees?: number
}

export async function readMetadata(bytes: Uint8Array): Promise<ImageMetadata> {
  if (!isJpeg(bytes)) {
    throw new Error('Only JPEG files are supported.')
  }

  const { width, height } = readJpegDimensions(bytes)
  const ratio = width / height
  const aspectRatioWarning = Math.abs(ratio - 2) > 0.05

  let latitude: number | undefined
  let longitude: number | undefined
  let altitude: number | undefined

  try {
    const gps = await exifr.gps(bytes)
    if (gps) {
      latitude = gps.latitude
      longitude = gps.longitude
    }
  } catch {
    // ignore GPS parse errors
  }

  try {
    const full = await exifr.parse(bytes, { gps: true, xmp: true, mergeOutput: true })
    if (full && typeof full.GPSAltitude === 'number') {
      altitude = full.GPSAltitude
    }
  } catch {
    // ignore
  }

  const gpano = extractGPano(bytes)

  return {
    width,
    height,
    latitude,
    longitude,
    altitude,
    gpano,
    aspectRatioWarning,
  }
}

export function writeMetadata(bytes: Uint8Array, options: WriteOptions): Uint8Array {
  if (!isJpeg(bytes)) {
    throw new Error('Only JPEG files are supported.')
  }

  const { width, height } = readJpegDimensions(bytes)
  let segments = parseJpeg(bytes)

  // Replace EXIF APP1 with a GPS-only EXIF (keeps file valid for Maps location)
  const gps: GpsCoords = {
    latitude: options.latitude,
    longitude: options.longitude,
  }
  if (options.altitude !== undefined && options.altitude !== null && !Number.isNaN(options.altitude)) {
    gps.altitude = options.altitude
  }
  const exifSeg = createExifApp1(buildGpsExifTiff(gps))
  segments = removeApp1Matching(segments, isExifApp1)
  segments = replaceOrInsertApp1(segments, () => false, exifSeg)

  // Build / replace XMP GPano
  const gpano: GPanoFields = {
    ...defaultGPanoForFullSphere(width, height, options.poseHeadingDegrees),
    poseHeadingDegrees: normalizeHeading(options.poseHeadingDegrees),
  }
  if (options.posePitchDegrees !== undefined) {
    gpano.posePitchDegrees = options.posePitchDegrees
  }
  if (options.poseRollDegrees !== undefined) {
    gpano.poseRollDegrees = options.poseRollDegrees
  }

  const xmpSeg = createXmpApp1(buildGPanoXmp(gpano))
  segments = removeApp1Matching(segments, isXmpApp1)
  segments = replaceOrInsertApp1(segments, () => false, xmpSeg)

  return rebuildJpeg(segments)
}

function extractGPano(bytes: Uint8Array): Partial<GPanoFields> | null {
  try {
    const segments = parseJpeg(bytes)
    for (const seg of segments) {
      if (!isXmpApp1(seg)) continue
      const payload = getSegmentPayload(seg)
      const headerLen = XMP_HEADER.length
      const xmlBytes = payload.slice(headerLen)
      const xml = new TextDecoder().decode(xmlBytes)
      return parseGPanoFromXmp(xml)
    }
  } catch {
    // ignore
  }
  return null
}

export function suggestOutputName(originalName: string): string {
  const base = originalName.replace(/\.(jpe?g)$/i, '')
  return `${base}-gpano.jpg`
}

export function isNearlyEquirectangular(width: number, height: number): boolean {
  return Math.abs(width / height - 2) <= 0.05
}
