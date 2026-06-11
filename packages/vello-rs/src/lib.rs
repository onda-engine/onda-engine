//! Vello vector renderer for ONDA — the GPU-native vector backend.
//!
//! Maps an ONDA [`Scene`] onto a `vello::Scene` and rasterizes it on the GPU
//! (compute) to an RGBA framebuffer. Unlike the retired quad+SDF backend this
//! does true vector rendering: anti-aliased fills *and* strokes, real rounded
//! rectangles, arbitrary Bézier [`Path`]s, and **native per-glyph vector text**
//! (glyph outlines drawn through Vello's glyph runs — resolution-independent and
//! ready for per-character/kinetic animation).
//!
//! Note: vello 0.3 pins wgpu 22, so this uses `vello::wgpu`.

use std::collections::HashMap;

use onda_core::{Color, Size, Transform};
use onda_scene::{
    BlendMode, BooleanOp, Camera3D, Effect, Gradient, GradientStop, ImageData, ImageFit, LineCap,
    LineJoin, Matte, MatteMode, Node, NodeKind, Scene, Shadow, ShapeGeometry, Text, TrimDash,
};
use onda_typography::{FontContext, StyledRun};
use vello::kurbo::{Affine, BezPath, Cap, Ellipse, Join, Rect, RoundedRect, Shape, Stroke};
use vello::peniko::{
    Blob, Brush, Color as PenikoColor, ColorStop, Fill, Font, Format, Gradient as PenikoGradient,
    Image as PenikoImage, Mix,
};
use vello::{wgpu, AaConfig, Glyph, RenderParams, Renderer, RendererOptions, Scene as VelloScene};

mod effects;
use effects::{
    AlphaMatte, Bloom, ColorGrade, FbmGradient, FinishParams, GaussianBlur, Goo, Grain, LightWrap,
    LinearFinish, PixelFx, PIXELFX_CHROMATIC, PIXELFX_CHROMA_KEY, PIXELFX_DUOTONE,
    PIXELFX_POSTERIZE, PIXELFX_VIGNETTE,
};
mod extrude;
mod scene3d;
use scene3d::{Layer3D, Mesh3D, Scene3D};

/// A rendered frame: straight-alpha RGBA8, row-major, top-left origin.
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

/// A reusable Vello-backed renderer (device + Vello renderer + fonts).
pub struct VelloRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    renderer: Renderer,
    fonts: FontContext,
    /// Vello fonts cached by `onda-typography`'s stable per-face key, built on
    /// demand from the face bytes the layout reports. Keeps Vello's glyph cache
    /// warm across frames.
    font_cache: HashMap<u64, Font>,
    /// Gaussian-blur compute pipeline (render-to-texture effect chain). Built
    /// lazily the first time a node carries a `Blur` effect, then reused.
    blur_pipeline: Option<GaussianBlur>,
    /// Bloom compute pipelines (bright-pass + additive composite). Built lazily the
    /// first time a node carries a `Bloom` effect; reuses `blur_pipeline` for the
    /// spread in between.
    bloom_pipeline: Option<Bloom>,
    /// Color-grade compute pipeline (a single per-pixel remap — no blur). Built
    /// lazily the first time a node carries a `ColorGrade` effect, then reused.
    grade_pipeline: Option<ColorGrade>,
    /// Unified per-pixel effect pipeline (chromatic aberration / vignette /
    /// posterize / duotone / chroma-key) — one pipeline, op-selected.
    pixelfx_pipeline: Option<PixelFx>,
    /// Gooey-morph threshold pipeline (alpha-sharpen after a blur). Built lazily
    /// the first time a node carries a `Goo` effect; reuses `blur_pipeline` for the
    /// spread before the threshold.
    goo_pipeline: Option<Goo>,
    /// Alpha-matte combine pipeline (content × matte coverage). Built lazily the
    /// first time a node carries a `matte`, then reused.
    matte_pipeline: Option<AlphaMatte>,
    /// fBm fractal-noise gradient generator (the "expensive" Stripe/Linear gradient).
    /// Built lazily the first time a shape carries a `Gradient::Fbm`, then reused.
    fbm_pipeline: Option<FbmGradient>,
    /// Film-grain compute pipeline (a single per-pixel pass). Built lazily the first
    /// time a node carries a `Grain` effect, then reused.
    grain_pipeline: Option<Grain>,
    /// Composition-level cinematic FINISH chain (decode→linear-HDR bloom→ACES). Built
    /// lazily the first time a comp carries a `Composition::finish`, then reused.
    linearfinish_pipeline: Option<LinearFinish>,
    /// The perspective 3D pass (textured-quad render pipeline + depth + un-premultiply).
    /// Built lazily the first time a comp carries a `camera3d` scene, then reused.
    scene3d_pipeline: Option<Scene3D>,
    /// True on the WebGPU (browser) backend, where buffer mapping is async-only.
    /// The effect path can't read a texture back synchronously mid-build there, so
    /// on the web effects are resolved up front by `prepare_effect_images` (async
    /// readbacks) and drawn from that cache; a cache miss degrades to un-effected
    /// rather than crashing. Native reads the effect texture back inline.
    web: bool,
}

impl VelloRenderer {
    /// Load an additional font (`.ttf`/`.otf` bytes) so text can select it by
    /// family. Returns the family name(s) it provides.
    pub fn load_font(&mut self, data: Vec<u8>) -> Vec<String> {
        self.fonts.load_font(data)
    }
}

impl VelloRenderer {
    /// Acquire a GPU and build the Vello renderer. `None` if no adapter exists.
    /// Blocks; native only. On the web use [`VelloRenderer::new_async`].
    pub fn new() -> Option<Self> {
        pollster::block_on(Self::new_async())
    }

    /// Async constructor — required on the web (wasm), where adapter/device
    /// acquisition genuinely can't block the main thread. `None` if no GPU.
    pub async fn new_async() -> Option<Self> {
        Self::try_new_async().await.ok()
    }

