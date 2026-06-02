import * as Lib from '@onda/components'
import type { Theme } from '@onda/components'
import { Player } from '@onda/player'
import { AbsoluteFill, Composition, Rect, Text } from '@onda/react'
import velloWasmUrl from '@onda/wasm-vello/pkg/onda_wasm_vello_bg.wasm?url'
import cpuWasmUrl from '@onda/wasm/pkg/onda_wasm_bg.wasm?url'
import {
  type CSSProperties,
  type FunctionComponent,
  type ReactElement,
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { GALLERY, GALLERY_CATEGORIES, type GalleryItem } from './gallery-data.js'

// The component gallery — every @onda/components component, rendered live by the
// real engine (Vello/WebGPU, CPU fallback). One shared engine + one player; the
// list on the left swaps which composition plays. Mounted client-only so wasm/
// WebGPU never touches SSR; boots lazily when scrolled into view.

const W = 1280
const H = 720

// Demo themes the gallery can switch between, to show components re-skinning
// from a single brand kit. Each is a Partial<Theme> merged over the default.
// (Fonts kept to families the wasm engine bundles so they render in-browser.)
const THEMES: { name: string; theme: Partial<Theme> }[] = [
  { name: 'Onda', theme: {} },
  {
    name: 'Ocean',
    theme: {
      accent: '#3b82f6',
      accentSoft: 'rgba(59,130,246,0.16)',
      background: '#070b14',
      surface: '#0e1626',
      border: '#1c2740',
      palette: ['#64748b', '#22d3ee', '#a78bfa', '#34d399'],
    },
  },
  {
    name: 'Sunset',
    theme: {
      accent: '#f59e0b',
      accentSoft: 'rgba(245,158,11,0.16)',
      text: '#fff7ed',
      textMuted: '#b8a99a',
      background: '#140b06',
      surface: '#241405',
      border: '#3a2410',
      headingFamily: 'IBM Plex Sans',
      palette: ['#9a8478', '#ef4444', '#ec4899', '#22c55e'],
    },
  },
  {
    name: 'Mono',
    theme: {
      accent: '#e5e7eb',
      accentSoft: 'rgba(229,231,235,0.12)',
      text: '#fafafa',
      textMuted: '#a1a1aa',
      background: '#0a0a0a',
      surface: '#171717',
      border: '#262626',
      palette: ['#52525b', '#71717a', '#a1a1aa', '#d4d4d8'],
    },
  },
  {
    name: 'Light',
    theme: {
      accent: '#d96b82',
      text: '#0e0e12',
      textMuted: '#56565f',
      background: '#f5f5f7',
      surface: '#ffffff',
      border: '#e2e2e6',
      palette: ['#9aa4b2', '#2974f2', '#e6b450', '#6bbf8a'],
    },
  },
]

/** Sample content for the wrapper components (FadeIn, SlideIn, frames, …). */
function sampleChild(theme: Partial<Theme>): ReactElement {
  return createElement(
    AbsoluteFill,
    { justify: 'center', align: 'center' },
    createElement(Text, { fontSize: 132, color: theme.text ?? '#f2f2f4', fontWeight: 700 }, 'Onda'),
  )
}

function buildComposition(item: GalleryItem, theme: Partial<Theme>): ReactElement | null {
  const Comp = (Lib as Record<string, unknown>)[item.name] as
    | FunctionComponent<Record<string, unknown>>
    | undefined
  if (!Comp) return null
  // Wrap the scene in a ThemeProvider so themed components pick up the brand
  // kit; the background uses the theme too.
  return createElement(
    Composition,
    { width: W, height: H, fps: 30, durationInFrames: 120 },
    createElement(
      Lib.ThemeProvider,
      { theme },
      createElement(Rect, { width: W, height: H, fill: theme.background ?? '#0a0d17' }),
      createElement(Comp, item.props, item.child ? sampleChild(theme) : undefined),
    ),
  )
}

function useEngine() {
  // biome-ignore lint/suspicious/noExplicitAny: wasm engine types load dynamically.
  const [gpu, setGpu] = useState<any>(null)
  // biome-ignore lint/suspicious/noExplicitAny: wasm engine types load dynamically.
  const [cpu, setCpu] = useState<any>(null)
  const [active, setActive] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !('IntersectionObserver' in window)) {
      setActive(true)
      return
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setActive(true)
        io.disconnect()
      }
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    ;(async () => {
      try {
        const { default: initVello, VelloEngine } = await import('@onda/wasm-vello')
        await initVello({ module_or_path: velloWasmUrl })
        const engine = await VelloEngine.create()
        if (!cancelled) setGpu(engine)
      } catch {
        const { default: initCpu, OndaEngine } = await import('@onda/wasm')
        await initCpu({ module_or_path: cpuWasmUrl })
        const engine = new OndaEngine()
        if (!cancelled) setCpu(engine)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [active])

  return { ref, gpu, cpu, ready: gpu || cpu }
}

export default function OndaGallery(): ReactElement {
  const { ref, gpu, cpu, ready } = useEngine()
  const [name, setName] = useState('TitleCard')
  const [themeName, setThemeName] = useState('Onda')
  const selected = useMemo(() => GALLERY.find((g) => g.name === name) ?? GALLERY[0], [name])
  const theme = useMemo(() => THEMES.find((t) => t.name === themeName)?.theme ?? {}, [themeName])
  const composition = useMemo(
    () => (selected ? buildComposition(selected, theme) : null),
    [selected, theme],
  )

  const groups = useMemo(
    () =>
      GALLERY_CATEGORIES.map((cat) => ({
        cat,
        items: GALLERY.filter((g) => g.category === cat),
      })).filter((g) => g.items.length > 0),
    [],
  )

  return (
    <div ref={ref} style={styles.wrap}>
      <aside style={styles.list} aria-label="Components">
        <div style={styles.count}>{GALLERY.length} components</div>
        {groups.map(({ cat, items }) => (
          <div key={cat} style={styles.group}>
            <h2 style={styles.catTitle}>{cat}</h2>
            {items.map((it) => (
              <button
                key={it.name}
                type="button"
                onClick={() => setName(it.name)}
                style={it.name === name ? { ...styles.item, ...styles.itemOn } : styles.item}
              >
                {it.name}
              </button>
            ))}
          </div>
        ))}
      </aside>

      <div style={styles.main}>
        <div style={styles.themebar}>
          <span style={styles.themeLabel}>Theme</span>
          {THEMES.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => setThemeName(t.name)}
              style={
                t.name === themeName
                  ? { ...styles.themePill, ...styles.themePillOn }
                  : styles.themePill
              }
            >
              {t.name}
            </button>
          ))}
        </div>
        <div style={styles.stage}>
          {selected?.note ? (
            <div style={styles.note}>
              <span style={styles.noteIcon} aria-hidden="true">
                ⌧
              </span>
              <p>{selected.note}</p>
            </div>
          ) : ready && composition ? (
            <Player
              key={name}
              composition={composition}
              gpuEngine={gpu ?? undefined}
              engine={cpu ?? undefined}
              loop
            />
          ) : (
            <div style={styles.booting}>Booting the GPU engine…</div>
          )}
        </div>
        {selected ? (
          <div style={styles.meta}>
            <div style={styles.nameRow}>
              <h1 style={styles.name}>{selected.name}</h1>
              {selected.themed ? <span style={styles.themedTag}>Themeable</span> : null}
            </div>
            <p style={styles.blurb}>{selected.blurb}</p>
            <code
              style={styles.import}
            >{`import { ${selected.name} } from '@onda/components'`}</code>
          </div>
        ) : null}
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  wrap: {
    display: 'grid',
    gridTemplateColumns: 'minmax(220px, 280px) 1fr',
    gap: 28,
    alignItems: 'start',
    color: '#f2f2f4',
    fontFamily: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif",
  },
  list: {
    maxHeight: '80vh',
    overflowY: 'auto',
    paddingRight: 8,
    position: 'sticky',
    top: 24,
  },
  count: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: '#56565f',
    marginBottom: 16,
  },
  group: { marginBottom: 18 },
  catTitle: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: '#8e8e98',
    margin: '0 0 6px',
    fontWeight: 500,
  },
  item: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    appearance: 'none',
    border: 0,
    background: 'transparent',
    color: '#b8b8c0',
    fontFamily: 'inherit',
    fontSize: 14,
    padding: '5px 10px',
    borderRadius: 7,
    cursor: 'pointer',
  },
  itemOn: { background: '#d96b82', color: '#0e0e12', fontWeight: 600 },
  main: { minWidth: 0 },
  themebar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    flexWrap: 'wrap',
  },
  themeLabel: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: '#56565f',
    marginRight: 4,
  },
  themePill: {
    appearance: 'none',
    border: '1px solid #26262c',
    background: 'transparent',
    color: '#b8b8c0',
    fontFamily: 'inherit',
    fontSize: 13,
    padding: '5px 12px',
    borderRadius: 999,
    cursor: 'pointer',
  },
  themePillOn: {
    background: '#d96b82',
    border: '1px solid #d96b82',
    color: '#0e0e12',
    fontWeight: 600,
  },
  stage: {
    borderRadius: 14,
    overflow: 'hidden',
    background: '#08080a',
    border: '1px solid #26262c',
  },
  booting: {
    aspectRatio: '16 / 9',
    display: 'grid',
    placeItems: 'center',
    color: '#8e8e98',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 14,
  },
  note: {
    aspectRatio: '16 / 9',
    display: 'grid',
    placeItems: 'center',
    gap: 14,
    textAlign: 'center',
    padding: '0 12%',
    color: '#8e8e98',
    fontSize: 15,
    lineHeight: 1.6,
  },
  noteIcon: { fontSize: 30, color: '#56565f' },
  meta: { marginTop: 20 },
  nameRow: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 },
  themedTag: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    letterSpacing: '0.04em',
    color: '#6bbf8a',
    border: '1px solid rgba(107,191,138,0.4)',
    borderRadius: 999,
    padding: '2px 9px',
  },
  name: { fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: '-0.01em' },
  blurb: { color: '#8e8e98', fontSize: 16, margin: '0 0 14px', maxWidth: '60ch' },
  import: {
    display: 'inline-block',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    color: '#e89aac',
    background: '#121217',
    border: '1px solid #26262c',
    borderRadius: 8,
    padding: '8px 12px',
  },
}
