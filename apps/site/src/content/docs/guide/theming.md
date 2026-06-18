---
title: "Theming & brand kit"
---

A **theme** is a small set of brand tokens — colors, fonts, a logo — that the
`@onda-engine/components` library reads for its defaults. Set it once and every themed
component comes out on-brand, without threading `color`/`fontFamily` props
through your whole composition.

This is the lever [ONDA Studio](/guide/introduction) pulls: the agent supplies
one brand kit and a whole video renders on-brand.

:::tip[Try it live]
The [component gallery](/components) has an editable theme configurator — change
the colors and fonts and watch the components re-skin in real time, then **Copy
theme** to get the exact object below.
:::

## Applying a theme

Wrap your scene in a `ThemeProvider`. Themed components below it pick up the
brand kit; an explicit prop on a component always wins over the theme.

```tsx
import { ThemeProvider, TitleCard, BarChart } from '@onda-engine/components'

const theme = {
  accent: '#3b82f6',
  background: '#070b14',
  surface: '#0e1626',
  palette: ['#64748b', '#22d3ee', '#a78bfa', '#34d399'],
}

export function Scene() {
  return (
    <ThemeProvider theme={theme}>
      <TitleCard title="Launch" subtitle="on-brand, automatically" />
    </ThemeProvider>
  )
}
```

`theme` is a `Partial<Theme>` — you only set what you want to change; everything
else falls back to the default. With **no** `ThemeProvider`, components render
with the house default, so existing compositions are unaffected.

Providers nest: a section can wrap a few children in another `ThemeProvider` to
tweak just a token or two.

## How it works

The theme flows through React context (the analogue of CSS variables — the scene
graph has no cascade), carried through `renderFrame` just like the current
frame. Because it's plain context, the same theme object drives the native
renderer, the CPU reference, and the in-browser wasm preview identically.

## Tokens

| Token | Type | Default | Used for |
| --- | --- | --- | --- |
| `accent` | `string` | `#d96b82` | The earned accent — bars, rules, highlights, glows |
| `accentSoft` | `string` | translucent accent | Fills/washes behind content |
| `text` | `string` | `#f2f2f4` | Primary text |
| `textMuted` | `string` | `#8e8e98` | Secondary / supporting text |
| `background` | `string` | `#0a0d17` | Canvas background |
| `surface` | `string` | `#121217` | Cards, panels, track fills |
| `border` | `string` | `#26262c` | Hairlines / borders |
| `palette` | `string[]` | 4 series colors | Multi-bar / multi-slice charts (after the accent) |
| `fontFamily` | `string?` | engine default | Body font family |
| `headingFamily` | `string?` | falls back to `fontFamily` | Heading font family |
| `monoFamily` | `string?` | generic mono | Code font family |
| `radius` | `number` | `14` | Base corner radius in px |
| `logo` | `{ src?; markup? }` | — | Brand logo for `LogoSting` / watermarks |

## Fonts are named, not shipped

A theme names a font *family*; it does not bundle the font file. The named family
must still be **loaded into the engine** — via `--font` on the
[CLI](/api/cli), or registered in the wasm engine for browser preview. The
bundled families (Open Sans, IBM Plex Sans) work everywhere out of the box; see
[Typography & fonts](/guide/typography).

## Which components are themed?

Themed components are flagged **Themeable** in the [gallery](/components). They
read `accent`, `text`, `surface`, the `palette`, and font families from the
theme, and every one accepts explicit props that override it.