    /// Like [`new_async`], but reports *why* setup failed — useful on the web,
    /// where WebGPU may be missing or lack the limits Vello's compute path needs.
    pub async fn try_new_async() -> Result<Self, String> {
        let instance = wgpu::Instance::new(wgpu::InstanceDescriptor::default());
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                force_fallback_adapter: false,
                compatible_surface: None,
            })
            .await
            .ok_or_else(|| "request_adapter returned no adapter".to_string())?;
        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("onda-vello"),
                    required_features: wgpu::Features::empty(),
                    required_limits: adapter.limits(),
                    memory_hints: wgpu::MemoryHints::default(),
                },
                None,
            )
            .await
            .map_err(|e| format!("request_device failed: {e}"))?;
        let renderer = Renderer::new(
            &device,
            RendererOptions {
                surface_format: None,
                use_cpu: false,
                antialiasing_support: vello::AaSupport::area_only(),
                // Single-threaded init: wasm threads need COOP/COEP + SharedArrayBuffer.
                num_init_threads: std::num::NonZeroUsize::new(1),
            },
        )
        .map_err(|e| format!("Renderer::new failed: {e}"))?;
        // WebGPU (browser) can't synchronously map buffers; the effect path's
        // mid-build readback only works on native backends.
        let web = adapter.get_info().backend == wgpu::Backend::BrowserWebGpu;
        Ok(VelloRenderer {
            device,
            queue,
            renderer,
            fonts: FontContext::with_default_font(),
            font_cache: HashMap::new(),
            blur_pipeline: None,
            bloom_pipeline: None,
            grade_pipeline: None,
            pixelfx_pipeline: None,
            goo_pipeline: None,
            matte_pipeline: None,
            fbm_pipeline: None,
            grain_pipeline: None,
            linearfinish_pipeline: None,
            scene3d_pipeline: None,
            web,
        })
    }

    /// Render an ONDA scene to a [`Frame`] (blocking readback; native only).
    pub fn render(&mut self, scene: &Scene) -> Frame {
        // Native resolves effects, backdrop blur AND mattes INLINE during the build
        // (synchronous readback), so no pre-pass cache is needed.
        let (texture, width, height) = self.render_to_target(scene, None, None, None);
        read_back(&self.device, &self.queue, &texture, width, height)
    }

    /// Render an ONDA scene to a [`Frame`], awaiting the readback instead of
    /// blocking — required on the web (wasm), where buffer mapping is async.
    pub async fn render_async(&mut self, scene: &Scene) -> Frame {
        // WebGPU can't map buffers synchronously mid-build, so resolve every effect
        // subtree AND every frosted backdrop up front with async readbacks, then
        // build using the cached images (both pre-passes are no-ops on native —
        // effects and backdrops read back inline there).
        let effect_images = self.prepare_effect_images(scene).await;
        // Thread the effect cache into the backdrop pre-pass so a subtree effect
        // (blur/bloom/grade/goo) sitting BEHIND a glass panel shows up correctly in
        // the frosted backdrop — matching native (which resolves it inline). Each
        // backdrop node re-walks from root, so the prefix sees the same stop-at-
        // effect DFS prefix of effect nodes; a fresh effect_idx:0 per node consumes
        // exactly those.
        let backdrop_images = self.prepare_backdrop_images(scene, &effect_images).await;
        // Mattes likewise resolve up front on web (two captures + an alpha-combine
        // need a readback the build can't do synchronously).
        let matte_images = self.prepare_matte_images(scene).await;
        let (texture, width, height) = self.render_to_target(
            scene,
            Some(&effect_images),
            Some(&backdrop_images),
            Some(&matte_images),
        );
        read_back_async(&self.device, &self.queue, &texture, width, height).await
    }

    /// Resolve every effect node's image up front with ASYNC readbacks — required
    /// on WebGPU, where a buffer can't be mapped synchronously mid-build. Walks the
    /// scene in the same stop-at-effect-node DFS order `build` consumes, producing
    /// one entry per effect node (`None` for a degenerate subtree). Nested effects
    /// inside an effect subtree degrade (captured into the outer node's image, not
    /// resolved separately). A no-op (empty) on native, where effects read back
    /// inline.
    async fn prepare_effect_images(&mut self, scene: &Scene) -> Vec<Option<CachedEffect>> {
        if !self.web {
            return Vec::new();
        }
        let mut out: Vec<Option<CachedEffect>> = Vec::new();
        // Pre-order DFS over the ORIGINAL tree: descend into non-effect nodes; at an
        // effect node render+process its subtree to a texture, async-read it back,
        // and STOP (don't descend) — matching `build`'s consumption order exactly.
        let comp = (
            scene.composition.width.max(1),
            scene.composition.height.max(1),
        );
        let mut stack: Vec<&Node> = vec![&scene.root];
        while let Some(node) = stack.pop() {
            // A matte node is owned by the matte pre-pass: `build`'s matte branch
            // wins and returns (its subtree is captured separately), so the main
            // build never reaches its content here. Skip it entirely — don't
            // capture, don't descend — or `effect_idx` would desync.
            if node.matte.is_some() {
                continue;
            }
            // Descend through plain nodes AND backdrop-blur nodes (the latter are
            // resolved by the separate backdrop pre-pass, not here). Capture only at
            // a node with a real SUBTREE effect (blur/bloom/grade/goo) and no
            // backdrop — exactly the nodes `build`'s subtree branch consumes.
            if !has_subtree_effect(node) || backdrop_blur_of(node).is_some() {
                // Push children reversed so they pop (and resolve) in document order.
                for child in node.children.iter().rev() {
                    stack.push(child);
                }
                continue;
            }
            let built = build_effect_texture(
                &mut Ctx {
                    device: &self.device,
                    queue: &self.queue,
                    renderer: &mut self.renderer,
                    fonts: &mut self.fonts,
                    font_cache: &mut self.font_cache,
                    blur_pipeline: &mut self.blur_pipeline,
                    bloom_pipeline: &mut self.bloom_pipeline,
                    grade_pipeline: &mut self.grade_pipeline,
                    pixelfx_pipeline: &mut self.pixelfx_pipeline,
                    goo_pipeline: &mut self.goo_pipeline,
                    matte_pipeline: &mut self.matte_pipeline,
                    fbm_pipeline: &mut self.fbm_pipeline,
                    grain_pipeline: &mut self.grain_pipeline,
                    scene3d_pipeline: &mut self.scene3d_pipeline,
                    effect_overrides: &mut Vec::new(),
                    linear: false,
                    web: true,
                    // Nested effects inside this subtree degrade (no cache here).
                    effect_images: None,
                    effect_idx: 0,
                    comp,
                    root: &scene.root,
                    backdrop_images: None,
                    backdrop_idx: 0,
                    backdrop_stop: None,
                    backdrop_done: false,
                    suppress_backdrop: false,
                    matte_images: None,
                    matte_idx: 0,
                    suppress_matte: false,
                    suppress_lightwrap: false,
                },
                node,
            );
            match built {
                Some((texture, tw, th, x0, y0)) => {
                    let frame = read_back_async(&self.device, &self.queue, &texture, tw, th).await;
                    out.push(Some(CachedEffect {
                        rgba: std::sync::Arc::new(frame.pixels),
                        width: tw,
                        height: th,
                        x0,
                        y0,
                    }));
                }
                None => out.push(None),
            }
            // Don't descend — the whole subtree is captured in this one image.
        }
        out
    }

    /// Resolve every frosted backdrop up front with ASYNC readbacks — the web
    /// counterpart to the native inline backdrop path. Enumerates backdrop-blur
    /// nodes in the SAME pre-order `build` consumes them (`collect_backdrop_nodes`),
    /// and for each one captures the backdrop *behind* it (the prefix of nodes
    /// painted before it) to a full-canvas texture, blurs/grades it, and reads it
    /// back. Consumed in `build` via `backdrop_idx`; a miss degrades to clear glass
    /// (no crash). A no-op (empty) on native, where backdrops read back inline.
    ///
    /// COST (web): each glass node triggers a full-canvas prefix render + blur +
    /// async readback, so N live frosted panels cost ≈ N × canvas-area per frame.
    /// Fine for the 1–2 panels a premium comp uses; a future optimization can
    /// downsample the backdrop (frost is low-frequency) or cap N to clear glass.
    async fn prepare_backdrop_images(
        &mut self,
        scene: &Scene,
        effect_images: &[Option<CachedEffect>],
    ) -> Vec<Option<CachedBackdrop>> {
        if !self.web {
            return Vec::new();
        }
        let comp = (
            scene.composition.width.max(1),
            scene.composition.height.max(1),
        );
        let mut nodes: Vec<&Node> = Vec::new();
        collect_backdrop_nodes(&scene.root, &mut nodes);
        let mut out: Vec<Option<CachedBackdrop>> = Vec::new();
        for node in nodes {
            let built = build_backdrop_texture(
                &mut Ctx {
                    device: &self.device,
                    queue: &self.queue,
                    renderer: &mut self.renderer,
                    fonts: &mut self.fonts,
                    font_cache: &mut self.font_cache,
                    blur_pipeline: &mut self.blur_pipeline,
                    bloom_pipeline: &mut self.bloom_pipeline,
                    grade_pipeline: &mut self.grade_pipeline,
                    pixelfx_pipeline: &mut self.pixelfx_pipeline,
                    goo_pipeline: &mut self.goo_pipeline,
                    matte_pipeline: &mut self.matte_pipeline,
                    fbm_pipeline: &mut self.fbm_pipeline,
                    grain_pipeline: &mut self.grain_pipeline,
                    scene3d_pipeline: &mut self.scene3d_pipeline,
                    effect_overrides: &mut Vec::new(),
                    linear: false,
                    web: true,
                    // Effect nodes BEHIND the glass resolve from the cache (computed
                    // just before this pre-pass); a fresh cursor per backdrop node,
                    // since each prefix walk restarts the DFS from root.
                    effect_images: Some(effect_images),
                    effect_idx: 0,
                    comp,
                    root: &scene.root,
                    backdrop_images: None,
                    backdrop_idx: 0,
                    backdrop_stop: None,
                    backdrop_done: false,
                    suppress_backdrop: false,
                    matte_images: None,
                    matte_idx: 0,
                    suppress_matte: false,
                    suppress_lightwrap: false,
                },
                node,
            );
            match built {
                Some((texture, tw, th)) => {
                    let frame = read_back_async(&self.device, &self.queue, &texture, tw, th).await;
                    out.push(Some(CachedBackdrop {
                        rgba: std::sync::Arc::new(frame.pixels),
                        width: tw,
                        height: th,
                    }));
                }
                None => out.push(None),
            }
        }
        out
    }

    /// Resolve every matte up front with ASYNC readbacks — the web counterpart to
    /// the native inline matte path. Enumerates matte nodes in the SAME pre-order
    /// `build` consumes them (a matte node wins + returns without descending; an
    /// effect node also returns; plain/backdrop nodes descend), captures each
    /// (content + matte → alpha-combine) to a texture, and reads it back. Consumed
    /// in `build` via `matte_idx`; a miss hides the content. No-op on native.
    async fn prepare_matte_images(&mut self, scene: &Scene) -> Vec<Option<CachedEffect>> {
        if !self.web {
            return Vec::new();
        }
        let comp = (
            scene.composition.width.max(1),
            scene.composition.height.max(1),
        );
        let mut out: Vec<Option<CachedEffect>> = Vec::new();
        let mut stack: Vec<&Node> = vec![&scene.root];
        while let Some(node) = stack.pop() {
            if let Some(matte) = node.matte.as_ref() {
                // Matte node: capture (content + matte), don't descend — matching
                // `build`'s matte branch (which returns without recursing children).
                let built = build_matte_texture(
                    &mut Ctx {
                        device: &self.device,
                        queue: &self.queue,
                        renderer: &mut self.renderer,
                        fonts: &mut self.fonts,
                        font_cache: &mut self.font_cache,
                        blur_pipeline: &mut self.blur_pipeline,
                        bloom_pipeline: &mut self.bloom_pipeline,
                        grade_pipeline: &mut self.grade_pipeline,
                        pixelfx_pipeline: &mut self.pixelfx_pipeline,
                        goo_pipeline: &mut self.goo_pipeline,
                        matte_pipeline: &mut self.matte_pipeline,
                        fbm_pipeline: &mut self.fbm_pipeline,
                        grain_pipeline: &mut self.grain_pipeline,
                        scene3d_pipeline: &mut self.scene3d_pipeline,
                        effect_overrides: &mut Vec::new(),
                        linear: false,
                        web: true,
                        effect_images: None,
                        effect_idx: 0,
                        comp,
                        root: &scene.root,
                        backdrop_images: None,
                        backdrop_idx: 0,
                        backdrop_stop: None,
                        backdrop_done: false,
                        suppress_backdrop: false,
                        matte_images: None,
                        matte_idx: 0,
                        suppress_matte: false,
                        suppress_lightwrap: false,
                    },
                    node,
                    matte,
                );
                match built {
                    Some((texture, tw, th, x0, y0)) => {
                        let frame =
                            read_back_async(&self.device, &self.queue, &texture, tw, th).await;
                        out.push(Some(CachedEffect {
                            rgba: std::sync::Arc::new(frame.pixels),
                            width: tw,
                            height: th,
                            x0,
                            y0,
                        }));
                    }
                    None => out.push(None),
                }
                continue;
            }
            // An effect node (no matte) also returns in `build` without descending;
            // its content's mattes are captured inside the effect texture, not here.
            if has_subtree_effect(node) && backdrop_blur_of(node).is_none() {
                continue;
            }
            // Plain or backdrop node: descend (document order).
            for child in node.children.iter().rev() {
                stack.push(child);
            }
        }
        out
    }

    /// Build the scene and rasterize it to an offscreen RGBA texture (shared by
    /// the sync and async render paths). `effect_images` supplies pre-rendered
    /// effect results for the web path (`None` natively — effects read back
    /// inline). Returns the texture and its size.
    fn render_to_target(
        &mut self,
        scene: &Scene,
        effect_images: Option<&[Option<CachedEffect>]>,
        backdrop_images: Option<&[Option<CachedBackdrop>]>,
        matte_images: Option<&[Option<CachedEffect>]>,
    ) -> (wgpu::Texture, u32, u32) {
        let width = scene.composition.width.max(1);
        let height = scene.composition.height.max(1);

        let mut vscene = VelloScene::new();
        // Placeholder images for native GPU-resident effect compositing — filled by
        // the walk (each keys an `override_image` to an effect's GPU texture), then
        // cleared after `render_vscene_to_texture` consumes them below.
        let mut effect_overrides: Vec<PenikoImage> = Vec::new();
        // Disjoint field borrows so the recursive walk can render *effect*
        // subtrees to their own textures while `fonts`/`font_cache` stay borrowed:
        // `fonts` (shaping) + `font_cache` (built fonts) for text, plus
        // `device`/`queue`/`renderer`/`blur_pipeline` for the render-to-texture
        // effect path. `&mut self` is never re-borrowed inside the walk.
        build(
            &mut vscene,
            &mut Ctx {
                device: &self.device,
                queue: &self.queue,
                renderer: &mut self.renderer,
                fonts: &mut self.fonts,
                font_cache: &mut self.font_cache,
                blur_pipeline: &mut self.blur_pipeline,
                bloom_pipeline: &mut self.bloom_pipeline,
                grade_pipeline: &mut self.grade_pipeline,
                pixelfx_pipeline: &mut self.pixelfx_pipeline,
                goo_pipeline: &mut self.goo_pipeline,
                matte_pipeline: &mut self.matte_pipeline,
                fbm_pipeline: &mut self.fbm_pipeline,
                grain_pipeline: &mut self.grain_pipeline,
                scene3d_pipeline: &mut self.scene3d_pipeline,
                effect_overrides: &mut effect_overrides,
                linear: scene.composition.linear,
                web: self.web,
                effect_images,
                effect_idx: 0,
                comp: (width, height),
                root: &scene.root,
                backdrop_images,
                backdrop_idx: 0,
                backdrop_stop: None,
                backdrop_done: false,
                suppress_backdrop: false,
                matte_images,
                matte_idx: 0,
                suppress_matte: false,
                suppress_lightwrap: false,
            },
            &scene.root,
            Affine::IDENTITY,
            1.0,
        );

        let texture = render_vscene_to_texture(
            &self.device,
            &self.queue,
            &mut self.renderer,
            &vscene,
            width,
            height,
        );
        // Vello has GPU-copied each effect texture into its atlas during the render
        // above; drop the overrides so the map keeps no stale node→texture mappings
        // (and releases the effect textures) past this frame.
        for placeholder in &effect_overrides {
            self.renderer.override_image(placeholder, None);
        }
        // Composition-level cinematic FINISH: a screen-space chain run on the final
        // 8-bit frame entirely in float — decode→scene-linear, linear-HDR bloom, then
        // one ACES tone-map back to sRGB. The HDR survives (float intermediates), so the
        // film look lands comp-wide, with or without any per-node effect. A pure
        // texture→texture compute chain, so it runs identically on native and the web.
        let texture = if let Some(finish) = scene.composition.finish {
            let params = FinishParams {
                exposure: finish.exposure,
                halation: finish.halation,
                bloom: finish.bloom.map(|b| (b.sigma, b.threshold, b.intensity)),
                temperature: finish.temperature,
                contrast: finish.contrast,
                saturation: finish.saturation,
                vignette: finish.vignette,
                grain: finish.grain,
                grain_seed: finish.grain_seed,
            };
            let lf = self
                .linearfinish_pipeline
                .get_or_insert_with(|| LinearFinish::new(&self.device));
            lf.run(&self.device, &self.queue, &texture, width, height, &params)
        } else {
            texture
        };
        (texture, width, height)
    }
}

/// The renderer state the scene walk needs as **disjoint field borrows** — kept
/// in one struct so a node carrying effects can render its subtree to a texture
/// (needs `device`/`queue`/`renderer`/`blur_pipeline`) while the text path keeps
/// `fonts`/`font_cache` borrowed. Holding these separately (not `&mut self`)
/// lets the recursive effect path reborrow them down the tree.
struct Ctx<'a> {
    device: &'a wgpu::Device,
    queue: &'a wgpu::Queue,
    renderer: &'a mut Renderer,
    fonts: &'a mut FontContext,
    font_cache: &'a mut HashMap<u64, Font>,
    blur_pipeline: &'a mut Option<GaussianBlur>,
    bloom_pipeline: &'a mut Option<Bloom>,
    grade_pipeline: &'a mut Option<ColorGrade>,
    pixelfx_pipeline: &'a mut Option<PixelFx>,
    goo_pipeline: &'a mut Option<Goo>,
    matte_pipeline: &'a mut Option<AlphaMatte>,
    fbm_pipeline: &'a mut Option<FbmGradient>,
    grain_pipeline: &'a mut Option<Grain>,
    /// The perspective 3D pass — built lazily for a `camera3d` scene, reused after.
    scene3d_pipeline: &'a mut Option<Scene3D>,
    /// Native GPU-resident effect compositing: the placeholder `peniko::Image`s whose
    /// Blob ids key `Renderer::override_image` to each effect's GPU texture, so Vello
    /// GPU→GPU-copies the result into its atlas instead of us reading it back. Filled
    /// during the build walk; cleared once `render_vscene_to_texture` has consumed
    /// them. Unused on the web path (effects resolve via the async pre-pass cache).
    effect_overrides: &'a mut Vec<PenikoImage>,
    /// Cinematic LINEAR finishing (`Composition::linear`): when set, the screen-space
    /// effect chain (currently Bloom) runs in linear light with an ACES tone-map
    /// output instead of gamma math. GPU/export only; false on the web pre-pass.
    linear: bool,
    /// WebGPU backend — the effect path's synchronous readback can't run mid-build
    /// here, so effects are resolved by an async PRE-PASS into `effect_images`
    /// instead; if that cache is absent/exhausted the node draws un-effected
    /// (graceful degrade, never a crash).
    web: bool,
    /// Pre-rendered effect results (web path), one per effect node in `build`'s
    /// stop-at-effect-node DFS order, consumed via `effect_idx`. `None` natively
    /// (effects read back inline). A `None` entry — or running past the end —
    /// means "no cached image" → the node renders un-effected.
    effect_images: Option<&'a [Option<CachedEffect>]>,
    /// Cursor into `effect_images`, advanced as each effect node is drawn.
    effect_idx: usize,
    /// Composition size `(w, h)` — the full-canvas target a backdrop blur samples.
    comp: (u32, u32),
    /// The scene root, so a backdrop-blur node can re-walk the tree to capture the
    /// *prefix* (everything painted before it) into a full-canvas texture.
    root: &'a Node,
    /// Pre-rendered frosted-backdrop images (web path), one per backdrop-blur node
    /// in `build`'s pre-order, consumed via `backdrop_idx`. `None` natively (the
    /// backdrop is captured + read back inline).
    backdrop_images: Option<&'a [Option<CachedBackdrop>]>,
    /// Cursor into `backdrop_images`.
    backdrop_idx: usize,
    /// While capturing a backdrop *prefix*, stop the walk once this node is reached
    /// (everything before it IS the backdrop). `None` during a normal build.
    backdrop_stop: Option<*const Node>,
    /// Latched once `backdrop_stop` is hit — short-circuits the rest of the walk.
    backdrop_done: bool,
    /// Suppress backdrop-blur resolution (inside a prefix capture or an effect
    /// subtree capture): nested glass renders clear instead of recursing.
    suppress_backdrop: bool,
    /// Pre-rendered matte results (web path), one per matte node in `build`'s
    /// pre-order, consumed via `matte_idx`. `None` natively (matte read back
    /// inline). A `None`/exhausted entry → the matted content is hidden.
    matte_images: Option<&'a [Option<CachedEffect>]>,
    /// Cursor into `matte_images`.
    matte_idx: usize,
    /// Suppress matte resolution (inside a capture): a nested matte renders its
    /// content un-matted instead of recursing.
    suppress_matte: bool,
    /// Suppress light-wrap resolution (inside a light-wrap's own foreground render
    /// or backdrop-prefix capture): a nested light-wrap node draws un-wrapped
    /// instead of recursing into another screen-space capture.
    suppress_lightwrap: bool,
}

/// A pre-rendered effect node's result (computed by the async effect pre-pass on
/// the web path, drawn back during the synchronous build). `(x0, y0)` is the
/// node-local top-left the image composites at, under the node's own affine.
#[derive(Clone)]
struct CachedEffect {
    rgba: std::sync::Arc<Vec<u8>>,
    width: u32,
    height: u32,
    x0: f64,
    y0: f64,
}

/// A pre-rendered frosted backdrop (full composition size), computed by the async
/// backdrop pre-pass on the web path and drawn back (clipped to the glass shape)
/// during the synchronous build.
#[derive(Clone)]
struct CachedBackdrop {
    rgba: std::sync::Arc<Vec<u8>>,
    width: u32,
    height: u32,
}

