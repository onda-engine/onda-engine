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
import { CodeBlock } from './CodeBlock.js'
import ThemeControls from './ThemeControls.js'
import { COMPONENT_PROPS } from './component-props.js'
import { GALLERY, GALLERY_CATEGORIES, type GalleryItem } from './gallery-data.js'
import { usageSnippet } from './snippet.js'
import { useThemeStore } from './theme-store.js'

// The component gallery — every @onda/components component, rendered live by the
// real engine (Vello/WebGPU, CPU fallback). One shared engine + one player; the
// list on the left swaps which composition plays. Mounted client-only so wasm/
// WebGPU never touches SSR; boots lazily when scrolled into view.

const W = 1280
const H = 720

/** Sample content for the wrapper components (FadeIn, SlideIn, frames, …). */
function sampleChild(theme: Partial<Theme>): ReactElement {
  return createElement(
    AbsoluteFill,
    { justify: 'center', align: 'center' },
    createElement(Text, { fontSize: 132, color: theme.text ?? '#f2f2f4', fontWeight: 700 }, 'Onda'),
  )
}

function buildComposition(
  item: GalleryItem,
  theme: Partial<Theme>,
  props: Record<string, unknown>,
): ReactElement | null {
  const Comp = (Lib as Record<string, unknown>)[item.name] as
    | FunctionComponent<Record<string, unknown>>
    | undefined
  if (!Comp) return null
  // Wrap the scene in a ThemeProvider so themed components pick up the brand
  // kit; the background uses the theme too. `props` are the demo props merged
  // with any live control overrides (e.g. the visualizer `type` toggle).
  return createElement(
    Composition,
    { width: W, height: H, fps: 30, durationInFrames: 120 },
    createElement(
      Lib.ThemeProvider,
      { theme },
      createElement(Rect, { width: W, height: H, fill: theme.background ?? '#0a0d17' }),
      createElement(Comp, props, item.child ? sampleChild(theme) : undefined),
    ),
  )
}

/** A component's live controls (see {@link GalleryItem.controls}): a button-group
 *  toggle when the control has `options`, else a free-text input (e.g. a video
 *  URL). `defaults` supplies a text control's starting value (the demo prop). */
