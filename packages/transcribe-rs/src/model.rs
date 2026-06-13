//! Whisper model selection + one-time download to `~/.onda/models/`.
//!
//! Mirrors onda-segment's downloader: the chosen ggml model is fetched once to
//! `~/.onda/models/ggml-<name>.bin` (download to a `.partial` sibling, then
//! atomically rename so an interrupted download is never treated as complete)
//! and reused thereafter. The model is selectable three ways, in priority order:
//!
//! 1. an explicit `model_path` in [`TranscribeOptions`] (an exact file),
//! 2. the `ONDA_WHISPER_MODEL` env var (an exact file — never downloaded),
//! 3. the [`WhisperModel`] enum (default `BaseEn`), which maps to the HF URL and
//!    the `~/.onda/models/` cache path, downloading on first use.

use std::io::Read;
use std::path::PathBuf;

use anyhow::{bail, Context, Result};

/// A bundled-by-name Whisper model. Each maps to a `ggml-<name>.bin` file on the
/// `ggerganov/whisper.cpp` Hugging Face repo and a `~/.onda/models/` cache path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WhisperModel {
    /// `tiny.en` — ~75 MB, fastest, English-only. Lowest accuracy; good for tests.
    TinyEn,
    /// `base.en` — ~142 MB, English-only. The ONDA default (better than tiny).
    BaseEn,
    /// `small.en` — ~466 MB, English-only. Slower, more accurate.
    SmallEn,
}

impl WhisperModel {
    /// The `ggml-<name>.bin` file name (the HF release asset + cache file name).
    pub fn file_name(self) -> &'static str {
        match self {
            WhisperModel::TinyEn => "ggml-tiny.en.bin",
            WhisperModel::BaseEn => "ggml-base.en.bin",
            WhisperModel::SmallEn => "ggml-small.en.bin",
        }
    }

    /// The approximate download size, for the progress message + the truncation
    /// sanity check.
    fn approx_mb(self) -> u64 {
        match self {
            WhisperModel::TinyEn => 75,
            WhisperModel::BaseEn => 142,
            WhisperModel::SmallEn => 466,
        }
    }

    /// Parse a short name (`tiny.en` / `base.en` / `small.en`, hyphens or dots).
    pub fn from_name(name: &str) -> Option<WhisperModel> {
        match name.trim().to_ascii_lowercase().replace('-', ".").as_str() {
            "tiny.en" | "tiny" => Some(WhisperModel::TinyEn),
            "base.en" | "base" => Some(WhisperModel::BaseEn),
            "small.en" | "small" => Some(WhisperModel::SmallEn),
            _ => None,
        }
    }

    /// The Hugging Face download URL for this model's ggml weights.
    fn url(self) -> String {
        format!(
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/{}",
            self.file_name()
        )
    }

    /// The on-disk cache path (`~/.onda/models/ggml-<name>.bin`).
    fn cache_path(self) -> Result<PathBuf> {
        let home =
            home_dir().context("could not determine the home directory for the model cache")?;
        Ok(home.join(".onda").join("models").join(self.file_name()))
    }

    /// Ensure the model is present in the cache, downloading it once if not.
    /// Returns the path to the model file. Mirrors onda-segment's cache-on-first-use.
    pub fn ensure(self) -> Result<PathBuf> {
        let path = self.cache_path()?;
        if path.exists() {
            return Ok(path);
        }
        let dir = path
            .parent()
            .context("model cache path has no parent directory")?;
        std::fs::create_dir_all(dir)
            .with_context(|| format!("creating model cache dir '{}'", dir.display()))?;

        let url = self.url();
        eprintln!(
            "onda-transcribe: downloading Whisper model {} (~{} MB) to {} …",
            self.file_name(),
            self.approx_mb(),
            path.display()
        );
        // Download to a temp sibling, then rename, so an interrupted download
        // never leaves a truncated model that future runs would treat as complete.
        let tmp = path.with_extension("bin.partial");
        let resp = ureq::get(&url)
            .call()
            .with_context(|| format!("requesting model from {url}"))?;
        let mut reader = resp.into_reader();
        let mut bytes = Vec::new();
        reader
            .read_to_end(&mut bytes)
            .context("reading model download body")?;
        // Guard a truncated/HTML-error download (a real ggml model is tens of MB).
        if (bytes.len() as u64) < self.approx_mb().saturating_mul(1_000_000) / 2 {
            bail!(
                "model download from {url} was only {} bytes — expected ~{} MB",
                bytes.len(),
                self.approx_mb()
            );
        }
        std::fs::write(&tmp, &bytes)
            .with_context(|| format!("writing model to '{}'", tmp.display()))?;
        std::fs::rename(&tmp, &path)
            .with_context(|| format!("finalizing model at '{}'", path.display()))?;
        eprintln!("onda-transcribe: model ready ({} bytes).", bytes.len());
        Ok(path)
    }
}

/// The user's home directory, without pulling in a crate for it.
fn home_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .filter(|h| !h.is_empty())
        .map(PathBuf::from)
}

/// Resolve the model file to load, honoring (in order): an explicit `model_path`,
/// the `ONDA_WHISPER_MODEL` env override, then the `model` enum (downloading the
/// enum's weights on first use). An explicit path / the env var is used as-is and
/// is NEVER downloaded — it must exist.
pub fn resolve_model_path(
    model_path: Option<&std::path::Path>,
    model: WhisperModel,
) -> Result<PathBuf> {
    if let Some(p) = model_path {
        if !p.exists() {
            bail!("ONDA Whisper model '{}' does not exist", p.display());
        }
        return Ok(p.to_path_buf());
    }
    if let Some(env) = std::env::var_os("ONDA_WHISPER_MODEL") {
        let p = PathBuf::from(env);
        if !p.exists() {
            bail!(
                "ONDA_WHISPER_MODEL points at '{}', which does not exist",
                p.display()
            );
        }
        return Ok(p);
    }
    model.ensure()
}
