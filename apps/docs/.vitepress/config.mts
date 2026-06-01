import { defineConfig } from 'vitepress'

// ONDA docs — GPU-native, browser-free motion-graphics engine in Rust.
// Branding (colors, fonts, logo) follows assets/brand/BRAND.md.
const REPO = 'https://github.com/degueba/onda-engine'

export default defineConfig({
  title: 'ONDA',
  description:
    'Motion graphics at GPU speed. No browser. An open-source, GPU-native motion-graphics engine in Rust.',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,
  appearance: 'dark',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#0e0e12' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'ONDA — programmatic motion graphics, without Chromium' }],
    ['meta', {
      property: 'og:description',
      content: 'GPU-native vector rendering in Rust. Author in React/JSX, compile to a scene graph, render with no browser anywhere.',
    }],
    // Fonts: Clash Display (headings, Fontshare), Space Grotesk (body, Google),
    // JetBrains Mono (code/labels, Google).
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'preconnect', href: 'https://api.fontshare.com', crossorigin: '' }],
    ['link', {
      rel: 'stylesheet',
      href: 'https://api.fontshare.com/v2/css?f[]=clash-display@600,700&display=swap',
    }],
    ['link', {
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap',
    }],
  ],

  themeConfig: {
    logo: '/onda-mark.svg',
    siteTitle: 'ONDA',

    nav: [
      { text: 'Guide', link: '/guide/introduction', activeMatch: '/guide/' },
      { text: 'Concepts', link: '/concepts/scene-graph', activeMatch: '/concepts/' },
      { text: 'API', link: '/api/react', activeMatch: '/api/' },
      { text: 'Examples', link: '/examples/', activeMatch: '/examples/' },
      { text: 'GitHub', link: REPO },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          collapsed: false,
          items: [
            { text: 'What is ONDA?', link: '/guide/introduction' },
            { text: 'Why not Remotion?', link: '/guide/why-onda' },
            { text: 'Getting started', link: '/guide/getting-started' },
          ],
        },
        {
          text: 'Authoring',
          collapsed: false,
          items: [
            { text: 'Authoring with React', link: '/guide/authoring-react' },
            { text: 'Rendering & export', link: '/guide/rendering' },
            { text: 'Typography & fonts', link: '/guide/typography' },
            { text: 'Backends', link: '/guide/backends' },
            { text: 'SVG import', link: '/guide/svg' },
          ],
        },
        {
          text: 'Reference',
          collapsed: false,
          items: [{ text: 'Architecture', link: '/guide/architecture' }],
        },
      ],
      '/concepts/': [
        {
          text: 'Concepts',
          items: [
            { text: 'The scene graph', link: '/concepts/scene-graph' },
            { text: 'Composition & nodes', link: '/concepts/composition' },
            { text: 'Transforms, opacity & clip', link: '/concepts/transforms' },
          ],
        },
      ],
      '/api/': [
        {
          text: '@onda/react',
          items: [
            { text: 'Components', link: '/api/react' },
            { text: 'Hooks', link: '/api/hooks' },
            { text: 'Animation', link: '/api/animation' },
            { text: 'Timeline (Sequence/Series/Loop)', link: '/api/timeline' },
            { text: 'Render functions', link: '/api/render' },
            { text: 'Scene-graph JSON', link: '/api/scene-json' },
          ],
        },
        {
          text: 'onda CLI',
          items: [{ text: 'Command reference', link: '/api/cli' }],
        },
      ],
      '/examples/': [
        {
          text: 'Examples',
          items: [
            { text: 'Overview', link: '/examples/' },
            { text: 'Hello ONDA', link: '/examples/hello' },
            { text: 'Animated title', link: '/examples/animated' },
            { text: 'Vector (paths, gradients, clip)', link: '/examples/vector' },
            { text: 'SVG import', link: '/examples/svg' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: REPO }],

    search: { provider: 'local' },

    editLink: {
      pattern: `${REPO}/edit/main/apps/docs/:path`,
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MIT or Apache-2.0 License.',
      copyright: 'The ONDA Engine contributors',
    },

    outline: { level: [2, 3] },
  },
})