function ControlBar({
  controls,
  values,
  defaults,
  onChange,
}: {
  controls: NonNullable<GalleryItem['controls']>
  values: Record<string, string>
  defaults: Record<string, unknown>
  onChange: (prop: string, value: string) => void
}): ReactElement {
  return (
    <div style={styles.controls}>
      {controls.map((c) =>
        c.options ? (
          <div key={c.prop} style={styles.controlGroup}>
            <span style={styles.controlLabel}>{c.label}</span>
            <div style={styles.seg}>
              {c.options.map((opt) => {
                const active = (values[c.prop] ?? c.options?.[0]) === opt
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => onChange(c.prop, opt)}
                    style={active ? { ...styles.segBtn, ...styles.segBtnOn } : styles.segBtn}
                  >
                    {opt}
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <TextControl
            key={c.prop}
            label={c.label}
            placeholder={c.placeholder}
            hint={c.hint}
            value={values[c.prop] ?? (defaults[c.prop] != null ? String(defaults[c.prop]) : '')}
            onCommit={(v) => onChange(c.prop, v)}
          />
        ),
      )}
    </div>
  )
}

/** A free-text control (e.g. a video URL). Commits on Enter or blur, so the heavy
 *  preview doesn't re-render — or re-fetch a half-typed URL — on every keystroke. */
function TextControl({
  label,
  placeholder,
  hint,
  value,
  onCommit,
}: {
  label: string
  placeholder?: string
  hint?: string
  value: string
  onCommit: (value: string) => void
}): ReactElement {
  const [draft, setDraft] = useState(value)
  // Re-sync when the committed value changes externally (e.g. switching components).
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    if (draft !== value) onCommit(draft)
  }
  return (
    <div style={styles.textGroup}>
      <span style={styles.controlLabel}>{label}</span>
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit()
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        style={styles.textInput}
      />
      {hint ? <span style={styles.controlHint}>{hint}</span> : null}
    </div>
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
  const theme = useThemeStore((s) => s.theme)
  const selected = useMemo(() => GALLERY.find((g) => g.name === name) ?? GALLERY[0], [name])
  // Per-component live control overrides (e.g. the AudioVisualizer `type`).
  // Reset when switching components so one component's choice can't leak.
  const [ctrl, setCtrl] = useState<Record<string, string>>({})
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on name change.
  useEffect(() => {
    setCtrl({})
  }, [name])
  // Demo props merged with the live control overrides — feeds both the live
  // preview and the copyable snippet, so the code matches what's on screen.
  const effectiveProps = useMemo(() => {
    const base: Record<string, unknown> = { ...(selected?.props ?? {}) }
    for (const c of selected?.controls ?? []) {
      // Enum control → chosen option (or the first as default). Text control →
      // typed value, falling back to the demo prop value.
      base[c.prop] = c.options
        ? (ctrl[c.prop] ?? c.options[0] ?? '')
        : (ctrl[c.prop] ?? (base[c.prop] != null ? String(base[c.prop]) : ''))
    }
    return base
  }, [selected, ctrl])
  const composition = useMemo(
    () => (selected ? buildComposition(selected, theme, effectiveProps) : null),
    [selected, theme, effectiveProps],
  )
  // The copyable usage snippet — regenerated from the live theme, so editing a
  // color updates the emitted <ThemeProvider> object. This is the code a human
  // pastes and ONDA Studio consumes.
  const snippet = useMemo(
    () =>
      selected
        ? usageSnippet({
            name: selected.name,
            props: effectiveProps,
            theme,
            child: selected.child,
          })
        : '',
    [selected, theme, effectiveProps],
  )
  const props = selected ? (COMPONENT_PROPS[selected.name] ?? []) : []

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
        <ThemeControls />
        {selected?.controls?.length ? (
          <ControlBar
            controls={selected.controls}
            values={ctrl}
            defaults={selected.props}
            onChange={(prop, value) => setCtrl((s) => ({ ...s, [prop]: value }))}
          />
        ) : null}
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
              showStatus={false}
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

            <CodeBlock code={snippet} />

            {props.length ? (
              <div style={styles.propsBlock}>
                <span style={styles.sectionLabel}>Props</span>
                <table style={styles.table}>
                  <tbody>
                    {props.map((p) => (
                      <tr key={p.name} style={styles.tr}>
                        <td style={styles.tdName}>
                          {p.name}
                          {p.required ? <span style={styles.req}>*</span> : null}
                        </td>
                        <td style={styles.tdType}>{p.type}</td>
                        <td style={styles.tdDesc}>{p.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p style={styles.propsFoot}>
                  <span style={styles.req}>*</span> required · others optional. Colors/fonts default
                  to the theme above.
                </p>
              </div>
            ) : null}
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
  controls: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 14,
    margin: '0 0 12px',
  },
  controlGroup: { display: 'flex', alignItems: 'center', gap: 8 },
  textGroup: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, flex: '1 1 100%' },
  textInput: {
    flex: '1 1 320px',
    minWidth: 240,
    maxWidth: 560,
    background: '#121217',
    border: '1px solid #26262c',
    borderRadius: 8,
    color: '#e8e8ec',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    padding: '6px 10px',
  },
  controlHint: { flexBasis: '100%', color: '#56565f', fontSize: 11.5, marginTop: 2 },
  controlLabel: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#8e8e98',
  },
  seg: {
    display: 'inline-flex',
    gap: 2,
    padding: 2,
    borderRadius: 9,
    background: '#121217',
    border: '1px solid #26262c',
  },
  segBtn: {
    appearance: 'none',
    border: 0,
    background: 'transparent',
    color: '#b8b8c0',
    fontFamily: 'inherit',
    fontSize: 13,
    padding: '4px 11px',
    borderRadius: 7,
    cursor: 'pointer',
    textTransform: 'capitalize',
  },
  segBtnOn: { background: '#d96b82', color: '#0e0e12', fontWeight: 600 },
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
  blurb: { color: '#8e8e98', fontSize: 16, margin: '0 0 18px', maxWidth: '60ch' },
  sectionLabel: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: '#56565f',
  },
  propsBlock: { marginTop: 22 },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    marginTop: 8,
    fontSize: 14,
  },
  tr: { borderBottom: '1px solid #1c1c22', verticalAlign: 'top' },
  tdName: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    color: '#e89aac',
    padding: '7px 16px 7px 0',
    whiteSpace: 'nowrap',
  },
  tdType: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12.5,
    color: '#7fb38a',
    padding: '7px 16px 7px 0',
    whiteSpace: 'nowrap',
  },
  tdDesc: { color: '#9a9aa4', padding: '7px 0', lineHeight: 1.5 },
  req: { color: '#d96b82', marginLeft: 1 },
  propsFoot: { color: '#56565f', fontSize: 12.5, marginTop: 10 },
}
