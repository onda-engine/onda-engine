//! In-browser video-frame decoding for the Player.
//!
//! The wasm engine can't decode video, so the Player decodes the frame the scene
//! asks for — an off-screen `<video>` seeked to the node's source `time`, drawn
//! to a canvas — and hands it to the engine as that frame's pixels. Today the
//! hand-off reuses the engine's image path (a `data:` URI); a raw-buffer path
//! (no per-frame base64) layers on top of this same resolver later.
//!
//! Decoded frames are cached by `(src, time-bucket)` and shared across players,
//! so a looping preview decodes each distinct source frame at most once — the
//! first pass seeks, every pass after is a cache hit. Seeking is serialized per
//! source (one `<video>` element can only be at one `currentTime`).

/** Quantization of source time into cache buckets (frames per second). Two
 *  requested times within the same 1/30s bucket share a decoded frame. */
const BUCKET_FPS = 30

/** The minimal scene-node shape these walkers touch (a subset of `Scene`). */
interface VideoNode {
  transform?: { translate?: { x?: number; y?: number }; scale?: { x?: number; y?: number } }
  kind?: {
    type?: string
    src?: string
    time?: number
    width?: number
    height?: number
    fit?: 'fill' | 'cover' | 'contain'
    previewFallback?: 'skip' | 'element'
  }
  children?: VideoNode[]
}

/** A `previewFallback: 'element'` video to display via a DOM `<video>` overlay,
 *  positioned in COMPOSITION coordinates (the player scales it to the canvas). */
export interface VideoOverlay {
  key: string
  src: string
  x: number
  y: number
  w: number
  h: number
  fit: 'fill' | 'cover' | 'contain'
}

// One <video> per source URL — heavy, so created lazily and shared module-level.
const elements = new Map<string, Promise<HTMLVideoElement>>()
// Decoded frames: `${src}@${bucket}` -> data: URI. Shared across players.
const frameCache = new Map<string, string>()
// In-flight decodes, so concurrent requests for the same frame share one decode.
const inflight = new Map<string, Promise<string | null>>()
// Per-source serialization: a <video> can only seek to one time at a time.
const seekChain = new Map<string, Promise<unknown>>()
// Sources we've already warned about (so the console isn't spammed per frame).
const warned = new Set<string>()

/** Warn once, with actionable guidance, when a video can't be decoded for preview
 *  (almost always a cross-origin source the browser won't let us read pixels from). */
function warnUnresolved(src: string): void {
  if (warned.has(src) || typeof console === 'undefined') return
  warned.add(src)
  let crossOrigin = false
  try {
    crossOrigin =
      typeof location !== 'undefined' && new URL(src, location.href).origin !== location.origin
  } catch {
    /* relative/odd src — treat as same-origin */
  }
  const reason = crossOrigin
    ? '  • Cross-origin: the browser only reads frames from a same-origin file or one served with CORS (Access-Control-Allow-Origin). Host it with CORS or copy it into your project. YouTube/Vimeo page links are not media files and never work. Or set previewFallback="element" to play it in preview without compositing.'
    : '  • The source failed to load (wrong path / not a video file?).'
  console.warn(
    `[onda] couldn't decode video for PREVIEW: ${src}\n${reason}\n  • This is a preview-only limit — \`onda export\` (ffmpeg) decodes any direct URL regardless of CORS.`,
  )
}

let scratch: HTMLCanvasElement | null = null

function bucketKey(src: string, time: number): string {
  return `${src}@${Math.round(Math.max(0, time) * BUCKET_FPS)}`
}

/** Lazily create (and load) one muted `<video>` per source, reused across frames. */
function getVideo(src: string): Promise<HTMLVideoElement> {
  const existing = elements.get(src)
  if (existing) return existing
  const p = new Promise<HTMLVideoElement>((resolve, reject) => {
    const v = document.createElement('video')
    v.muted = true
    v.crossOrigin = 'anonymous'
    v.preload = 'auto'
    v.playsInline = true
    const cleanup = () => {
      v.removeEventListener('loadeddata', onReady)
      v.removeEventListener('error', onError)
    }
    const onReady = () => {
      cleanup()
      resolve(v)
    }
    const onError = () => {
      cleanup()
      reject(new Error(`video failed to load: ${src}`))
    }
    v.addEventListener('loadeddata', onReady)
    v.addEventListener('error', onError)
    v.src = src
    v.load()
  })
  elements.set(src, p)
  return p
}

/** Seek `v` to `t` seconds and resolve once the frame is ready. */
function seek(v: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    // Already on (close enough to) the target frame — no seek needed.
    if (v.readyState >= 2 && Math.abs(v.currentTime - t) < 1 / (BUCKET_FPS * 2)) {
      resolve()
      return
    }
    const onSeeked = () => {
      v.removeEventListener('seeked', onSeeked)
      resolve()
    }
    v.addEventListener('seeked', onSeeked)
    try {
      v.currentTime = t
    } catch {
      v.removeEventListener('seeked', onSeeked)
      resolve()
    }
  })
}

