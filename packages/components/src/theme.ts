//! Theme — brand tokens shared across @onda/components.
//!
//! Set once with `<ThemeProvider theme={…}>` and every themed component reads its
//! color/font defaults from it; an explicit prop on a component always wins. This
//! is the lever ONDA Studio uses: the agent supplies one brand kit (colors,
//! fonts, logo) and a whole composition comes out on-brand, without threading
//! styling into every component.
//!
//! Mechanism: React Context (the scene graph has no CSS cascade, so this is the
//! analogue of ondajs's CSS variables). It flows through `renderFrame` just like
//! the frame context. With no provider, components use {@link defaultTheme}, so
//! existing compositions render identically.
//!
//! Font note: the engine renders a font *family name*; the font file must still
//! be loaded into the engine (`--font` on the CLI, or registered in the wasm
//! engine). The theme names the family — it does not ship fonts.

import { type ReactNode, createContext, createElement, useContext } from 'react'

export interface Theme {
  /** Primary brand color — the earned accent (bars, rules, highlights, glows). */
  accent: string
  /** A soft, translucent accent for fills/washes behind content. Must be an
   *  engine color (`#rrggbbaa`), not a CSS `rgba()` string — it is used directly
   *  as a scene fill. */
  accentSoft: string
  /** Primary text. */
  text: string
  /** Secondary / supporting text. */
  textMuted: string
  /** Canvas background. */
  background: string
  /** Cards / panels / surfaces. */
  surface: string
  /** Hairlines / borders. */
  border: string
  /** Extra series colors for multi-bar / multi-slice charts (after the accent). */
  palette: string[]
  /** Body font family (a *loaded* family name; `undefined` = the engine default). */
  fontFamily?: string
  /** Heading font family (falls back to `fontFamily`). */
  headingFamily?: string
  /** Monospace font family for code (falls back to a generic mono). */
  monoFamily?: string
  /** Base corner radius in px. */
  radius: number
  /** Brand logo, for `LogoSting` / watermarks / outros. */
  logo?: { src?: string; markup?: string }
}

/** The Onda house theme — the values components shipped with before theming. */
export const defaultTheme: Theme = {
  accent: '#e85494',
  accentSoft: '#e854942e',
  text: '#f2f2f4',
  textMuted: '#8e8e98',
  background: '#0a0d17',
  surface: '#121217',
  border: '#26262c',
  palette: ['#8e8e98', '#2974f2', '#e6b450', '#6bbf8a'],
  fontFamily: undefined,
  headingFamily: undefined,
  monoFamily: undefined,
  radius: 14,
}

const ThemeContext = createContext<Theme>(defaultTheme)

/** Read the active theme. Returns {@link defaultTheme} when there's no provider. */
export function useTheme(): Theme {
  return useContext(ThemeContext)
}

export interface ThemeProviderProps {
  /** Partial overrides merged over the inherited (or default) theme. */
  theme?: Partial<Theme>
  children?: ReactNode
}

/** Provide a theme to descendant components. Merges over any parent theme, so
 *  providers can nest (a section can tweak a few tokens). */
export function ThemeProvider({ theme, children }: ThemeProviderProps) {
  const parent = useContext(ThemeContext)
  const value = theme ? { ...parent, ...theme } : parent
  return createElement(ThemeContext.Provider, { value }, children)
}
