import './styles.css'
import {
  readMetadata,
  suggestOutputName,
  writeMetadata,
  type ImageMetadata,
} from './lib/metadata'

interface AppState {
  file: File | null
  bytes: Uint8Array | null
  meta: ImageMetadata | null
  objectUrl: string | null
}

const state: AppState = {
  file: null,
  bytes: null,
  meta: null,
  objectUrl: null,
}

const app = document.querySelector<HTMLDivElement>('#app')!

app.innerHTML = `
  <header>
    <h1>EXIF / XMP Panorama Editor</h1>
    <p>
      Add GPS coordinates and Google Photo Sphere (GPano) XMP tags to equirectangular
      JPEG panoramas entirely in your browser. Prepared files can be recognized as
      photo spheres by Google Maps and similar viewers.
    </p>
  </header>

  <div class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="Select JPEG file">
    <strong>Drop an equirectangular JPEG here</strong>
    <span>or click to choose a file · processing stays on your device</span>
    <input type="file" id="file-input" accept="image/jpeg,.jpg,.jpeg" />
  </div>

  <div id="message"></div>

  <section class="panel" id="editor" hidden>
    <h2>Image &amp; metadata</h2>
    <div class="meta-row" id="meta-summary"></div>
    <div class="preview-wrap">
      <img id="preview" alt="Panorama preview" />
    </div>

    <form id="meta-form">
      <div class="form-grid">
        <label>
          <span>Latitude <span class="hint">(-90 … 90)</span></span>
          <input type="number" name="latitude" step="any" required />
        </label>
        <label>
          <span>Longitude <span class="hint">(-180 … 180)</span></span>
          <input type="number" name="longitude" step="any" required />
        </label>
        <label>
          <span>Altitude (m) <span class="hint">optional</span></span>
          <input type="number" name="altitude" step="any" />
        </label>
        <label>
          <span>Pose heading ° <span class="hint">0–360, center faces this compass bearing</span></span>
          <input type="number" name="heading" min="0" max="359.999" step="any" value="0" required />
        </label>
        <label>
          <span>Pose pitch ° <span class="hint">optional</span></span>
          <input type="number" name="pitch" min="-90" max="90" step="any" value="0" />
        </label>
        <label>
          <span>Pose roll ° <span class="hint">optional</span></span>
          <input type="number" name="roll" min="-180" max="180" step="any" value="0" />
        </label>
      </div>

      <ul class="checklist">
        <li>ProjectionType = equirectangular</li>
        <li>UsePanoramaViewer = True</li>
        <li>Full / cropped pano pixel sizes = image width × height</li>
        <li>GPS EXIF latitude / longitude written</li>
      </ul>

      <div class="actions">
        <button type="submit" class="primary" id="btn-download">Apply &amp; download</button>
        <button type="button" class="secondary" id="btn-clear">Clear</button>
      </div>
    </form>
  </section>

  <footer>
    Spec:
    <a href="https://developers.google.com/streetview/spherical-metadata" target="_blank" rel="noopener">
      Google Photo Sphere XMP
    </a>
    · Source intended for
    <a href="https://github.com/miguelcarrascoq/exif-xmp-editor" target="_blank" rel="noopener">
      miguelcarrascoq/exif-xmp-editor
    </a>
  </footer>
`

const dropzone = document.querySelector<HTMLDivElement>('#dropzone')!
const fileInput = document.querySelector<HTMLInputElement>('#file-input')!
const editor = document.querySelector<HTMLElement>('#editor')!
const message = document.querySelector<HTMLDivElement>('#message')!
const metaSummary = document.querySelector<HTMLDivElement>('#meta-summary')!
const preview = document.querySelector<HTMLImageElement>('#preview')!
const form = document.querySelector<HTMLFormElement>('#meta-form')!
const btnClear = document.querySelector<HTMLButtonElement>('#btn-clear')!