/// Rasterize an already-built `VelloScene` to a fresh `Rgba8Unorm` texture of the
/// given size. Shared by the top-level frame path and the per-subtree effect path
/// (effects render their subtree here, in local space, before post-processing).
///
/// The texture also carries `TEXTURE_BINDING` so an effect compute pass can sample
/// it; that's harmless for the frame path (which only reads it back).
fn render_vscene_to_texture(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    renderer: &mut Renderer,
    vscene: &VelloScene,
    width: u32,
    height: u32,
) -> wgpu::Texture {
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("onda-vello target"),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8Unorm,
        usage: wgpu::TextureUsages::STORAGE_BINDING
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let view = texture.create_view(&wgpu::TextureViewDescriptor::default());

    renderer
        .render_to_texture(
            device,
            queue,
            vscene,
            &view,
            &RenderParams {
                base_color: PenikoColor::TRANSPARENT,
                width,
                height,
                antialiasing_method: AaConfig::Area,
            },
        )
        .expect("vello render");

    texture
}

/// Walk the scene graph, appending fills/strokes/text to the Vello scene.
fn build(vscene: &mut VelloScene, ctx: &mut Ctx, node: &Node, parent: Affine, parent_opacity: f32) {
    // Backdrop-prefix capture: when re-walking the tree to collect everything
    // painted BEHIND a glass node, stop the moment we reach that node — whatever's
    // been appended so far is exactly its backdrop.
    if ctx.backdrop_done {
        return;
    }
    if let Some(stop) = ctx.backdrop_stop {
        if std::ptr::eq(node as *const Node, stop) {
            ctx.backdrop_done = true;
            return;
        }
    }

    let affine = parent * to_affine(&node.transform);
    let opacity = (parent_opacity * node.opacity).clamp(0.0, 1.0);

    // MATTE (track matte / mask): reveal this node's content only through the matte
    // subtree's alpha/luminance. It captures the content + matte to two textures,
    // alpha-combines them, and composites the result — REPLACING the node's whole
    // draw, so it wins over backdrop/effects and returns. Native reads back inline;
    // web resolves via `prepare_matte_images` and consumes by `matte_idx`, degrading
    // (content hidden) on a miss. Suppressed inside a capture (nested matte renders
    // its content un-matted). blend/clip wrap the composite via push_layer/pop_layer.
    if !ctx.suppress_matte {
        if let Some(matte) = node.matte.as_ref() {
            enum MatteDraw {
                Native,
                Cached(Option<CachedEffect>),
                Degrade,
            }
            let how = if !ctx.web {
                MatteDraw::Native
            } else if let Some(imgs) = ctx.matte_images {
                if ctx.matte_idx < imgs.len() {
                    let c = imgs[ctx.matte_idx].clone();
                    ctx.matte_idx += 1;
                    MatteDraw::Cached(c)
                } else {
                    MatteDraw::Degrade
                }
            } else {
                MatteDraw::Degrade
            };

            let blended = node.blend != BlendMode::Normal;
            if blended {
                vscene.push_layer(
                    blend_mix(node.blend),
                    1.0,
                    Affine::IDENTITY,
                    &Rect::new(-1.0e7, -1.0e7, 1.0e7, 1.0e7),
                );
            }
            let clipped = node.clip.is_some();
            if let Some(clip) = &node.clip {
                vscene.push_layer(Mix::Clip, 1.0, affine, &shape_path(clip));
            }
            match how {
                MatteDraw::Native => {
                    render_matte_subtree(vscene, ctx, node, matte, affine, opacity)
                }
                MatteDraw::Cached(Some(c)) => draw_effect_image(
                    vscene, affine, opacity, c.rgba, c.width, c.height, c.x0, c.y0,
                ),
                // Degenerate matte (nothing captured) or web cache miss → the matted
                // content is hidden (drawing nothing is safer than an un-matted,
                // shape-overflowing image), never a crash.
                MatteDraw::Cached(None) | MatteDraw::Degrade => {}
            }
            if clipped {
                vscene.pop_layer();
            }
            if blended {
                vscene.pop_layer();
            }
            return;
        }
    }

    // 3D SCENE ROOT (`camera3d`): the children are 3D LAYERS placed in one shared
    // world and viewed through a perspective camera. Each child is rasterized to its
    // own texture (the effect-capture seam) and drawn as a textured quad. Native runs
    // the true GPU 3D pass (perspective + out-of-plane rotation + a depth buffer, so
    // layers occlude and intersect by real depth); the web preview degrades to a 2.5D
    // affine projection (perspective scale + position, depth-sorted — no tilt),
    // matching the CPU reference. Replaces the node's draw and returns.
    if let Some(cam) = node.camera3d {
        if ctx.web {
            render_scene3d_2d(vscene, ctx, node, &cam, affine, opacity);
        } else {
            render_scene3d_gpu(vscene, ctx, node, &cam, affine, opacity);
        }
        return;
    }

    // Render-to-texture effect chain (e.g. blur): if this node carries effects,
    // rasterize its subtree to its own texture *in local space* (transform and
    // opacity neutralized, effects cleared so the recursion terminates), run the
    // effect compute passes, then composite the result back at this node's
    // `affine`/`opacity` via the existing `draw_image_data` path — which keeps it
    // honoring `blend`/`clip` through the surrounding push_layer/pop_layer.
    // On the WebGPU backend the mid-build CPU readback can't run (async-only
    // buffer mapping), so effects are pre-rendered by an async pass into
    // `ctx.effect_images` and consumed here in order; a cache miss degrades to
    // un-effected (never a crash). Native reads back inline. Either way blend/clip
    // wrap the composited result via the surrounding push_layer/pop_layer.
    // Light-wrap (`Effect::LightWrap`): like backdrop blur it samples the backdrop
    // behind the node, but bleeds that blurred light onto the node's own FEATHERED
    // EDGES — REPLACING the node's draw (the composited foreground+wrap is what gets
    // drawn). Native/export only; on the web path, or inside a capture, it falls
    // through and the node draws un-wrapped (graceful degrade).
    if !ctx.web && !ctx.suppress_lightwrap && lightwrap_of(node).is_some() {
        draw_lightwrap_native(vscene, ctx, node, affine, opacity);
        return;
    }

    // Frosted glass (`Effect::BackdropBlur`): resolve + composite the blurred
    // backdrop UNDER this node, then FALL THROUGH to draw the node's own content
    // (panel fill/stroke/children) on top. Suppressed while capturing a prefix or
    // an effect subtree (nested glass renders clear). A backdrop-blur node ignores
    // any co-located subtree-capture effects.
    let backdrop = if ctx.suppress_backdrop {
        None
    } else {
        backdrop_blur_of(node)
    };
    if let Some(bb) = backdrop {
        enum BackdropDraw {
            Native,
            Cached(Option<CachedBackdrop>),
            Degrade,
        }
        let how = if !ctx.web {
            BackdropDraw::Native
        } else if let Some(imgs) = ctx.backdrop_images {
            if ctx.backdrop_idx < imgs.len() {
                let c = imgs[ctx.backdrop_idx].clone();
                ctx.backdrop_idx += 1;
                BackdropDraw::Cached(c)
            } else {
                BackdropDraw::Degrade
            }
        } else {
            BackdropDraw::Degrade
        };
        match how {
            BackdropDraw::Native => draw_backdrop_native(vscene, ctx, node, affine, opacity, bb),
            BackdropDraw::Cached(Some(c)) => composite_backdrop(
                vscene, ctx, node, affine, opacity, bb, c.rgba, c.width, c.height,
            ),
            // A degenerate backdrop (nothing behind) or a web cache miss → the glass
            // simply stays clear (no frost), never a crash.
            BackdropDraw::Cached(None) | BackdropDraw::Degrade => {}
        }
        // Fall through to draw the node's own content on top of the frost.
    } else if has_subtree_effect(node) {
        enum EffectDraw {
            Native,
            Cached(Option<CachedEffect>),
            Degrade,
        }
        let how = if !ctx.web {
            EffectDraw::Native
        } else if let Some(images) = ctx.effect_images {
            if ctx.effect_idx < images.len() {
                let cached = images[ctx.effect_idx].clone();
                ctx.effect_idx += 1;
                EffectDraw::Cached(cached)
            } else {
                EffectDraw::Degrade
            }
        } else {
            EffectDraw::Degrade
        };

        if !matches!(how, EffectDraw::Degrade) {
            let blended = node.blend != BlendMode::Normal;
            if blended {
                vscene.push_layer(
                    blend_mix(node.blend),
                    1.0,
                    Affine::IDENTITY,
                    &Rect::new(-1.0e7, -1.0e7, 1.0e7, 1.0e7),
                );
            }
            let clipped = node.clip.is_some();
            if let Some(clip) = &node.clip {
                vscene.push_layer(Mix::Clip, 1.0, affine, &shape_path(clip));
            }

            match how {
                EffectDraw::Native => render_effects_subtree(vscene, ctx, node, affine, opacity),
                EffectDraw::Cached(Some(c)) => draw_effect_image(
                    vscene, affine, opacity, c.rgba, c.width, c.height, c.x0, c.y0,
                ),
                // A degenerate effect node (no measurable subtree) drew nothing.
                EffectDraw::Cached(None) => {}
                EffectDraw::Degrade => {}
            }

            if clipped {
                vscene.pop_layer();
            }
            if blended {
                vscene.pop_layer();
            }
            return;
        }
        // Cache miss on the web → fall through and render the subtree un-effected.
    }

    // A blend mode composites this node's whole subtree against the backdrop
    // (CSS mix-blend-mode). Push a canvas-covering blend layer around everything,
    // like clip; the subtree draws into it and composites with the chosen mode.
    let blended = node.blend != BlendMode::Normal;
    if blended {
        vscene.push_layer(
            blend_mix(node.blend),
            1.0,
            Affine::IDENTITY,
            &Rect::new(-1.0e7, -1.0e7, 1.0e7, 1.0e7),
        );
    }

    // A clip on this node bounds its own drawing *and* its subtree to the clip
    // geometry (in local space). Push a clip layer, draw, then pop.
    let clipped = node.clip.is_some();
    if let Some(clip) = &node.clip {
        vscene.push_layer(Mix::Clip, 1.0, affine, &shape_path(clip));
    }

    match &node.kind {
        NodeKind::Group => {}
        NodeKind::Shape(shape) => {
            let path = shape_path(&shape.geometry);
            // Drop shadow / glow: an analytic blurred rounded-rect drawn BEHIND
            // the shape (Vello's built-in; no extra render pass).
            if let Some(shadow) = &shape.shadow {
                let (rect, radius) = shadow_box(&shape.geometry, &path, shadow);
                vscene.draw_blurred_rounded_rect(
                    affine,
                    rect,
                    peniko_color(shadow.color, opacity),
                    radius,
                    shadow.blur.max(0.0) as f64,
                );
            }
            // fBm fractal-noise gradient: a GPU compute pass generates the field,
            // reads it back, and draws it clipped to the shape (native only — the
            // sync readback can't run on WebGPU mid-build). The WebGPU preview + CPU
            // reference degrade to the smooth fallback in `fill_brush`.
            match shape.gradient.as_ref() {
                Some(Gradient::Fbm {
                    stops,
                    scale,
                    time,
                    warp,
                }) if !ctx.web => {
                    draw_fbm_fill(
                        vscene, ctx, &path, affine, opacity, stops, *scale, *time, *warp,
                    );
                }
                _ => {
                    if let Some(brush) = fill_brush(shape.fill, shape.gradient.as_ref(), opacity) {
                        vscene.fill(Fill::NonZero, affine, &brush, None, &path);
                    }
                }
            }
            if let Some(stroke) = &shape.stroke {
                const STROKE_TOL: f64 = 0.1;
                let mut sk = Stroke::new(stroke.width as f64)
                    .with_caps(cap_to_kurbo(stroke.cap))
                    .with_join(join_to_kurbo(stroke.join));
                // Effective dash: a TRIM is a length-normalised dash (measure the path
                // and slice [start, end] of its arc length), and overrides an explicit
                // dash pattern; otherwise apply the literal dash.
                let mut draw_stroke = true;
                if let Some(trim) = stroke.trim {
                    match trim.resolve(path.perimeter(STROKE_TOL) as f32) {
                        TrimDash::Solid => {}
                        TrimDash::Hidden => draw_stroke = false,
                        TrimDash::Dash(dash, off) => {
                            sk = sk.with_dashes(off as f64, dash.into_iter().map(|d| d as f64));
                        }
                    }
                } else if !stroke.dash.is_empty() {
                    sk = sk.with_dashes(
                        stroke.dash_offset as f64,
                        stroke.dash.iter().map(|d| *d as f64),
                    );
                }
                // Expand the stroke to a FILLED outline on the CPU (kurbo) and fill
                // that, instead of using Vello's GPU stroke path. This sidesteps a
                // Vello-on-Dawn (WebGPU) stroke-rasterization artifact — a stray
                // column of fragments on stroked rounded-rect borders that only
                // appeared on Chrome's Dawn backend (native Metal + the CPU
                // reference were always clean). The filled outline rasterizes
                // identically across backends; stroke counts are tiny, so the CPU
                // expansion is cheap.
                if draw_stroke {
                    let outline = vello::kurbo::stroke(
                        path.path_elements(STROKE_TOL),
                        &sk,
                        &Default::default(),
                        STROKE_TOL,
                    );
                    vscene.fill(
                        Fill::NonZero,
                        affine,
                        peniko_color(stroke.color, opacity),
                        None,
                        &outline,
                    );
                }
            }
        }
        NodeKind::Text(text) => draw_text(vscene, ctx.fonts, ctx.font_cache, text, affine, opacity),
        // Image and Video draw decoded RGBA the same way (a video frame is just
        // an image); pixels are attached by a decode pass and skipped if absent.
        NodeKind::Image(image) => {
            draw_image_data(
                vscene,
                affine,
                opacity,
                image.data.as_ref(),
                image.width,
                image.height,
                image.fit,
            );
        }
        NodeKind::Video(video) => {
            draw_image_data(
                vscene,
                affine,
                opacity,
                video.data.as_ref(),
                video.width,
                video.height,
                video.fit,
            );
        }
        // Audio is non-visual — the player plays it; the renderer skips it.
        NodeKind::Audio(_) => {}
        // SVG nodes are expanded to shapes before rendering (see onda-svg); an
        // unexpanded one draws nothing.
        NodeKind::Svg(_) => {}
    }

    for child in &node.children {
        build(vscene, ctx, child, affine, opacity);
    }

    if clipped {
        vscene.pop_layer();
    }
    if blended {
        vscene.pop_layer();
    }
}

