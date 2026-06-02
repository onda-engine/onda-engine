// Machine-readable description of the theme tokens — name / type / default /
// description — for the Studio-facing API spec (/api/components.json) and any
// LLM consumer. Defaults mirror `defaultTheme` in
// packages/components/src/theme.ts (kept as plain data so the build-time API
// endpoint has no runtime dependency on the component library).

export interface ThemeTokenSpec {
  name: string
  type: string
  default: unknown
  description: string
}

export const THEME_TOKENS: ThemeTokenSpec[] = [
  {
    name: 'accent',
    type: 'string',
    default: '#d96b82',
    description: 'Primary brand color — the earned accent (bars, rules, highlights, glows).',
  },
  {
    name: 'accentSoft',
    type: 'string',
    default: 'rgba(217, 107, 130, 0.16)',
    description: 'A soft, translucent accent for fills/washes behind content.',
  },
  { name: 'text', type: 'string', default: '#f2f2f4', description: 'Primary text.' },
  {
    name: 'textMuted',
    type: 'string',
    default: '#8e8e98',
    description: 'Secondary / supporting text.',
  },
  { name: 'background', type: 'string', default: '#0a0d17', description: 'Canvas background.' },
  {
    name: 'surface',
    type: 'string',
    default: '#121217',
    description: 'Cards / panels / track fills.',
  },
  { name: 'border', type: 'string', default: '#26262c', description: 'Hairlines / borders.' },
  {
    name: 'palette',
    type: 'string[]',
    default: ['#8e8e98', '#2974f2', '#e6b450', '#6bbf8a'],
    description: 'Extra series colors for multi-bar / multi-slice charts (after the accent).',
  },
  {
    name: 'fontFamily',
    type: 'string | undefined',
    default: null,
    description: 'Body font family (a loaded family name; undefined = the engine default).',
  },
  {
    name: 'headingFamily',
    type: 'string | undefined',
    default: null,
    description: 'Heading font family (falls back to fontFamily).',
  },
  {
    name: 'monoFamily',
    type: 'string | undefined',
    default: null,
    description: 'Monospace font family for code (falls back to a generic mono).',
  },
  { name: 'radius', type: 'number', default: 14, description: 'Base corner radius in px.' },
  {
    name: 'logo',
    type: '{ src?: string; markup?: string }',
    default: null,
    description: 'Brand logo, for LogoSting / watermarks / outros.',
  },
]
