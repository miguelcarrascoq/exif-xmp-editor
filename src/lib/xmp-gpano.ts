/**
 * Google Photo Sphere (GPano) XMP metadata builder.
 * Spec: https://developers.google.com/streetview/spherical-metadata
 */

export interface GPanoFields {
  usePanoramaViewer: boolean
  projectionType: 'equirectangular'
  poseHeadingDegrees: number
  posePitchDegrees?: number
  poseRollDegrees?: number
  croppedAreaLeftPixels: number
  croppedAreaTopPixels: number
  croppedAreaImageWidthPixels: number
  croppedAreaImageHeightPixels: number
  fullPanoWidthPixels: number
  fullPanoHeightPixels: number
  stitchingSoftware?: string
  captureSoftware?: string
  initialViewHeadingDegrees?: number
  initialViewPitchDegrees?: number
  initialViewRollDegrees?: number
  initialHorizontalFOVDegrees?: number
}

export function defaultGPanoForFullSphere(
  width: number,
  height: number,
  poseHeadingDegrees = 0,
): GPanoFields {
  return {
    usePanoramaViewer: true,
    projectionType: 'equirectangular',
    poseHeadingDegrees: normalizeHeading(poseHeadingDegrees),
    posePitchDegrees: 0,
    poseRollDegrees: 0,
    croppedAreaLeftPixels: 0,
    croppedAreaTopPixels: 0,
    croppedAreaImageWidthPixels: width,
    croppedAreaImageHeightPixels: height,
    fullPanoWidthPixels: width,
    fullPanoHeightPixels: height,
    stitchingSoftware: 'exif-xmp-editor',
  }
}

export function normalizeHeading(degrees: number): number {
  let h = degrees % 360
  if (h < 0) h += 360
  if (h >= 360) h = 0
  return h
}

export function parseGPanoFromXmp(xmpXml: string): Partial<GPanoFields> | null {
  if (!xmpXml.includes('GPano') && !xmpXml.includes('ns.google.com/photos/1.0/panorama')) {
    return null
  }

  const get = (name: string): string | undefined => {
    const attr = new RegExp(`GPano:${name}="([^"]*)"`, 'i').exec(xmpXml)
    if (attr) return attr[1]
    const elem = new RegExp(`<GPano:${name}[^>]*>([^<]*)</GPano:${name}>`, 'i').exec(xmpXml)
    if (elem) return elem[1]
    return undefined
  }

  const num = (name: string): number | undefined => {
    const v = get(name)
    if (v === undefined || v === '') return undefined
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }

  const bool = (name: string): boolean | undefined => {
    const v = get(name)
    if (v === undefined) return undefined
    return /^(true|1)$/i.test(v.trim())
  }

  return {
    usePanoramaViewer: bool('UsePanoramaViewer'),
    projectionType: 'equirectangular',
    poseHeadingDegrees: num('PoseHeadingDegrees'),
    posePitchDegrees: num('PosePitchDegrees'),
    poseRollDegrees: num('PoseRollDegrees'),
    croppedAreaLeftPixels: num('CroppedAreaLeftPixels'),
    croppedAreaTopPixels: num('CroppedAreaTopPixels'),
    croppedAreaImageWidthPixels: num('CroppedAreaImageWidthPixels'),
    croppedAreaImageHeightPixels: num('CroppedAreaImageHeightPixels'),
    fullPanoWidthPixels: num('FullPanoWidthPixels'),
    fullPanoHeightPixels: num('FullPanoHeightPixels'),
    stitchingSoftware: get('StitchingSoftware'),
    captureSoftware: get('CaptureSoftware'),
    initialViewHeadingDegrees: num('InitialViewHeadingDegrees'),
    initialViewPitchDegrees: num('InitialViewPitchDegrees'),
    initialViewRollDegrees: num('InitialViewRollDegrees'),
    initialHorizontalFOVDegrees: num('InitialHorizontalFOVDegrees'),
  }
}

export function buildGPanoXmp(fields: GPanoFields): string {
  const boolStr = (v: boolean) => (v ? 'True' : 'False')
  const lines: string[] = [
    `<GPano:UsePanoramaViewer>${boolStr(fields.usePanoramaViewer)}</GPano:UsePanoramaViewer>`,
    `<GPano:ProjectionType>${fields.projectionType}</GPano:ProjectionType>`,
    `<GPano:PoseHeadingDegrees>${fields.poseHeadingDegrees}</GPano:PoseHeadingDegrees>`,
  ]

  if (fields.posePitchDegrees !== undefined) {
    lines.push(`<GPano:PosePitchDegrees>${fields.posePitchDegrees}</GPano:PosePitchDegrees>`)
  }
  if (fields.poseRollDegrees !== undefined) {
    lines.push(`<GPano:PoseRollDegrees>${fields.poseRollDegrees}</GPano:PoseRollDegrees>`)
  }
  if (fields.stitchingSoftware) {
    lines.push(
      `<GPano:StitchingSoftware>${escapeXml(fields.stitchingSoftware)}</GPano:StitchingSoftware>`,
    )
  }
  if (fields.captureSoftware) {
    lines.push(
      `<GPano:CaptureSoftware>${escapeXml(fields.captureSoftware)}</GPano:CaptureSoftware>`,
    )
  }
  if (fields.initialViewHeadingDegrees !== undefined) {
    lines.push(
      `<GPano:InitialViewHeadingDegrees>${fields.initialViewHeadingDegrees}</GPano:InitialViewHeadingDegrees>`,
    )
  }
  if (fields.initialViewPitchDegrees !== undefined) {
    lines.push(
      `<GPano:InitialViewPitchDegrees>${fields.initialViewPitchDegrees}</GPano:InitialViewPitchDegrees>`,
    )
  }
  if (fields.initialViewRollDegrees !== undefined) {
    lines.push(
      `<GPano:InitialViewRollDegrees>${fields.initialViewRollDegrees}</GPano:InitialViewRollDegrees>`,
    )
  }
  if (fields.initialHorizontalFOVDegrees !== undefined) {
    lines.push(
      `<GPano:InitialHorizontalFOVDegrees>${fields.initialHorizontalFOVDegrees}</GPano:InitialHorizontalFOVDegrees>`,
    )
  }

  lines.push(
    `<GPano:CroppedAreaLeftPixels>${fields.croppedAreaLeftPixels}</GPano:CroppedAreaLeftPixels>`,
    `<GPano:CroppedAreaTopPixels>${fields.croppedAreaTopPixels}</GPano:CroppedAreaTopPixels>`,
    `<GPano:CroppedAreaImageWidthPixels>${fields.croppedAreaImageWidthPixels}</GPano:CroppedAreaImageWidthPixels>`,
    `<GPano:CroppedAreaImageHeightPixels>${fields.croppedAreaImageHeightPixels}</GPano:CroppedAreaImageHeightPixels>`,
    `<GPano:FullPanoWidthPixels>${fields.fullPanoWidthPixels}</GPano:FullPanoWidthPixels>`,
    `<GPano:FullPanoHeightPixels>${fields.fullPanoHeightPixels}</GPano:FullPanoHeightPixels>`,
  )

  // Standard XMP packet with GPano namespace
  return [
    '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description rdf:about=""',
    ' xmlns:GPano="http://ns.google.com/photos/1.0/panorama/">',
    ...lines,
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    // Padding helps some editors rewrite in-place; keep modest for APP1 size limits
    '<?xpacket end="w"?>',
  ].join('\n')
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