/// Render a node's subtree to an offscreen texture in **local space**, run its
/// effect chain (currently Gaussian blur), and composite the result back into
/// `vscene` at `affine`/`opacity` via the normal `draw_image_data` path.
///
/// "Local space" means the subtree is rendered with this node's own transform and
/// opacity neutralized (identity affine, full opacity, effects cleared) into a
/// texture sized to the subtree's local bounds grown by the blur margin (`3σ`).
/// The texture's top-left maps to local `(x0, y0)`, so we draw it at
/// `affine * translate(x0, y0)` and the blurred pixels land exactly where the
/// sharp subtree would have, just softened and spread by the margin.
fn build_effect_texture(ctx: &mut Ctx, node: &Node) -> Option<(wgpu::Texture, u32, u32, f64, f64)> {
    // Total blur margin = the largest σ in the chain × 3 (the kernel's reach),
    // so blurred edges aren't clipped by the texture border.
    let max_sigma = node
        .effects
        .iter()
        .map(|e| match e {
            Effect::Isolate => 0.0,
            Effect::Blur { sigma } => *sigma,
            // Directional blur smears along one axis by `sigma`; the 3σ headroom
            // (applied to both axes below) covers the worst case.
            Effect::DirectionalBlur { sigma, .. } => *sigma,
            // Bloom blurs its bright-pass with `sigma`; the halo needs the same
            // headroom as a blur so the glow isn't clipped at the texture edge.
            Effect::Bloom { sigma, .. } => *sigma,
            // ColorGrade is a per-pixel remap (no spread) — it needs no margin.
            Effect::ColorGrade { .. } => 0.0,
            // Chromatic aberration shifts channels by `amount` px, so the fringe
            // needs that headroom; the other per-pixel effects don't spread.
            Effect::ChromaticAberration { amount } => *amount,
            Effect::Vignette { .. } => 0.0,
            Effect::Posterize { .. } => 0.0,
            Effect::Duotone { .. } => 0.0,
            Effect::ChromaKey { .. } => 0.0,
            // Grain is a per-pixel pass (no spread) — it needs no margin.
            Effect::Grain { .. } => 0.0,
            // Goo blurs the subtree with `sigma` before thresholding; it needs the
            // same headroom as a blur so the spread (and fused neck) isn't clipped.
            Effect::Goo { sigma, .. } => *sigma,
            // BackdropBlur is resolved in `build` (samples the backdrop, not this
            // subtree), so it contributes no capture margin here.
            Effect::BackdropBlur { .. } => 0.0,
            // LightWrap is likewise resolved in `build` (it samples the backdrop and
            // composites in screen space), not via this local-bounds capture.
            Effect::LightWrap { .. } => 0.0,
        })
        .fold(0.0_f32, f32::max);
    let margin = (3.0 * max_sigma).ceil().max(0.0) as f64;

    // Local-space bounds of the subtree (this node's own drawing + descendants),
    // grown by the margin. Empty/degenerate → nothing to do.
    let bounds = subtree_local_bounds(ctx.fonts, node)?;
    let x0 = (bounds.x0 - margin).floor();
    let y0 = (bounds.y0 - margin).floor();
    let x1 = (bounds.x1 + margin).ceil();
    let y1 = (bounds.y1 + margin).ceil();
    let w = (x1 - x0) as i64;
    let h = (y1 - y0) as i64;
    if w <= 0 || h <= 0 {
        return None;
    }
    // Clamp to a sane ceiling so a pathological scene can't request a giant
    // texture (the frame itself is the natural upper bound on useful size).
    const MAX_DIM: i64 = 8192;
    if w > MAX_DIM || h > MAX_DIM {
        return None;
    }
    let (tw, th) = (w as u32, h as u32);

    // Build the subtree in local space: shift by `-(x0, y0)` so local bounds map
    // to the texture's top-left, neutralize this node's transform/opacity, and
    // clear effects so the recursion terminates (a nested-effect child still
    // renders its own sub-texture via the normal `build` branch).
    let local_root = Node {
        transform: Transform::IDENTITY,
        opacity: 1.0,
        effects: Vec::new(),
        // Drop this node's own blend/clip — they apply to the *composited* image
        // back in the caller (where the layers were already pushed), not inside
        // the local-space capture.
        blend: BlendMode::Normal,
        clip: None,
        matte: None,
        ..node.clone()
    };
    let mut sub = VelloScene::new();
    // Suppress backdrop/matte resolution inside the captured subtree — a nested glass
    // panel renders clear, a nested matte renders its content un-matted, rather than
    // recursing into machinery that doesn't fit this local-space capture.
    let saved_sb = ctx.suppress_backdrop;
    let saved_sm = ctx.suppress_matte;
    ctx.suppress_backdrop = true;
    ctx.suppress_matte = true;
    build(
        &mut sub,
        ctx,
        &local_root,
        Affine::translate((-x0, -y0)),
        1.0,
    );
    ctx.suppress_backdrop = saved_sb;
    ctx.suppress_matte = saved_sm;

    let mut texture = render_vscene_to_texture(ctx.device, ctx.queue, ctx.renderer, &sub, tw, th);

    // Run the ordered effect chain. Each effect consumes the previous texture and
    // produces the next (ping-pong is internal to the blur). The compute pass is
    // its own encoder+submit — bracketed between the Vello render above and the
    // readback below; it never injects into Vello's pass.
    for effect in &node.effects {
        match effect {
            // Isolate/precomp: no pixel change — the render-to-texture flatten is the point.
            Effect::Isolate => {}
            Effect::Blur { sigma } if *sigma > 0.0 => {
                let blur = ctx
                    .blur_pipeline
                    .get_or_insert_with(|| GaussianBlur::new(ctx.device));
                texture = blur.run(ctx.device, ctx.queue, &texture, tw, th, *sigma);
            }
            // sigma <= 0 is a no-op (leave the texture sharp).
            Effect::Blur { .. } => {}
            Effect::DirectionalBlur { sigma, angle } if *sigma > 0.0 => {
                // Reuses the blur pipeline (generalized to a direction vector): one
                // pass along (cos angle, sin angle).
                let blur = ctx
                    .blur_pipeline
                    .get_or_insert_with(|| GaussianBlur::new(ctx.device));
                texture = blur.run_directional(
                    ctx.device,
                    ctx.queue,
                    &texture,
                    tw,
                    th,
                    *sigma,
                    angle.cos(),
                    angle.sin(),
                );
            }
            Effect::DirectionalBlur { .. } => {}
            Effect::Bloom {
                threshold,
                intensity,
                sigma,
            } if *sigma > 0.0 && *intensity > 0.0 => {
                // Bloom reuses the blur compute for the spread; ensure both pipelines
                // exist, then borrow them disjointly (distinct `Ctx` fields).
                if ctx.blur_pipeline.is_none() {
                    *ctx.blur_pipeline = Some(GaussianBlur::new(ctx.device));
                }
                if ctx.bloom_pipeline.is_none() {
                    *ctx.bloom_pipeline = Some(Bloom::new(ctx.device));
                }
                let linear = ctx.linear;
                let blur = ctx.blur_pipeline.as_ref().unwrap();
                let bloom = ctx.bloom_pipeline.as_ref().unwrap();
                texture = bloom.run(
                    ctx.device, ctx.queue, blur, &texture, tw, th, *threshold, *intensity, *sigma,
                    linear,
                );
            }
            // Degenerate bloom (no spread or no intensity) is a no-op.
            Effect::Bloom { .. } => {}
            Effect::ColorGrade {
                exposure,
                contrast,
                saturation,
                temperature,
                tint,
            } => {
                let grade = ctx
                    .grade_pipeline
                    .get_or_insert_with(|| ColorGrade::new(ctx.device));
                texture = grade.run(
                    ctx.device,
                    ctx.queue,
                    &texture,
                    tw,
                    th,
                    *exposure,
                    *contrast,
                    *saturation,
                    *temperature,
                    *tint,
                );
            }
            Effect::ChromaticAberration { amount } if *amount > 0.0 => {
                let fx = ctx
                    .pixelfx_pipeline
                    .get_or_insert_with(|| PixelFx::new(ctx.device));
                texture = fx.run(
                    ctx.device,
                    ctx.queue,
                    &texture,
                    tw,
                    th,
                    PIXELFX_CHROMATIC,
                    [*amount, 0.0, 0.0, 0.0],
                    [0.0; 4],
                );
            }
            Effect::ChromaticAberration { .. } => {}
            Effect::Vignette { amount, softness } => {
                let fx = ctx
                    .pixelfx_pipeline
                    .get_or_insert_with(|| PixelFx::new(ctx.device));
                texture = fx.run(
                    ctx.device,
                    ctx.queue,
                    &texture,
                    tw,
                    th,
                    PIXELFX_VIGNETTE,
                    [*amount, *softness, 0.0, 0.0],
                    [0.0; 4],
                );
            }
            Effect::Posterize { levels } => {
                let fx = ctx
                    .pixelfx_pipeline
                    .get_or_insert_with(|| PixelFx::new(ctx.device));
                texture = fx.run(
                    ctx.device,
                    ctx.queue,
                    &texture,
                    tw,
                    th,
                    PIXELFX_POSTERIZE,
                    [*levels, 0.0, 0.0, 0.0],
                    [0.0; 4],
                );
            }
            Effect::Duotone { shadow, highlight } => {
                let fx = ctx
                    .pixelfx_pipeline
                    .get_or_insert_with(|| PixelFx::new(ctx.device));
                texture = fx.run(
                    ctx.device,
                    ctx.queue,
                    &texture,
                    tw,
                    th,
                    PIXELFX_DUOTONE,
                    [shadow[0], shadow[1], shadow[2], 0.0],
                    [highlight[0], highlight[1], highlight[2], 0.0],
                );
            }
            Effect::ChromaKey {
                key,
                threshold,
                smoothness,
            } => {
                let fx = ctx
                    .pixelfx_pipeline
                    .get_or_insert_with(|| PixelFx::new(ctx.device));
                texture = fx.run(
                    ctx.device,
                    ctx.queue,
                    &texture,
                    tw,
                    th,
                    PIXELFX_CHROMA_KEY,
                    [key[0], key[1], key[2], 0.0],
                    [*threshold, *smoothness, 0.0, 0.0],
                );
            }
            Effect::Grain {
                intensity,
                size,
                seed,
            } if *intensity > 0.0 => {
                let grain = ctx
                    .grain_pipeline
                    .get_or_insert_with(|| Grain::new(ctx.device));
                texture = grain.run(
                    ctx.device, ctx.queue, &texture, tw, th, *intensity, *size, *seed,
                );
            }
            // Zero-intensity grain is a no-op.
            Effect::Grain { .. } => {}
            Effect::Goo { sigma, threshold } => {
                // Goo reuses the blur compute for the spread; ensure both pipelines
                // exist, then borrow them disjointly (distinct `Ctx` fields).
                if ctx.blur_pipeline.is_none() {
                    *ctx.blur_pipeline = Some(GaussianBlur::new(ctx.device));
                }
                if ctx.goo_pipeline.is_none() {
                    *ctx.goo_pipeline = Some(Goo::new(ctx.device));
                }
                let blur = ctx.blur_pipeline.as_ref().unwrap();
                let goo = ctx.goo_pipeline.as_ref().unwrap();
                texture = goo.run(
                    ctx.device, ctx.queue, blur, &texture, tw, th, *sigma, *threshold,
                );
            }
            // Resolved in `build` (samples the backdrop, not this captured subtree).
            Effect::BackdropBlur { .. } => {}
            // Resolved in `build` (screen-space backdrop wrap) — never reached here,
            // since a light-wrap node is excluded from `has_subtree_effect`.
            Effect::LightWrap { .. } => {}
        }
    }

    Some((texture, tw, th, x0, y0))
}

/// Resolve a [`Camera3D`] to pinhole parameters for a `w×h` frame: focal length `f`
/// (px, from the vertical fov) and eye position `[px, py, pz]`. The default eye is
/// centered and pulled back by `f` so the `z = 0` plane fills the frame.
fn resolve_camera3d(cam: &Camera3D, w: f32, h: f32) -> (f32, [f32; 3]) {
    let fov = cam
        .fov
        .to_radians()
        .clamp(1e-3, std::f32::consts::PI - 1e-3);
    let f = (h * 0.5) / (fov * 0.5).tan();
    let eye = cam.position.unwrap_or([w * 0.5, h * 0.5, -f]);
    (f, eye)
}

/// The straight-pinhole view-projection that EXACTLY matches the CPU/2.5D projection
/// (so a `z = 0` layer projects 1:1, the framing invariant), with a standard `[0,1]`
/// depth mapping over `[near, far]`. Out-of-plane rotation is added per layer via the
/// model matrix. Columns are the coefficients of X, Y, Z and the constant term —
/// `clip = VP · (X, Y, Z, 1)`, screen y (down) flipped into NDC y (up).
fn scene3d_view_proj(f: f32, eye: [f32; 3], w: f32, h: f32, near: f32, far: f32) -> glam::Mat4 {
    let [px, py, pz] = eye;
    let a = far / (far - near);
    let b = -a * (pz + near);
    glam::Mat4::from_cols(
        glam::vec4(2.0 * f / w, 0.0, 0.0, 0.0),
        glam::vec4(0.0, -2.0 * f / h, 0.0, 0.0),
        glam::vec4(0.0, 0.0, a, 1.0),
        glam::vec4(-(2.0 * f / w) * px, (2.0 * f / h) * py, b, -pz),
    )
}

/// The per-layer model matrix: place the unit quad (`[0,1]²` over the layer's `tw×th`
/// content texture) into the world — scaled to content size, rotated about the anchor
/// (Z·Y·X, degrees), then translated to the world `position`.
fn scene3d_model(pos: [f32; 3], rot_deg: [f32; 3], qa: (f32, f32), tw: f32, th: f32) -> glam::Mat4 {
    let [wx, wy, wz] = pos;
    let [rx, ry, rz] = rot_deg;
    glam::Mat4::from_translation(glam::vec3(wx, wy, wz))
        * glam::Mat4::from_rotation_z(rz.to_radians())
        * glam::Mat4::from_rotation_y(ry.to_radians())
        * glam::Mat4::from_rotation_x(rx.to_radians())
        * glam::Mat4::from_translation(glam::vec3(-qa.0, -qa.1, 0.0))
        * glam::Mat4::from_scale(glam::vec3(tw, th, 1.0))
}

/// A skrifa outline pen that appends a glyph's contours to a kurbo path, scaled to px
/// and flipped into ONDA's y-down space at the glyph's baseline origin `(ox, oy)`.
struct KurboPen<'a> {
    path: &'a mut BezPath,
    ox: f64,
    oy: f64,
}

