//! Extrude a 2D outline (kurbo [`BezPath`]) into a 3D solid mesh for the GPU 3D pass:
//! a front + back face (tessellated with **lyon**, holes and winding handled) joined by
//! side walls, with a per-vertex normal on every face so a directional light shades it
//! — the "3D logo / title" move. The mesh is centered on `z = 0`, spanning ±`depth`/2,
//! in the outline's own local pixel space; the caller's model matrix places it.

use lyon::math::point as lpoint;
use lyon::path::Path as LyonPath;
use lyon::tessellation::{BuffersBuilder, FillOptions, FillTessellator, FillVertex, VertexBuffers};
use vello::kurbo::{flatten, BezPath, PathEl, Point};

/// One mesh vertex: position + normal, both in the outline's local space (z added).
#[repr(C)]
#[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct MeshVertex {
    pub pos: [f32; 3],
    pub normal: [f32; 3],
}

/// Flatness tolerance (px) for turning béziers into the line segments the walls + the
/// fill tessellation consume. Fine enough that a rotated edge stays smooth.
const TOL: f64 = 0.25;

/// Flatten `path` into closed polygonal contours (a letter 'O' yields two — outer + hole).
fn flatten_contours(path: &BezPath) -> Vec<Vec<Point>> {
    let mut contours: Vec<Vec<Point>> = Vec::new();
    let mut cur: Vec<Point> = Vec::new();
    flatten(path.elements().iter().copied(), TOL, |el| match el {
        PathEl::MoveTo(p) => {
            if cur.len() > 1 {
                contours.push(std::mem::take(&mut cur));
            } else {
                cur.clear();
            }
            cur.push(p);
        }
        PathEl::LineTo(p) => cur.push(p),
        PathEl::ClosePath => {
            if cur.len() > 1 {
                contours.push(std::mem::take(&mut cur));
            } else {
                cur.clear();
            }
        }
        _ => {}
    });
    if cur.len() > 1 {
        contours.push(cur);
    }
    // Drop a duplicated closing point so each edge `i → i+1 (mod n)` is unique.
    for c in &mut contours {
        if c.len() > 1
            && (c[0].x - c[c.len() - 1].x).abs() < 1e-6
            && (c[0].y - c[c.len() - 1].y).abs() < 1e-6
        {
            c.pop();
        }
    }
    contours
}

/// Twice the signed area of a contour (shoelace) — its sign is the winding, which lets
/// the wall normals point *out of the solid* for both the outer ring and any holes
/// (holes wind opposite, so the same rule turns their normals into the hole correctly).
fn signed_area2(c: &[Point]) -> f64 {
    let mut a = 0.0;
    for i in 0..c.len() {
        let p = c[i];
        let q = c[(i + 1) % c.len()];
        a += p.x * q.y - q.x * p.y;
    }
    a
}

/// Extrude `path` to a solid of thickness `depth` (centered on `z = 0`). Returns a flat
/// triangle list (front face, back face, side walls) with normals, or `None` if the
/// outline is degenerate (no area).
pub fn extrude_path(path: &BezPath, depth: f32) -> Option<Vec<MeshVertex>> {
    let contours = flatten_contours(path);
    if contours.is_empty() {
        return None;
    }
    let hz = depth.max(0.0) * 0.5;

    // Front/back faces: tessellate the filled outline (NonZero, so holes are cut) once
    // in 2D, then place a copy at each z with the matching face normal.
    let mut builder = LyonPath::builder();
    for c in &contours {
        if c.len() < 3 {
            continue;
        }
        builder.begin(lpoint(c[0].x as f32, c[0].y as f32));
        for p in &c[1..] {
            builder.line_to(lpoint(p.x as f32, p.y as f32));
        }
        builder.end(true);
    }
    let lpath = builder.build();
    let mut buffers: VertexBuffers<[f32; 2], u32> = VertexBuffers::new();
    let mut tess = FillTessellator::new();
    if tess
        .tessellate_path(
            &lpath,
            &FillOptions::default(),
            &mut BuffersBuilder::new(&mut buffers, |v: FillVertex| {
                let p = v.position();
                [p.x, p.y]
            }),
        )
        .is_err()
    {
        return None;
    }
    if buffers.indices.is_empty() {
        return None;
    }

    let mut out: Vec<MeshVertex> =
        Vec::with_capacity(buffers.indices.len() * 2 + contours.len() * 6);
    // Front face at z = -hz (toward the camera, which looks down +z), normal -z. The
    // back face reuses the triangles at +hz with reversed winding + normal +z.
    for tri in buffers.indices.chunks_exact(3) {
        let v = [
            buffers.vertices[tri[0] as usize],
            buffers.vertices[tri[1] as usize],
            buffers.vertices[tri[2] as usize],
        ];
        for p in v {
            out.push(MeshVertex {
                pos: [p[0], p[1], -hz],
                normal: [0.0, 0.0, -1.0],
            });
        }
        for p in [v[0], v[2], v[1]] {
            out.push(MeshVertex {
                pos: [p[0], p[1], hz],
                normal: [0.0, 0.0, 1.0],
            });
        }
    }

    // Side walls: one quad per contour edge, joining the front (-hz) and back (+hz)
    // rims. The normal is perpendicular to the edge in xy, oriented out of the solid
    // via the contour's winding sign.
    for c in &contours {
        if c.len() < 3 {
            continue;
        }
        let sign = if signed_area2(c) >= 0.0 {
            1.0_f32
        } else {
            -1.0
        };
        let n = c.len();
        for i in 0..n {
            let a = c[i];
            let b = c[(i + 1) % n];
            let (ax, ay, bx, by) = (a.x as f32, a.y as f32, b.x as f32, b.y as f32);
            let (ex, ey) = (bx - ax, by - ay);
            let len = (ex * ex + ey * ey).sqrt();
            if len < 1e-5 {
                continue;
            }
            // Outward normal = perpendicular to the edge, flipped by winding.
            let nx = (ey / len) * sign;
            let ny = (-ex / len) * sign;
            let normal = [nx, ny, 0.0];
            let af = [ax, ay, -hz];
            let bf = [bx, by, -hz];
            let ab = [ax, ay, hz];
            let bb = [bx, by, hz];
            for p in [af, bf, bb, af, bb, ab] {
                out.push(MeshVertex { pos: p, normal });
            }
        }
    }

    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extrudes_a_square_into_a_closed_solid() {
        // A unit square → 2 front + 2 back triangles + 4 side-wall quads (8 triangles),
        // each triangle 3 vertices: 12 tris × 3 = 36 vertices, all in triangle list form.
        let mut p = BezPath::new();
        p.move_to((0.0, 0.0));
        p.line_to((10.0, 0.0));
        p.line_to((10.0, 10.0));
        p.line_to((0.0, 10.0));
        p.close_path();
        let mesh = extrude_path(&p, 4.0).expect("square extrudes");
        assert_eq!(mesh.len() % 3, 0, "a triangle list");
        assert_eq!(mesh.len(), 36, "front + back + 4 walls");
        // The solid spans ±depth/2 in z.
        assert!(mesh.iter().any(|v| (v.pos[2] + 2.0).abs() < 1e-4));
        assert!(mesh.iter().any(|v| (v.pos[2] - 2.0).abs() < 1e-4));
    }

    #[test]
    fn empty_path_does_not_extrude() {
        assert!(extrude_path(&BezPath::new(), 4.0).is_none());
    }
}
