import init from '@onda/wasm'
import wasmUrl from '@onda/wasm/pkg/onda_wasm_bg.wasm?url'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'

// Initialize the WebAssembly engine (the real Rust renderer) before mounting,
// so the player can render through it.
init(wasmUrl).then(() => {
  const root = document.getElementById('root')
  if (root) createRoot(root).render(<App />)
})
