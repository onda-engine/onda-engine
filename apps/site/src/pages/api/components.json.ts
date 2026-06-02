import type { APIRoute } from 'astro'
import { COMPONENT_PROPS } from '../../components/component-props.js'
import { GALLERY } from '../../components/gallery-data.js'
import { usageSnippet } from '../../components/snippet.js'
import { THEME_TOKENS } from '../../components/theme-spec.js'

// Machine-readable spec of @onda/components for ONDA Studio (and any LLM): every
// component's props (name/type/required/description — the description carries the
// theme-token default), a canonical usage snippet, and the theme token shape.
// Generated at build time from the SAME source as the live gallery, so it can't
// drift. Served static at /api/components.json.
export const prerender = true

export const GET: APIRoute = () => {
  const components = GALLERY.map((g) => ({
    name: g.name,
    category: g.category,
    summary: g.blurb,
    themeable: !!g.themed,
    wrapsChildren: !!g.child,
    previewNote: g.note ?? null,
    import: `import { ${g.name} } from '@onda/components'`,
    usage: usageSnippet({ name: g.name, props: g.props, theme: {}, child: g.child }),
    props: COMPONENT_PROPS[g.name] ?? [],
  }))

  const body = {
    library: '@onda/components',
    description:
      'Scene-graph React motion components for @onda/react. Compose them, export to scene-graph JSON, and render on the GPU (Vello) or CPU. A single <ThemeProvider theme={…}> brand kit re-skins a whole composition; an explicit prop on a component always overrides the theme.',
    count: components.length,
    themeableCount: components.filter((c) => c.themeable).length,
    theme: {
      apply:
        "Wrap a scene: <ThemeProvider theme={{ accent: '#…', background: '#…' }}>…</ThemeProvider>",
      notes:
        'theme is a Partial<Theme> — set only what you change; the rest falls back to the defaults below. Props named like a color/font default to a token (see each prop description). Font tokens name a *loaded* family; they do not ship the font.',
      tokens: THEME_TOKENS,
    },
    components,
  }

  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}
