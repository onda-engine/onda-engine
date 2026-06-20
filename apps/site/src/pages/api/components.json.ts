import type { APIRoute } from 'astro'
import {
  COMPONENT_FIDELITY,
  ENGINE_CAPABILITIES,
  FIDELITY_SUMMARY,
  RECOMMENDED_PALETTE,
} from 'onda-engine/components'
import { AUTHORING } from '../../components/authoring.js'
import { COMPONENT_PROPS } from '../../components/component-props.js'
import { GALLERY } from '../../components/gallery-data.js'
import { usageSnippet } from '../../components/snippet.js'
import { THEME_TOKENS } from '../../components/theme-spec.js'

// Machine-readable spec of onda-engine/components for ONDA Studio (and any LLM): every
// component's props (name/type/required/description — the description carries the
// theme-token default), a canonical usage snippet, its engine render FIDELITY
// (so the agent can prefer first-class, engine-native components and avoid ones
// that degrade or need the GPU), the theme token shape, the engine capability
// statement, and a composition-authoring guide. Generated at build time from the
// SAME source as the live gallery + onda-engine/components fidelity, so it can't drift.
// Served static at /api/components.json.
export const prerender = true

export const GET: APIRoute = () => {
  const components = GALLERY.map((g) => {
    const f = COMPONENT_FIDELITY[g.name]
    return {
      name: g.name,
      category: g.category,
      summary: g.blurb,
      // Engine render fidelity — the agent's signal to choose well.
      fidelity: f?.fidelity ?? 'first_class',
      engineNative: f?.engineNative ?? true,
      needsFeature: f?.needsFeature ?? null,
      backend: f?.backend ?? 'both',
      themeable: !!g.themed,
      wrapsChildren: !!g.child,
      previewNote: g.note ?? null,
      import: `import { ${g.name} } from 'onda-engine/components'`,
      usage: usageSnippet({ name: g.name, props: g.props, theme: {}, child: g.child }),
      props: COMPONENT_PROPS[g.name] ?? [],
    }
  })

  const body = {
    library: 'onda-engine/components',
    description:
      'Scene-graph React motion components for onda-engine/react. Compose them, export to scene-graph JSON, and render on the GPU (Vello) or CPU. A single <ThemeProvider theme={…}> brand kit re-skins a whole composition; an explicit prop on a component always overrides the theme.',
    count: components.length,
    themeableCount: components.filter((c) => c.themeable).length,
    // Pick first: the engine's strengths + what NOT to author for, the fidelity
    // tally, the safe palette, and how to assemble a composition.
    capabilities: ENGINE_CAPABILITIES,
    fidelitySummary: FIDELITY_SUMMARY,
    recommendedPalette: RECOMMENDED_PALETTE,
    authoring: AUTHORING,
    fidelityLegend: {
      fidelity:
        'first_class = faithful on native primitives · degraded = works but visibly off until `needsFeature` lands · apes_remotion = imitates a browser feature the engine omits (re-think, don’t chase).',
      engineNative:
        'true = what the engine does best (vector/layout/audio); false = imitates a browser effect.',
      backend:
        'both = renders on the CPU reference too (byte-identical CPU==GPU); gpu_only = needs Vello today (CPU reference lacks gradients/paths/strokes/video).',
      policy:
        'Prefer fidelity:first_class + engineNative:true. Reach for degraded only when the design demands it; never silently pick gpu_only for a CPU-verified render.',
    },
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
