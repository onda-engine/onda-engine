#!/usr/bin/env node
// onda-inspect — run the @onda/cinema INSPECTOR over a composition payload.
//
//   onda-inspect <composition.json> [--format 9:16] [--frames 12,80] [--json]
//
// Prints violations grouped by severity (or the full report as JSON with
// --json). Exit code: 0 clean / has only warn+info, 1 when any `error`
// violation fires, 2 on usage errors.

import { readFileSync } from 'node:fs'
import process from 'node:process'

const FORMATS = ['16:9', '9:16', '1:1', '4:5']

function usage(message) {
  if (message) console.error(`onda-inspect: ${message}\n`)
  console.error(
    'usage: onda-inspect <composition.json> [--format 16:9|9:16|1:1|4:5] [--frames 12,80] [--json]',
  )
  process.exit(2)
}

const args = process.argv.slice(2)
let file
let format
let frames
let json = false
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--json') json = true
  else if (a === '--format') {
    format = args[++i]
    if (!FORMATS.includes(format)) usage(`--format must be one of ${FORMATS.join(' | ')}`)
  } else if (a === '--frames') {
    const raw = args[++i]
    if (!raw) usage('--frames needs a comma-separated list of frame indices')
    frames = raw.split(',').map((s) => Number(s.trim()))
    if (frames.some((f) => !Number.isInteger(f) || f < 0))
      usage(`--frames must be non-negative integers (got "${raw}")`)
  } else if (a === '--help' || a === '-h') usage()
  else if (a.startsWith('--')) usage(`unknown flag ${a}`)
  else if (file) usage('only one composition file at a time')
  else file = a
}
if (!file) usage('missing <composition.json>')

let payload
try {
  payload = JSON.parse(readFileSync(file, 'utf8'))
} catch (e) {
  console.error(`onda-inspect: can't read ${file}: ${e.message}`)
  process.exit(2)
}

// Warm the engine's text metrics so overflow widths are shaped (cosmic-text),
// not the glyph-count estimate. Never throws — estimates are the fallback.
const { preloadTextMetrics } = await import('@onda/components')
await preloadTextMetrics()
const { inspect, validateComposition } = await import('../dist/index.js')

// Structural problems first — inspect() assumes a valid payload.
const structural = validateComposition(payload).filter((d) => d.level === 'error')
if (structural.length > 0) {
  console.error(`${file}: ${structural.length} structural error(s) — fix these first:\n`)
  for (const d of structural) console.error(`  ✖ ${d.path}: ${d.message}`)
  process.exit(1)
}

const report = inspect(payload, { format, frames })

if (json) {
  console.log(JSON.stringify(report, null, 2))
  process.exit(report.summary.error > 0 ? 1 : 0)
}

const MARK = { error: '✖', warn: '▲', info: 'ℹ' }
const order = ['error', 'warn', 'info']
console.log(
  `${file} — ${report.format}, ${report.totalFrames} frames @ ${report.fps}fps — ` +
    `${report.summary.error} error(s), ${report.summary.warn} warning(s), ${report.summary.info} info\n`,
)
for (const severity of order) {
  const group = report.violations.filter((v) => v.severity === severity)
  if (group.length === 0) continue
  console.log(`${severity.toUpperCase()}`)
  for (const v of group) {
    const where = v.sceneId && v.sceneId !== v.targetId ? ` (scene ${v.sceneId})` : ''
    console.log(`  ${MARK[severity]} [${v.check}] ${v.targetId}${where}`)
    console.log(`      ${v.message}`)
    if (v.fix) console.log(`      fix: ${v.fix.prop} → ${JSON.stringify(v.fix.suggested)}`)
  }
  console.log('')
}
if (report.violations.length === 0) console.log('clean — no violations.')
process.exit(report.summary.error > 0 ? 1 : 0)
