import { createRoot } from 'react-dom/client'
import { App } from './App.js'

// The App selects + initializes the renderer (WebGPU/Vello, falling back to the
// CPU engine) on mount, so we can mount immediately.
const root = document.getElementById('root')
if (root) createRoot(root).render(<App />)
