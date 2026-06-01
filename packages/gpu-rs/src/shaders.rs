//! WGSL for the GPU backend: a shape pipeline (instanced rects/ellipses with an
//! SDF fragment) and a text pipeline (textured quad sampling a coverage mask).

pub const SHADER: &str = r#"
struct Uniforms { canvas: vec2<f32>, _pad: vec2<f32> };
@group(0) @binding(0) var<uniform> u: Uniforms;

fn to_ndc(px: vec2<f32>) -> vec2<f32> {
    return vec2(px.x / u.canvas.x * 2.0 - 1.0, 1.0 - px.y / u.canvas.y * 2.0);
}

var<private> CORNERS: array<vec2<f32>, 4> =
    array<vec2<f32>, 4>(vec2(0., 0.), vec2(1., 0.), vec2(0., 1.), vec2(1., 1.));

// ---- shapes ----
struct Inst {
    @location(0) rect_min: vec2<f32>,
    @location(1) rect_size: vec2<f32>,
    @location(2) color: vec4<f32>,
    @location(3) kind: u32,
};
struct VsOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
    @location(2) @interpolate(flat) kind: u32,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, inst: Inst) -> VsOut {
    let uv = CORNERS[vi];
    var out: VsOut;
    out.pos = vec4(to_ndc(inst.rect_min + uv * inst.rect_size), 0.0, 1.0);
    out.uv = uv;
    out.color = inst.color;
    out.kind = inst.kind;
    return out;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
    var alpha = in.color.a;
    if (in.kind == 1u) {
        let d = distance(in.uv, vec2(0.5, 0.5)) * 2.0;
        let aa = fwidth(d);
        alpha = alpha * (1.0 - smoothstep(1.0 - aa, 1.0 + aa, d));
    }
    return vec4(in.color.rgb, alpha);
}

// ---- text ----
@group(1) @binding(0) var t_cov: texture_2d<f32>;
@group(1) @binding(1) var s_cov: sampler;

struct TInst {
    @location(0) rect_min: vec2<f32>,
    @location(1) rect_size: vec2<f32>,
    @location(2) color: vec4<f32>,
};
struct TOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
};

@vertex
fn vs_text(@builtin(vertex_index) vi: u32, inst: TInst) -> TOut {
    let uv = CORNERS[vi];
    var out: TOut;
    out.pos = vec4(to_ndc(inst.rect_min + uv * inst.rect_size), 0.0, 1.0);
    out.uv = uv;
    out.color = inst.color;
    return out;
}

@fragment
fn fs_text(in: TOut) -> @location(0) vec4<f32> {
    let coverage = textureSample(t_cov, s_cov, in.uv).r;
    return vec4(in.color.rgb, in.color.a * coverage);
}
"#;
