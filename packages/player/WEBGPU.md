# Real-time WebGPU present for the ONDA Player

> Status: **assessment / not yet built.** This is the P0 "readback → present"
> item from `techspecs/gap-analysis.md` (§A and §F-3), scoped for the embeddable
> `<Player>`. Grounded in the actual code: `packages/vello-rs` (Vello 0.3 / wgpu
> 22) and `packages/wasm` (the wasm engine the Player previews through today).

## TL;DR

Today the in-browser Player previews through `@onda/wasm` → the **CPU** reference
renderer (`onda-renderer`): pixel-exact for rects/ellipses/text, but no paths,
gradients, clips, or AA, and no GPU. The pixel-true GPU output comes from
`onda-vello` (`VelloRenderer`), which renders headlessly on native wgpu and
**reads the texture back** to CPU bytes per frame.

A real-time WebGPU Player means: compile `onda-vello` to `wasm32-unknown-unknown`,
run it on the browser's **WebGPU** backend of wgpu, and **present Vello's output
straight to a `<canvas>` swapchain** instead of reading it back. The result:
the in-browser preview becomes pixel-identical to `onda export --backend vello`,
at real-time frame rates, with no DOM and no readback stall.

It is feasible — Vello is designed for exactly this — but it is a real project
(roughly **3–5 focused weeks**), with the main risks being WebGPU's compute/limits
constraints and wasm threading.

## What exists today (the starting point)

- **`onda-vello` / `VelloRenderer`** (`packages/vello-rs/src/lib.rs`): builds a
  `vello::Scene` from the ONDA `Scene`, then:
  - `wgpu::Instance::new(..)` → `request_adapter { compatible_surface: None }`
    → `request_device { required_features: Features::empty(), required_limits:
    adapter.limits() }`.
  - `Renderer::new(.., RendererOptions { surface_format: None, use_cpu: false,
    antialiasing_support: AaSupport::area_only(), .. })`.
  - Per frame: allocate an `Rgba8Unorm` texture (`STORAGE_BINDING | COPY_SRC`),
    `renderer.render_to_texture(.., &view, &RenderParams { .. AaConfig::Area })`,
    then **`read_back()`** — `copy_texture_to_buffer` (256-byte row padding) +
    `map_async(Read)` + `device.poll(Maintain::Wait)` → `Vec<u8>`.
- **`@onda/wasm`** (`packages/wasm`): the CPU `onda-renderer` compiled to wasm
  (`wasm32-unknown-unknown`, `wasm-bindgen --target web`), exposing
  `OndaEngine.render(json) -> RenderedFrame { width, height, pixels }`. This is
  what `<Player>`'s `engine` drawer blits with `putImageData` today.
- **`<Player>`** already accepts a `FrameDrawer` and an `engine`, and falls back
  gracefully when an engine can't render a scene — so a WebGPU present path slots
  in as a third drawer/initialization mode without an API redesign.

So two things are missing for charter-true real-time preview in the browser:
**(1)** the *Vello* renderer in wasm (not just the CPU one), and **(2)** a
*present* path (swapchain) instead of readback.

## The pieces

1. **A wasm build of `onda-vello` (Vello + wgpu on WebGPU).**
   - Vello 0.3 pins **wgpu 22**, which already has a `webgpu` backend for
     `wasm32-unknown-unknown`. Add a `[target.'cfg(target_arch = "wasm32")']`
     dependency set to `vello-rs` (mirroring how `packages/wasm/Cargo.toml`
     gates the engine deps), and a new wasm crate (or extend `onda-wasm`) that
     exports a `VelloEngine`.
   - Build with `--target wasm32-unknown-unknown` + `wasm-bindgen --target web`,
     same toolchain the existing `@onda/wasm` build script uses.

