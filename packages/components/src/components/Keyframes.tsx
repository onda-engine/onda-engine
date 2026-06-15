//! Keyframes — the engine's general declarative-keyframe primitive. Animate ANY
//! element along explicit per-channel tracks (position / opacity / scale /
//! rotation), each keyframe carrying its own easing (a named curve OR a raw
//! cubic-bezier [x1,y1,x2,y2] — so a Lottie/AE curve transcribes 1:1). This is what
//! lets a composition express ARBITRARY motion, not just the fixed entrance presets:
//! "this element is at A at frame 0, B at frame 18 on THIS ease, C at frame 54…".
//!
//! It renders ONE content element (an image tile or a text line) so it slots into
//! the flat composition-entry model; the content (src / text / color) stays an
//! editable prop while the motion lives in the tracks (motion is never themed).

import { Group, Image, Text, clipRect, useCurrentFrame } from '@onda/react'
import { type PosKey, type ValKey, sampleKeyframes } from '../keyframes-sampler.js'
import { useTheme } from '../theme.js'

// The track types + sampler now live in ../keyframes-sampler.js — ONE
// implementation shared with the cinema export + the Studio preview. Re-exported
// here so existing `import { PosKey } from './components/Keyframes'` keeps working.
export type { Ease, PosKey, ValKey } from '../keyframes-sampler.js'

export interface KeyframesImageContent {
  kind: 'image'
  src: string
  width: number
  height: number
  cornerRadius?: number
  /** Pivot in content space (defaults to the tile CENTER). */
  anchorX?: number
  anchorY?: number
}
export interface KeyframesTextContent {
  kind: 'text'
  text: string
  fontSize: number
  color?: string
  fontFamily?: string
  fontWeight?: number
  letterSpacing?: number
  /** Pivot in content space (defaults to top-left 0,0). */
  anchorX?: number
  anchorY?: number
}

export interface KeyframesProps {
  position?: PosKey[]
  opacity?: ValKey[]
  scale?: ValKey[]
  rotation?: ValKey[]
  content: KeyframesImageContent | KeyframesTextContent
}

export function Keyframes({ position, opacity, scale, rotation, content }: KeyframesProps) {
  const frame = useCurrentFrame()
  const theme = useTheme()
  const { x, y, opacity: op, scale: sc, rotation: rot } = sampleKeyframes(
    { position, opacity, scale, rotation },
    frame,
  )
  if (op <= 0.002) return null

  let inner: React.ReactNode
  if (content.kind === 'image') {
    const ax = content.anchorX ?? content.width / 2
    const ay = content.anchorY ?? content.height / 2
    inner = (
      <Group x={-ax} y={-ay} clip={clipRect(content.width, content.height, content.cornerRadius ?? 0)}>
        <Image src={content.src} width={content.width} height={content.height} fit="cover" />
      </Group>
    )
  } else {
    inner = (
      <Text
        x={-(content.anchorX ?? 0)}
        y={-(content.anchorY ?? 0)}
        fontSize={content.fontSize}
        color={content.color ?? theme.text}
        fontFamily={content.fontFamily ?? theme.headingFamily ?? theme.fontFamily}
        fontWeight={content.fontWeight ?? 400}
        letterSpacing={content.letterSpacing}
      >
        {content.text}
      </Text>
    )
  }

  return (
    <Group x={x} y={y} opacity={op}>
      <Group scaleX={sc} scaleY={sc} rotation={rot}>
        {inner}
      </Group>
    </Group>
  )
}
