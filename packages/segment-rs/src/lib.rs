//! Native subject segmentation — the cutout step ONDA used to shell out to
//! Python `rembg` for.
//!
//! Given an image of a salient subject on a background (a person, a product),
//! [`segment_to_rgba`] returns the same image as RGBA with the background made
//! transparent: the subject's alpha is opaque, everything else fades to 0.
//!
//! It runs the **U²-Net** salient-object-detection model (`u2net.onnx`,
//! Apache-2.0 — the default rembg uses) through ONNX Runtime via the [`ort`]
//! crate, with the CPU execution provider. The model is downloaded once to
//! `~/.onda/models/u2net.onnx` (mirroring how rembg caches to `~/.u2net`) and
//! reused thereafter.
//!
//! The preprocessing/postprocessing replicates rembg's `U2netSession` exactly:
//! resize to 320×320 → scale by the image max → ImageNet normalize → NCHW
//! float32 → run → take output 0 (the `d1` saliency map) → min-max normalize →
//! resize back to the original size → use as the alpha channel.

use std::io::Read;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use image::imageops::FilterType;
use image::{GenericImageView, GrayImage, ImageBuffer, Luma, RgbaImage};
use ort::session::Session;
use ort::value::Tensor;

/// Public URL of the Apache-2.0 U²-Net ONNX model (the rembg default release).
const MODEL_URL: &str = "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx";

/// The model's fixed square input/output resolution.
const SIZE: u32 = 320;

/// ImageNet per-channel normalization, matching rembg's `U2netSession`.
const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const STD: [f32; 3] = [0.229, 0.224, 0.225];

/// The on-disk path of the cached U²-Net model (`~/.onda/models/u2net.onnx`).
fn model_cache_path() -> Result<PathBuf> {
    let home = home_dir().context("could not determine the home directory for the model cache")?;
    Ok(home.join(".onda").join("models").join("u2net.onnx"))
}

/// The user's home directory, without pulling in a crate for it.
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .filter(|h| !h.is_empty())
        .map(PathBuf::from)
}

/// Ensure the U²-Net model is present in the cache, downloading it once if not.
/// Returns the path to the model file. Mirrors rembg's cache-on-first-use.
fn ensure_model() -> Result<PathBuf> {
    let path = model_cache_path()?;
    if path.exists() {
        return Ok(path);
    }
    let dir = path
        .parent()
        .context("model cache path has no parent directory")?;
    std::fs::create_dir_all(dir)
        .with_context(|| format!("creating model cache dir '{}'", dir.display()))?;

    eprintln!(
        "onda-segment: downloading U²-Net model (~176 MB) to {} …",
        path.display()
    );
    // Download to a temp sibling, then rename, so an interrupted download never
    // leaves a truncated model that future runs would treat as complete.
    let tmp = path.with_extension("onnx.partial");
    let resp = ureq::get(MODEL_URL)
        .call()
        .with_context(|| format!("requesting model from {MODEL_URL}"))?;
    let mut reader = resp.into_reader();
    let mut bytes = Vec::new();
    reader
        .read_to_end(&mut bytes)
        .context("reading model download body")?;
    if bytes.len() < 1_000_000 {
        bail!(
            "model download from {MODEL_URL} was only {} bytes — expected ~176 MB",
            bytes.len()
        );
    }
    std::fs::write(&tmp, &bytes)
        .with_context(|| format!("writing model to '{}'", tmp.display()))?;
    std::fs::rename(&tmp, &path)
        .with_context(|| format!("finalizing model at '{}'", path.display()))?;
    eprintln!("onda-segment: model ready ({} bytes).", bytes.len());
    Ok(path)
}

/// Load an image from disk and produce its single-channel alpha matte
/// (`GrayImage`, white = subject, black = background) at the image's ORIGINAL
/// resolution. This is the saliency map U²-Net predicts, upscaled.
pub fn segment_alpha_from_path(input_path: &Path) -> Result<GrayImage> {
    let img = image::open(input_path)
        .with_context(|| format!("opening image '{}'", input_path.display()))?;
    segment_alpha(&img)
}

