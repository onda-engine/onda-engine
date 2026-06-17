import { readFileSync, writeFileSync } from 'node:fs'
import { Captions, loadFont, preloadTextMetrics } from '@onda/components'
import { Composition, Group, Video, renderFramesJSON } from '@onda/react'
import { createElement as h } from 'react'

const W = 640,
  H = 360,
  FPS = 30,
  SECONDS = 9
const t = JSON.parse(readFileSync('/tmp/rt.json', 'utf8'))
await preloadTextMetrics()
const fams = await loadFont(new Uint8Array(readFileSync('/tmp/Anton.ttf')))
const FONT = fams[0] || 'Anton'
const up = (s) => s.toUpperCase()
const captions = t.segments
  .filter((s) => !/^\s*[[(]/.test(s.text))
  .map((s) => ({
    text: up(s.text),
    startMs: s.start_ms,
    endMs: s.end_ms,
    words: s.words.map((idx) => ({
      text: up(t.words[idx].text),
      startMs: t.words[idx].start_ms,
      endMs: t.words[idx].end_ms,
    })),
  }))

const scene = h(
  Group,
  null,
  h(Video, { src: '/tmp/realclip.mp4', x: 0, y: 0, width: W, height: H }),
  h(Captions, {
    captions,
    placement: 'lower-third',
    fontFamily: FONT,
    fontSize: 44, // bigger — wrapping handles long lines now
    color: '#ffffff',
    accentColor: '#ffd23d',
    backdrop: 'shadow', // legibility without a manual scrim
    highlight: 'box', // active word in a gold pill (TikTok look)
    maxWidth: 0.86,
  }),
)
const comp = h(
  Composition,
  { width: W, height: H, fps: FPS, durationInFrames: FPS * SECONDS },
  scene,
)
writeFileSync('/tmp/captions-frames.json', renderFramesJSON(comp))
console.log(`frames built | font=${FONT}`)
