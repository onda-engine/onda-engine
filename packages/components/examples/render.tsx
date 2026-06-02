//! Tiny driver: render a showcase scene at a frame to scene-graph JSON on stdout.
//! Usage: tsx render.tsx <title|stat> <frame>  >  scene.json
//! Then:  onda render scene.json out.png --backend vello

import { renderFrame } from '@onda/react'
import { StatScene, TitleScene } from './showcase.js'

const which = process.argv[2] ?? 'title'
const frame = Number(process.argv[3] ?? '34')
const element = which === 'stat' ? StatScene() : TitleScene()
process.stdout.write(JSON.stringify(renderFrame(element, frame)))
