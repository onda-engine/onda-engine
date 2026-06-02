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

const COLOR = {
  comment: '#56565f',
  string: '#7fb38a',
  number: '#e6b450',
  keyword: '#d96b82',
  tag: '#7cb3f0',
  punct: '#7a7a86',
}

// One token per match: comment | string | number | identifier | whitespace | punctuation.
const TOKEN =
  /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\d+(?:\.\d+)?)|([A-Za-z_$][\w$]*)|(\s+)|([^\s\w$'"`]+)/g

function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = []
  let i = 0
  for (const m of code.matchAll(TOKEN)) {
    const [tok, comment, str, num, word, _ws, punct] = m
    let color: string | undefined
    if (comment) color = COLOR.comment
    else if (str) color = COLOR.string
    else if (num) color = COLOR.number
    else if (word)
      color = KEYWORDS.has(word) ? COLOR.keyword : /^[A-Z]/.test(word) ? COLOR.tag : undefined
    else if (punct) color = COLOR.punct
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
    color: '#d7d7de',
    background: '#121217',
    border: '1px solid #26262c',
    borderRadius: 10,
    padding: '14px 16px',
    overflowX: 'auto',
    maxHeight: 420,
    whiteSpace: 'pre',
  },
}
