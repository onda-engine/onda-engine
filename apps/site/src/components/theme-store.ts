import { type Theme, defaultTheme } from '@onda-engine/components'
import { create } from 'zustand'

// Editable theme state for the gallery's config panel (Zustand). The panel
// mutates this; the preview reads it and feeds it to <ThemeProvider>. Stored as
// a Partial<Theme> (only what's been changed); everything else falls back to
// `defaultTheme` inside the components.

export interface ThemePreset {
  name: string
  theme: Partial<Theme>
}

/** Starting points users can load, then tweak. */
export const PRESETS: ThemePreset[] = [
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

interface ThemeStore {
  /** The working theme (overrides over `defaultTheme`). */
  theme: Partial<Theme>
  /** Which preset was last applied (for highlighting the chip). `''` = custom. */
  presetName: string
  /** Set a single token. */
  setField: <K extends keyof Theme>(key: K, value: Theme[K]) => void
  /** Set one palette slot. */
  setPaletteAt: (index: number, color: string) => void
  /** Set the body + heading font family together (the gallery's single control). */
  setFont: (family: string | undefined) => void
  /** Replace the whole theme (loading a preset). */
  apply: (preset: ThemePreset) => void
  /** Back to the house default. */
  reset: () => void
}

export const useThemeStore = create<ThemeStore>((set) => ({
  theme: {},
  presetName: 'Onda',
  setField: (key, value) => set((s) => ({ theme: { ...s.theme, [key]: value }, presetName: '' })),
  setPaletteAt: (index, color) =>
    set((s) => {
      const base = s.theme.palette ?? defaultTheme.palette
      const palette = base.map((c, i) => (i === index ? color : c))
      return { theme: { ...s.theme, palette }, presetName: '' }
    }),
  setFont: (family) =>
    set((s) => ({
      theme: { ...s.theme, fontFamily: family, headingFamily: family },
      presetName: '',
    })),
  apply: (preset) => set({ theme: preset.theme, presetName: preset.name }),
  reset: () => set({ theme: {}, presetName: 'Onda' }),
}))
