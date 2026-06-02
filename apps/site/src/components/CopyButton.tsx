import { type CSSProperties, type ReactElement, useState } from 'react'

// Copy-to-clipboard button with a transient confirmation. Used by the gallery's
// code block and the theme panel's "Copy theme" action.
export function CopyButton({
  text,
  label = 'Copy',
  style,
}: { text: string; label?: string; style?: CSSProperties }): ReactElement {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      style={style}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        } catch {
          // Clipboard blocked (insecure context / permissions) — no-op.
        }
      }}
    >
      {copied ? 'Copied ✓' : label}
    </button>
  )
}
