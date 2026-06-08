// FLOWS AGENT — 49s replication v3 (reference-verified scene content)
// 0-2s:   Intro  — gradient + "Flows" → " Agent" types + sub-caption
// 2-6s:   Prompt — input card slides up, "10-second product ad…" types
// 6-8s:   Macro  — 290px heat-gradient kinetic type scroll
// 8-12s:  Log    — agent log: "Building full flow now" + orange pill badges
// 12-15s: Selector— model picker: purple icon circle + Veo highlighted in list
// 15-20s: Nodes  — large node cards: GPT Image shoe + Veo video + Eleven audio
// 20-22s: Hero   — hero shoe photo fills right, Flows Agent card overlaid
// 22-25s: Think  — "Thinking / Analyzing…" thinking screen
// 25-28s: Res    — "You can also choose the export resolution…" 720p/1080p/4K
// 28-32s: Audio  — Eleven v3 audio node: waveform + Victoria + script + Run
// 32-40s: Matrix — infinite canvas zoom-out, many node cards spread across canvas
// 40-43s: Scatter— scattered card canvas fades to white
// 43-46s: Flood  — gradient floods, scattered icon dots, "What should we create next?" card
// 46-49s: Logo   — corner arcs + "||Eleven Creative" logo types in on gradient
import { createElement as h } from 'react'
import {
  Composition, Group, Rect, Ellipse, Path, Text, Image,
  Camera, spring, fbmGradient, interpolate, useCurrentFrame,
} from '@onda/react'
import { AudioClip, fontMetrics, glyphLayout, measureText } from '@onda/components'

const FPS = 30
const W = 1280, H = 720
const CX = W / 2, CY = H / 2

const T      = (s) => Math.round(s * FPS)
const CLAMP  = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
const clamp  = (v, a, b) => Math.max(a, Math.min(b, v))
const lerp   = (a, b, t) => a + (b - a) * t
const prg    = (f, s, e) => clamp((f - s) / (e - s), 0, 1)
const easeOut  = (t) => 1 - Math.pow(1 - t, 3)
const fadeIn   = (f, s, e) => easeOut(prg(f, s, e))
const fadeOut  = (f, s, e) => 1 - easeOut(prg(f, s, e))

// Spring configs — house presets (matching @onda/components motion tokens)
const SPRING_SMOOTH = { damping: 200, stiffness: 100, mass: 1 }  // overdamped, no bounce
const SPRING_SNAPPY = { damping: 120, stiffness: 180, mass: 1 }  // decisive, still overdamped
// sp(frame, startFrame, durationInFrames, config?) → 0..1 spring value
const sp = (f, s, dur, cfg = SPRING_SNAPPY) =>
  spring({ frame: Math.max(0, f - s), fps: FPS, config: cfg, durationInFrames: dur })

// Scene frame boundaries
const S_PROMPT   = T(2)   // f60
const S_MACRO    = T(6)   // f180
const S_LOG      = T(8)   // f240
const S_SELECT   = T(12)  // f360
const S_NODES    = T(15)  // f450
const S_HERO     = T(20)  // f600
const S_THINK    = T(22)  // f660
const S_RES      = T(25)  // f750
const S_AUDIO    = T(28)  // f840
const S_MATRIX   = T(32)  // f960
const S_FLOOD    = T(43)  // f1290
const S_LOGO     = T(46)  // f1380
const TOTAL      = T(49)  // f1470

const FG    = '#1A1A1E', BG = '#F4F4F6', WHITE = '#FFFFFF'
const ORANGE = '#E25C38', PURPLE = '#7B42BC', GREEN = '#36C24A'
const PILL  = '#E07830'  // orange pill badge color
const CARD_BG = '#FAFAFA'
const LIGHT_BG = '#EFEFEF'

const CLOUD = [
  { offset: 0.00, color: '#A6321A' },
  { offset: 0.26, color: '#D9531C' },
  { offset: 0.50, color: '#E8732B' },
  { offset: 0.72, color: '#ECA163' },
  { offset: 0.88, color: '#C9A0A0' },
  { offset: 1.00, color: '#9085B8' },
]

// ── Typography ─────────────────────────────────────────────────────────────
const SANS = 'IBM Plex Sans'
const _mw = new Map()
const mw = (ch, sz, wt) => {
  const k = `${ch}|${sz}|${wt}`
  if (!_mw.has(k)) _mw.set(k, measureText(ch, sz, { fontFamily: SANS, fontWeight: wt }).width)
  return _mw.get(k)
}
const textW = (s, sz, wt) => Array.from(s).reduce((a, c) => a + mw(c, sz, wt), 0)

// Fade-in typewriter
function FadeType({ text, x0, y, size, weight = 400, color = WHITE, start = 0,
                    charF = 2, fadeF = 8, center = false, canvasW = W, cursor = true }) {
  const frame = useCurrentFrame()
  const lf = frame - start
  const chars = Array.from(text)
  const ox = center ? Math.round((canvasW - textW(text, size, weight)) / 2) : x0
  let cx = 0, edge = 0
  const nodes = []
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    const w = mw(ch, size, weight)
    const op = clamp((lf - i * charF) / fadeF, 0, 1)
    if (op > 0.002 && ch !== ' ')
      nodes.push(h(Text, { key: i, x: ox + Math.round(cx), y, fontSize: size, fontFamily: SANS, fontWeight: weight, color, opacity: op }, ch))
    if (op > 0.5) edge = cx + w
    cx += w
  }
  if (cursor && lf > 0) {
    const blink = lf % 28 < 16 ? 0.9 : 0.08
    nodes.push(h(Text, { key: 'cur', x: ox + Math.round(edge) + 1, y, fontSize: size, fontFamily: SANS, fontWeight: weight, color, opacity: blink }, '|'))
  }
  return h(Group, null, ...nodes)
}

// ── Font metrics + glyph layout for typing macro ──────────────────────────
const FM       = fontMetrics(290, { fontFamily: SANS, fontWeight: 400 })
const TYPE_LINE = 'test 3 colorways in 2 settings, voiceover in English'
const TYPE_GL   = glyphLayout(TYPE_LINE, 290, { fontFamily: SANS, fontWeight: 400 })
const CHAR_X    = TYPE_GL.map(g => ({ x: g.x, adv: g.advance }))
function heat(d) {
  const stops = [[0,[245,200,66]],[120,[232,115,43]],[300,[150,90,70]],[520,[58,58,58]]]
  const t = clamp(d, 0, 520)
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [d0,c0]=stops[i-1],[d1,c1]=stops[i]
      const f=(t-d0)/(d1-d0), c=c0.map((v,k)=>Math.round(v+(c1[k]-v)*f))
      return '#'+c.map(v=>v.toString(16).padStart(2,'0')).join('')
    }
  }
  return '#3a3a3a'
}

// ── Bezier connector (world coords, used inside Camera) ────────────────────
function Bezier({ x1, y1, x2, y2, opacity = 1 }) {
  const mx = Math.round((x1 + x2) / 2)
  return h(Path, { x: 0, y: 0,
    d: `M ${x1} ${y1} C ${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`,
    stroke: '#AAAAAE', strokeWidth: 1, fill: '#00000000', opacity })
}

