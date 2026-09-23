import { Viewer, events } from '@photo-sphere-viewer/core'
import '@photo-sphere-viewer/core/index.css'

const POSE_DECIMALS = 1

export interface PanoramaViewerOptions {
  container: HTMLElement
  headingInput: HTMLInputElement
  pitchInput: HTMLInputElement
}

export interface PanoramaViewer {
  setPanorama: (url: string) => Promise<void>
  syncFromInputs: () => void
  resize: () => void
  destroy: () => void
}

function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

function normalizeHeading(deg: number): number {
  const n = deg % 360
  return n < 0 ? n + 360 : n
}

function formatPose(n: number): string {
  return n.toFixed(POSE_DECIMALS)
}

function parsePose(value: string): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function isValidHeading(h: number): boolean {
  return h >= 0 && h < 360
}

function isValidPitch(p: number): boolean {
  return p >= -90 && p <= 90
}

export function initPanoramaViewer(options: PanoramaViewerOptions): PanoramaViewer {
  const { container, headingInput, pitchInput } = options

  let viewer: Viewer | null = null
  let syncing = false

  function readPoseFromInputs(): { yaw: string; pitch: string } | null {
    const heading = parsePose(headingInput.value)
    const pitch = parsePose(pitchInput.value)
    if (heading === null || pitch === null) return null
    if (!isValidHeading(heading) || !isValidPitch(pitch)) return null
    return {
      yaw: `${heading}deg`,
      pitch: `${pitch}deg`,
    }
  }

  function writeInputsFromPosition(yawRad: number, pitchRad: number) {
    const heading = normalizeHeading(radToDeg(yawRad))
    const pitch = Math.max(-90, Math.min(90, radToDeg(pitchRad)))
    syncing = true
    headingInput.value = formatPose(heading)
    pitchInput.value = formatPose(pitch)
    syncing = false
  }

  function rotateFromInputs() {
    if (!viewer || syncing) return
    const pose = readPoseFromInputs()
    if (!pose) return
    syncing = true
    viewer.rotate(pose)
    syncing = false
  }

  function onPositionUpdated(e: events.PositionUpdatedEvent) {
    if (syncing) return
    writeInputsFromPosition(e.position.yaw, e.position.pitch)
  }

  for (const input of [headingInput, pitchInput]) {
    input.addEventListener('input', rotateFromInputs)
    input.addEventListener('change', rotateFromInputs)
  }

  async function ensureViewer(url: string): Promise<Viewer> {
    const pose = readPoseFromInputs()

    if (viewer) {
      await viewer.setPanorama(url, {
        transition: false,
        ...(pose ? { position: pose } : {}),
      })
      return viewer
    }

    viewer = new Viewer({
      container,
      panorama: url,
      navbar: ['zoom', 'fullscreen'],
      defaultZoomLvl: 50,
      touchmoveTwoFingers: true,
      mousewheelCtrlKey: true,
      ...(pose
        ? { defaultYaw: pose.yaw, defaultPitch: pose.pitch }
        : {}),
    })

    viewer.addEventListener('position-updated', onPositionUpdated)

    await new Promise<void>((resolve) => {
      viewer!.addEventListener('ready', () => resolve(), { once: true })
    })

    return viewer
  }

  return {
    async setPanorama(url: string) {
      await ensureViewer(url)
    },

    syncFromInputs() {
      rotateFromInputs()
    },

    resize() {
      viewer?.autoSize()
    },

    destroy() {
      if (viewer) {
        viewer.removeEventListener('position-updated', onPositionUpdated)
        viewer.destroy()
        viewer = null
      }
      container.replaceChildren()
    },
  }
}
