import type { CSSProperties, ReactElement, ReactNode } from 'react'
import { CopyButton } from './CopyButton.js'

// A copyable code block with lightweight JSX/TS syntax highlighting — a tiny
// tokenizer (no dependency, good enough for the showcase snippets) so the code
// reads like a real editor rather than flat monospace. Used by the component
// gallery and the transitions showcase.

const KEYWORDS = new Set([
  'import',
  'from',
  'export',
  'const',
  'let',
  'var',
  'return',
  'function',
  'type',
  'true',
  'false',
  'null',
  'undefined',
  'default',
  'await',
  'async',
  'new',
])

// Match the docs' code theme (Starlight dark — Night Owl) so code reads the same
// across the site.
const COLOR = {
  comment: '#637777',
  string: '#ecc48d',
  number: '#f78c6c',
  keyword: '#c792ea',
  tag: '#f78c6c', // PascalCase components/tags
  func: '#82aaff', // identifier before `(`
  attr: '#c5e478', // identifier before `=`
  bracket: '#7fdbca', // JSX angle brackets < > / >
  punct: '#7e8aa0',
}

// One token per match: comment | string | number | identifier | whitespace | punctuation.
const TOKEN =
  /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\d+(?:\.\d+)?)|([A-Za-z_$][\w$]*)|(\s+)|([^\s\w$'"`]+)/g

/** The next non-whitespace character at or after `idx` (for call/attr lookahead). */
function nextNonSpace(code: string, idx: number): string {
  let j = idx
  while (j < code.length && /\s/.test(code[j] ?? '')) j++
  return code[j] ?? ''
}

function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = []
  let i = 0
  for (const m of code.matchAll(TOKEN)) {
    const [tok, comment, str, num, word, _ws, punct] = m
    let color: string | undefined
    if (comment) color = COLOR.comment
    else if (str) color = COLOR.string
    else if (num) color = COLOR.number
    else if (word) {
      if (KEYWORDS.has(word)) color = COLOR.keyword
      else if (/^[A-Z]/.test(word)) color = COLOR.tag
      else {
        const after = nextNonSpace(code, (m.index ?? 0) + tok.length)
        color = after === '(' ? COLOR.func : after === '=' ? COLOR.attr : undefined
      }
    } else if (punct) color = /^[<>/]+$/.test(punct) ? COLOR.bracket : COLOR.punct
    out.push(
      color ? (
        <span key={i} style={{ color }}>
          {tok}
        </span>
      ) : (
        tok
      ),
    )
    i++
  }
  return out
}

export function CodeBlock({
  code,
  label = 'Usage',
}: { code: string; label?: string }): ReactElement {
  return (
    <div>
      <div style={styles.head}>
        <span style={styles.label}>{label}</span>
        <CopyButton text={code} style={styles.copy} />
      </div>
      <pre style={styles.pre}>
        <code>{highlight(code)}</code>
      </pre>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  head: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  label: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: '#56565f',
  },
  copy: {
    appearance: 'none',
    border: '1px solid #26262c',
    background: 'transparent',
    color: '#b8b8c0',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    padding: '3px 10px',
    borderRadius: 7,
    cursor: 'pointer',
  },
  pre: {
    margin: 0,
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    lineHeight: 1.65,
    color: '#c2c2c8',
    background: '#18181d',
    border: '1px solid #26262c',
    borderRadius: 10,
    padding: '14px 16px',
    overflowX: 'auto',
    maxHeight: 420,
    whiteSpace: 'pre',
  },
}