/** Decode one source frame to a `data:` URI, cached + per-source serialized.
 *  Returns `null` if the frame can't be decoded (load/seek/CORS failure). */
function decodeFrame(src: string, time: number): Promise<string | null> {
  const key = bucketKey(src, time)
  const cached = frameCache.get(key)
  if (cached) return Promise.resolve(cached)
  const pending = inflight.get(key)
  if (pending) return pending

  // Chain after any in-flight seek on this source so the <video> isn't seeked to
  // two times at once.
  const prior = seekChain.get(src) ?? Promise.resolve()
  const p = prior.then(async () => {
    const again = frameCache.get(key)
    if (again) return again
    try {
      const v = await getVideo(src)
      const dur = Number.isFinite(v.duration) ? v.duration : 0
      const t = dur > 0 ? Math.min(time, Math.max(0, dur - 1 / BUCKET_FPS)) : time
      await seek(v, t)
      const w = v.videoWidth
      const h = v.videoHeight
      if (!w || !h) return null
      if (!scratch) scratch = document.createElement('canvas')
      if (scratch.width !== w) scratch.width = w
      if (scratch.height !== h) scratch.height = h
      const ctx = scratch.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(v, 0, 0, w, h)
      const uri = scratch.toDataURL('image/jpeg', 0.82)
      frameCache.set(key, uri)
      return uri
    } catch {
      // Unreadable: failed to load (bad URL / 404), or a cross-origin source
      // without CORS headers (the canvas is tainted, so toDataURL throws). The
      // node is left unresolved and the renderer skips it.
      return null
    } finally {
      inflight.delete(key)
    }
  })
  inflight.set(key, p)
  seekChain.set(src, p)
  return p
}

/** Whether the scene contains any video node. */
export function hasVideo(node: VideoNode | undefined): boolean {
  if (!node) return false
  if (node.kind?.type === 'video') return true
  return (node.children ?? []).some(hasVideo)
}

/** Decode + attach the current frame for every video node in `root`, in place:
 *  rewrites each node's `src` to a `data:` URI of the requested source frame.
 *  Awaits all decodes; an undecodable frame is left as-is (the engine skips an
 *  unresolved src). No-op outside a browser. */
export async function resolveVideoFrames(root: VideoNode | undefined): Promise<void> {
  if (!root || typeof document === 'undefined') return
  const nodes: VideoNode[] = []
  const collect = (n: VideoNode | undefined) => {
    if (!n) return
    const src = n.kind?.type === 'video' ? n.kind.src : undefined
    // `previewFallback: 'element'` videos are shown via a DOM overlay instead of
    // composited — skip them here (don't decode, don't warn).
    if (
      typeof src === 'string' &&
      src.length > 0 &&
      !src.startsWith('data:') &&
      n.kind?.previewFallback !== 'element'
    ) {
      nodes.push(n)
    }
    for (const child of n.children ?? []) collect(child)
  }
  collect(root)
  // Sequential: video nodes commonly share one <video> element, which can only
  // hold one playhead — concurrent seeks would clobber each other.
  for (const n of nodes) {
    const src = n.kind?.src
    if (typeof src !== 'string') continue
    const time = typeof n.kind?.time === 'number' ? n.kind.time : 0
    const uri = await decodeFrame(src, time)
    if (uri && n.kind) n.kind.src = uri
    else if (!uri) warnUnresolved(src)
  }
}

/** Collect `previewFallback: 'element'` video nodes as positioned overlays (in
 *  composition coordinates — translate + scale accumulated from the root). The
 *  player renders a plain `<video>` at each box: a display-only preview for
 *  sources it can't composite (cross-origin without CORS). Box/position only —
 *  rotation, clip, and engine effects are not reflected (export still is). */
export function collectVideoOverlays(
  root: VideoNode | undefined,
  compWidth: number,
  compHeight: number,
): VideoOverlay[] {
  const out: VideoOverlay[] = []
  if (!root) return out
  let idx = 0
  const walk = (node: VideoNode, ax: number, ay: number, asx: number, asy: number): void => {
    const t = node.transform?.translate
    const s = node.transform?.scale
    const nx = ax + asx * (t?.x ?? 0)
    const ny = ay + asy * (t?.y ?? 0)
    const nsx = asx * (s?.x ?? 1)
    const nsy = asy * (s?.y ?? 1)
    const k = node.kind
    if (
      k?.type === 'video' &&
      k.previewFallback === 'element' &&
      typeof k.src === 'string' &&
      k.src.length > 0
    ) {
      out.push({
        key: `${k.src}#${idx++}`,
        src: k.src,
        x: nx,
        y: ny,
        w: (typeof k.width === 'number' ? k.width : compWidth) * nsx,
        h: (typeof k.height === 'number' ? k.height : compHeight) * nsy,
        fit: k.fit ?? 'cover',
      })
    }
    for (const child of node.children ?? []) walk(child, nx, ny, nsx, nsy)
  }
  walk(root, 0, 0, 1, 1)
  return out
}
