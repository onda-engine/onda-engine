import { Player } from '@onda/player'
import { Composition, Easing, Rect, Text, interpolate, useCurrentFrame } from '@onda/react'
import type { ReactElement } from 'react'

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
      <Player composition={hello} />
      <p style={{ color: '#888', fontSize: 13 }}>
        Canvas2D preview: shapes are exact; text uses the browser font. The pixel-exact render is{' '}
        <code>onda export</code> (the bundled engine font).
      </p>
    </main>
  )
}