impl skrifa::outline::OutlinePen for KurboPen<'_> {
    fn move_to(&mut self, x: f32, y: f32) {
        self.path.move_to((self.ox + x as f64, self.oy - y as f64));
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.path.line_to((self.ox + x as f64, self.oy - y as f64));
    }
    fn quad_to(&mut self, cx: f32, cy: f32, x: f32, y: f32) {
        self.path.quad_to(
            (self.ox + cx as f64, self.oy - cy as f64),
            (self.ox + x as f64, self.oy - y as f64),
        );
    }
    fn curve_to(&mut self, c0x: f32, c0y: f32, c1x: f32, c1y: f32, x: f32, y: f32) {
        self.path.curve_to(
            (self.ox + c0x as f64, self.oy - c0y as f64),
            (self.ox + c1x as f64, self.oy - c1y as f64),
            (self.ox + x as f64, self.oy - y as f64),
        );
    }
    fn close(&mut self) {
        self.path.close_path();
    }
}

/// Build the combined VECTOR OUTLINE (kurbo path) of a text node's glyphs in the text's
/// local layout space — for extruding text into a 3D solid. Lays the text out exactly
/// like the 2D draw, then pulls each glyph's outline via skrifa. Returns the path plus
/// the first glyph's fill colour, or `None` if nothing lays out.
fn text_outline_path(fonts: &mut FontContext, text: &Text) -> Option<(BezPath, [f32; 4])> {
    use skrifa::MetadataProvider;
    let resolved = text.resolved_runs();
    let styled: Vec<StyledRun> = resolved
        .iter()
        .map(|r| StyledRun {
            text: &r.text,
            font_size: r.font_size,
            color: [r.color.r, r.color.g, r.color.b, r.color.a],
            family: r.font_family.as_deref(),
            weight: r.weight,
            italic: r.italic,
            letter_spacing: text.letter_spacing,
        })
        .collect();
    let layout = fonts.layout_rich(&styled);
    if layout.glyphs.is_empty() {
        return None;
    }
    let color = layout.glyphs[0].color;
    let mut path = BezPath::new();
    for gl in &layout.glyphs {
        let Some(blob) = layout.fonts.iter().find(|b| b.key == gl.font_key) else {
            continue;
        };
        let Ok(font) = skrifa::FontRef::from_index(blob.data.as_slice(), blob.index) else {
            continue;
        };
        let Some(glyph) = font.outline_glyphs().get(skrifa::GlyphId::new(gl.id)) else {
            continue;
        };
        let mut pen = KurboPen {
            path: &mut path,
            ox: gl.x as f64,
            oy: gl.y as f64,
        };
        let settings = skrifa::outline::DrawSettings::unhinted(
            skrifa::instance::Size::new(gl.font_size),
            skrifa::instance::LocationRef::default(),
        );
        let _ = glyph.draw(settings, &mut pen);
    }
    if path.elements().is_empty() {
        return None;
    }
    Some((path, color))
}

/// Native GPU 3D pass: capture each 3D layer to a texture (the effect-capture seam),
/// place it as a textured quad through the perspective camera (with a depth buffer so
/// layers occlude/intersect by true depth), and composite the comp-sized result via
/// `override_image` — GPU-resident, exactly like an effect.
fn render_scene3d_gpu(
    vscene: &mut VelloScene,
    ctx: &mut Ctx,
    node: &Node,
    cam: &Camera3D,
    affine: Affine,
    opacity: f32,
) {
    let (cw, ch) = (ctx.comp.0 as f32, ctx.comp.1 as f32);
    let (f, eye) = resolve_camera3d(cam, cw, ch);
    let pz = eye[2];
    let near = cam.near.max(1e-3);
    let far = cam.far.max(near + 1.0);
    let vp = scene3d_view_proj(f, eye, cw, ch, near, far);

    // Build each child as either an EXTRUDED solid (a lit mesh) or a flat textured
    // quad; cull those at/behind the near plane.
    let mut entries: Vec<(f32, Layer3D)> = Vec::with_capacity(node.children.len());
    let mut meshes: Vec<Mesh3D> = Vec::new();
    for child in &node.children {
        let t3 = child.transform3d.unwrap_or_default();
        let [wx, wy, wz] = t3.position;
        if wz - pz <= near {
            continue;
        }
        // EXTRUDED shape or text → lit solid mesh (front/back faces + side walls).
        if let Some(ext) = child.extrude {
            let outline: Option<(BezPath, [f32; 4])> = match &child.kind {
                NodeKind::Shape(shape) => Some((
                    shape_path(&shape.geometry),
                    shape
                        .fill
                        .map_or([1.0, 1.0, 1.0, 1.0], |c| [c.r, c.g, c.b, c.a]),
                )),
                NodeKind::Text(t) => text_outline_path(ctx.fonts, t),
                _ => None,
            };
            if let Some((path, color)) = outline {
                if let Some(vertices) = extrude::extrude_path(&path, ext.depth) {
                    let bb = path.bounding_box();
                    let (ax, ay) = match t3.anchor {
                        Some([ax, ay]) => (ax, ay),
                        None => (
                            ((bb.x0 + bb.x1) * 0.5) as f32,
                            ((bb.y0 + bb.y1) * 0.5) as f32,
                        ),
                    };
                    let [rx, ry, rz] = t3.rotation;
                    // No unit-quad scale here — the mesh vertices are already in local px.
                    let model = glam::Mat4::from_translation(glam::vec3(wx, wy, wz))
                        * glam::Mat4::from_rotation_z(rz.to_radians())
                        * glam::Mat4::from_rotation_y(ry.to_radians())
                        * glam::Mat4::from_rotation_x(rx.to_radians())
                        * glam::Mat4::from_translation(glam::vec3(-ax, -ay, 0.0));
                    meshes.push(Mesh3D {
                        vertices,
                        mvp: vp * model,
                        model,
                        color,
                    });
                    continue;
                }
            }
            // Degenerate / non-extrudable → fall through to the flat-quad capture below.
        }
        let Some((texture, tw, th, x0, y0)) = build_effect_texture(ctx, child) else {
            continue;
        };
        // Anchor in the layer's local space: an explicit pivot, else the content center.
        let (ax, ay) = match t3.anchor {
            Some([ax, ay]) => (ax as f64, ay as f64),
            None => (x0 + tw as f64 * 0.5, y0 + th as f64 * 0.5),
        };
        let qa = ((ax - x0) as f32, (ay - y0) as f32);
        let model = scene3d_model([wx, wy, wz], t3.rotation, qa, tw as f32, th as f32);
        entries.push((
            wz,
            Layer3D {
                texture,
                mvp: vp * model,
            },
        ));
    }
    if entries.is_empty() && meshes.is_empty() {
        return;
    }
    // Far (large z) first — the depth buffer resolves occlusion, but back-to-front
    // keeps blended/AA edges compositing correctly.
    entries.sort_by(|x, y| y.0.total_cmp(&x.0));
    let layers: Vec<Layer3D> = entries.into_iter().map(|(_, l)| l).collect();

    let (device, queue) = (ctx.device, ctx.queue);
    let pass = ctx
        .scene3d_pipeline
        .get_or_insert_with(|| Scene3D::new(device));
    let out = pass.run(device, queue, &layers, &meshes, ctx.comp.0, ctx.comp.1);

    // Composite the comp-sized 3D render at the scene root's place/opacity (GPU-resident).
    let placeholder = effect_placeholder(ctx.comp.0, ctx.comp.1);
    draw_peniko_image(vscene, &placeholder, affine, opacity);
    ctx.renderer.override_image(
        &placeholder,
        Some(wgpu::ImageCopyTextureBase {
            texture: std::sync::Arc::new(out),
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        }),
    );
    ctx.effect_overrides.push(placeholder);
}

/// Web preview degrade of the 3D pass: project each layer to a 2.5D affine (perspective
/// scale + position, depth-sorted; no out-of-plane rotation) and build it normally —
/// the same projection the CPU reference uses. The native GPU pass is the truth.
fn render_scene3d_2d(
    vscene: &mut VelloScene,
    ctx: &mut Ctx,
    node: &Node,
    cam: &Camera3D,
    affine: Affine,
    opacity: f32,
) {
    let (cw, ch) = (ctx.comp.0 as f32, ctx.comp.1 as f32);
    let (f, eye) = resolve_camera3d(cam, cw, ch);
    let [px, py, pz] = eye;
    let near = cam.near.max(1e-3);

    // (world z, child index, projection affine), built then depth-sorted far→near.
    let mut entries: Vec<(f32, usize, Affine)> = Vec::with_capacity(node.children.len());
    for (i, child) in node.children.iter().enumerate() {
        let t3 = child.transform3d.unwrap_or_default();
        let [wx, wy, wz] = t3.position;
        let d = wz - pz;
        if d <= near {
            continue;
        }
        let s = (f / d) as f64;
        let sx = (cw * 0.5 + f * (wx - px) / d) as f64;
        let sy = (ch * 0.5 + f * (wy - py) / d) as f64;
        let (ax, ay) = match t3.anchor {
            Some([ax, ay]) => (ax as f64, ay as f64),
            None => match subtree_local_bounds(ctx.fonts, child) {
                Some(b) => ((b.x0 + b.x1) * 0.5, (b.y0 + b.y1) * 0.5),
                None => (0.0, 0.0),
            },
        };
        let proj = Affine::translate((sx, sy)) * Affine::scale(s) * Affine::translate((-ax, -ay));
        entries.push((wz, i, proj));
    }
    entries.sort_by(|a, b| b.0.total_cmp(&a.0));
    for (_, i, proj) in entries {
        // Neutralize the child's own transform so `position3d` governs (matching native).
        let local = Node {
            transform: Transform::IDENTITY,
            ..node.children[i].clone()
        };
        build(vscene, ctx, &local, affine * proj, opacity);
    }
}

/// Native inline effect path: build the effect texture, read it back synchronously
/// (native only — WebGPU resolves effects via the async pre-pass), and composite
/// it at the node's affine/opacity.
fn render_effects_subtree(
    vscene: &mut VelloScene,
    ctx: &mut Ctx,
    node: &Node,
    affine: Affine,
    opacity: f32,
) {
    let Some((texture, tw, th, x0, y0)) = build_effect_texture(ctx, node) else {
        return;
    };
    // GPU-RESIDENT composite (no readback): draw a placeholder image at the node's
    // place/opacity, then override it with the effect's GPU texture — Vello GPU→GPU-
    // copies the result into its atlas at render time instead of us reading it back to
    // the CPU and re-uploading it. The override is cleared after the frame renders.
    let placeholder = effect_placeholder(tw, th);
    let place = affine * Affine::translate((x0, y0));
    draw_peniko_image(vscene, &placeholder, place, opacity);
    ctx.renderer.override_image(
        &placeholder,
        Some(wgpu::ImageCopyTextureBase {
            texture: std::sync::Arc::new(texture),
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        }),
    );
    ctx.effect_overrides.push(placeholder);
}

/// Composite a pre-rendered effect image (straight-alpha RGBA) at `affine`/
/// `opacity`, offset so its node-local `(x0, y0)` lands correctly. Shared by the
/// native inline path and the web cached (pre-pass) path.
fn draw_effect_image(
    vscene: &mut VelloScene,
    affine: Affine,
    opacity: f32,
    rgba: std::sync::Arc<Vec<u8>>,
    width: u32,
    height: u32,
    x0: f64,
    y0: f64,
) {
    let data = ImageData {
        width,
        height,
        rgba,
    };
    let place = affine * Affine::translate((x0, y0));
    draw_image_data(
        vscene,
        place,
        opacity,
        Some(&data),
        None,
        None,
        ImageFit::Fill,
    );
}

/// Fill a shape with an fBm fractal-noise gradient (the "expensive" Stripe/Linear
/// gradient): generate the field on the GPU at the shape's pixel bounds, read it
/// back, and draw it clipped to the shape path. Native-only — the synchronous
/// readback can't run on WebGPU mid-build (the preview degrades to `fill_brush`'s
/// smooth fallback). The field texture is sized to the shape's local bounding box
/// (capped) and placed at that origin, so it lines up under the affine/clip.
#[allow(clippy::too_many_arguments)]
fn draw_fbm_fill(
    vscene: &mut VelloScene,
    ctx: &mut Ctx,
    path: &BezPath,
    affine: Affine,
    opacity: f32,
    stops: &[GradientStop],
    scale: f32,
    time: f32,
    warp: f32,
) {
    let bounds = path.bounding_box();
    let w = (bounds.width().ceil() as u32).clamp(1, 4096);
    let h = (bounds.height().ceil() as u32).clamp(1, 4096);
    let ramp: Vec<([f32; 4], f32)> = stops
        .iter()
        .map(|s| {
            let [r, g, b, a] = s.color.to_rgba8();
            (
                [
                    r as f32 / 255.0,
                    g as f32 / 255.0,
                    b as f32 / 255.0,
                    a as f32 / 255.0,
                ],
                s.offset,
            )
        })
        .collect();
    let pipe = ctx
        .fbm_pipeline
        .get_or_insert_with(|| FbmGradient::new(ctx.device));
    let texture = pipe.run(ctx.device, ctx.queue, w, h, scale, time, warp, &ramp);
    let frame = read_back(ctx.device, ctx.queue, &texture, w, h);
    // Clip to the shape, then draw the field at the shape's local bounds origin.
    vscene.push_layer(Mix::Clip, 1.0, affine, path);
    let data = ImageData {
        width: w,
        height: h,
        rgba: std::sync::Arc::new(frame.pixels),
    };
    let place = affine * Affine::translate((bounds.x0, bounds.y0));
    draw_image_data(
        vscene,
        place,
        opacity,
        Some(&data),
        None,
        None,
        ImageFit::Fill,
    );
    vscene.pop_layer();
}

/// The first `Effect::BackdropBlur` in a node's chain (frosted glass), if any.
/// Backdrop blur is handled apart from the subtree-capture effects: it samples the
/// backdrop *behind* the node rather than the node's own subtree.
fn backdrop_blur_of(node: &Node) -> Option<Effect> {
    node.effects
        .iter()
        .copied()
        .find(|e| matches!(e, Effect::BackdropBlur { .. }))
}

/// The first `Effect::LightWrap` in a node's chain, if any. Like `BackdropBlur` it
/// samples the backdrop *behind* the node rather than the node's own subtree, so it
/// is resolved in `build` (screen space), apart from the subtree-capture chain.
fn lightwrap_of(node: &Node) -> Option<Effect> {
    node.effects
        .iter()
        .copied()
        .find(|e| matches!(e, Effect::LightWrap { .. }))
}

