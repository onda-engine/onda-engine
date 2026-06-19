// `onda-engine` — the single-install entry to the whole engine.
//
// The root export is the Onda motion language (the primary authoring surface,
// `@onda-engine/components`). The lower-level pieces are subpaths:
//
//   import { ... }      from 'onda-engine'            // motion language
//   import { ... }      from 'onda-engine/react'      // the React → scene-graph renderer
//   import { Player }   from 'onda-engine/player'     // interactive preview
//   import { render }   from 'onda-engine/render'     // headless video/still render
//   import { ... }      from 'onda-engine/cinema'     // timeline payload → element
//   import init, { ... } from 'onda-engine/wasm'      // wasm cores
//   import init, { ... } from 'onda-engine/wasm-audio'
//   import init, { ... } from 'onda-engine/wasm-vello'
export * from '@onda-engine/components'
