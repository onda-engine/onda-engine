import type { APIRoute } from 'astro'
import { GALLERY } from '../components/gallery-data.js'

// /llms.txt — an LLM-oriented index of the docs (https://llmstxt.org/). Points
// at the machine-readable component spec, the live gallery, and the key guides
// so an agent (e.g. ONDA Studio) can find the API fast. Generated at build time.
export const prerender = true

const SITE = 'https://onda.video'

export const GET: APIRoute = () => {
  const total = GALLERY.length
  const themeable = GALLERY.filter((g) => g.themed).length

  const txt = `# ONDA

> Open-source, GPU-native motion-graphics engine in Rust. Author compositions in React (\`@onda/react\`) → scene-graph JSON → a native GPU renderer (Vello) or a CPU reference, with a wasm path for in-browser preview. \`@onda/components\` is a ${total}-component motion library; a single \`<ThemeProvider theme={…}>\` brand kit re-skins a whole composition (${themeable} of ${total} components are themeable).

The scene graph is the universal language; the renderer is the platform. Components are pure React that emit scene nodes — no DOM, no browser at render time.

## Components

- [Component API (JSON)](${SITE}/api/components.json): machine-readable spec for all ${total} components — props (name, type, required, description with the theme-token default), a canonical usage snippet, and the theme token shape. Start here to generate compositions.
- [Component gallery](${SITE}/components): every component rendered live in the browser, with an editable theme/brand-kit configurator and copyable code.
- [Theming & brand kit](${SITE}/guide/theming): the Theme tokens and how \`<ThemeProvider>\` flows through the scene graph.

## Guides

- [What is ONDA?](${SITE}/guide/introduction)
- [Why not Remotion?](${SITE}/guide/why-onda)
- [Getting started](${SITE}/guide/getting-started)
- [Authoring with React](${SITE}/guide/authoring-react)
- [Rendering & export](${SITE}/guide/rendering)
- [Layout](${SITE}/guide/layout)
- [Typography & fonts](${SITE}/guide/typography)
- [Backends](${SITE}/guide/backends)

## Concepts

- [The scene graph](${SITE}/concepts/scene-graph)
- [Composition & nodes](${SITE}/concepts/composition)
- [Transforms, opacity & clip](${SITE}/concepts/transforms)

## API reference

- [@onda/react components](${SITE}/api/react)
- [Hooks](${SITE}/api/hooks)
- [Animation](${SITE}/api/animation)
- [Timeline (Sequence/Series/Loop)](${SITE}/api/timeline)
- [Scene-graph JSON](${SITE}/api/scene-json)
- [onda CLI](${SITE}/api/cli)
`

  return new Response(txt, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}