/// Whether a node carries a real SUBTREE-capture effect (blur/bloom/grade/goo) —
/// any effect other than `BackdropBlur`/`LightWrap`, both of which sample the
/// backdrop and are composited separately in `build`.
fn has_subtree_effect(node: &Node) -> bool {
    node.effects
        .iter()
        .any(|e| !matches!(e, Effect::BackdropBlur { .. } | Effect::LightWrap { .. }))
}

/// Collect every backdrop-blur node in the SAME pre-order `build` reaches them:
/// descend into a backdrop node's children (build falls through to them), but NOT
/// into a subtree-effect node's children (build returns at the effect branch, so
/// its descendants are never reached at the top level). Keeps the web pre-pass's
/// `backdrop_idx` order aligned with `build`'s consumption.
fn collect_backdrop_nodes<'a>(node: &'a Node, out: &mut Vec<&'a Node>) {
    // A matte node wins in `build` and returns without descending (its backdrop, if
    // any, is never resolved; its content is captured separately) — skip it entirely
    // so `backdrop_idx` stays aligned.
    if node.matte.is_some() {
        return;
    }
    if backdrop_blur_of(node).is_some() {
        out.push(node);
    } else if has_subtree_effect(node) {
        return;
    }
    for child in &node.children {
        collect_backdrop_nodes(child, out);
    }
}

/// The frosted region of a backdrop-blur node, in its LOCAL space: its `clip`, or
/// its own `Shape` geometry, or — for a bare container — its subtree bounds. The
/// returned offset places a subtree-bounds rect (clip/shape sit at the origin).
fn backdrop_region(ctx: &mut Ctx, node: &Node) -> Option<(ShapeGeometry, (f64, f64))> {
    if let Some(clip) = &node.clip {
        return Some((clip.clone(), (0.0, 0.0)));
    }
    if let NodeKind::Shape(shape) = &node.kind {
        return Some((shape.geometry.clone(), (0.0, 0.0)));
    }
    let b = subtree_local_bounds(ctx.fonts, node)?;
    let (w, h) = (b.x1 - b.x0, b.y1 - b.y0);
    if !(w > 0.0 && h > 0.0) {
        return None;
    }
    Some((
        ShapeGeometry::Rect {
            size: Size::new(w as f32, h as f32),
            corner_radius: 0.0,
        },
        (b.x0, b.y0),
    ))
}

/// Capture the *prefix* of the scene relative to `node` — everything painted before
/// it — into a full-canvas (composition-size) texture. Re-walks the scene root and
/// STOPS the moment it reaches `node` (`backdrop_stop`), so it sees exactly the nodes
/// drawn behind it. Suppresses nested glass / matte / light-wrap in the prefix (each
/// renders plainly rather than recursing into more screen-space captures). Shared by
/// the backdrop-blur and light-wrap resolves.
fn capture_prefix(ctx: &mut Ctx, node: &Node) -> Option<wgpu::Texture> {
    let (w, h) = ctx.comp;
    if w == 0 || h == 0 {
        return None;
    }
    let saved_stop = ctx.backdrop_stop;
    let saved_done = ctx.backdrop_done;
    let saved_sb = ctx.suppress_backdrop;
    let saved_sm = ctx.suppress_matte;
    let saved_slw = ctx.suppress_lightwrap;
    ctx.backdrop_stop = Some(node as *const Node);
    ctx.backdrop_done = false;
    ctx.suppress_backdrop = true;
    ctx.suppress_matte = true;
    ctx.suppress_lightwrap = true;
    let root = ctx.root;
    let mut prefix = VelloScene::new();
    build(&mut prefix, ctx, root, Affine::IDENTITY, 1.0);
    ctx.backdrop_stop = saved_stop;
    ctx.backdrop_done = saved_done;
    ctx.suppress_backdrop = saved_sb;
    ctx.suppress_matte = saved_sm;
    ctx.suppress_lightwrap = saved_slw;
    Some(render_vscene_to_texture(
        ctx.device,
        ctx.queue,
        ctx.renderer,
        &prefix,
        w,
        h,
    ))
}

/// Capture the backdrop *behind* a glass `node` — everything painted before it —
/// into a full-canvas texture, then blur it by `sigma` and apply brightness/
/// saturation. Returns the texture (composition size); the caller reads it back
/// (sync native / async web) and composites it, clipped to the glass shape. The
/// backdrop is captured by re-walking the scene root and STOPPING at this node
/// (`backdrop_stop`), so it sees exactly the nodes drawn before it. Mirrors
/// `build_effect_texture`, but for the backdrop instead of the node's subtree.
fn build_backdrop_texture(ctx: &mut Ctx, node: &Node) -> Option<(wgpu::Texture, u32, u32)> {
    let Effect::BackdropBlur {
        sigma,
        brightness,
        saturation,
        ..
    } = backdrop_blur_of(node)?
    else {
        return None;
    };
    let (w, h) = ctx.comp;
    if w == 0 || h == 0 {
        return None;
    }

    let mut texture = capture_prefix(ctx, node)?;

    if sigma > 0.0 {
        let blur = ctx
            .blur_pipeline
            .get_or_insert_with(|| GaussianBlur::new(ctx.device));
        texture = blur.run(ctx.device, ctx.queue, &texture, w, h, sigma);
    }
    if brightness != 1.0 || saturation != 1.0 {
        // brightness is a linear multiply → encode as exposure (2^exposure); the
        // grade also applies saturation (lerp toward luma). temperature/tint stay 0.
        let exposure = if brightness > 0.0 {
            brightness.log2()
        } else {
            f32::NEG_INFINITY
        };
        let grade = ctx
            .grade_pipeline
            .get_or_insert_with(|| ColorGrade::new(ctx.device));
        texture = grade.run(
            ctx.device, ctx.queue, &texture, w, h, exposure, 1.0, saturation, 0.0, 0.0,
        );
    }
    Some((texture, w, h))
}

/// Build the light-wrap composite for `node` — a full-canvas texture of the node's
/// foreground with the blurred backdrop light bled onto its feathered edges. Renders
/// the foreground in SCREEN space (so it aligns with the full-canvas backdrop
/// capture), blurs both the backdrop (the light) and the foreground alpha (the edge
/// band), and composites them in linear light. Returns `(texture, w, h)`; the caller
/// reads it back and draws it over the scene (where the foreground is transparent the
/// existing backdrop shows through). Native/export only — see [`Effect::LightWrap`].
fn build_lightwrap(
    ctx: &mut Ctx,
    node: &Node,
    affine: Affine,
) -> Option<(wgpu::Texture, u32, u32)> {
    let Effect::LightWrap { sigma, strength } = lightwrap_of(node)? else {
        return None;
    };
    let (w, h) = ctx.comp;
    if w == 0 || h == 0 {
        return None;
    }

    // Foreground: this node's subtree in SCREEN space (full-canvas). Neutralize the
    // node's own transform (already baked into `affine`) and clear effects / matte /
    // blend / clip so we capture the raw silhouette and don't recurse into light-wrap.
    let fg_root = Node {
        transform: Transform::IDENTITY,
        opacity: 1.0,
        effects: Vec::new(),
        blend: BlendMode::Normal,
        clip: None,
        matte: None,
        ..node.clone()
    };
    let saved_slw = ctx.suppress_lightwrap;
    let saved_sb = ctx.suppress_backdrop;
    let saved_sm = ctx.suppress_matte;
    ctx.suppress_lightwrap = true;
    ctx.suppress_backdrop = true;
    ctx.suppress_matte = true;
    let mut fg_scene = VelloScene::new();
    build(&mut fg_scene, ctx, &fg_root, affine, 1.0);
    ctx.suppress_lightwrap = saved_slw;
    ctx.suppress_backdrop = saved_sb;
    ctx.suppress_matte = saved_sm;
    let fg = render_vscene_to_texture(ctx.device, ctx.queue, ctx.renderer, &fg_scene, w, h);

    // Backdrop: everything painted behind this node (full-canvas, screen-aligned).
    let bg = capture_prefix(ctx, node)?;

    // Blur the backdrop (the light to wrap) and a copy of the foreground (its alpha
    // gives the feathered edge band). σ doubles as the rim width; keep a small floor
    // so a 0 σ still yields a visible 1px wrap rather than nothing.
    let sig = sigma.max(1.0);
    if ctx.blur_pipeline.is_none() {
        *ctx.blur_pipeline = Some(GaussianBlur::new(ctx.device));
    }
    let bg_blurred = {
        let blur = ctx.blur_pipeline.as_ref().unwrap();
        blur.run(ctx.device, ctx.queue, &bg, w, h, sig)
    };
    let soft_fg = {
        let blur = ctx.blur_pipeline.as_ref().unwrap();
        blur.run(ctx.device, ctx.queue, &fg, w, h, sig)
    };

    // Composite the wrap. The pipeline is cheap to build per-resolve (export path).
    let lw = LightWrap::new(ctx.device);
    let out = lw.run(
        ctx.device,
        ctx.queue,
        &fg,
        &soft_fg,
        &bg_blurred,
        w,
        h,
        strength,
    );
    Some((out, w, h))
}

/// Native inline light-wrap path: build the composite, read it back synchronously
/// (native only), and draw it full-canvas at identity (it is already screen-space).
fn draw_lightwrap_native(
    vscene: &mut VelloScene,
    ctx: &mut Ctx,
    node: &Node,
    affine: Affine,
    opacity: f32,
) {
    let Some((texture, w, h)) = build_lightwrap(ctx, node, affine) else {
        return;
    };
    let frame = read_back(ctx.device, ctx.queue, &texture, w, h);
    draw_effect_image(
        vscene,
        Affine::IDENTITY,
        opacity,
        std::sync::Arc::new(frame.pixels),
        w,
        h,
        0.0,
        0.0,
    );
}

/// Native inline backdrop path: capture + blur the backdrop, read it back
/// synchronously (native only), and composite it under the glass node.
fn draw_backdrop_native(
    vscene: &mut VelloScene,
    ctx: &mut Ctx,
    node: &Node,
    affine: Affine,
    opacity: f32,
    bb: Effect,
) {
    let Some((texture, tw, th)) = build_backdrop_texture(ctx, node) else {
        return;
    };
    let frame = read_back(ctx.device, ctx.queue, &texture, tw, th);
    composite_backdrop(
        vscene,
        ctx,
        node,
        affine,
        opacity,
        bb,
        std::sync::Arc::new(frame.pixels),
        tw,
        th,
    );
}

/// Composite a (full-canvas) frosted-backdrop image under a glass node: clip to the
/// node's region, draw the image at composition origin, lay the `tint` over it
/// (alpha = strength), and pop. Shared by the native inline and web cached paths.
fn composite_backdrop(
    vscene: &mut VelloScene,
    ctx: &mut Ctx,
    node: &Node,
    affine: Affine,
    opacity: f32,
    bb: Effect,
    rgba: std::sync::Arc<Vec<u8>>,
    iw: u32,
    ih: u32,
) {
    let Effect::BackdropBlur { tint, .. } = bb else {
        return;
    };
    let Some((geometry, offset)) = backdrop_region(ctx, node) else {
        return;
    };
    let region_affine = affine * Affine::translate(offset);
    let path = shape_path(&geometry);
    vscene.push_layer(Mix::Clip, 1.0, region_affine, &path);
    let data = ImageData {
        width: iw,
        height: ih,
        rgba,
    };
    // The image IS the full canvas, drawn at identity → pixel (x,y) → canvas (x,y);
    // the clip layer keeps only the glass region.
    draw_image_data(
        vscene,
        Affine::IDENTITY,
        opacity,
        Some(&data),
        None,
        None,
        ImageFit::Fill,
    );
    if tint.a > 0.0 {
        vscene.fill(
            Fill::NonZero,
            region_affine,
            peniko_color(tint, opacity),
            None,
            &path,
        );
    }
    vscene.pop_layer();
}

/// Capture a matte node's CONTENT subtree and its MATTE subtree to two
/// pixel-aligned textures over a shared window, then alpha-combine them (content
/// rgb; content alpha × the matte's coverage). Returns the combined texture, its
/// size, and the `(x0, y0)` local top-left — like `build_effect_texture` — so it
/// feeds the existing `draw_effect_image` composite. The media-through-type move.
fn build_matte_texture(
    ctx: &mut Ctx,
    node: &Node,
    matte: &Matte,
) -> Option<(wgpu::Texture, u32, u32, f64, f64)> {
    // Shared window = union of the content subtree's local bounds (node's own kind
    // at identity + children) and the matte subtree's bounds (through its own
    // transform). Both must exist — no content, or an empty matte, reveals nothing.
    let cb = subtree_local_bounds(ctx.fonts, node)?;
    let mb_local = subtree_local_bounds(ctx.fonts, &matte.source)?;
    let mb = to_affine(&matte.source.transform).transform_rect_bbox(mb_local);
    let x0 = cb.x0.min(mb.x0).floor();
    let y0 = cb.y0.min(mb.y0).floor();
    let x1 = cb.x1.max(mb.x1).ceil();
    let y1 = cb.y1.max(mb.y1).ceil();
    let w = (x1 - x0) as i64;
    let h = (y1 - y0) as i64;
    if w <= 0 || h <= 0 {
        return None;
    }
    const MAX_DIM: i64 = 8192;
    if w > MAX_DIM || h > MAX_DIM {
        return None;
    }
    let (tw, th) = (w as u32, h as u32);

    // Suppress nested backdrop/matte resolution inside both captures.
    let saved_sb = ctx.suppress_backdrop;
    let saved_sm = ctx.suppress_matte;
    ctx.suppress_backdrop = true;
    ctx.suppress_matte = true;

    // CONTENT: node's children at identity, transform/opacity/effects/blend/clip/
    // matte neutralized so the recursion terminates — like the effect capture's
    // local_root. (A matted node's own subtree effects are dropped for v1. v1 LIMIT:
    // a subtree effect on a DESCENDANT inside the content renders effected on native
    // export but degrades to un-effected in WebGPU preview, since this capture runs
    // with effect_images=None — a known preview≠export edge; threading the effect
    // cache through here is the long-term fix.)
    let content_root = Node {
        transform: Transform::IDENTITY,
        opacity: 1.0,
        effects: Vec::new(),
        blend: BlendMode::Normal,
        clip: None,
        matte: None,
        ..node.clone()
    };
    let mut content_scene = VelloScene::new();
    build(
        &mut content_scene,
        ctx,
        &content_root,
        Affine::translate((-x0, -y0)),
        1.0,
    );
    let content_tex =
        render_vscene_to_texture(ctx.device, ctx.queue, ctx.renderer, &content_scene, tw, th);

    // MATTE: the matte source positioned by its OWN transform, into the SAME window
    // (so it's pixel-aligned with the content).
    let mut matte_scene = VelloScene::new();
    build(
        &mut matte_scene,
        ctx,
        &matte.source,
        Affine::translate((-x0, -y0)),
        1.0,
    );
    let matte_tex =
        render_vscene_to_texture(ctx.device, ctx.queue, ctx.renderer, &matte_scene, tw, th);

    ctx.suppress_backdrop = saved_sb;
    ctx.suppress_matte = saved_sm;

    // Alpha-combine on the GPU: content.rgb, content.a × the matte's coverage.
    let mode = match matte.mode {
        MatteMode::Alpha => 0u32,
        MatteMode::Luminance => 1u32,
    };
    let pipe = ctx
        .matte_pipeline
        .get_or_insert_with(|| AlphaMatte::new(ctx.device));
    let combined = pipe.run(
        ctx.device,
        ctx.queue,
        &content_tex,
        &matte_tex,
        tw,
        th,
        mode,
    );
    Some((combined, tw, th, x0, y0))
}

