// The hero's wave horizon — a perspective-projected wireframe swell drawn on a
// plain 2D canvas (no WebGL, no deps). The ONDA mark, literally: an onda,
// receding to a glowing horizon. Sibling of the Studio landing's R3F wave —
// same motif, rose-skinned, cheap enough for a static marketing page.
//
// Behavior: caps DPR, renders at ~30fps, pauses entirely when the canvas
// leaves the viewport (IntersectionObserver) or the tab hides, and draws one
// static pose under prefers-reduced-motion.

type Pt = { sx: number; sy: number; depth: number }

const GRID_X = 56 // columns across
const GRID_Z = 26 // rows into the distance
const FPS_INTERVAL = 1000 / 30

function waveY(x: number, z: number, t: number): number {
  return (
    Math.sin(x * 0.55 + t) * Math.cos(z * 0.42 + t * 0.7) * 0.62 +
    Math.sin((x + z) * 0.24 + t * 0.55) * 0.38
  )
}

export function mountWaveHero(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let width = 0
  let height = 0
  let dpr = 1

  const resize = () => {
    const rect = canvas.getBoundingClientRect()
    dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    width = rect.width
    height = rect.height
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
  resize()
  const ro = new ResizeObserver(() => {
    resize()
    if (reduceMotion) draw(1.8)
  })
  ro.observe(canvas)

  // Project the grid point (gx ∈ [-1,1], gz ∈ [0,1]) to screen space — a
  // ground plane seen from above: the far rows converge on a horizon line
  // (~28% height), the near rows fan DOWN toward the bottom edge. sy grows
  // with proximity (persp), which is what makes it read as a floor.
  const project = (gx: number, gz: number, t: number): Pt => {
    const x = gx * 14
    const z = gz * 18 + 1.2
    const y = waveY(x, z, t)
    const persp = 5.2 / (5.2 + z) // simple pinhole
    return {
      sx: width / 2 + x * persp * (width / 9),
      sy: height * 0.3 + (1.7 - y * 0.55) * persp * (height * 0.5),
      depth: gz,
    }
  }

  const draw = (t: number) => {
    ctx.globalCompositeOperation = 'source-over'
    ctx.clearRect(0, 0, width, height)
    // Additive blending: overlapping strokes accumulate toward white, which
    // reads as bloom — the 2D stand-in for the Studio hero's bloom pass.
    ctx.globalCompositeOperation = 'lighter'

    // The horizon light — a soft rose band where the far rows converge. This
    // is the fold's "moment"; the mesh alone is too faint that far away.
    const hy = height * 0.34
    ctx.save()
    ctx.scale(1, 0.32) // flatten the radial into a horizon ellipse
    const glow = ctx.createRadialGradient(
      width / 2,
      hy / 0.32,
      0,
      width / 2,
      hy / 0.32,
      width * 0.42,
    )
    glow.addColorStop(0, 'rgba(217, 107, 130, 0.16)')
    glow.addColorStop(0.55, 'rgba(217, 107, 130, 0.05)')
    glow.addColorStop(1, 'rgba(217, 107, 130, 0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, width, height / 0.32)
    ctx.restore()

    const rows: Pt[][] = []
    for (let iz = 0; iz <= GRID_Z; iz++) {
      const row: Pt[] = []
      for (let ix = 0; ix <= GRID_X; ix++) {
        row.push(project((ix / GRID_X) * 2 - 1, iz / GRID_Z, t))
      }
      rows.push(row)
    }

    // Two passes: a wide faint stroke (the "bloom") then a thin brighter core.
    for (const pass of [
      { width: 2.8, alpha: 0.12 },
      { width: 1.1, alpha: 0.34 },
    ]) {
      ctx.lineWidth = pass.width
      for (let iz = 0; iz <= GRID_Z; iz++) {
        const row = rows[iz]
        if (!row) continue
        // nearer rows brighter; the far rows keep a floor so the horizon
        // doesn't vanish entirely into the dark
        const fade = 0.3 + 0.7 * (1 - row[0]!.depth) ** 1.25
        ctx.strokeStyle = `rgba(217, 107, 130, ${pass.alpha * fade})`
        ctx.beginPath()
        for (let ix = 0; ix <= GRID_X; ix++) {
          const p = row[ix]!
          if (ix === 0) ctx.moveTo(p.sx, p.sy)
          else ctx.lineTo(p.sx, p.sy)
        }
        ctx.stroke()
        // verticals, sparser (every 2nd) so the grid reads calm
        if (iz < GRID_Z) {
          const next = rows[iz + 1]
          if (!next) continue
          ctx.beginPath()
          for (let ix = 0; ix <= GRID_X; ix += 2) {
            const a = row[ix]!
            const b = next[ix]!
            ctx.moveTo(a.sx, a.sy)
            ctx.lineTo(b.sx, b.sy)
          }
          ctx.stroke()
        }
      }
    }
  }

  if (reduceMotion) {
    draw(1.8)
    return
  }

  let visible = true
  let raf = 0
  let last = 0
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop)
    if (now - last < FPS_INTERVAL) return
    last = now
    draw(now / 1000 / 2.4)
  }
  const start = () => {
    if (!raf) raf = requestAnimationFrame(loop)
  }
  const stop = () => {
    if (raf) cancelAnimationFrame(raf)
    raf = 0
  }

  const io = new IntersectionObserver(
    (entries) => {
      visible = entries[0]?.isIntersecting ?? true
      if (visible && !document.hidden) start()
      else stop()
    },
    { rootMargin: '80px 0px' },
  )
  io.observe(canvas)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && visible) start()
    else stop()
  })
  start()
}
