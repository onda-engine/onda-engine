// @onda/wasm-vello — the ONDA Vello (GPU) renderer for the browser.
//
// This wrapper applies a small WebGPU compatibility shim, then re-exports the
// wasm-bindgen bindings from ./pkg. Import this (the package entry), not ./pkg
// directly, so the shim is always in place before you call `VelloEngine.create`.
//
// The shim: wgpu 22 (pinned by Vello 0.3) still sends the limit
// `maxInterStageShaderComponents`, which current Chrome removed from the WebGPU
// spec and rejects in `requestDevice`. We strip it. (Remove this once Vello/wgpu
// is bumped past 22 — see packages/player/WEBGPU.md.)
if (
  typeof globalThis !== 'undefined' &&
  globalThis.GPUAdapter &&
  !globalThis.__ondaWebgpuLimitShim
) {
  globalThis.__ondaWebgpuLimitShim = true
  const proto = globalThis.GPUAdapter.prototype
  const original = proto.requestDevice
  proto.requestDevice = function requestDevice(descriptor) {
    if (
      descriptor?.requiredLimits &&
      'maxInterStageShaderComponents' in descriptor.requiredLimits
    ) {
      const limits = { ...descriptor.requiredLimits }
      limits.maxInterStageShaderComponents = undefined
      return original.call(this, { ...descriptor, requiredLimits: limits })
    }
    return original.call(this, descriptor)
  }
}

export { default, initSync, VelloEngine, RenderedFrame } from './pkg/onda_wasm_vello.js'
