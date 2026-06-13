//! Kokoro model + voices download to `~/.onda/models/`.
//!
//! Mirrors onda-transcribe's downloader: the two Kokoro assets — the ONNX model
//! (`kokoro-v1.0.onnx`, ~325 MB) and the packed voice styles
//! (`voices-v1.0.bin`, ~28 MB) — are fetched once to `~/.onda/models/` (each
//! downloaded to a `.partial` sibling, then atomically renamed so an interrupted
//! download is never treated as complete) and reused thereafter.
//!
//! Each path is resolvable three ways, in priority order:
//! 1. an explicit path passed by the caller (`SpeakOptions::model_path` /
//!    `voices_path`) — used as-is, NEVER downloaded,
//! 2. an env override (`ONDA_KOKORO_MODEL` / `ONDA_KOKORO_VOICES`) pointing at an
//!    existing file — used as-is, NEVER downloaded (dev reuses `/tmp` copies),
//! 3. the `~/.onda/models/<file>` cache, downloading the release asset on first use.

use std::io::Read;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};

/// The Kokoro v1.0 ONNX model release asset (thewh1teagle/kokoro-onnx).
const MODEL_URL: &str = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx";
const MODEL_FILE: &str = "kokoro-v1.0.onnx";
const MODEL_APPROX_MB: u64 = 325;

/// The packed per-voice style tensors (a NumPy `.npz`).
const VOICES_URL: &str = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin";
const VOICES_FILE: &str = "voices-v1.0.bin";
const VOICES_APPROX_MB: u64 = 28;

/// Resolve the Kokoro ONNX model path: an explicit `path` (must exist) → the
/// `ONDA_KOKORO_MODEL` override (must exist) → the `~/.onda/models/` cache,
/// downloading on first use.
pub fn resolve_model_path(path: Option<&Path>) -> Result<PathBuf> {
    resolve(
        path,
        "ONDA_KOKORO_MODEL",
        MODEL_FILE,
        MODEL_URL,
        MODEL_APPROX_MB,
    )
}

/// Resolve the packed voices path: an explicit `path` (must exist) → the
/// `ONDA_KOKORO_VOICES` override (must exist) → the `~/.onda/models/` cache,
/// downloading on first use.
pub fn resolve_voices_path(path: Option<&Path>) -> Result<PathBuf> {
    resolve(
        path,
        "ONDA_KOKORO_VOICES",
        VOICES_FILE,
        VOICES_URL,
        VOICES_APPROX_MB,
    )
}

/// Shared resolution: explicit path → env override (exact file, never downloaded)
/// → cache (download once). The explicit path and env var must exist if given.
fn resolve(
    path: Option<&Path>,
    env_var: &str,
    file: &str,
    url: &str,
    approx_mb: u64,
) -> Result<PathBuf> {
    if let Some(p) = path {
        if !p.exists() {
            bail!("Kokoro asset '{}' does not exist", p.display());
        }
        return Ok(p.to_path_buf());
    }
    if let Some(over) = std::env::var_os(env_var) {
        let p = PathBuf::from(over);
        if !p.exists() {
            bail!(
                "{env_var} points at '{}', which does not exist",
                p.display()
            );
        }
        return Ok(p);
    }
    ensure_cached(file, url, approx_mb)
}

/// The user's home directory, without pulling in a crate for it.
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .filter(|h| !h.is_empty())
        .map(PathBuf::from)
}

/// Ensure `~/.onda/models/<file>` exists, downloading `url` once if not.
fn ensure_cached(file: &str, url: &str, approx_mb: u64) -> Result<PathBuf> {
    let home = home_dir().context("could not determine the home directory for the model cache")?;
    let path = home.join(".onda").join("models").join(file);
    if path.exists() {
        return Ok(path);
    }
    let dir = path
        .parent()
        .context("model cache path has no parent directory")?;
    std::fs::create_dir_all(dir)
        .with_context(|| format!("creating model cache dir '{}'", dir.display()))?;

    eprintln!(
        "onda-tts: downloading Kokoro asset {file} (~{approx_mb} MB) to {} …",
        path.display()
    );
    // Download to a temp sibling, then rename, so an interrupted download never
    // leaves a truncated file that future runs would treat as complete.
    let tmp = path.with_extension("partial");
    let resp = ureq::get(url)
        .call()
        .with_context(|| format!("requesting Kokoro asset from {url}"))?;
    let mut reader = resp.into_reader();
    let mut bytes = Vec::new();
    reader
        .read_to_end(&mut bytes)
        .context("reading Kokoro asset download body")?;
    // Guard a truncated/HTML-error download (the real assets are tens of MB).
    if (bytes.len() as u64) < approx_mb.saturating_mul(1_000_000) / 2 {
        bail!(
            "Kokoro asset download from {url} was only {} bytes — expected ~{approx_mb} MB",
            bytes.len()
        );
    }
    std::fs::write(&tmp, &bytes)
        .with_context(|| format!("writing Kokoro asset to '{}'", tmp.display()))?;
    std::fs::rename(&tmp, &path)
        .with_context(|| format!("finalizing Kokoro asset at '{}'", path.display()))?;
    eprintln!("onda-tts: {file} ready ({} bytes).", bytes.len());
    Ok(path)
}
