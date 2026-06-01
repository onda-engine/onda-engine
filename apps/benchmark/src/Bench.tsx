// A Remotion composition equivalent to the ONDA benchmark scene.
export const Bench = () => (
  <div style={{ width: '100%', height: '100%', position: 'absolute', backgroundColor: '#0a0d17' }}>
    <div
      style={{
        position: 'absolute',
        left: 180,
        top: 120,
        width: 520,
        height: 520,
        borderRadius: '50%',
        background: 'rgba(41,115,242,0.25)',
      }}
    />
    <div
      style={{
        position: 'absolute',
        left: 1200,
        top: 420,
        width: 420,
        height: 420,
        borderRadius: '50%',
        background: 'rgba(230,77,102,0.22)',
      }}
    />
    <div
      style={{
        position: 'absolute',
        left: 160,
        top: 640,
        width: 900,
        height: 12,
        background: '#2974f2',
      }}
    />
    <div
      style={{
        position: 'absolute',
        left: 160,
        top: 430,
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
        left: 164,
        top: 690,
        fontSize: 48,
        color: '#b3bfd9',
        fontFamily: 'sans-serif',
      }}
    >
      GPU-native motion graphics, no browser
    </div>
  </div>
)
