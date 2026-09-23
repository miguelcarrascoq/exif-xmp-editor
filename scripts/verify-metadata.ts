/**
 * Smoke test: write GPano + GPS into a minimal JPEG and re-read.
 * Run: npx tsx scripts/verify-metadata.ts
 */
import { writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeMetadata, readMetadata } from '../src/lib/metadata.ts'
import { parseJpeg, isExifApp1, isXmpApp1, getSegmentPayload, XMP_HEADER } from '../src/lib/jpeg.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Minimal valid grayscale JPEG 2×1 (equirectangular aspect). */
function minimalJpeg2x1(): Uint8Array {
  // Hand-built: SOI + APP0 + SOF0 (2x1) + DHT + DQT + SOS + scan + EOI
  // Use a known-good tiny JPEG and we only care that SOF reports width/height;
  // for aspect warning we want 2:1 — generate via raw SOF if needed.
  // Base64 of a standard 2x1 yellow JPEG is awkward; build SOF-aware stub:

  // Simpler: use a real 1x1 JPEG then we accept aspect warning; still verify tags.
  const b64 =
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEABj8Cf//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAT8hf//Z'
  return Uint8Array.from(Buffer.from(b64, 'base64'))
}

async function main() {
  const input = minimalJpeg2x1()
  const out = writeMetadata(input, {
    latitude: -33.4489,
    longitude: -70.6693,
    altitude: 570,
    poseHeadingDegrees: 45,
    initialViewHeadingDegrees: 90,
    initialViewPitchDegrees: 10,
  })

  const tmp = resolve(__dirname, '../tmp-verify.jpg')
  writeFileSync(tmp, out)

  const segments = parseJpeg(out)
  const hasExif = segments.some(isExifApp1)
  const hasXmp = segments.some(isXmpApp1)
  if (!hasExif) throw new Error('Missing EXIF APP1')
  if (!hasXmp) throw new Error('Missing XMP APP1')

  const xmpSeg = segments.find(isXmpApp1)!
  const xml = new TextDecoder().decode(getSegmentPayload(xmpSeg).slice(XMP_HEADER.length))
  const required = [
    'ProjectionType',
    'equirectangular',
    'UsePanoramaViewer',
    'PoseHeadingDegrees',
    '45',
    'PosePitchDegrees',
    'InitialViewHeadingDegrees',
    '90',
    'InitialViewPitchDegrees',
    '10',
    'CroppedAreaImageWidthPixels',
    'FullPanoWidthPixels',
  ]
  for (const token of required) {
    if (!xml.includes(token)) throw new Error(`XMP missing: ${token}`)
  }
  if (!xml.includes('<GPano:PosePitchDegrees>0</GPano:PosePitchDegrees>')) {
    throw new Error('PosePitchDegrees must be 0 (horizon unlocked from look pitch)')
  }

  const meta = await readMetadata(out)
  if (meta.latitude === undefined || Math.abs(meta.latitude - -33.4489) > 0.001) {
    throw new Error(`GPS latitude mismatch: ${meta.latitude}`)
  }
  if (meta.longitude === undefined || Math.abs(meta.longitude - -70.6693) > 0.001) {
    throw new Error(`GPS longitude mismatch: ${meta.longitude}`)
  }
  if (!meta.gpano || meta.gpano.poseHeadingDegrees !== 45) {
    throw new Error(`GPano heading mismatch: ${JSON.stringify(meta.gpano)}`)
  }
  if (meta.gpano.posePitchDegrees !== 0) {
    throw new Error(`GPano pose pitch must be 0: ${meta.gpano.posePitchDegrees}`)
  }
  if (meta.gpano.initialViewHeadingDegrees !== 90) {
    throw new Error(`Initial view heading mismatch: ${meta.gpano.initialViewHeadingDegrees}`)
  }
  if (meta.gpano.initialViewPitchDegrees !== 10) {
    throw new Error(`Initial view pitch mismatch: ${meta.gpano.initialViewPitchDegrees}`)
  }

  console.log('OK — EXIF GPS + GPano XMP written and re-read successfully')
  console.log(`  dimensions: ${meta.width}×${meta.height}`)
  console.log(`  lat/lon: ${meta.latitude}, ${meta.longitude}`)
  console.log(`  pose heading: ${meta.gpano.poseHeadingDegrees}`)
  console.log(
    `  initial view: ${meta.gpano.initialViewHeadingDegrees}° / ${meta.gpano.initialViewPitchDegrees}°`,
  )
  console.log(`  output bytes: ${out.length} (saved ${tmp})`)

  // keep file for optional exiftool inspection; delete if clean env preferred
  try {
    unlinkSync(tmp)
  } catch {
    /* ignore */
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
