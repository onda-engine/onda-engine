import { type CompositionPayload, buildComposition } from '@onda/cinema'
import { Player } from '@onda/player'
import initCpu, { OndaEngine } from '@onda/wasm'
import initVello, { VelloEngine } from '@onda/wasm-vello'
import velloWasmUrl from '@onda/wasm-vello/pkg/onda_wasm_vello_bg.wasm?url'
import cpuWasmUrl from '@onda/wasm/pkg/onda_wasm_bg.wasm?url'
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'

// Where the composition payload lives. RELATIVE to the served app (NOT root-
// absolute) so the ONDA Studio MCP can drop `composition.json` next to this
// app's index.html in whatever directory it serves — works under any subdir.
const PAYLOAD_URL = './composition.json'

// How often to re-check the payload for changes. The agent edits the file and
// the preview picks it up within ~one interval — the user opens the page once
// and watches the comp form/change without refreshing.
const POLL_MS = 800

/** A payload is "renderable" only if it has at least one scene — otherwise
 *  `buildComposition` makes an empty <TransitionSeries> (a blank frame). */
function hasScenes(p: CompositionPayload | null): p is CompositionPayload {
  return Boolean(p && Array.isArray(p.scenes) && p.scenes.length > 0)
}

/** The fetched payload plus the raw JSON text it was parsed from. The raw text
 *  is the change signature — comparing it byte-for-byte is the cheapest, exact
 *  way to know the file changed (no hashing, no false positives from key order). */
interface Loaded {
  payload: CompositionPayload | null
  /** The raw response body the payload was parsed from. `null` for the empty/
   *  missing/error states, so a transient failure never matches a good payload. */
  raw: string | null
}

/** Fetch + parse the payload once. Throws on a network error / non-OK / bad
 *  JSON so the caller can decide whether to keep the last good composition. */
async function fetchPayload(): Promise<Loaded> {
  const res = await fetch(PAYLOAD_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`fetch ${PAYLOAD_URL}: ${res.status}`)
  const raw = await res.text()
  const payload = JSON.parse(raw) as CompositionPayload
  return { payload, raw }
}

