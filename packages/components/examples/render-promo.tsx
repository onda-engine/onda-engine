/** @jsxRuntime automatic @jsxImportSource react */
//! Evaluate the flagship promo to a per-frame scene-graph JSON array (for
//! `onda export-frames`). Usage: tsx render-promo.tsx <out.json>

import { writeFileSync } from 'node:fs'
import { renderFramesJSON } from '@onda-engine/react'
import { Promo } from './promo.js'

const out = process.argv[2] ?? '/tmp/promo-frames.json'
const t0 = process.hrtime.bigint()
const json = renderFramesJSON(Promo())
const ms = Number(process.hrtime.bigint() - t0) / 1e6
writeFileSync(out, json)
process.stderr.write(
  `evaluated promo -> ${out} (${(json.length / 1e6).toFixed(1)} MB, ${ms.toFixed(0)} ms in JS)\n`,
)