2. **A canvas surface + swapchain present (replace readback).**
   - Get a `wgpu::Surface` from an `HtmlCanvasElement` (wgpu 22:
     `instance.create_surface(SurfaceTarget::Canvas(canvas))` via
     `wasm-bindgen`'s `web-sys`). Note `request_adapter` must pass
     `compatible_surface: Some(&surface)` — today it's `None`.
   - `surface.configure(.., &SurfaceConfiguration { usage: RENDER_ATTACHMENT,
     format, .. })`. Per frame: `surface.get_current_texture()` →
     `render_to_surface`/`render_to_texture` into that view → `frame.present()`.
   - **Vello caveat:** `render_to_surface` needs a `TextureFormat::*Srgb`
     surface, but Vello's compute pipeline writes to a *storage* texture
     (`Rgba8Unorm`, no sRGB storage). Vello ships `util::block_on_wgpu` and a
     blit step for exactly this; the renderer must be created with
     `RendererOptions { surface_format: Some(config.format), .. }` so it builds
     the final blit pipeline. This is the single most fiddly bit.

3. **Async, browser-friendly device acquisition.**
   - `VelloRenderer::new()` currently does `pollster::block_on(new_async())`.
     On the web you **cannot block** on the main thread; `request_adapter` /
     `request_device` / buffer mapping are genuinely async there. The wasm
     entry must be `async` (an `async` `#[wasm_bindgen]` fn returning a JS
     `Promise`), and the Player initializes it before first paint (it already
     awaits `init(wasmUrl)` in `main.tsx`).

4. **A present-mode `<Player>` drawer.**
   - Instead of `engineDrawer` (which does `render(json) -> pixels` →
     `putImageData`), add a path that hands the engine the *canvas* once, then
     per frame calls `engine.renderToCanvas(json)` which presents directly. The
     React loop stays identical (still `renderFrame(composition, n)` →
     scene-graph JSON per frame); only the paint sink changes. The Canvas2D and
     `putImageData` drawers remain as fallbacks.

## Rough steps

1. Add the wasm-gated `vello-rs` dep + a `VelloEngine` wasm export; get it
   **compiling** to `wasm32-unknown-unknown` (expect to chase wgpu/web-sys
   feature flags). Keep readback first — prove Vello-in-browser produces the
   same bytes as `onda export --backend vello`, blitted via `putImageData`.
   *(This alone already upgrades preview fidelity to paths/gradients/clips/AA.)*
2. Switch device acquisition to fully async; request a compute-capable device
   and the limits Vello needs.
3. Add the surface/swapchain present path (canvas surface, `surface_format`,
   blit pipeline, `get_current_texture`/`present`); drop readback for preview.
4. Wire a present-mode drawer into `<Player>`; make it the default when a WebGPU
   adapter is available, falling back to the CPU wasm engine, then Canvas2D.
5. Verify pixel-parity vs the native Vello export on a fixture set; add a
   Playwright smoke test (WebGPU in headless Chromium needs the right flags).

## Risks / unknowns

- **WebGPU compute + limits.** Vello's fast path is a compute pipeline. The
  current native code requests `Features::empty()` with `downlevel_defaults`
  (gap-analysis §A flags this as blocking the compute path). In the browser the
  baseline WebGPU limits are tighter still; we must request the real limits and
  may need Vello's **`AaSupport`**/CPU-fallback or **Vello Hybrid** (compute +
  raster) for portability. Some devices/browsers will only have the slower path.
- **Browser/availability.** WebGPU is shipping in Chromium and Safari but not
  uniformly; Firefox is partial. The CPU wasm engine and Canvas2D must stay as
  graceful fallbacks (the Player already supports that).
- **wasm threading.** Vello init can use threads (`num_init_threads`); wasm
  threads require COOP/COEP cross-origin isolation headers and
  `SharedArrayBuffer`. Single-threaded init works but is slower to warm up.
- **Surface format / color management.** sRGB storage-texture mismatch (above)
  and premultiplied-alpha canvas compositing can introduce subtle color shifts
  vs the readback path; needs a golden-image check.
- **Binary size.** Vello + wgpu in wasm is large (the CPU engine is already
  ~2.1 MB); ship compressed and lazy-load the WebGPU module.
- **Resize / DPR.** The swapchain must reconfigure on container resize and
  honor `devicePixelRatio`; the Player's responsive container already sizes via
  CSS `aspect-ratio`, so the canvas backing store needs to track that.

## Estimate

- **~1 week** to get `onda-vello` compiling and rendering in wasm with readback
  (immediate fidelity win; lowest risk).
- **~1–2 weeks** for the async device + surface/swapchain present path and the
  sRGB/blit plumbing (the real meat; highest risk).
- **~1 week** to integrate into `<Player>` (present-mode drawer + adapter-based
  default + fallbacks) and write the headless WebGPU smoke test.
- **~0.5–1 week** buffer for limits/threading/format surprises across
  browsers/GPUs.

**Total: roughly 3–5 focused weeks** for a first credible real-time WebGPU
preview, with step 1 deliverable on its own as an early fidelity upgrade.