function showMessage(text: string, kind: 'warn' | 'error' | 'ok' | '') {
  if (!kind) {
    message.innerHTML = ''
    return
  }
  message.innerHTML = `<div class="banner ${kind}">${escapeHtml(text)}</div>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function revokePreview() {
  if (state.objectUrl) {
    URL.revokeObjectURL(state.objectUrl)
    state.objectUrl = null
  }
}

function clearState() {
  revokePreview()
  state.file = null
  state.bytes = null
  state.meta = null
  editor.hidden = true
  form.reset()
  showMessage('', '')
  fileInput.value = ''
}

async function loadFile(file: File) {
  showMessage('', '')
  if (!/\.jpe?g$/i.test(file.name) && file.type !== 'image/jpeg') {
    showMessage('Please select a JPEG file (.jpg / .jpeg).', 'error')
    return
  }

  try {
    const buffer = await file.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    const meta = await readMetadata(bytes)

    revokePreview()
    state.file = file
    state.bytes = bytes
    state.meta = meta
    state.objectUrl = URL.createObjectURL(file)
    preview.src = state.objectUrl

    metaSummary.innerHTML = `
      <span>File: <code>${escapeHtml(file.name)}</code></span>
      <span>Size: <code>${(file.size / 1024 / 1024).toFixed(2)} MB</code></span>
      <span>Dimensions: <code>${meta.width} × ${meta.height}</code></span>
      <span>Ratio: <code>${(meta.width / meta.height).toFixed(3)}</code></span>
    `

    const latInput = form.elements.namedItem('latitude') as HTMLInputElement
    const lonInput = form.elements.namedItem('longitude') as HTMLInputElement
    const altInput = form.elements.namedItem('altitude') as HTMLInputElement
    const headingInput = form.elements.namedItem('heading') as HTMLInputElement
    const pitchInput = form.elements.namedItem('pitch') as HTMLInputElement
    const rollInput = form.elements.namedItem('roll') as HTMLInputElement

    latInput.value =
      meta.latitude !== undefined ? String(meta.latitude) : ''
    lonInput.value =
      meta.longitude !== undefined ? String(meta.longitude) : ''
    altInput.value =
      meta.altitude !== undefined ? String(meta.altitude) : ''

    const heading =
      meta.gpano?.poseHeadingDegrees !== undefined
        ? meta.gpano.poseHeadingDegrees
        : 0
    headingInput.value = String(heading)
    pitchInput.value = String(meta.gpano?.posePitchDegrees ?? 0)
    rollInput.value = String(meta.gpano?.poseRollDegrees ?? 0)

    editor.hidden = false

    if (meta.aspectRatioWarning) {
      showMessage(
        'Aspect ratio is not ~2:1. Google products expect a full equirectangular sphere (width ≈ 2 × height). You can still write metadata.',
        'warn',
      )
    } else if (meta.gpano) {
      showMessage('Existing GPano XMP detected; values were loaded into the form where possible.', 'ok')
    }
  } catch (err) {
    clearState()
    const msg = err instanceof Error ? err.message : 'Failed to read file.'
    showMessage(msg, 'error')
  }
}

dropzone.addEventListener('click', () => fileInput.click())
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    fileInput.click()
  }
})

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  if (file) void loadFile(file)
})

;['dragenter', 'dragover'].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault()
    dropzone.classList.add('dragover')
  })
})

;['dragleave', 'drop'].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault()
    dropzone.classList.remove('dragover')
  })
})

dropzone.addEventListener('drop', (e) => {
  const dt = (e as DragEvent).dataTransfer
  const file = dt?.files?.[0]
  if (file) void loadFile(file)
})

btnClear.addEventListener('click', () => clearState())

form.addEventListener('submit', (e) => {
  e.preventDefault()
  if (!state.bytes || !state.file) return

  const fd = new FormData(form)
  const latitude = Number(fd.get('latitude'))
  const longitude = Number(fd.get('longitude'))
  const altitudeRaw = String(fd.get('altitude') ?? '').trim()
  const heading = Number(fd.get('heading'))
  const pitch = Number(fd.get('pitch'))
  const roll = Number(fd.get('roll'))

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    showMessage('Latitude must be between -90 and 90.', 'error')
    return
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    showMessage('Longitude must be between -180 and 180.', 'error')
    return
  }
  if (!Number.isFinite(heading) || heading < 0 || heading >= 360) {
    showMessage('Pose heading must be >= 0 and < 360.', 'error')
    return
  }

  try {
    const out = writeMetadata(state.bytes, {
      latitude,
      longitude,
      altitude: altitudeRaw === '' ? undefined : Number(altitudeRaw),
      poseHeadingDegrees: heading,
      posePitchDegrees: Number.isFinite(pitch) ? pitch : 0,
      poseRollDegrees: Number.isFinite(roll) ? roll : 0,
    })

    const blob = new Blob([new Uint8Array(out)], { type: 'image/jpeg' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = suggestOutputName(state.file.name)
    a.click()
    URL.revokeObjectURL(url)
    showMessage('Metadata written. Download started.', 'ok')
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to write metadata.'
    showMessage(msg, 'error')
  }
})