/// Native inline matte path: capture + alpha-combine, read back synchronously
/// (native only), and composite at the node's affine/opacity.
fn render_matte_subtree(
    vscene: &mut VelloScene,
    ctx: &mut Ctx,
    node: &Node,
    matte: &Matte,
    affine: Affine,
    opacity: f32,
) {
    let Some((texture, tw, th, x0, y0)) = build_matte_texture(ctx, node, matte) else {
        return;
    };
    let frame = read_back(ctx.device, ctx.queue, &texture, tw, th);
    draw_effect_image(
        vscene,
        affine,
        opacity,
        std::sync::Arc::new(frame.pixels),
        tw,
        th,
        x0,
        y0,
    );
}

/// Axis-aligned bounds of a node's subtree in the node's **own local space**
/// (its transform NOT applied; children's transforms ARE). `None` if the subtree
/// draws nothing measurable. Used to size the offscreen effect texture.
///
/// Geometry is exact for shapes/clips; text falls back to a measured box via the
/// font context (cheap and good enough for blur margins). Unknown/empty kinds
/// contribute only through their children.
fn subtree_local_bounds(fonts: &mut FontContext, node: &Node) -> Option<Rect> {
    // `at` is the accumulated transform of `node` *relative to the effect node's
    // local space* — so the effect node itself contributes at IDENTITY (its own
    // transform is applied later at composite-back), and each descendant adds its
    // own transform on top.
    fn walk(fonts: &mut FontContext, node: &Node, at: Affine, acc: &mut Option<Rect>) {
        if let Some(local) = node_self_bounds(fonts, node) {
            let t = at.transform_rect_bbox(local);
            *acc = Some(match *acc {
                Some(r) => r.union(t),
                None => t,
            });
        }
        for child in &node.children {
            walk(fonts, child, at * to_affine(&child.transform), acc);
        }
    }
    let mut acc = None;
    walk(fonts, node, Affine::IDENTITY, &mut acc);
    acc
}

/// The local-space drawn bounds of a single node (no children), or `None` if it
/// draws nothing measurable.
fn node_self_bounds(fonts: &mut FontContext, node: &Node) -> Option<Rect> {
    match &node.kind {
        NodeKind::Shape(shape) => {
            let mut b = shape_path(&shape.geometry).bounding_box();
            if let Some(stroke) = &shape.stroke {
                let half = stroke.width as f64 / 2.0;
                b = b.inflate(half, half);
            }
            if let Some(shadow) = &shape.shadow {
                let (rect, _) = shadow_box(&shape.geometry, &shape_path(&shape.geometry), shadow);
                let grown = rect.inflate(shadow.blur.max(0.0) as f64, shadow.blur.max(0.0) as f64);
                b = b.union(grown);
            }
            Some(b)
        }
        NodeKind::Text(text) => text_local_bounds(fonts, text),
        NodeKind::Image(image) => {
            image_local_bounds(image.data.as_ref(), image.width, image.height)
        }
        NodeKind::Video(video) => {
            image_local_bounds(video.data.as_ref(), video.width, video.height)
        }
        NodeKind::Group | NodeKind::Audio(_) | NodeKind::Svg(_) => None,
    }
}

/// Local box of an image/video node: the `box_width`×`box_height` if given, else
/// the decoded intrinsic size. `None` if there's nothing to draw.
fn image_local_bounds(
    data: Option<&ImageData>,
    box_width: Option<f32>,
    box_height: Option<f32>,
) -> Option<Rect> {
    match (box_width, box_height) {
        (Some(bw), Some(bh)) if bw > 0.0 && bh > 0.0 => {
            Some(Rect::new(0.0, 0.0, bw as f64, bh as f64))
        }
        _ => {
            let d = data?;
            if d.width == 0 || d.height == 0 {
                return None;
            }
            Some(Rect::new(0.0, 0.0, d.width as f64, d.height as f64))
        }
    }
}

/// Local box of a text node, measured through the font context (the layout's
/// glyph extents). Origin is the text's local `(0, 0)`, matching `draw_text`.
fn text_local_bounds(fonts: &mut FontContext, text: &Text) -> Option<Rect> {
    let resolved = text.resolved_runs();
    let styled: Vec<StyledRun> = resolved
        .iter()
        .map(|r| StyledRun {
            text: &r.text,
            font_size: r.font_size,
            color: [r.color.r, r.color.g, r.color.b, r.color.a],
            family: r.font_family.as_deref(),
            weight: r.weight,
            italic: r.italic,
            letter_spacing: text.letter_spacing,
        })
        .collect();
    let layout = fonts.layout_rich(&styled);
    if layout.glyphs.is_empty() {
        return None;
    }
    let max_x = layout.glyphs.iter().map(|g| g.x).fold(0.0_f32, f32::max);
    let max_size = resolved.iter().map(|r| r.font_size).fold(0.0_f32, f32::max);
    // `draw_text` places glyphs through Vello at the node's local origin, with
    // each glyph's `y` being its **baseline** measured DOWN from the text box top
    // (positive). So the drawn box runs from the box top (~0, with ascenders a
    // touch above) down past the deepest baseline by a descender's worth. We take
    // the max baseline and pad ~0.3em below for descenders + a small headroom
    // above for ascenders/diacritics. Width = furthest pen x + ~0.6em for the last
    // glyph's body (mirrors `measure_text` in the wasm crate).
    let max_baseline = layout.glyphs.iter().map(|g| g.y).fold(0.0_f32, f32::max);
    let top = -max_size * 0.1;
    let bottom = max_baseline + max_size * 0.3;
    Some(Rect::new(
        0.0,
        top as f64,
        (max_x + max_size * 0.6) as f64,
        bottom as f64,
    ))
}

/// Draw decoded RGBA pixels into the optional `box_width`×`box_height` box per
/// `fit` — shared by Image and Video nodes (a video frame is just an image).
/// Without a box, the image draws at intrinsic size at `affine`.
#[allow(clippy::too_many_arguments)]
fn draw_image_data(
    vscene: &mut VelloScene,
    affine: Affine,
    opacity: f32,
    data: Option<&ImageData>,
    box_width: Option<f32>,
    box_height: Option<f32>,
    fit: ImageFit,
) {
    let Some(data) = data else {
        return;
    };
    if data.width == 0 || data.height == 0 {
        return;
    }
    let pimg = PenikoImage::new(
        Blob::new(data.rgba.clone()),
        Format::Rgba8,
        data.width,
        data.height,
    );
    let (iw, ih) = (data.width as f64, data.height as f64);
    let (img_affine, clip_box) = match (box_width, box_height) {
        (Some(bw), Some(bh)) if bw > 0.0 && bh > 0.0 => {
            let (bw, bh) = (bw as f64, bh as f64);
            let (sx, sy) = match fit {
                ImageFit::Fill => (bw / iw, bh / ih),
                ImageFit::Cover => {
                    let s = (bw / iw).max(bh / ih);
                    (s, s)
                }
                ImageFit::Contain => {
                    let s = (bw / iw).min(bh / ih);
                    (s, s)
                }
            };
            // Center the scaled image in the box.
            let dx = (bw - iw * sx) / 2.0;
            let dy = (bh - ih * sy) / 2.0;
            let a = affine * Affine::translate((dx, dy)) * Affine::scale_non_uniform(sx, sy);
            // Cover overflows the box → clip it; fill/contain stay inside.
            let clip = (fit == ImageFit::Cover).then(|| Rect::new(0.0, 0.0, bw, bh));
            (a, clip)
        }
        _ => (affine, None),
    };
    // Clip cover overflow to the box (in node-local `affine` space).
    let did_clip = clip_box.is_some();
    if let Some(b) = clip_box {
        vscene.push_layer(Mix::Clip, 1.0, affine, &b);
    }
    draw_peniko_image(vscene, &pimg, img_affine, opacity);
    if did_clip {
        vscene.pop_layer();
    }
}

/// Draw a peniko image at `img_affine`, folding `opacity` in via a layer (Vello's
/// `draw_image` has no alpha arg). Shared by `draw_image_data` (a CPU image) and the
/// native GPU-resident effect path (a placeholder image overridden to a GPU texture).
fn draw_peniko_image(
    vscene: &mut VelloScene,
    pimg: &PenikoImage,
    img_affine: Affine,
    opacity: f32,
) {
    if opacity < 1.0 {
        let bounds = Rect::new(0.0, 0.0, pimg.width as f64, pimg.height as f64);
        vscene.push_layer(Mix::Normal, opacity, img_affine, &bounds);
        vscene.draw_image(pimg, img_affine);
        vscene.pop_layer();
    } else {
        vscene.draw_image(pimg, img_affine);
    }
}

/// A placeholder `peniko::Image` at `w×h` whose Blob is a tiny dummy — used only as a
/// stable, unique override KEY for `Renderer::override_image`. Under an override Vello
/// GPU→GPU-copies the real texture and never reads the blob (the WriteImage upload is
/// short-circuited), and `Image::new` does not validate the blob length; `Blob::new`
/// stamps a globally-unique id, so every call is a distinct key.
fn effect_placeholder(w: u32, h: u32) -> PenikoImage {
    PenikoImage::new(
        Blob::new(std::sync::Arc::new(vec![0u8; 4])),
        Format::Rgba8,
        w,
        h,
    )
}

fn to_affine(t: &Transform) -> Affine {
    // TRS about `origin` (CSS transform-origin): move the pivot to 0, scale, then
    // rotate (degrees → radians, clockwise in screen space), move it back, then
    // the node translate. origin (0,0) reduces to the plain local-origin TRS.
    // Composed with the parent affine up the tree, so nested transforms work.
    let (ox, oy) = (t.origin.x as f64, t.origin.y as f64);
    Affine::translate((t.translate.x as f64, t.translate.y as f64))
        * Affine::translate((ox, oy))
        * Affine::rotate((t.rotate as f64).to_radians())
        * Affine::scale_non_uniform(t.scale.x as f64, t.scale.y as f64)
        * Affine::translate((-ox, -oy))
}

fn boolean_rule(op: BooleanOp) -> i_overlay::core::overlay_rule::OverlayRule {
    use i_overlay::core::overlay_rule::OverlayRule;
    match op {
        BooleanOp::Union => OverlayRule::Union,
        BooleanOp::Difference => OverlayRule::Difference,
        BooleanOp::Intersect => OverlayRule::Intersect,
        BooleanOp::Xor => OverlayRule::Xor,
    }
}

/// Resolve a boolean combination of `operands` (paths in a common space) into one
/// outline via i_overlay — flatten to polygons (kurbo), fold pairwise so N compose,
/// rebuild as a `BezPath` (NonZero fill → orientation encodes holes). Mirrors the
/// CPU reference in `onda-renderer` so both backends agree.
fn boolean_path(rule: i_overlay::core::overlay_rule::OverlayRule, operands: &[BezPath]) -> BezPath {
    use i_overlay::core::fill_rule::FillRule;
    use i_overlay::float::single::SingleFloatOverlay;
    use vello::kurbo::PathEl;
    const TOL: f64 = 0.2;
    let to_contours = |bp: &BezPath| -> Vec<Vec<[f64; 2]>> {
        let mut contours: Vec<Vec<[f64; 2]>> = Vec::new();
        let mut cur: Vec<[f64; 2]> = Vec::new();
        let flush = |cur: &mut Vec<[f64; 2]>, out: &mut Vec<Vec<[f64; 2]>>| {
            if cur.len() >= 3 {
                out.push(std::mem::take(cur));
            } else {
                cur.clear();
            }
        };
        vello::kurbo::flatten(bp.elements().iter().copied(), TOL, |el| match el {
            PathEl::MoveTo(p) => {
                flush(&mut cur, &mut contours);
                cur.push([p.x, p.y]);
            }
            PathEl::LineTo(p) => cur.push([p.x, p.y]),
            PathEl::ClosePath => flush(&mut cur, &mut contours),
            _ => {}
        });
        if cur.len() >= 3 {
            contours.push(cur);
        }
        contours
    };
    if operands.is_empty() {
        return BezPath::new();
    }
    let mut acc = to_contours(&operands[0]);
    for operand in &operands[1..] {
        let clip = to_contours(operand);
        let shapes = acc.overlay(&clip, rule, FillRule::NonZero);
        acc = shapes.into_iter().flatten().collect();
    }
    let mut out = BezPath::new();
    for contour in &acc {
        if contour.len() < 3 {
            continue;
        }
        out.move_to((contour[0][0], contour[0][1]));
        for p in &contour[1..] {
            out.line_to((p[0], p[1]));
        }
        out.close_path();
    }
    out
}

/// The (local-space) rounded-rect + radius for a shape's drop shadow: the
/// geometry's box, displaced by `offset` and grown by `spread`. Ellipses map to a
/// fully-rounded rect; paths use their bounding box.
fn shadow_box(geo: &ShapeGeometry, path: &BezPath, shadow: &Shadow) -> (Rect, f64) {
    let s = shadow.spread as f64;
    let (ox, oy) = (shadow.offset.x as f64, shadow.offset.y as f64);
    let (x0, y0, x1, y1, base_r) = match geo {
        ShapeGeometry::Rect {
            size,
            corner_radius,
        } => (
            0.0,
            0.0,
            size.width as f64,
            size.height as f64,
            *corner_radius as f64,
        ),
        ShapeGeometry::Ellipse { size } => {
            let (w, h) = (size.width as f64, size.height as f64);
            (0.0, 0.0, w, h, w.min(h) / 2.0)
        }
        ShapeGeometry::Path { .. } | ShapeGeometry::Boolean { .. } => {
            let b = path.bounding_box();
            (b.x0, b.y0, b.x1, b.y1, 0.0)
        }
    };
    (
        Rect::new(x0 + ox - s, y0 + oy - s, x1 + ox + s, y1 + oy + s),
        (base_r + s).max(0.0),
    )
}

