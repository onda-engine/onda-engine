import { type FrameDrawer, Player } from '@onda/player'
import { Composition, Easing, Rect, Text, interpolate, useCurrentFrame } from '@onda/react'
import { OndaEngine } from '@onda/wasm'
import { type ReactElement, useMemo, useState } from 'react'

/** A title that fades and slides into place over the first half-second. */
function Title(): ReactElement {
  const frame = useCurrentFrame()
  const opacity = interpolate(frame, [0, 15], [0, 1], { easing: Easing.easeOutCubic })
  const y = interpolate(frame, [0, 15], [150, 110], { easing: Easing.easeOutCubic })
  return (
    <Text x={96} y={y} fontSize={96} color="#ffffff" opacity={opacity}>
      Hello ONDA
    </Text>
  )
}

const hello = (
  <Composition width={1200} height={360} fps={30} durationInFrames={90}>
    <Rect width={1200} height={360} fill="#0a0d17" />
    <Rect x={96} y={250} width={520} height={10} cornerRadius={5} fill="#2974f2" />
    <Title />
  </Composition>
)

export function App(): ReactElement {
  // The real engine (Rust renderer) compiled to WASM. Reused across frames.
  const engine = useMemo(() => new OndaEngine(), [])
  const [useEngine, setUseEngine] = useState(true)

  // Draw each frame through the WASM engine: render the scene to RGBA and blit.
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
        A React composition, previewed live — drag the scrubber or press play.
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
          ? 'Engine: the real Rust renderer (cosmic-text + Open Sans) running in WebAssembly — pixel-identical to onda export. No DOM, no Chromium.'
          : 'Preview: Canvas2D with the browser font (shapes exact, text approximate).'}
      </p>
    </main>
  )
}
