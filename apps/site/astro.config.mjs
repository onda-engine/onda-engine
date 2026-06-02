import mdx from '@astrojs/mdx'
import react from '@astrojs/react'
import starlight from '@astrojs/starlight'
import { defineConfig } from 'astro/config'

// ONDA — unified marketing landing (src/pages/index.astro) + documentation
// (Starlight, src/content/docs/**). Static output: `astro build` -> ./dist,
// hostable on any static host (Cloudflare Pages / Netlify / Vercel) with no
// server. Branding follows assets/brand/BRAND.md (onda.video-aligned).
const REPO = 'https://github.com/degueba/onda-engine'

export default defineConfig({
  site: 'https://onda.video',
  // Pin dev/preview to one port so `pnpm dev` is always http://localhost:4330
  // (no auto-incrementing to a new port every run).
  server: { port: 4330 },
  // The dev-toolbar overlay is dev-only noise here (and its lazy entrypoint
  // throws a transient Vite "504 Outdated Optimize Dep" on first load); off.
  devToolbar: { enabled: false },
  integrations: [
    starlight({
      title: 'ONDA',
      description:
        'Motion graphics at GPU speed. No browser. An open-source, GPU-native motion-graphics engine in Rust.',
      logo: { src: './src/assets/onda-mark.svg' },
      favicon: '/favicon.svg',
      customCss: ['./src/styles/brand.css'],
      social: [{ icon: 'github', label: 'GitHub', href: REPO }],
      editLink: { baseUrl: `${REPO}/edit/main/apps/site/` },
      // Fonts: Clash Display (headings, Fontshare), Space Grotesk (body, Google),
      // JetBrains Mono (code/labels, Google).
      head: [
        { tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' } },
        {
          tag: 'link',
          attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: true },
        },
        {
          tag: 'link',
          attrs: { rel: 'preconnect', href: 'https://api.fontshare.com', crossorigin: true },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: 'https://api.fontshare.com/v2/css?f[]=clash-display@600,700&display=swap',
          },
        },
        {
          tag: 'link',
          attrs: {
            rel: 'stylesheet',
            href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Space+Grotesk:wght@400;500;600;700&display=swap',
          },
        },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#0e0e12' } },
      ],
      sidebar: [
        {
          label: 'Introduction',
          items: [
            { label: 'What is ONDA?', link: '/guide/introduction' },
            { label: 'Why not Remotion?', link: '/guide/why-onda' },
            { label: 'Getting started', link: '/guide/getting-started' },
          ],
        },
        {
          label: 'Authoring',
          items: [
            { label: 'Authoring with React', link: '/guide/authoring-react' },
            { label: 'Rendering & export', link: '/guide/rendering' },
            { label: 'Layout', link: '/guide/layout' },
            { label: 'Typography & fonts', link: '/guide/typography' },
            { label: 'Backends', link: '/guide/backends' },
            { label: 'SVG import', link: '/guide/svg' },
          ],
        },
        {
          label: 'Reference',
          items: [{ label: 'Architecture', link: '/guide/architecture' }],
        },
        {
          label: 'Concepts',
          items: [
            { label: 'The scene graph', link: '/concepts/scene-graph' },
            { label: 'Composition & nodes', link: '/concepts/composition' },
            { label: 'Transforms, opacity & clip', link: '/concepts/transforms' },
          ],
        },
        {
          label: '@onda/react',
          items: [
            { label: 'Components', link: '/api/react' },
            { label: 'Hooks', link: '/api/hooks' },
            { label: 'Animation', link: '/api/animation' },
            { label: 'Timeline (Sequence/Series/Loop)', link: '/api/timeline' },
            { label: 'Render functions', link: '/api/render' },
            { label: 'Scene-graph JSON', link: '/api/scene-json' },
          ],
        },
        {
          label: 'onda CLI',
          items: [{ label: 'Command reference', link: '/api/cli' }],
        },
        {
          label: 'Examples',
          items: [
            { label: 'Overview', link: '/examples/' },
            { label: 'Live demo', link: '/examples/live', badge: 'new' },
            { label: 'Hello ONDA', link: '/examples/hello' },
            { label: 'Animated title', link: '/examples/animated' },
            { label: 'Vector (paths, gradients, clip)', link: '/examples/vector' },
            { label: 'SVG import', link: '/examples/svg' },
          ],
        },
      ],
    }),
    // React islands — for live @onda/react + @onda/player demos (client-only).
    react(),
    // MDX — lets doc pages embed React islands (e.g. the live player demo).
    mdx(),
  ],
})
