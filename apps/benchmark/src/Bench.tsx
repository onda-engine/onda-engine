// A Remotion composition equivalent to the ONDA benchmark scene. `repeats`
// scatters N copies of the same cluster (two discs, an accent bar, a title and
// a subtitle) — byte-for-byte equivalent to `onda-bench`'s `cluster(i)`, same
// scatter formula — so the two stay an apples-to-apples comparison as the scene
// scales from trivial (1) to complex (40+).

const ox = (i: number) => (i * 53) % 700
const oy = (i: number) => (i * 97) % 380

const Cluster = ({ i }: { i: number }) => {
  const x = ox(i)
  const y = oy(i)
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: 180 + x,
          top: 120 + y,
          width: 520,
          height: 520,
          borderRadius: '50%',
          background: 'rgba(41,115,242,0.25)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 1200 - x,
          top: 420 + y,
          width: 420,
          height: 420,
          borderRadius: '50%',
          background: 'rgba(230,77,102,0.22)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 160 + x,
          top: 640 + y,
          width: 900,
          height: 12,
          background: '#2974f2',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 160 + x,
          top: 430 + y,
          fontSize: 140,
          color: '#fff',
          fontFamily: 'sans-serif',
        }}
      >
        ONDA Benchmark
      </div>
      <div
        style={{
          position: 'absolute',
          left: 164 + x,
          top: 690 + y,
          fontSize: 48,
          color: '#b3bfd9',
          fontFamily: 'sans-serif',
        }}
      >
        GPU-native motion graphics, no browser
      </div>
    </>
  )
}

export const Bench = ({ repeats = 1 }: { repeats?: number }) => (
  <div style={{ width: '100%', height: '100%', position: 'absolute', backgroundColor: '#0a0d17' }}>
    {Array.from({ length: Math.max(1, repeats) }, (_, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: fixed benchmark scene, stable order
      <Cluster key={i} i={i} />
    ))}
  </div>
)