/// Produce the alpha matte (`GrayImage`) for an already-decoded image, at the
/// image's original width × height. White (255) is opaque subject; black (0) is
/// background.
pub fn segment_alpha(img: &image::DynamicImage) -> Result<GrayImage> {
    let (orig_w, orig_h) = img.dimensions();
    let model = ensure_model()?;
    let mut session = Session::builder()
        .context("creating an ONNX Runtime session builder")?
        .commit_from_file(&model)
        .with_context(|| format!("loading the U²-Net model '{}'", model.display()))?;

    let input = preprocess(img);

    // Feed by the model's declared input name; read output 0 by position (the
    // `d1` saliency map), robust to the model's internal output naming.
    let input_name = session
        .inputs
        .first()
        .context("the U²-Net model declares no inputs")?
        .name
        .clone();
    let tensor = Tensor::from_array(([1usize, 3, SIZE as usize, SIZE as usize], input))
        .context("building the input tensor")?;
    let outputs = session
        .run(ort::inputs![input_name => tensor])
        .context("running U²-Net inference")?;
    let (_, data) = outputs[0]
        .try_extract_tensor::<f32>()
        .context("extracting the saliency map (output 0)")?;

    // Min-max normalize the 320×320 map to [0,1] (rembg's `(p-min)/(max-min)`).
    let mut lo = f32::INFINITY;
    let mut hi = f32::NEG_INFINITY;
    for &v in data {
        if v < lo {
            lo = v;
        }
        if v > hi {
            hi = v;
        }
    }
    let span = (hi - lo).max(f32::EPSILON);
    let small: GrayImage = ImageBuffer::from_fn(SIZE, SIZE, |x, y| {
        let v = data[(y * SIZE + x) as usize];
        let n = ((v - lo) / span).clamp(0.0, 1.0);
        Luma([(n * 255.0).round() as u8])
    });

    // Resize the map back to the original size (bilinear == Triangle filter).
    let alpha = image::imageops::resize(&small, orig_w, orig_h, FilterType::Triangle);
    Ok(alpha)
}

/// Segment the subject in the image at `input_path` and return an RGBA cutout:
/// the original RGB with U²-Net's saliency map as the alpha channel, at the
/// original resolution. The background → transparent, the subject → opaque.
pub fn segment_to_rgba(input_path: &Path) -> Result<RgbaImage> {
    let img = image::open(input_path)
        .with_context(|| format!("opening image '{}'", input_path.display()))?;
    let alpha = segment_alpha(&img)?;
    let rgb = img.to_rgb8();
    let (w, h) = rgb.dimensions();
    debug_assert_eq!((w, h), alpha.dimensions());
    let cutout: RgbaImage = ImageBuffer::from_fn(w, h, |x, y| {
        let p = rgb.get_pixel(x, y).0;
        let a = alpha.get_pixel(x, y).0[0];
        image::Rgba([p[0], p[1], p[2], a])
    });
    Ok(cutout)
}

/// rembg's U2netSession preprocessing: resize to 320×320, divide by the image
/// max (not 255), ImageNet-normalize per channel, lay out NCHW float32. Returns
/// the flat `[1,3,320,320]` data in row-major (N,C,H,W) order.
fn preprocess(img: &image::DynamicImage) -> Vec<f32> {
    // Triangle == bilinear; rembg uses PIL's BILINEAR for the LANCZOS-free path.
    let resized = img.resize_exact(SIZE, SIZE, FilterType::Triangle).to_rgb8();

    // rembg scales by `np.max(im)` over the resized RGB array (a single scalar,
    // the brightest channel value), then divides; guard the all-black case.
    let max = resized
        .pixels()
        .flat_map(|p| p.0)
        .max()
        .unwrap_or(255)
        .max(1) as f32;

    let n = (SIZE * SIZE) as usize;
    let mut out = vec![0f32; 3 * n];
    for (x, y, p) in resized.enumerate_pixels() {
        let idx = (y * SIZE + x) as usize;
        for c in 0..3 {
            let v = p.0[c] as f32 / max; // scale to ~[0,1] by the image max
            out[c * n + idx] = (v - MEAN[c]) / STD[c]; // ImageNet normalize
        }
    }
    out
}
