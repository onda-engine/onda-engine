import { defaultTheme } from '@onda/components'
import type { CSSProperties, ReactElement } from 'react'
import { PRESETS, useThemeStore } from './theme-store.js'

// The theme configurator for the gallery — set up a brand kit (colors + font)
// and watch the themed components re-skin live. Backed by the Zustand store; the
// gallery reads the same store and feeds it to <ThemeProvider>.

type ColorKey = 'accent' | 'text' | 'textMuted' | 'background' | 'surface' | 'border'
const COLORS: { key: ColorKey; label: string }[] = [
  { key: 'accent', label: 'Accent' },
  { key: 'text', label: 'Text' },
  { key: 'textMuted', label: 'Muted' },
  { key: 'background', label: 'Background' },
  { key: 'surface', label: 'Surface' },
  { key: 'border', label: 'Border' },
]

// Families the wasm engine bundles (so they actually render in-browser).
const FONTS = [
  { label: 'Default', value: '' },
  { label: 'Open Sans', value: 'Open Sans' },
  { label: 'IBM Plex Sans', value: 'IBM Plex Sans' },
]

function Swatch({
  label,
  value,
  onChange,
}: { label: string; value: string; onChange: (v: string) => void }): ReactElement {
  return (
    <label style={styles.swatch}>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={styles.colorInput}
        aria-label={label}
      />
      <span style={styles.swatchLabel}>{label}</span>
    </label>
  )
}

export default function ThemeControls(): ReactElement {
  const theme = useThemeStore((s) => s.theme)
  const presetName = useThemeStore((s) => s.presetName)
  const setField = useThemeStore((s) => s.setField)
  const setPaletteAt = useThemeStore((s) => s.setPaletteAt)
  const setFont = useThemeStore((s) => s.setFont)
  const apply = useThemeStore((s) => s.apply)
  const reset = useThemeStore((s) => s.reset)

  const palette = theme.palette ?? defaultTheme.palette
  const font = theme.fontFamily ?? ''

  return (
    <div style={styles.panel}>
      {/* Presets — a starting point you can then tweak. */}
      <div style={styles.row}>
        <span style={styles.section}>Preset</span>
        {PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={() => apply(p)}
            style={p.name === presetName ? { ...styles.chip, ...styles.chipOn } : styles.chip}
          >
            {p.name}
          </button>
        ))}
        <button type="button" onClick={reset} style={styles.resetBtn}>
          Reset
        </button>
      </div>

      {/* Colors + palette + font. */}
      <div style={styles.row}>
        <span style={styles.section}>Colors</span>
        {COLORS.map(({ key, label }) => (
          <Swatch
            key={key}
            label={label}
            value={theme[key] ?? defaultTheme[key]}
            onChange={(v) => setField(key, v)}
          />
        ))}
        <span style={{ ...styles.section, marginLeft: 8 }}>Palette</span>
        {palette.slice(0, 4).map((c, i) => (
          <Swatch
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length palette slots
            key={i}
            label={`#${i + 1}`}
            value={c}
            onChange={(v) => setPaletteAt(i, v)}
          />
        ))}
        <label style={{ ...styles.swatch, marginLeft: 8 }}>
          <select
            value={font}
            onChange={(e) => setFont(e.target.value || undefined)}
            style={styles.select}
            aria-label="Font family"
          >
            {FONTS.map((f) => (
              <option key={f.label} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <span style={styles.swatchLabel}>Font</span>
        </label>
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    marginBottom: 16,
    padding: 14,
    border: '1px solid #26262c',
    borderRadius: 12,
    background: '#0c0c10',
  },
  row: { display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' },
  section: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: '#56565f',
    alignSelf: 'center',
    marginRight: 2,
  },
  chip: {
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
  chipOn: { background: '#d96b82', border: '1px solid #d96b82', color: '#0e0e12', fontWeight: 600 },
  // A text action, pushed to the far right of the preset row — not a preset chip.
  resetBtn: {
    marginLeft: 'auto',
    appearance: 'none',
    border: 0,
    background: 'transparent',
    color: '#8e8e98',
    fontFamily: 'inherit',
    fontSize: 13,
    padding: '5px 4px',
    cursor: 'pointer',
    textDecoration: 'underline',
    textUnderlineOffset: 3,
  },
  swatch: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 },
  swatchLabel: {
    fontSize: 10,
    color: '#8e8e98',
    fontFamily: "'JetBrains Mono', monospace",
  },
  colorInput: {
    width: 34,
    height: 28,
    padding: 0,
    border: '1px solid #26262c',
    borderRadius: 8,
    background: 'transparent',
    cursor: 'pointer',
  },
  select: {
    appearance: 'none',
    border: '1px solid #26262c',
    borderRadius: 8,
    background: '#121217',
    color: '#f2f2f4',
    fontFamily: 'inherit',
    fontSize: 13,
    padding: '6px 10px',
    cursor: 'pointer',
  },
}
