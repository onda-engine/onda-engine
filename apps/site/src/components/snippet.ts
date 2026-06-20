import type { Theme } from 'onda-engine/components'

// Turn the gallery's live state (the configured theme + a component's props)
// into copyable code. This is what makes the configurator a code generator: edit
// a color, the emitted <ThemeProvider> theme object updates with it — the same
// artifact a human pastes and ONDA Studio consumes.

/** Serialize a JS value as a TypeScript/JSX literal (single-quoted strings). */
export function literal(v: unknown): string {
  if (typeof v === 'string') return `'${v.replace(/'/g, "\\'")}'`
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (v === null) return 'null'
  if (Array.isArray(v)) return `[${v.map(literal).join(', ')}]`
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).map(
      ([k, val]) => `${k}: ${literal(val)}`,
    )
    return `{ ${entries.join(', ')} }`
  }
  return String(v)
}

/** Pretty-print a theme object literal (2-space indent). `{}` when empty. */
export function themeObjectCode(theme: Partial<Theme>, indent = ''): string {
  const keys = Object.keys(theme) as (keyof Theme)[]
  if (keys.length === 0) return '{}'
  const body = keys
    .map((k) => `${indent}  ${k}: ${literal((theme as Record<string, unknown>)[k])},`)
    .join('\n')
  return `{\n${body}\n${indent}}`
}

/** A standalone, copyable `const theme = {…}` block (the brand-kit artifact). */
export function themeSnippet(theme: Partial<Theme>): string {
  return `import type { Theme } from 'onda-engine/components'\n\nconst theme: Partial<Theme> = ${themeObjectCode(theme)}`
}

/** Render one JSX attribute. Booleans use the JSX shorthand for `true`. */
function attr(key: string, value: unknown): string {
  if (typeof value === 'string') return `${key}="${value.replace(/"/g, '&quot;')}"`
  if (value === true) return key
  return `${key}={${literal(value)}}`
}

/** Render `<Name … />` (or with children) at the given base indent. */
function elementCode(
  name: string,
  props: Record<string, unknown>,
  child: boolean,
  indent: string,
): string {
  const attrs = Object.entries(props)
  if (attrs.length === 0) {
    return child
      ? `${indent}<${name}>\n${indent}  {/* your content */}\n${indent}</${name}>`
      : `${indent}<${name} />`
  }
  const attrLines = attrs.map(([k, v]) => `${indent}  ${attr(k, v)}`).join('\n')
  return child
    ? `${indent}<${name}\n${attrLines}\n${indent}>\n${indent}  {/* your content */}\n${indent}</${name}>`
    : `${indent}<${name}\n${attrLines}\n${indent}/>`
}

export interface SnippetInput {
  name: string
  props: Record<string, unknown>
  theme: Partial<Theme>
  child?: boolean
}

/** The full usage snippet: import + (when configured) a ThemeProvider wrapping
 *  the component with its demo props. With no theme overrides, the default theme
 *  applies and no provider is needed. */
export function usageSnippet({ name, props, theme, child = false }: SnippetInput): string {
  const hasTheme = Object.keys(theme).length > 0
  if (!hasTheme) {
    return `import { ${name} } from 'onda-engine/components'\n\n${elementCode(name, props, child, '')}`
  }
  const el = elementCode(name, props, child, '  ')
  return [
    `import { ThemeProvider, ${name} } from 'onda-engine/components'`,
    '',
    `const theme = ${themeObjectCode(theme)}`,
    '',
    '<ThemeProvider theme={theme}>',
    el,
    '</ThemeProvider>',
  ].join('\n')
}