fn blend_mix(b: BlendMode) -> Mix {
    match b {
        BlendMode::Normal => Mix::Normal,
        BlendMode::Multiply => Mix::Multiply,
        BlendMode::Screen => Mix::Screen,
        BlendMode::Overlay => Mix::Overlay,
        BlendMode::Darken => Mix::Darken,
        BlendMode::Lighten => Mix::Lighten,
        BlendMode::ColorDodge => Mix::ColorDodge,
        BlendMode::ColorBurn => Mix::ColorBurn,
        BlendMode::HardLight => Mix::HardLight,
        BlendMode::SoftLight => Mix::SoftLight,
        BlendMode::Difference => Mix::Difference,
        BlendMode::Exclusion => Mix::Exclusion,
        BlendMode::Hue => Mix::Hue,
        BlendMode::Saturation => Mix::Saturation,
        BlendMode::Color => Mix::Color,
        BlendMode::Luminosity => Mix::Luminosity,
    }
}

fn cap_to_kurbo(c: LineCap) -> Cap {
    match c {
        LineCap::Butt => Cap::Butt,
        LineCap::Round => Cap::Round,
        LineCap::Square => Cap::Square,
    }
}

fn join_to_kurbo(j: LineJoin) -> Join {
    match j {
        LineJoin::Miter => Join::Miter,
        LineJoin::Round => Join::Round,
        LineJoin::Bevel => Join::Bevel,
    }
}

fn peniko_color(color: Color, opacity: f32) -> PenikoColor {
    let [r, g, b, a] = color.with_alpha(color.a * opacity).to_rgba8();
    PenikoColor::rgba8(r, g, b, a)
}

/// The fill paint for a shape: a gradient takes precedence over a solid color;
/// `opacity` is baked into the resulting colors. `None` if the shape has no fill.
fn fill_brush(fill: Option<Color>, gradient: Option<&Gradient>, opacity: f32) -> Option<Brush> {
    match gradient {
        Some(g) => Some(Brush::Gradient(peniko_gradient(g, opacity))),
        None => fill.map(|c| Brush::Solid(peniko_color(c, opacity))),
    }
}

fn peniko_gradient(gradient: &Gradient, opacity: f32) -> PenikoGradient {
    match gradient {
        Gradient::Linear { start, end, stops } => PenikoGradient::new_linear(
            (start.x as f64, start.y as f64),
            (end.x as f64, end.y as f64),
        )
        .with_stops(color_stops(stops, opacity).as_slice()),
        Gradient::Radial {
            center,
            radius,
            stops,
        } => PenikoGradient::new_radial((center.x as f64, center.y as f64), *radius)
            .with_stops(color_stops(stops, opacity).as_slice()),
        // FBM is rendered by the compute pass in the Shape branch (native). This is
        // only reached as a FALLBACK (WebGPU preview, which can't sync-read the
        // pass): a smooth diagonal of the same stops — the colors without the noise.
        Gradient::Fbm { stops, .. } => PenikoGradient::new_linear((0.0, 0.0), (1600.0, 900.0))
            .with_stops(color_stops(stops, opacity).as_slice()),
    }
}

fn color_stops(stops: &[GradientStop], opacity: f32) -> Vec<ColorStop> {
    stops
        .iter()
        .map(|s| ColorStop {
            offset: s.offset,
            color: peniko_color(s.color, opacity),
        })
        .collect()
}

fn shape_path(geometry: &ShapeGeometry) -> BezPath {
    const TOL: f64 = 0.1;
    match geometry {
        ShapeGeometry::Rect {
            size,
            corner_radius,
        } => {
            let (w, h) = (size.width as f64, size.height as f64);
            // Clamp the radius below half the shorter side. Near a stadium/pill
            // (radius ≈ half the height, e.g. a `RECOMMENDED` badge) the rounded
            // rect's straight edges shrink toward zero and the stroked path
            // degenerates — leaving a stray full-width line (verified on Vello).
            // The 2px margin keeps every pill ~4px of straight edge: visually
            // still a perfect pill, but a well-formed, robustly-strokeable path.
            let max_r = (w.min(h) / 2.0 - 2.0).max(0.0);
            let r = (*corner_radius as f64).min(max_r);
            if r > 0.0 {
                RoundedRect::new(0.0, 0.0, w, h, r).to_path(TOL)
            } else {
                Rect::new(0.0, 0.0, w, h).to_path(TOL)
            }
        }
        ShapeGeometry::Ellipse { size } => {
            let (rx, ry) = (size.width as f64 / 2.0, size.height as f64 / 2.0);
            Ellipse::new((rx, ry), (rx, ry), 0.0).to_path(TOL)
        }
        // Arbitrary SVG path data → Bézier outline. Malformed data yields an
        // empty path (draws nothing) rather than panicking.
        ShapeGeometry::Path { data } => BezPath::from_svg(data).unwrap_or_default(),
        // Boolean: resolve each operand to its (transformed) path, then combine.
        ShapeGeometry::Boolean { op, operands } => {
            let paths: Vec<BezPath> = operands
                .iter()
                .map(|o| {
                    let mut p = shape_path(&o.geometry);
                    p.apply_affine(to_affine(&o.transform));
                    p
                })
                .collect();
            boolean_path(boolean_rule(*op), &paths)
        }
    }
}

/// Draw text as native glyph outlines through Vello's glyph runs. cosmic-text
/// shapes the node's rich runs ([`FontContext::layout_rich`]) — picking the right
/// face per run's family/weight/style — and Vello rasterizes the outlines on the
/// GPU. Crisp at any scale; pixel-identical to `onda export`.
fn draw_text(
    vscene: &mut VelloScene,
    fonts: &mut FontContext,
    font_cache: &mut HashMap<u64, Font>,
    text: &Text,
    affine: Affine,
    opacity: f32,
) {
    if opacity <= 0.0 {
        return;
    }
    // Resolve the node's rich runs (a single run for plain text), bake node
    // opacity into each run's alpha, and lay them out together.
    let resolved = text.resolved_runs();
    let styled: Vec<StyledRun> = resolved
        .iter()
        .map(|r| StyledRun {
            text: &r.text,
            font_size: r.font_size,
            color: [r.color.r, r.color.g, r.color.b, r.color.a * opacity],
            family: r.font_family.as_deref(),
            weight: r.weight,
            italic: r.italic,
            letter_spacing: text.letter_spacing,
        })
        .collect();
    let layout = fonts.layout_rich(&styled);
    if layout.glyphs.is_empty() {
        return;
    }
    // Build any newly-seen faces (cached by stable key — keeps Vello's glyph
    // cache warm across frames).
    for blob in &layout.fonts {
        font_cache
            .entry(blob.key)
            .or_insert_with(|| Font::new(Blob::new(blob.data.clone()), blob.index));
    }

    // Draw a Vello glyph run per contiguous group sharing face + size + color.
    // Runs are contiguous in layout order, so grouping consecutively is deterministic.
    let glyphs = &layout.glyphs;
    let mut i = 0;
    while i < glyphs.len() {
        let head = glyphs[i];
        let mut j = i + 1;
        while j < glyphs.len()
            && glyphs[j].font_key == head.font_key
            && glyphs[j].font_size == head.font_size
            && glyphs[j].color == head.color
        {
            j += 1;
        }
        if let Some(font) = font_cache.get(&head.font_key) {
            let [r, g, b, a] = head.color;
            let to8 = |c: f32| (c.clamp(0.0, 1.0) * 255.0).round() as u8;
            vscene
                .draw_glyphs(font)
                .font_size(head.font_size)
                .transform(affine)
                .brush(PenikoColor::rgba8(to8(r), to8(g), to8(b), to8(a)))
                .draw(
                    Fill::NonZero,
                    glyphs[i..j].iter().map(|gl| Glyph {
                        id: gl.id,
                        x: gl.x,
                        y: gl.y,
                    }),
                );
        }
        i = j;
    }
}

/// Copy the rendered texture into a mappable buffer. Returns the buffer and the
/// 256-byte-aligned row stride.
fn copy_to_readback_buffer(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    texture: &wgpu::Texture,
    width: u32,
    height: u32,
) -> (wgpu::Buffer, u32) {
    let unpadded = width * 4;
    let padded = unpadded.div_ceil(256) * 256;
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("readback"),
        size: (padded * height) as u64,
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
    encoder.copy_texture_to_buffer(
        wgpu::ImageCopyTexture {
            texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        wgpu::ImageCopyBuffer {
            buffer: &buffer,
            layout: wgpu::ImageDataLayout {
                offset: 0,
                bytes_per_row: Some(padded),
                rows_per_image: Some(height),
            },
        },
        wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
    );
    queue.submit(Some(encoder.finish()));
    (buffer, padded)
}

/// Strip the 256-byte row padding from a mapped readback buffer into tight RGBA.
fn unpad_rows(mapped: &[u8], width: u32, height: u32, padded: u32) -> Vec<u8> {
    let unpadded = (width * 4) as usize;
    let mut pixels = Vec::with_capacity(unpadded * height as usize);
    for row in 0..height {
        let start = (row * padded) as usize;
        pixels.extend_from_slice(&mapped[start..start + unpadded]);
    }
    pixels
}

fn read_back(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    texture: &wgpu::Texture,
    width: u32,
    height: u32,
) -> Frame {
    let (buffer, padded) = copy_to_readback_buffer(device, queue, texture, width, height);
    let slice = buffer.slice(..);
    slice.map_async(wgpu::MapMode::Read, |_| {});
    device.poll(wgpu::Maintain::Wait);
    let pixels = unpad_rows(&slice.get_mapped_range(), width, height, padded);
    buffer.unmap();
    Frame {
        width,
        height,
        pixels,
    }
}

/// Async readback: awaits the buffer map instead of blocking on `poll(Wait)`.
/// On native, `poll(Wait)` drives the map to completion immediately; on the web
/// it's a no-op and the browser fulfils the map while we await the callback.
async fn read_back_async(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    texture: &wgpu::Texture,
    width: u32,
    height: u32,
) -> Frame {
    let (buffer, padded) = copy_to_readback_buffer(device, queue, texture, width, height);
    let slice = buffer.slice(..);
    let (tx, rx) = futures_intrusive::channel::shared::oneshot_channel();
    slice.map_async(wgpu::MapMode::Read, move |res| {
        let _ = tx.send(res);
    });
    device.poll(wgpu::Maintain::Wait);
    let _ = rx.receive().await;
    let pixels = unpad_rows(&slice.get_mapped_range(), width, height, padded);
    buffer.unmap();
    Frame {
        width,
        height,
        pixels,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use onda_core::{Size, Vec2};
    use onda_scene::{Composition, GradientStop, Node, Shape, ShapeGeometry};

    #[test]
    fn renders_an_onda_scene() {
        let Some(mut renderer) = VelloRenderer::new() else {
            eprintln!("no GPU adapter; skipping");
            return;
        };
        let scene = Scene::new(Composition::new(64, 64, 30.0, 1)).with_root(
            Node::group().with_child(Node::shape(
                Shape::rect(Size::new(64.0, 64.0)).with_fill(Color::rgb(1.0, 0.0, 0.0)),
            )),
        );
        let frame = renderer.render(&scene);
        assert_eq!((frame.width, frame.height), (64, 64));
        // A full-canvas red fill: center pixel is opaque red.
        let center = ((32 * 64 + 32) * 4) as usize;
        assert_eq!(&frame.pixels[center..center + 4], &[255, 0, 0, 255]);
    }

    #[test]
    fn renders_an_arbitrary_path() {
        let Some(mut renderer) = VelloRenderer::new() else {
            eprintln!("no GPU adapter; skipping");
            return;
        };
        // A path filling the whole 64x64 canvas (only expressible as a path).
        let scene = Scene::new(Composition::new(64, 64, 30.0, 1)).with_root(
            Node::group().with_child(Node::shape(
                Shape::path("M0 0 L64 0 L64 64 L0 64 Z").with_fill(Color::rgb(0.0, 1.0, 0.0)),
            )),
        );
        let frame = renderer.render(&scene);
        let center = ((32 * 64 + 32) * 4) as usize;
        assert_eq!(&frame.pixels[center..center + 4], &[0, 255, 0, 255]);
    }

    #[test]
    fn renders_a_linear_gradient() {
        let Some(mut renderer) = VelloRenderer::new() else {
            eprintln!("no GPU adapter; skipping");
            return;
        };
        // Horizontal red → blue across the canvas.
        let scene =
            Scene::new(Composition::new(64, 64, 30.0, 1)).with_root(Node::group().with_child(
                Node::shape(Shape::rect(Size::new(64.0, 64.0)).with_linear_gradient(
                    Vec2::new(0.0, 0.0),
                    Vec2::new(64.0, 0.0),
                    [
                        GradientStop::new(0.0, Color::rgb(1.0, 0.0, 0.0)),
                        GradientStop::new(1.0, Color::rgb(0.0, 0.0, 1.0)),
                    ],
                )),
            ));
        let frame = renderer.render(&scene);
        let px = |x: u32| {
            let i = ((32 * 64 + x) * 4) as usize;
            [frame.pixels[i], frame.pixels[i + 1], frame.pixels[i + 2]]
        };
        let (left, right) = (px(2), px(61));
        // Left end is mostly red; right end mostly blue.
        assert!(
            left[0] > 180 && left[2] < 80,
            "left should be red: {left:?}"
        );
        assert!(
            right[2] > 180 && right[0] < 80,
            "right should be blue: {right:?}"
        );
    }

    #[test]
    fn clip_confines_a_subtree() {
        let Some(mut renderer) = VelloRenderer::new() else {
            eprintln!("no GPU adapter; skipping");
            return;
        };
        // A full-canvas red fill, clipped to the top-left 20x20 corner.
        let scene = Scene::new(Composition::new(64, 64, 30.0, 1)).with_root(
            Node::group()
                .with_clip(ShapeGeometry::Rect {
                    size: Size::new(20.0, 20.0),
                    corner_radius: 0.0,
                })
                .with_child(Node::shape(
                    Shape::rect(Size::new(64.0, 64.0)).with_fill(Color::rgb(1.0, 0.0, 0.0)),
                )),
        );
        let frame = renderer.render(&scene);
        let alpha = |x: u32, y: u32| frame.pixels[((y * 64 + x) * 4 + 3) as usize];
        assert_eq!(alpha(10, 10), 255, "inside the clip should be filled");
        assert_eq!(alpha(40, 40), 0, "outside the clip should be empty");
    }
}
