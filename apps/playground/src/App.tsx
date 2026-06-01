import { type FrameDrawer, Player } from '@onda/player'
import {
  Composition,
  Rect,
  Series,
  Text,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from '@onda/react'
import { OndaEngine } from '@onda/wasm'
import { type ReactElement, useMemo, useState } from 'react'

/** A title that springs up and fades in (frame-driven; deterministic). */
function Title({ label }: { label: string }): ReactElement {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const rise = spring({ frame, fps, config: { damping: 12 } })
  const opacity = interpolate(frame, [0, 12], [0, 1])
  const y = interpolate(rise, [0, 1], [150, 110])
  return (
    <Text x={96} y={y} fontSize={96} color="#ffffff" opacity={opacity}>
      {label}
    </Text>
  )
}

// Two spring-animated titles played back-to-back with <Series>.
const hello = (
  <Composition width={1200} height={360} fps={30} durationInFrames={120}>
    <Rect width={1200} height={360} fill="#0a0d17" />
    <Rect x={96} y={250} width={520} height={10} cornerRadius={5} fill="#2974f2" />
    <Series>
      <Series.Sequence durationInFrames={60}>
        <Title label="Hello ONDA" />
      </Series.Sequence>
      <Series.Sequence durationInFrames={60}>
        <Title label="Springs + Series" />
      </Series.Sequence>
    </Series>
  </Composition>
)

export function App(): ReactElement {
  const engine = useMemo(() => new OndaEngine(), [])
  const [useEngine, setUseEngine] = useState(true)

  const engineDraw = useMemo<FrameDrawer>(
    () => (ctx, scene) => {
      const frame = engine.render(JSON.stringify(scene))
      const image = new ImageData(new Uint8ClampedArray(frame.pixels), frame.width, frame.height)
      ctx.putImageData(image, 0, 0)
    },
    [engine],
  )

  return (
    <main
      style={{
        maxWidth: 980,
        margin: '40px auto',
        padding: '0 16px',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1 style={{ marginBottom: 4 }}>ONDA Player</h1>
      <p style={{ marginTop: 0, color: '#666' }}>
        Two spring-animated titles played back-to-back with <code>&lt;Series&gt;</code> — drag the
        scrubber or press play.
      </p>

      <label
        style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0', fontSize: 14 }}
      >
        <input
          type="checkbox"
          checked={useEngine}
          onChange={(e) => setUseEngine(e.target.checked)}
        />
        Render with the WASM engine{' '}
        <span style={{ color: '#888' }}>(off = Canvas2D preview with the browser font)</span>
      </label>

      <Player composition={hello} draw={useEngine ? engineDraw : undefined} />

      <p style={{ color: '#888', fontSize: 13 }}>
        {useEngine
          ? 'Engine: the real Rust renderer (cosmic-text + Open Sans) in WebAssembly — pixel-identical to onda export. No DOM, no Chromium.'
          : 'Preview: Canvas2D with the browser font (shapes exact, text approximate).'}
      </p>
    </main>
  )
}