export function App(): ReactElement {
  // Select the renderer on mount: the GPU engine (Vello over WebGPU) when
  // available, else the CPU engine. The Player prefers whichever it's given and
  // falls back to Canvas2D if neither is ready yet. (Mirrors apps/playground.)
  const [gpu, setGpu] = useState<VelloEngine | null>(null)
  const [cpu, setCpu] = useState<OndaEngine | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await initVello(velloWasmUrl)
        const engine = await VelloEngine.create()
        if (!cancelled) setGpu(engine)
      } catch {
        // No WebGPU here — fall back to the CPU engine.
        await initCpu(cpuWasmUrl)
        const engine = new OndaEngine()
        if (!cancelled) setCpu(engine)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // The fetched composition payload + the raw text it came from (the change
  // signature). `loading` distinguishes "still fetching" from "fetched, but
  // empty/missing" so we don't flash the empty state.
  const [loaded, setLoaded] = useState<Loaded>({ payload: null, raw: null })
  const [loading, setLoading] = useState(true)

  // The raw text of the LAST payload we accepted (good or empty). The poll only
  // rebuilds when the fetched text differs from this, so unchanged files are a
  // cheap no-op. A ref (not state) so it updates without re-running the poll.
  const lastRawRef = useRef<string | null>(null)

  // Initial load + live poll. After the first fetch, re-check on an interval;
  // when the raw JSON changes we accept the new payload (the keyed <Player>
  // below remounts on the new composition). A failed/malformed poll is ignored,
  // keeping the last good composition on screen — never blank out on a blip.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    const poll = async (isInitial: boolean) => {
      try {
        const next = await fetchPayload()
        if (cancelled) return
        // Unchanged file → nothing to do (cheap exact-text compare).
        if (!isInitial && next.raw === lastRawRef.current) return
        lastRawRef.current = next.raw
        setLoaded(next)
      } catch {
        // No payload yet / transient network error / malformed JSON. On the
        // initial load there's nothing to keep, so fall to the empty state.
        // On a later poll, keep the last good composition untouched.
        if (isInitial && !cancelled) {
          lastRawRef.current = null
          setLoaded({ payload: null, raw: null })
        }
      } finally {
        if (isInitial && !cancelled) setLoading(false)
      }
    }

    void poll(true)
    timer = setInterval(() => void poll(false), POLL_MS)

    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [])

  const { payload } = loaded

  // Build the `@onda/react` element from the payload (default registry pulls in
  // every `@onda/components` component). Guarded so a malformed payload renders
  // the empty state instead of crashing the whole preview.
  const composition = useMemo<ReactElement | null>(() => {
    if (!hasScenes(payload)) return null
    try {
      return buildComposition(payload)
    } catch (err) {
      console.error('buildComposition failed', err)
      return null
    }
  }, [payload])

  const ready = composition !== null && hasScenes(payload)

  // Preserve the scrub/playhead position across live swaps. The keyed <Player>
  // (below) remounts on every composition change — which it must, since the
  // Player derives its frame count + per-composition state once on mount — so we
  // stash the last frame here and hand it back as `initialFrame`. The Player
  // clamps it to the new comp's length, so a shorter new comp can't land out of
  // range. A ref (not state) so tracking the frame never re-renders App.
  const lastFrameRef = useRef(0)
  const onFrameUpdate = useCallback((f: number) => {
    lastFrameRef.current = f
  }, [])

  return (
    <main style={styles.main}>
      {ready ? (
        <>
          <header style={styles.bar}>
            <span style={styles.live} title="Auto-updating — edits appear automatically">
              <span style={styles.liveDot} aria-hidden="true" />
              live
            </span>
            <span style={styles.meta}>
              {payload.width}×{payload.height} · {payload.fps}fps · {payload.scenes.length}{' '}
              {payload.scenes.length === 1 ? 'scene' : 'scenes'}
            </span>
          </header>
          <section style={styles.stage}>
            <div
              style={{
                ...styles.frame,
                // Cap the player by both axes so it fits any viewport while
                // honoring the comp's aspect ratio (the Player's own stage sets
                // aspect-ratio internally from the composition).
                aspectRatio: `${payload.width} / ${payload.height}`,
              }}
            >
              <Player
                // Remount on each composition change for a clean, race-free swap:
                // the Player derives its frame count + per-composition state once
                // on mount, so a keyed remount is the reliable way to live-update.
                // `compositionKey` changes only when the raw payload text changes.
                key={compositionKey(loaded.raw)}
                composition={composition}
                gpuEngine={gpu ?? undefined}
                engine={cpu ?? undefined}
                loop
                controls="auto"
                initialFrame={lastFrameRef.current}
                onFrameUpdate={onFrameUpdate}
              />
            </div>
          </section>
        </>
      ) : (
        <div style={styles.empty}>
          <span style={styles.emptyText}>
            {loading ? 'Loading composition…' : 'No composition loaded yet.'}
          </span>
        </div>
      )}
    </main>
  )
}

/** A stable key derived from the raw payload text: changes exactly when the file
 *  changes, so the <Player> remounts on a new composition but not on unrelated
 *  re-renders (e.g. an engine arriving). Length + a cheap rolling checksum keeps
 *  it short while staying sensitive to any edit. */
function compositionKey(raw: string | null): string {
  if (!raw) return 'empty'
  let sum = 0
  for (let i = 0; i < raw.length; i++) {
    sum = (sum * 31 + raw.charCodeAt(i)) | 0
  }
  return `${raw.length}:${sum}`
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg)',
  },
  bar: {
    flex: '0 0 auto',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 16px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--surface)',
  },
  // "● live" pill: a tiny pulsing dot + label, so it's clear the preview auto-
  // updates. Sits at the start of the existing bar — no layout churn.
  live: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontFamily: 'var(--font-mono)',
    fontSize: 11.5,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    background: 'var(--ok, #6bbf8a)',
    boxShadow: '0 0 0 3px color-mix(in srgb, var(--ok, #6bbf8a) 25%, transparent)',
    animation: 'onda-live-pulse 1.8s ease-in-out infinite',
  },
  meta: {
    fontFamily: 'var(--font-mono)',
    fontSize: 12.5,
    letterSpacing: '0.02em',
    color: 'var(--text-muted)',
  },
  stage: {
    flex: '1 1 auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    minHeight: 0,
  },
  // Cap by both width and height so the player fits any viewport; the inline
  // aspect-ratio (from the payload) keeps the comp's shape, so bounding the
  // height via the aspect box also bounds the width.
  frame: {
    width: '100%',
    maxWidth: '100%',
    maxHeight: 'calc(100vh - 96px)',
  },
  empty: {
    flex: '1 1 auto',
    display: 'grid',
    placeItems: 'center',
    padding: 24,
  },
  emptyText: {
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-body)',
    fontSize: 16,
  },
}
