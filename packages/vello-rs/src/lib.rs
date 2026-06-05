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

use onda_core::{Color, Transform};
use onda_scene::{
    BlendMode, Effect, Gradient, GradientStop, ImageData, ImageFit, LineCap, LineJoin, Node,
    NodeKind, Scene, Shadow, ShapeGeometry, Text,
};
use onda_typography::{FontContext, StyledRun};
use vello::kurbo::{Affine, BezPath, Cap, Ellipse, Join, Rect, RoundedRect, Shape, Stroke};
use vello::peniko::{
    Blob, Brush, Color as PenikoColor, ColorStop, Fill, Font, Format, Gradient as PenikoGradient,
    Image as PenikoImage, Mix,
};
use vello::{wgpu, AaConfig, Glyph, RenderParams, Renderer, RendererOptions, Scene as VelloScene};

mod effects;
use effects::{Bloom, ColorGrade, GaussianBlur, Goo};

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
    /// Gooey-morph threshold pipeline (alpha-sharpen after a blur). Built lazily
    /// the first time a node carries a `Goo` effect; reuses `blur_pipeline` for the
    /// spread before the threshold.
    goo_pipeline: Option<Goo>,
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
            goo_pipeline: None,
            web,
        })
    }

    /// Render an ONDA scene to a [`Frame`] (blocking readback; native only).
    pub fn render(&mut self, scene: &Scene) -> Frame {
        let (texture, width, height) = self.render_to_target(scene, None);
        read_back(&self.device, &self.queue, &texture, width, height)
    }

    /// Render an ONDA scene to a [`Frame`], awaiting the readback instead of
    /// blocking — required on the web (wasm), where buffer mapping is async.
    pub async fn render_async(&mut self, scene: &Scene) -> Frame {
        // WebGPU can't map buffers synchronously mid-build, so resolve every effect
        // subtree up front with async readbacks, then build using the cached images
        // (`prepare_effect_images` is a no-op on native — effects read back inline).
        let effect_images = self.prepare_effect_images(scene).await;
        let (texture, width, height) = self.render_to_target(scene, Some(&effect_images));
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
        let mut stack: Vec<&Node> = vec![&scene.root];
        while let Some(node) = stack.pop() {
            if node.effects.is_empty() {
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
                    goo_pipeline: &mut self.goo_pipeline,
                    web: true,
                    // Nested effects inside this subtree degrade (no cache here).
                    effect_images: None,
                    effect_idx: 0,
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

    /// Build the scene and rasterize it to an offscreen RGBA texture (shared by
    /// the sync and async render paths). `effect_images` supplies pre-rendered
    /// effect results for the web path (`None` natively — effects read back
    /// inline). Returns the texture and its size.
    fn render_to_target(
        &mut self,
        scene: &Scene,
        effect_images: Option<&[Option<CachedEffect>]>,
    ) -> (wgpu::Texture, u32, u32) {
        let width = scene.composition.width.max(1);
        let height = scene.composition.height.max(1);

        let mut vscene = VelloScene::new();
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
                goo_pipeline: &mut self.goo_pipeline,
                web: self.web,
                effect_images,
                effect_idx: 0,
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
    goo_pipeline: &'a mut Option<Goo>,
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
    let affine = parent * to_affine(&node.transform);
    let opacity = (parent_opacity * node.opacity).clamp(0.0, 1.0);

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
    if !node.effects.is_empty() {
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
            if let Some(brush) = fill_brush(shape.fill, shape.gradient.as_ref(), opacity) {
                vscene.fill(Fill::NonZero, affine, &brush, None, &path);
            }
            if let Some(stroke) = &shape.stroke {
                let mut sk = Stroke::new(stroke.width as f64)
                    .with_caps(cap_to_kurbo(stroke.cap))
                    .with_join(join_to_kurbo(stroke.join));
                if !stroke.dash.is_empty() {
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
                const STROKE_TOL: f64 = 0.1;
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
            Effect::Blur { sigma } => *sigma,
            // Bloom blurs its bright-pass with `sigma`; the halo needs the same
            // headroom as a blur so the glow isn't clipped at the texture edge.
            Effect::Bloom { sigma, .. } => *sigma,
            // ColorGrade is a per-pixel remap (no spread) — it needs no margin.
            Effect::ColorGrade { .. } => 0.0,
            // Goo blurs the subtree with `sigma` before thresholding; it needs the
            // same headroom as a blur so the spread (and fused neck) isn't clipped.
            Effect::Goo { sigma, .. } => *sigma,
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
        ..node.clone()
    };
    let mut sub = VelloScene::new();
    build(
        &mut sub,
        ctx,
        &local_root,
        Affine::translate((-x0, -y0)),
        1.0,
    );

    let mut texture = render_vscene_to_texture(ctx.device, ctx.queue, ctx.renderer, &sub, tw, th);

    // Run the ordered effect chain. Each effect consumes the previous texture and
    // produces the next (ping-pong is internal to the blur). The compute pass is
    // its own encoder+submit — bracketed between the Vello render above and the
    // readback below; it never injects into Vello's pass.
    for effect in &node.effects {
        match effect {
            Effect::Blur { sigma } if *sigma > 0.0 => {
                let blur = ctx
                    .blur_pipeline
                    .get_or_insert_with(|| GaussianBlur::new(ctx.device));
                texture = blur.run(ctx.device, ctx.queue, &texture, tw, th, *sigma);
            }
            // sigma <= 0 is a no-op (leave the texture sharp).
            Effect::Blur { .. } => {}
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
                let blur = ctx.blur_pipeline.as_ref().unwrap();
                let bloom = ctx.bloom_pipeline.as_ref().unwrap();
                texture = bloom.run(
                    ctx.device, ctx.queue, blur, &texture, tw, th, *threshold, *intensity, *sigma,
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
        }
    }

    Some((texture, tw, th, x0, y0))
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
    // draw_image has no alpha arg; fold node opacity in via a layer.
    if opacity < 1.0 {
        let bounds = Rect::new(0.0, 0.0, iw, ih);
        vscene.push_layer(Mix::Normal, opacity, img_affine, &bounds);
        vscene.draw_image(&pimg, img_affine);
        vscene.pop_layer();
    } else {
        vscene.draw_image(&pimg, img_affine);
    }
    if did_clip {
        vscene.pop_layer();
    }
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
        ShapeGeometry::Path { .. } => {
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
