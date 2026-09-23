import { Viewer, events } from '@photo-sphere-viewer/core'
import '@photo-sphere-viewer/core/index.css'

const POSE_DECIMALS = 1

export interface PanoramaViewerOptions {
  container: HTMLElement
  /** Compass heading of the image center (PoseHeadingDegrees). */
  poseHeadingInput: HTMLInputElement
  /** Initial look direction in the world frame (InitialViewHeadingDegrees). */
  initialHeadingInput: HTMLInputElement
  /** Initial look pitch above the horizon (InitialViewPitchDegrees). */
  initialPitchInput: HTMLInputElement
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

/**
 * PSV yaw is relative to the image center. GPano InitialView* is relative to
 * real-world North / horizon. With PosePitch=0:
 *   initialHeading = poseHeading + yaw
 *   yaw = initialHeading - poseHeading
 */
export function initPanoramaViewer(options: PanoramaViewerOptions): PanoramaViewer {
  const { container, poseHeadingInput, initialHeadingInput, initialPitchInput } = options

  let viewer: Viewer | null = null
  let syncing = false

  function readViewerPosition(): { yaw: string; pitch: string } | null {
    const poseHeading = parsePose(poseHeadingInput.value) ?? 0
    const initialHeading = parsePose(initialHeadingInput.value)
    const initialPitch = parsePose(initialPitchInput.value)
    if (initialHeading === null || initialPitch === null) return null
    if (!isValidHeading(normalizeHeading(initialHeading)) || !isValidPitch(initialPitch)) {
      return null
    }
    const yaw = normalizeHeading(initialHeading - poseHeading)
    return {
      yaw: `${yaw}deg`,
      pitch: `${initialPitch}deg`,
    }
  }

  function writeInputsFromPosition(yawRad: number, pitchRad: number) {
    const poseHeading = parsePose(poseHeadingInput.value) ?? 0
    const yawDeg = radToDeg(yawRad)
    const initialHeading = normalizeHeading(poseHeading + yawDeg)
    const pitch = Math.max(-90, Math.min(90, radToDeg(pitchRad)))
    syncing = true
    initialHeadingInput.value = formatPose(initialHeading)
    initialPitchInput.value = formatPose(pitch)
    syncing = false
  }

  function rotateFromInputs() {
    if (!viewer || syncing) return
    const pose = readViewerPosition()
    if (!pose) return
    syncing = true
    viewer.rotate(pose)
    syncing = false
  }

  function onPositionUpdated(e: events.PositionUpdatedEvent) {
    if (syncing) return
    writeInputsFromPosition(e.position.yaw, e.position.pitch)
  }

  for (const input of [poseHeadingInput, initialHeadingInput, initialPitchInput]) {
    input.addEventListener('input', rotateFromInputs)
    input.addEventListener('change', rotateFromInputs)
  }

  async function ensureViewer(url: string): Promise<Viewer> {
    const pose = readViewerPosition()

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