// ── Orange pill badge ──────────────────────────────────────────────────────
function Pill({ x, y, label }) {
  const tw = textW(label, 14, 500) + 24
  return h(Group, null,
    h(Rect, { x, y, width: tw, height: 28, fill: PILL, cornerRadius: 14 }),
    h(Text, { x: x + 12, y: y + 7, fontSize: 14, fontFamily: SANS, fontWeight: 500, color: WHITE }, label),
  )
}

// ── Light bg helper ────────────────────────────────────────────────────────
const LightBg = () => h(Rect, { x: 0, y: 0, width: W, height: H, fill: LIGHT_BG })
const WhiteBg = () => h(Rect, { x: 0, y: 0, width: W, height: H, fill: WHITE })

// ── Shared icon shape — Lucide-style SVG paths, font-free ─────────────────
// type: 'img' | 'vid' | 'aud'  cx/cy: center  sz: icon size (fits in sz×sz box)  clr: color
function IconShape({ type, cx, cy, sz, clr }) {
  const hs = sz / 2
  const sw = Math.max(1, sz / 11)
  if (type === 'img') {
    // photo frame + mountain + sun
    return h(Group, null,
      h(Path, { x: cx - hs, y: cy - hs * 0.9,
        d: `M 0 1.5 Q 0 0 1.5 0 L ${sz - 1.5} 0 Q ${sz} 0 ${sz} 1.5 L ${sz} ${sz * 0.9 - 1.5} Q ${sz} ${sz * 0.9} ${sz - 1.5} ${sz * 0.9} L 1.5 ${sz * 0.9} Q 0 ${sz * 0.9} 0 ${sz * 0.9 - 1.5} Z`,
        fill: '#00000000', stroke: clr, strokeWidth: sw }),
      h(Path, { x: cx - hs, y: cy - hs * 0.9,
        d: `M 0 ${sz * 0.7} L ${sz * 0.3} ${sz * 0.38} L ${sz * 0.5} ${sz * 0.58} L ${sz * 0.65} ${sz * 0.43} L ${sz} ${sz * 0.7}`,
        fill: '#00000000', stroke: clr, strokeWidth: sw, strokeJoin: 'round' }),
      h(Ellipse, { x: cx - hs + sz * 0.08, y: cy - hs * 0.9 + sz * 0.08, width: sz * 0.22, height: sz * 0.22, fill: clr }),
    )
  } else if (type === 'vid') {
    // monitor rect + camera triangle
    const rw = sz * 0.68, rh = sz * 0.82
    return h(Group, null,
      h(Path, { x: cx - hs, y: cy - rh / 2,
        d: `M 0 1.5 Q 0 0 1.5 0 L ${rw - 1.5} 0 Q ${rw} 0 ${rw} 1.5 L ${rw} ${rh - 1.5} Q ${rw} ${rh} ${rw - 1.5} ${rh} L 1.5 ${rh} Q 0 ${rh} 0 ${rh - 1.5} Z`,
        fill: '#00000000', stroke: clr, strokeWidth: sw }),
      h(Path, { x: cx - hs, y: cy - rh / 2,
        d: `M ${rw} ${rh * 0.2} L ${sz} ${rh * 0.05} L ${sz} ${rh * 0.95} L ${rw} ${rh * 0.8} Z`,
        fill: clr, stroke: clr, strokeWidth: sw * 0.5, strokeJoin: 'round' }),
    )
  } else {
    // waveform bars (5 bars varying height)
    const barW = sz * 0.14, gap = sz * 0.05
    const totalW = 5 * barW + 4 * gap
    const heights = [0.45, 0.78, 0.55, 1.0, 0.48]
    return h(Group, null,
      ...heights.map((hf, bi) =>
        h(Rect, { key: bi,
          x: cx - totalW / 2 + bi * (barW + gap), y: cy - (sz * 0.88 * hf) / 2,
          width: barW, height: sz * 0.88 * hf, fill: clr, cornerRadius: barW / 2 }),
      ),
    )
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SCENE 1+2: INTRO + PROMPT (f0–S_MACRO) — shot1 logic (reference-perfect)
// ════════════════════════════════════════════════════════════════════════════
// Shot1-specific cloud: lighter tail (#EFEFEF) for the warm-ethereal intro look
const CLOUD_S1 = [
  { offset: 0.00, color: '#A6321A' },
  { offset: 0.26, color: '#D9531C' },
  { offset: 0.50, color: '#E8732B' },
  { offset: 0.72, color: '#ECA163' },
  { offset: 0.88, color: '#E9D2BB' },
  { offset: 1.00, color: '#EFEFEF' },
]

const TSIZE  = 52
const GROW   = 50  // f50 ≈ 1.67s — card erupts from the cursor gap

// Card geometry measured from reference: 898×253, centred vertically on screen
const S1_CW = 898, S1_CH = 253
const S1_CCX = W / 2, S1_CCY = CY           // card centre — true vertical centre
const S1_CX  = Math.round(S1_CCX - S1_CW / 2)  // 191 — card left edge
const S1_CY  = Math.round(S1_CCY - S1_CH / 2)  // 404 — card top edge
const S1_HDR_W = textW('Flows Agent', 28, 600)
const S1_FX = S1_CX + 54, S1_FW = S1_CW - 54 - 18
const S1_FY = S1_CY + 74, S1_FH = 72

function SceneShot1({ frame }) {
  const t = frame / FPS
  const toOut = fadeOut(frame, S_MACRO - 14, S_MACRO)

  const easeInOut_ = (x) => { const c = clamp(x, 0, 1); return c < 0.5 ? 2*c*c : 1 - Math.pow(-2*c+2,2)/2 }
  const easeOut3_  = (x) => 1 - Math.pow(1 - clamp(x, 0, 1), 3)

  // Card morphs from a small square at the cursor gap to full width/height
  const cardW = 80 + (S1_CW - 80) * easeInOut_((frame - GROW) / 30)
  const cardH = 80 + (S1_CH - 80) * easeOut3_((frame - GROW) / 15)
  const BX = Math.round(S1_CCX - cardW / 2)
  const BY = Math.round(S1_CCY - cardH / 2)
  const cardOp    = interpolate(frame, [GROW, GROW + 6],   [0, 1], CLAMP)
  const contentOp = interpolate(frame, [GROW + 26, GROW + 36], [0, 1], CLAMP)
  const TYPE_START = GROW + 40

  // Input text slides right when typing finishes (~f155), simulating "submit"
  const slideP = sp(frame, 155, 20, SPRING_SNAPPY)
  const slideX = Math.round(slideP * 480)
  // Arrow button pulses / rotates to confirm submission
  const arrowOp = 1 - slideP * 0.6

  return h(Group, { grain: { intensity: 0.05, size: 1.1, seed: frame }, opacity: toOut },
    h(Rect, { x: 0, y: 0, width: W, height: H,
      gradient: fbmGradient(CLOUD_S1, { scale: 0.42, warp: 0.6, time: t * 0.06 }) }),
    // "Flows Agent" types in centred, vertically aligned with the card centre
    h(FadeType, { text: 'Flows Agent', size: TSIZE, weight: 400, color: '#FBF7F2',
      start: 8, charF: 2, fadeF: 3, center: true, canvasW: W,
      y: Math.round(S1_CCY - TSIZE * 0.55), cursor: true }),
    // Card — erupts from cursor gap, square → wide
    h(Group, { opacity: cardOp },
      h(Rect, { x: BX, y: BY, width: cardW, height: cardH,
        cornerRadius: Math.min(26, cardH / 2), fill: WHITE,
        shadow: { color: '#00000026', blur: 50, offsetY: 16 } }),
      h(Group, { opacity: contentOp },
        h(Text, { x: S1_FX, y: S1_CY + 24, fontSize: 28, fontFamily: SANS, fontWeight: 600, color: FG }, 'Flows Agent'),
        h(Ellipse, { x: S1_FX + S1_HDR_W + 12, y: S1_CY + 33, width: 15, height: 15, fill: GREEN }),
        // Whole input field (background + text) slides right on submit
        h(Group, { x: slideX },
          h(Rect, { x: S1_FX, y: S1_FY, width: S1_FW, height: S1_FH, cornerRadius: 16, fill: '#F2F1EF' }),
          h(FadeType, { text: '10-second product ad for these running shoes.',
            x0: S1_FX + 22, y: S1_FY + S1_FH / 2 - 10, size: 19, weight: 400, color: '#3C3C3C',
            start: TYPE_START, charF: 1.7, fadeF: 8, cursor: slideP < 0.05 }),
        ),
        h(Text, { x: S1_CX + S1_CW - 126, y: S1_CY + 184, fontSize: 28, fontFamily: SANS, fontWeight: 400, color: '#9C9C9C' }, '+'),
        // Arrow button fills dark as it receives the submit
        h(Ellipse, { x: S1_CX + S1_CW - 93, y: S1_CY + 171, width: 50, height: 50,
          fill: slideP > 0.1 ? FG : '#ECECEC' }),
        h(Path, { x: S1_CX + S1_CW - 68, y: S1_CY + 196,
          d: 'M 0 9 L 0 -9 M -6 -3 L 0 -9 L 6 -3',
          stroke: slideP > 0.1 ? WHITE : '#3A3A3A', strokeWidth: 2.6, strokeCap: 'round', strokeJoin: 'round' }),
      ),
    ),
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SCENE 3: MACRO TYPING (f180–f239)
// ════════════════════════════════════════════════════════════════════════════
function SceneMacro({ frame }) {
  const sceneF = frame - S_MACRO
  const cursorX = Math.round(W * 0.62)
  const cyText  = Math.round(H * 0.45 - FM.capTop - FM.capHeight / 2)
  const nChars  = clamp(Math.round(((sceneF + 20) / FPS) * 17), 0, TYPE_LINE.length)
  const substr  = TYPE_LINE.slice(0, nChars)
  const total   = nChars > 0 ? measureText(substr, 290, { fontFamily: SANS, fontWeight: 400 }).width : 0
  const startX  = cursorX - total
  const scale   = nChars > 0 && CHAR_X[nChars-1]
    ? total / (CHAR_X[nChars-1].x + CHAR_X[nChars-1].adv) : 1
  const runs = Array.from({ length: nChars }, (_, i) =>
    ({ text: TYPE_LINE[i], color: heat(cursorX - (startX + (CHAR_X[i].x + CHAR_X[i].adv) * scale)) }))
  const cursorH = Math.round(FM.ascent - FM.capTop + FM.descent)
  const blink   = sceneF % 28 < 16 ? 0.95 : 0.15
  return h(Group, { grain: { intensity: 0.035, size: 1.1, seed: frame } },
    h(Rect, { x: 0, y: 0, width: W, height: H, fill: '#ECECEC' }),
    nChars > 0
      ? h(Text, { x: Math.round(startX), y: cyText, fontSize: 290, fontFamily: SANS, fontWeight: 400, color: '#3a3a3a', runs }, '')
      : h(Rect, { x: 0, y: 0, width: 0, height: 0, fill: '#00000000' }),
    h(Rect, { x: cursorX + 2, y: cyText + FM.capTop, width: 10, height: cursorH, fill: '#F08030', opacity: blink }),
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SCENE 4A: AGENT LOG (f240–f359)
// ════════════════════════════════════════════════════════════════════════════
// "Let me start building" log: items appear one by one, active = orange, done = dark.
const LOG_ICONS = [
  { label: 'Image', desc: 'hero concept shot of a trail running shoe',        cc: '#C2DDF8', ic: '#3A78C9', type: 'img', f: S_LOG + 8  },
  { label: 'Video', desc: 'product ad animated from the image (trail env.)',   cc: '#CCBBEE', ic: '#7B42BC', type: 'vid', f: S_LOG + 48 },
  { label: 'TTS',   desc: 'punchy voiceover line wired to composition',        cc: '#F2BEFA', ic: '#A040B0', type: 'aud', f: S_LOG + 88 },
]
const WORK_F    = S_LOG + 106
const LOG_ORANGE = '#E07D30'  // active-item accent (warmer than the pill ORANGE)

function SceneLog({ frame }) {
  const toOut  = fadeOut(frame, S_SELECT - 16, S_SELECT)
  const headOp = sp(frame, S_LOG, 16, SPRING_SMOOTH)

  const HEAD_X = 80, HEAD_Y = 52
  const CIRC_D = 48, CIRC_R = CIRC_D / 2
  const ITEM_H = 110  // generous vertical spacing matches reference

  // ── Items — slide up + fade in; color shifts active→done as next item appears
  const iconEls = LOG_ICONS.map((item, i) => {
    const nextF = LOG_ICONS[i + 1]?.f ?? Infinity
    const pop   = sp(frame, item.f, 16, SPRING_SNAPPY)
    const yBase = HEAD_Y + 76 + i * ITEM_H
    const yOff  = Math.round((1 - pop) * 32)
    const cy    = yBase + yOff + CIRC_R

    // Active = orange text; done = dark; pending = not visible (opacity 0)
    const isActive = frame >= item.f && frame < nextF
    const isDone   = frame >= nextF
    const textClr  = isActive ? LOG_ORANGE : FG
    const descClr  = isActive ? LOG_ORANGE : '#AAAAAE'

    return h(Group, { key: i, opacity: pop },
      h(Ellipse, { x: HEAD_X, y: cy - CIRC_R, width: CIRC_D, height: CIRC_D, fill: item.cc }),
      h(IconShape, { type: item.type, cx: HEAD_X + CIRC_R, cy, sz: 22, clr: '#FFFFFF' }),
      h(Text, { x: HEAD_X + CIRC_D + 20, y: yBase + yOff + 4,
        fontSize: 28, fontFamily: SANS, fontWeight: 600, color: textClr }, item.label),
      h(Text, { x: HEAD_X + CIRC_D + 20, y: yBase + yOff + 36,
        fontSize: 22, fontFamily: SANS, fontWeight: 400, color: descClr }, item.desc),
    )
  })

  // ── Rotating arc spinner + "Working" ─────────────────────────────────────
  const workOp = sp(frame, WORK_F, 14, SPRING_SMOOTH)
  const spinY  = HEAD_Y + 76 + LOG_ICONS.length * ITEM_H + 8
  const SR = 13
  const SCX = HEAD_X + SR, SCY = spinY + SR
  const rotDeg = ((frame - WORK_F) * 9) % 360
  const arcEnd = { x: SCX + SR * Math.sin(Math.PI * 2 / 3), y: SCY - SR * Math.cos(Math.PI * 2 / 3) }

  const spinnerEl = h(Group, { opacity: workOp },
    h(Ellipse, { x: SCX - SR, y: SCY - SR, width: SR * 2, height: SR * 2,
      fill: '#00000000', stroke: '#E4E4E8', strokeWidth: 2 }),
    h(Group, { rotation: rotDeg, originX: SCX, originY: SCY },
      h(Path, { x: 0, y: 0,
        d: `M ${SCX} ${SCY - SR} A ${SR} ${SR} 0 0 1 ${Math.round(arcEnd.x)} ${Math.round(arcEnd.y)}`,
        fill: '#00000000', stroke: '#9CA3AF', strokeWidth: 2.5, strokeCap: 'round' }),
    ),
    h(Text, { x: SCX + SR + 14, y: spinY + 2, fontSize: 20,
      fontFamily: SANS, fontWeight: 400, color: '#9CA3AF' }, 'Working'),
  )

  return h(Group, { opacity: toOut },
    h(LightBg),
    h(Text, { x: HEAD_X, y: HEAD_Y, fontSize: 38, fontFamily: SANS, fontWeight: 400, color: FG, opacity: headOp },
      'Let me start building'),
    ...iconEls,
    spinnerEl,
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SCENE 4B: MODEL SELECTOR (f360–f449)
// ════════════════════════════════════════════════════════════════════════════
const TOOLS = ['Topaz', 'Flux', 'Runway', 'Veo', 'Seedance', 'LTX', 'Eleven v3']
const SEL   = 3  // index of selected tool (Veo)
// Per-tool: circle color, icon color, icon type — drives the live circle as drum spins
const TOOL_META = [
  { cc: '#C2DDF8', ic: '#3A78C9', type: 'img' },  // Topaz   — image upscale
  { cc: '#C2DDF8', ic: '#3A78C9', type: 'img' },  // Flux    — image gen
  { cc: '#CCBBEE', ic: '#7B42BC', type: 'vid' },  // Runway  — video gen
  { cc: '#CCBBEE', ic: '#7B42BC', type: 'vid' },  // Veo     — video gen
  { cc: '#CCBBEE', ic: '#7B42BC', type: 'vid' },  // Seedance— video gen
  { cc: '#CCBBEE', ic: '#7B42BC', type: 'vid' },  // LTX     — video gen
  { cc: '#F2BEFA', ic: '#A040B0', type: 'aud' },  // Eleven v3 — TTS
]

function SceneSelector({ frame }) {
  const toOut  = fadeOut(frame, S_NODES - 14, S_NODES)
  const sceneP = sp(frame, S_SELECT, 16)

  const CIR_X = 320, CIR_Y = CY, CIR_R = 76
  const LIST_X = CIR_X + CIR_R + 80
  const ITEM_H = 80

  // Slot machine: start with Topaz in the window, spin down to Veo with a click (slight underdamp)
  const SLOT_CFG = { damping: 14, stiffness: 100, mass: 1 }
  const scrollY = spring({ frame: Math.max(0, frame - S_SELECT), fps: FPS,
    from: SEL * ITEM_H, to: 0, config: SLOT_CFG, durationInFrames: 55 })

  // Whichever tool is currently nearest CIR_Y is the "live" highlight as drum spins
  const focusIdx = clamp(Math.round(SEL - scrollY / ITEM_H), 0, TOOLS.length - 1)

  // Line grows horizontally from circle → Veo's fixed position, then stays
  const lineGrow = sp(frame, S_SELECT + 4, 18)
  const LINE_SX  = CIR_X + CIR_R
  const LINE_EX  = LIST_X - 20
  const lineW    = Math.max(0, Math.round(lineGrow * (LINE_EX - LINE_SX)))

  const toolEls = TOOLS.map((name, i) => {
    const dist     = Math.abs(i - focusIdx)
    const isFocused = i === focusIdx
    const finalY   = CIR_Y + (i - SEL) * ITEM_H
    const y        = Math.round(finalY + scrollY - 14)

    const sz     = isFocused ? 38 : dist === 1 ? 30 : dist === 2 ? 26 : 22
    const weight = isFocused ? 700 : 400
    const color  = isFocused ? FG : '#C4C4CC'
    const op     = Math.max(0.25, 1 - dist * 0.22) * sceneP

    return h(Group, { key: i, opacity: op },
      h(Text, { x: LIST_X, y, fontSize: sz, fontFamily: SANS, fontWeight: weight, color }, name),
    )
  })

  // Circle color + icon follow the focused tool as the drum spins
  const meta = TOOL_META[focusIdx]

  return h(Group, { opacity: toOut },
    h(LightBg),
    h(Group, { opacity: sceneP },
      h(Ellipse, { x: CIR_X - CIR_R, y: CIR_Y - CIR_R, width: CIR_R * 2, height: CIR_R * 2, fill: meta.cc }),
      h(IconShape, { type: meta.type, cx: CIR_X, cy: CIR_Y, sz: 52, clr: meta.ic }),
    ),
    h(Rect, { x: LINE_SX, y: CIR_Y, width: lineW, height: 1, fill: '#AAAAAE' }),
    ...toolEls,
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SCENE 4C: NODE CARDS (f450–f599)
// ════════════════════════════════════════════════════════════════════════════
// Three large cards: GPT Image (shoe), Veo (video), Eleven v3 (audio node)
// World coords; pulled back at zoom 0.85
const NC = {
  shoe:  { x:  80, y: 170, w: 240, h: 310 },
  veo:   { x: 400, y:  80, w: 240, h: 310 },
  video: { x: 730, y: 110, w: 240, h: 185 }, // standalone video frame
  audio: { x: 390, y: 410, w: 340, h: 190 },
}
const MEDIA = {
  shoe:  '/Users/rodrigosilva/dev/onda-engine/refs/media/shoe-red.jpg',
  veo:   '/Users/rodrigosilva/dev/onda-engine/refs/media/trail-run.jpg',
  video: '/Users/rodrigosilva/dev/onda-engine/refs/media/sprint-hero.jpg',
}

function NodeCard({ nd, label, img, badge, badgeColor, popF, frame }) {
  const pop = sp(frame, popF, 18)
  const { x, y, w, h: h_ } = { x: nd.x, y: nd.y, w: nd.w, h: nd.h }
  const imgH = img ? Math.round(h_ * 0.55) : 0
  const badgeEl = badge
    ? h(Group, { key: 'badge' },
        h(Ellipse, { x: x + w - 26, y: y - 14, width: 28, height: 28, fill: badgeColor ?? '#4B7BF5' }),
        h(Text, { x: x + w - 20, y: y - 8, fontSize: 12, fontFamily: SANS, fontWeight: 700, color: WHITE }, badge),
      )
    : h(Rect, { key: 'badge', x: 0, y: 0, width: 0, height: 0, fill: '#00000000' })
  const imgEl = img
    ? h(Image, { key: 'img', x: x + 4, y: y + 4, width: w - 8, height: imgH, src: img, cornerRadius: 8 })
    : h(Rect, { key: 'img', x: 0, y: 0, width: 0, height: 0, fill: '#00000000' })
  const lblEl = label
    ? h(Text, { key: 'lbl', x: x + 10, y: y + imgH + 10, fontSize: 11, fontFamily: SANS, fontWeight: 400, color: '#6B7280' }, label)
    : h(Rect, { key: 'lbl', x: 0, y: 0, width: 0, height: 0, fill: '#00000000' })
  return h(Group, { opacity: pop },
    h(Rect, { x, y, width: w, height: h_, fill: WHITE, cornerRadius: 12,
      shadow: { color: '#00000014', blur: 20, offsetY: 8 } }),
    imgEl, lblEl, badgeEl,
  )
}

function VideoCard({ frame }) {
  const pop = sp(frame, S_NODES + 28, 18)
  const { x, y, w, h: hh } = { x: NC.video.x, y: NC.video.y, w: NC.video.w, h: NC.video.h }
  return h(Group, { opacity: pop },
    h(Image, { x, y, width: w, height: hh, src: MEDIA.video, cornerRadius: 10 }),
    h(Ellipse, { x: x + w - 26, y: y - 14, width: 28, height: 28, fill: PURPLE }),
    h(Text, { x: x + w - 20, y: y - 8, fontSize: 12, fontFamily: SANS, fontWeight: 700, color: WHITE }, '▶'),
  )
}

function AudioCard({ frame }) {
  const pop = sp(frame, S_NODES + 36, 18)
  const { x, y, w, h: hh } = { x: NC.audio.x, y: NC.audio.y, w: NC.audio.w, h: NC.audio.h }
  const WH = [6,10,16,22,14,26,18,10,22,28,14,20,8,18,24,12,20,14,22,10,18,24,8,14,20,16,12,20,14,18]
  const wfW = 200, wfH = 28, wfX = x + 70, wfY = y + 14
  const maxWH = Math.max(...WH)
  return h(Group, { opacity: pop },
    h(Rect, { x, y, width: w, height: hh, fill: WHITE, cornerRadius: 12,
      shadow: { color: '#00000014', blur: 16, offsetY: 6 } }),
    h(Ellipse, { x: x + 14, y: y + 14, width: 32, height: 32, fill: '#F0F0F4' }),
    h(Text, { x: x + 22, y: y + 18, fontSize: 14, fontFamily: SANS, fontWeight: 700, color: FG }, '▶'),
    h(Text, { x: x + 54, y: y + 22, fontSize: 11, fontFamily: SANS, fontWeight: 400, color: '#9CA3AF' }, '0:13'),
    ...WH.map((barH, i) => {
      const bw = Math.max(1, Math.round(wfW / WH.length) - 1)
      const bx = wfX + Math.round(i * wfW / WH.length)
      const bh = Math.round((barH / maxWH) * wfH)
      const by = wfY + Math.round(wfH / 2 - bh / 2)
      return h(Rect, { key: i, x: bx, y: by, width: bw, height: Math.max(2, bh), fill: '#D1D5DB' })
    }),
    h(Rect, { x: x + 10, y: y + 58, width: w - 20, height: 32, fill: '#F7F7FA', cornerRadius: 8 }),
    h(Ellipse, { x: x + 18, y: y + 65, width: 18, height: 18, fill: '#5B8DEF' }),
    h(Text, { x: x + 44, y: y + 68, fontSize: 12, fontFamily: SANS, fontWeight: 500, color: FG }, 'Victoria - Warm, Trustworthy, and Relatable'),
    h(Text, { x: x + 14, y: y + 100, fontSize: 11, fontFamily: SANS, fontWeight: 400, color: '#6B7280' }, 'Built for the path ahead. From forest trails to everyday'),
    h(Text, { x: x + 14, y: y + 116, fontSize: 11, fontFamily: SANS, fontWeight: 400, color: '#6B7280' }, 'miles, these trainers move with you.'),
    h(Rect, { x: x + w - 70, y: y + hh - 36, width: 60, height: 26, fill: FG, cornerRadius: 8 }),
    h(Text, { x: x + w - 58, y: y + hh - 28, fontSize: 11, fontFamily: SANS, fontWeight: 600, color: WHITE }, 'Run ▾'),
    h(Ellipse, { x: x + w - 26, y: y - 14, width: 28, height: 28, fill: '#E08AF0' }),
    h(Text, { x: x + w - 20, y: y - 8, fontSize: 12, fontFamily: SANS, fontWeight: 700, color: WHITE }, '♪'),
  )
}

function SceneNodes({ frame }) {
  const zoom = spring({ frame: Math.max(0, frame - S_NODES), fps: FPS,
    from: 1.05, to: 0.88, config: SPRING_SMOOTH, durationInFrames: S_HERO - S_NODES })
  const toOut = fadeOut(frame, S_HERO - 14, S_HERO)
  const connOp = fadeIn(frame, S_NODES + 28, S_NODES + 48)
  // Bezier connectors in world coords — Camera handles the zoom
  const shoe_r = { x: NC.shoe.x + NC.shoe.w,  y: NC.shoe.y + NC.shoe.h / 2 }
  const veo_l  = { x: NC.veo.x,               y: NC.veo.y + NC.veo.h / 2 }
  const veo_r  = { x: NC.veo.x + NC.veo.w,    y: NC.veo.y + NC.veo.h / 2 }
  const vid_l  = { x: NC.video.x,             y: NC.video.y + NC.video.h / 2 }
  const aud_l  = { x: NC.audio.x,             y: NC.audio.y + NC.audio.h / 2 }

  return h(Group, { opacity: toOut },
    h(LightBg),
    h(Camera, { zoom, focusX: CX, focusY: CY },
      h(Bezier, { x1: shoe_r.x, y1: shoe_r.y, x2: veo_l.x, y2: veo_l.y, opacity: connOp }),
      h(Bezier, { x1: veo_r.x, y1: veo_r.y, x2: vid_l.x, y2: vid_l.y, opacity: connOp }),
      h(Bezier, { x1: veo_r.x, y1: veo_r.y, x2: aud_l.x, y2: aud_l.y, opacity: connOp }),
      h(NodeCard, { nd: NC.shoe,  label: 'GPT Image 2  16:9  4K',  img: MEDIA.shoe, badge: '⬛', badgeColor: '#4B7BF5', popF: S_NODES,      frame }),
      h(NodeCard, { nd: NC.veo,   label: 'Veo 3.1 Fast  720p  4s', img: MEDIA.veo,  badge: '▶', badgeColor: PURPLE,    popF: S_NODES + 18, frame }),
      h(VideoCard, { frame }),
      h(AudioCard, { frame }),
    ),
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SCENE 5A: HERO SHOT (f600–f659)
// ════════════════════════════════════════════════════════════════════════════
function SceneHero({ frame }) {
  const toOut = fadeOut(frame, S_THINK - 14, S_THINK)
  const cardP = sp(frame, S_HERO, 18)
  const CW2 = 420, CH2 = 130
  const cx2 = 140, cy2 = 100
  return h(Group, { opacity: toOut },
    h(Image, { x: 360, y: 0, width: 920, height: H, src: MEDIA.video, cornerRadius: 0 }),
    h(Rect, { x: 0, y: 0, width: W, height: H, fill: '#EFEFEF90' }),
    h(Group, { opacity: cardP },
      h(Rect, { x: cx2, y: cy2, width: CW2, height: CH2, fill: WHITE,
        cornerRadius: 16, shadow: { color: '#00000020', blur: 30, offsetY: 10 } }),
      h(Text, { x: cx2 + 20, y: cy2 + 18, fontSize: 20, fontFamily: SANS, fontWeight: 600, color: FG }, 'Flows Agent'),
      h(Ellipse, { x: cx2 + 20 + textW('Flows Agent', 20, 600) + 10, y: cy2 + 26, width: 10, height: 10, fill: GREEN }),
      h(Rect, { x: cx2 + 14, y: cy2 + 48, width: CW2 - 28, height: 54, cornerRadius: 10, fill: '#F7F7FA' }),
      h(Image, { x: cx2 + 22, y: cy2 + 57, width: 36, height: 36, src: MEDIA.shoe, cornerRadius: 6 }),
      h(Rect, { x: cx2 + 66, y: cy2 + 65, width: 240, height: 18, fill: '#E8E8EC', cornerRadius: 4 }),
      h(Ellipse, { x: cx2 + CW2 - 52, y: cy2 + 74, width: 32, height: 32, fill: FG }),
      h(Path, { x: cx2 + CW2 - 38, y: cy2 + 90,
        d: 'M 0 8 L 0 -8 M -4 -3 L 0 -8 L 4 -3',
        stroke: WHITE, strokeWidth: 2, strokeCap: 'round', strokeJoin: 'round' }),
    ),
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SCENE 5B: THINKING (f660–f749)
// ════════════════════════════════════════════════════════════════════════════
function SceneThink({ frame }) {
  const toOut = fadeOut(frame, S_RES - 14, S_RES)
  const hOp   = fadeIn(frame, S_THINK, S_THINK + 12)
  const t1Op  = fadeIn(frame, S_THINK + 14, S_THINK + 24)
  const t2Op  = fadeIn(frame, S_THINK + 28, S_THINK + 38)
  const t3Op  = fadeIn(frame, S_THINK + 44, S_THINK + 54)
  const HX = 80, HY = 80
  const HL = textW('Flows Agent', 34, 700)
  return h(Group, { opacity: toOut },
    h(WhiteBg),
    h(Group, { opacity: hOp },
      h(Text, { x: HX, y: HY, fontSize: 34, fontFamily: SANS, fontWeight: 700, color: FG }, 'Flows Agent'),
      h(Ellipse, { x: HX + HL + 12, y: HY + 12, width: 14, height: 14, fill: GREEN }),
    ),
    h(Text, { x: HX, y: HY + 62, fontSize: 20, fontFamily: SANS, fontWeight: 400, color: '#AAAAAE', opacity: t1Op }, 'Thinking'),
    h(Rect, { x: HX + 2, y: HY + 90, width: 2, height: 80, fill: '#D0D0D8', opacity: t1Op }),
    h(Text, { x: HX + 18, y: HY + 92, fontSize: 18, fontFamily: SANS, fontWeight: 400, color: '#AAAAAE', opacity: t2Op },
      'Analyzing current Shoe Concept 01 outputs'),
    h(Text, { x: HX + 18, y: HY + 116, fontSize: 18, fontFamily: SANS, fontWeight: 400, color: '#AAAAAE', opacity: t2Op },
      'and preparing batch variants'),
    h(Text, { x: HX, y: HY + 188, fontSize: 20, fontFamily: SANS, fontWeight: 400, color: '#AAAAAE', opacity: t3Op },
      'Activated workflow'),
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SCENE 5C: RESOLUTION PICKER (f750–f839)
// ════════════════════════════════════════════════════════════════════════════
const RES_OPTS = ['720p', '1080p', '4K']

function SceneRes({ frame }) {
  const toOut = fadeOut(frame, S_AUDIO - 14, S_AUDIO)
  const adj   = fadeIn(frame, S_RES, S_RES + 14)
  const hOp   = fadeIn(frame, S_RES + 14, S_RES + 28)
  const chipOp = fadeIn(frame, S_RES + 28, S_RES + 44)
  const HX = 80, HY = 80
  const LINE1 = 'You can also choose the export resolution for'
  const LINE2 = 'final delivery:'
  const FSZ = 38
  return h(Group, { opacity: toOut },
    h(WhiteBg),
    h(Text, { x: HX, y: HY - 28, fontSize: 15, fontFamily: SANS, fontWeight: 400, color: '#AAAAAE', opacity: adj },
      'Adjusting layouts and reframing visuals...'),
    h(Text, { x: HX, y: HY + 28, fontSize: FSZ, fontFamily: SANS, fontWeight: 500, color: FG, opacity: hOp }, LINE1),
    h(Text, { x: HX, y: HY + 28 + FSZ + 8, fontSize: FSZ, fontFamily: SANS, fontWeight: 500, color: FG, opacity: hOp }, LINE2),
    h(Group, { opacity: chipOp },
      ...RES_OPTS.map((lbl, i) => {
        const cw = textW(lbl, 22, 500) + 40
        const cx = HX + RES_OPTS.slice(0, i).reduce((a, l) => a + textW(l, 22, 500) + 40 + 18, 0)
        const cy = HY + 28 + (FSZ + 8) * 2 + 26
        return h(Group, { key: i },
          h(Rect, { x: cx, y: cy, width: cw, height: 52, fill: WHITE, cornerRadius: 12,
            shadow: { color: '#00000010', blur: 4, offsetY: 2 } }),
          h(Rect, { x: cx + 1, y: cy + 1, width: cw - 2, height: 50, fill: '#00000000', cornerRadius: 11 }),
          h(Text, { x: cx + 20, y: cy + 15, fontSize: 22, fontFamily: SANS, fontWeight: 500, color: FG }, lbl),
        )
      }),
    ),
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SCENE 5D: AUDIO NODE (f840–f959)
// ════════════════════════════════════════════════════════════════════════════
const WF_H = [6,12,18,26,16,28,22,14,20,28,16,22,10,24,28,14,20,10,24,18,26,12,18,28,8,16,22,18,12,20]

function SceneAudio({ frame }) {
  const toOut = fadeOut(frame, S_MATRIX - 14, S_MATRIX)
  const pop   = sp(frame, S_AUDIO, 22)
  const AW = 580, AH = 280
  const AX = Math.round(CX - AW / 2), AY = Math.round(CY - AH / 2)
  const maxWH = Math.max(...WF_H)
  const wfTW = AW - 80, wfX = AX + 76, wfY = AY + 28, wfH = 32
  // Animate a playhead progress
  const playP = prg(frame, S_AUDIO, S_MATRIX)

  return h(Group, { opacity: toOut },
    h(LightBg),
    h(Group, { opacity: pop },
      // T circle (left connector label)
      h(Ellipse, { x: AX - 66, y: AY + AH / 2 - 22, width: 44, height: 44, fill: '#E8E8EC' }),
      h(Text, { x: AX - 54, y: AY + AH / 2 - 10, fontSize: 18, fontFamily: SANS, fontWeight: 700, color: '#6B7280' }, 'T'),

      // Main card
      h(Rect, { x: AX, y: AY, width: AW, height: AH, fill: WHITE, cornerRadius: 16,
        shadow: { color: '#00000018', blur: 30, offsetY: 12 } }),

      // Row 1: play + time + waveform + download + dots
      h(Ellipse, { x: AX + 14, y: AY + 16, width: 44, height: 44, fill: '#F2F2F4' }),
      h(Text, { x: AX + 24, y: AY + 20, fontSize: 20, fontFamily: SANS, fontWeight: 700, color: FG }, '▶'),
      h(Text, { x: AX + 66, y: AY + 24, fontSize: 16, fontFamily: SANS, fontWeight: 400, color: FG }, '0:13'),
      // Waveform bars
      ...WF_H.map((bh, i) => {
        const maxH = wfH, norm = bh / maxWH
        const barH = Math.max(2, Math.round(norm * maxH))
        const barW = Math.max(2, Math.round(wfTW / WF_H.length) - 1)
        const bx = wfX + Math.round(i * wfTW / WF_H.length)
        const by = wfY + Math.round((wfH - barH) / 2)
        const past = i / WF_H.length < playP
        return h(Rect, { key: `wf${i}`, x: bx, y: by, width: barW, height: barH,
          fill: past ? '#6B7280' : '#D1D5DB' })
      }),
      h(Text, { x: AX + AW - 72, y: AY + 24, fontSize: 16, fontFamily: SANS, fontWeight: 400, color: '#9CA3AF' }, '⬇  ···'),

      // Divider
      h(Rect, { x: AX + 14, y: AY + 72, width: AW - 28, height: 1, fill: '#F0F0F4' }),

      // Victoria row
      h(Rect, { x: AX + 14, y: AY + 82, width: AW - 28, height: 46, fill: '#F7F7FA', cornerRadius: 10 }),
      h(Ellipse, { x: AX + 22, y: AY + 91, width: 28, height: 28, fill: '#5B8DEF' }),
      h(Text, { x: AX + 58, y: AY + 98, fontSize: 15, fontFamily: SANS, fontWeight: 500, color: '#E07830' },
        'Victoria - Warm, Trustworthy, and Relatable'),

      // Divider
      h(Rect, { x: AX + 14, y: AY + 136, width: AW - 28, height: 1, fill: '#F0F0F4' }),

      // Script text
      h(Text, { x: AX + 22, y: AY + 154, fontSize: 16, fontFamily: SANS, fontWeight: 400, color: FG },
        'Built for speed and endurance. From first stride to final'),
      h(Text, { x: AX + 22, y: AY + 176, fontSize: 16, fontFamily: SANS, fontWeight: 400, color: FG },
        'stretch, trainers that keep pace with your ambition'),

      // Run button
      h(Rect, { x: AX + AW - 100, y: AY + AH - 46, width: 86, height: 34, fill: FG, cornerRadius: 10 }),
      h(Text, { x: AX + AW - 86, y: AY + AH - 34, fontSize: 14, fontFamily: SANS, fontWeight: 600, color: WHITE }, 'Run  ▾'),

      // Pink audio badge
      h(Ellipse, { x: AX + AW - 18, y: AY - 18, width: 36, height: 36, fill: '#E08AF0' }),
      h(Text, { x: AX + AW - 8, y: AY - 10, fontSize: 14, fontFamily: SANS, fontWeight: 700, color: WHITE }, '♪'),
    ),
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SCENE 6: MATRIX — infinite canvas zoom-out (f960–f1289)
// ════════════════════════════════════════════════════════════════════════════
const MATS = [
  // [wx, wy, w, h, img, rotation] — organic scattered layout
  [  90, 120, 210, 165, 0], [ 340, 100, 160, 120, 0], [ 540,  80, 200, 150, 0],
  [ 760, 100, 220, 170, 0], [ 980,  90, 160, 120, 0], [1160,  80, 220, 165, 0],
  [  60, 330, 180, 140, 0], [ 280, 310, 240, 185, 0], [ 560, 295, 180, 140, 0],
  [ 770, 315, 200, 150, 0], [1000, 300, 160, 125, 0], [1190, 310, 190, 145, 0],
  [ 110, 530, 220, 170, 0], [ 370, 515, 180, 140, 0], [ 590, 500, 200, 155, 0],
  [ 820, 510, 170, 135, 0], [1030, 495, 200, 155, 0], [1220, 505, 180, 140, 0],
]
const MAT_IMGS = [
  '/Users/rodrigosilva/dev/onda-engine/refs/media/shoe-red.jpg',
  '/Users/rodrigosilva/dev/onda-engine/refs/media/trail-run.jpg',
  '/Users/rodrigosilva/dev/onda-engine/refs/media/shoe-white.jpg',
  '/Users/rodrigosilva/dev/onda-engine/refs/media/sprint-hero.jpg',
  '/Users/rodrigosilva/dev/onda-engine/refs/media/shoe-run.jpg',
]

function SceneMatrix({ frame }) {
  const zoom = interpolate(frame, [S_MATRIX, S_FLOOD], [0.92, 0.36], CLAMP)
  const toOut = fadeOut(frame, S_FLOOD - 24, S_FLOOD)

  const cards = MATS.map(([wx, wy, mw, mh], i) => {
    const pop = sp(frame, S_MATRIX + i * 8, 20)
    return h(Group, { key: i, opacity: pop },
      h(Rect, { x: wx, y: wy, width: mw, height: mh,
        fill: WHITE, cornerRadius: 8, shadow: { color: '#00000012', blur: 12, offsetY: 5 } }),
      h(Image, { x: wx + 3, y: wy + 3, width: mw - 6, height: mh - 24,
        src: MAT_IMGS[i % MAT_IMGS.length], cornerRadius: 5 }),
      h(Text, { x: wx + 8, y: wy + mh - 18, fontSize: 10, fontFamily: SANS, fontWeight: 400, color: '#9CA3AF' },
        ['GPT Image 2', 'Veo 3.1 Fast', 'GPT Image 2', 'Veo 3.1 Fast', 'GPT Image 2'][i % 5]),
    )
  })

  return h(Group, { opacity: toOut },
    h(WhiteBg),
    h(Camera, { zoom, focusX: CX, focusY: CY }, ...cards),
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SCENE 7A: GRADIENT FLOOD + SCATTERED ICONS (f1290–f1379)
// ════════════════════════════════════════════════════════════════════════════
// Small scattered icon dots throughout, "Flows Agent / What should we create next?" card
const ICON_DOTS = [
  { rx: 0.10, ry: 0.18, icon: '↩' }, { rx: 0.78, ry: 0.12, icon: '▶' },
  { rx: 0.88, ry: 0.38, icon: '◫' }, { rx: 0.06, ry: 0.52, icon: 'T' },
  { rx: 0.22, ry: 0.72, icon: '⊟' }, { rx: 0.58, ry: 0.80, icon: '▷' },
  { rx: 0.80, ry: 0.74, icon: '▶' }, { rx: 0.44, ry: 0.14, icon: '≡' },
  { rx: 0.92, ry: 0.60, icon: '↗' }, { rx: 0.16, ry: 0.86, icon: 'Q' },
  { rx: 0.68, ry: 0.44, icon: 'D' }, { rx: 0.35, ry: 0.48, icon: '⊞' },
  { rx: 0.55, ry: 0.25, icon: '≡' }, { rx: 0.72, ry: 0.60, icon: '↩' },
]
const WHAT_CARD_W = 300, WHAT_CARD_H = 80

function SceneFlood({ frame }) {
  const t    = frame / FPS
  const fIn  = fadeIn(frame, S_FLOOD, S_FLOOD + 24)
  const toOut = fadeOut(frame, S_LOGO - 16, S_LOGO)
  const icOp  = fadeIn(frame, S_FLOOD + 12, S_FLOOD + 36)
  const cardP = sp(frame, S_FLOOD + 20, 24)

  const WCX = CX, WCY = CY + 10
  const wcx = Math.round(WCX - WHAT_CARD_W / 2)
  const wcy = Math.round(WCY - WHAT_CARD_H / 2)
  const HL2 = textW('Flows Agent', 16, 600)
  const TYPE_START = S_FLOOD + 32

  const icons = ICON_DOTS.map((dot, i) => {
    const ix = Math.round(dot.rx * W)
    const iy = Math.round(dot.ry * H)
    const op = sp(frame, S_FLOOD + i * 3, 10) * icOp
    return h(Group, { key: i, opacity: op },
      h(Ellipse, { x: ix - 16, y: iy - 16, width: 32, height: 32, fill: '#FFFFFF28' }),
      h(Text, { x: ix - 7, y: iy - 8, fontSize: 13, fontFamily: SANS, fontWeight: 500, color: '#FFFFFF90' }, dot.icon),
    )
  })

  return h(Group, { grain: { intensity: 0.08, size: 1.2, seed: frame }, opacity: toOut },
    h(Rect, { x: 0, y: 0, width: W, height: H,
      gradient: fbmGradient(CLOUD, { scale: 0.42, warp: 0.60, time: (t - 43) * 0.06 + 2.5 }) }),
    h(Group, { opacity: fIn }, ...icons),
    h(Group, { opacity: cardP },
      h(Rect, { x: wcx, y: wcy, width: WHAT_CARD_W, height: WHAT_CARD_H,
        fill: WHITE, cornerRadius: 14, shadow: { color: '#00000030', blur: 24, offsetY: 8 } }),
      h(Text, { x: wcx + 16, y: wcy + 16, fontSize: 16, fontFamily: SANS, fontWeight: 600, color: FG }, 'Flows Agent'),
      h(Ellipse, { x: wcx + 16 + HL2 + 10, y: wcy + 24, width: 10, height: 10, fill: GREEN }),
      h(Rect, { x: wcx + 12, y: wcy + 44, width: WHAT_CARD_W - 24, height: 26, fill: '#F4F4F8', cornerRadius: 8 }),
      h(FadeType, { text: 'What should we create next?', x0: wcx + 20, y: wcy + 52,
        size: 14, weight: 400, color: FG, start: TYPE_START, charF: 1.2, fadeF: 5, cursor: true }),
    ),
  )
}

// ════════════════════════════════════════════════════════════════════════════
// SCENE 7B: LOGO + CORNER ARCS (f1380–end)
// ════════════════════════════════════════════════════════════════════════════
const ARC_R = 180  // radius of corner arcs

function SceneLogo({ frame }) {
  const t   = frame / FPS
  const fIn = fadeIn(frame, S_LOGO, S_LOGO + 24)
  const arcOp = fadeIn(frame, S_LOGO + 18, S_LOGO + 42)
  const logoOp = fadeIn(frame, S_LOGO + 28, S_LOGO + 52)

  // Logo: "||Eleven" bold + "Creative" regular, centered
  const BOLD_TXT = '||Eleven', REG_TXT = ' Creative', LSZ = 38
  const boldW = textW(BOLD_TXT, LSZ, 700)
  const regW  = textW(REG_TXT,  LSZ, 400)
  const logoX = Math.round(CX - (boldW + regW) / 2)
  const logoY = Math.round(CY - LSZ * 0.55)

  // FadeType for the logo typing
  const TYPE_START = S_LOGO + 28
  const FULL_LOGO  = BOLD_TXT + REG_TXT

  // Corner arcs: 4 large circles centered at each corner, showing just the visible arc
  const corners = [
    { cx: 0,   cy: 0   }, { cx: W,   cy: 0   },
    { cx: 0,   cy: H   }, { cx: W,   cy: H   },
  ].map(({ cx, cy }, i) =>
    h(Ellipse, { key: i, x: cx - ARC_R, y: cy - ARC_R, width: ARC_R * 2, height: ARC_R * 2,
      fill: '#00000000', stroke: '#FFFFFF50', strokeWidth: 1.5, opacity: arcOp })
  )

  return h(Group, { grain: { intensity: 0.08, size: 1.2, seed: frame } },
    h(Rect, { x: 0, y: 0, width: W, height: H,
      gradient: fbmGradient(CLOUD, { scale: 0.42, warp: 0.60, time: (t - 46) * 0.06 + 3.2 }) }),
    h(Group, { opacity: fIn }, ...corners),
    // Logo types in
    h(Group, { opacity: logoOp },
      h(FadeType, {
        text: FULL_LOGO, x0: logoX, y: logoY,
        size: LSZ, weight: 700, color: WHITE,
        start: TYPE_START, charF: 1.5, fadeF: 6, cursor: false,
      }),
    ),
  )
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN ROUTER
// ════════════════════════════════════════════════════════════════════════════
function FlowsFull({ width, height }) {
  const frame = useCurrentFrame()
  const content =
    frame < S_MACRO  ? h(SceneShot1,   { frame }) :
    frame < S_LOG    ? h(SceneMacro,   { frame }) :
    frame < S_SELECT ? h(SceneLog,      { frame }) :
    frame < S_NODES  ? h(SceneSelector, { frame }) :
    frame < S_HERO   ? h(SceneNodes,    { frame }) :
    frame < S_THINK  ? h(SceneHero,     { frame }) :
    frame < S_RES    ? h(SceneThink,    { frame }) :
    frame < S_AUDIO  ? h(SceneRes,      { frame }) :
    frame < S_MATRIX ? h(SceneAudio,    { frame }) :
    frame < S_FLOOD  ? h(SceneMatrix,   { frame }) :
    frame < S_LOGO   ? h(SceneFlood,    { frame }) :
                       h(SceneLogo,     { frame })
  return h(Group, null,
    content,
    h(AudioClip, { key: 'audio',
      src: '/Users/rodrigosilva/dev/onda-engine/refs/flows-full-audio.aac', volume: 0.85 }),
  )
}

export default function flowsFull({ fps, durationInFrames, width, height }) {
  return h(Composition, { width, height, fps, durationInFrames, linear: true },
    h(FlowsFull, { width, height }))
}
