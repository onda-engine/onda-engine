//! Native text-to-speech (AI voiceover) — turn a script into natural narration.
//!
//! The engine half of ONDA Studio voiceover. Given a line of text, [`synthesize`]
//! runs **Kokoro-82M** (an Apache-2.0, 82M-param TTS model) through ONNX Runtime
//! and returns 24 kHz mono f32 audio — clean spoken narration, ~4–5× realtime on
//! CPU.
//!
//! The pipeline mirrors the validated `kokoro-onnx` Python package exactly:
//! text → espeak-ng IPA phonemes (`with_stress`, `preserve_punctuation`) → filter
//! to Kokoro's 114-symbol vocab → token ids → ONNX `{tokens, style, speed}` →
//! float32 waveform. The voice catalog ([`voices`]) is curated for the Studio to
//! RECOMMEND from.
//!
//! The two model assets (`kokoro-v1.0.onnx` ~325 MB, `voices-v1.0.bin` ~28 MB) are
//! downloaded once to `~/.onda/models/` (mirroring onda-segment / onda-transcribe);
//! `ONDA_KOKORO_MODEL` / `ONDA_KOKORO_VOICES` override the paths (dev reuses
//! `/tmp` copies). See [`model`].
//!
//! NATIVE-ONLY: this crate pulls in `ort`/onnxruntime AND compiles espeak-ng from
//! bundled C source (cmake) — neither targets wasm32. It is pulled in only behind
//! onda-cli's `speak` feature.

mod model;
mod phonemes;
mod voices;

use std::path::Path;
use std::time::Instant;

use anyhow::{bail, Context, Result};
use ort::session::Session;
use ort::value::Tensor;

pub use voices::VoiceInfo;

/// Kokoro's output sample rate (Hz). Always 24 kHz mono.
pub const SAMPLE_RATE: u32 = 24_000;
/// The default voice when none is given — a warm US-English female narrator.
pub const DEFAULT_VOICE: &str = "af_heart";

/// Options for [`synthesize`].
#[derive(Debug, Clone)]
pub struct SpeakOptions<'a> {
    /// The voice id (e.g. `af_heart`, `am_michael`, `bf_emma`). See [`voices`].
    /// Defaults to [`DEFAULT_VOICE`].
    pub voice: &'a str,
    /// Speech rate multiplier. 1.0 is natural; >1 faster, <1 slower. Clamped to a
    /// sane range so a bad value can't produce garbage.
    pub speed: f32,
    /// An explicit ONNX model file (highest priority; never downloaded).
    pub model_path: Option<&'a Path>,
    /// An explicit voices `.npz` file (highest priority; never downloaded).
    pub voices_path: Option<&'a Path>,
}

impl Default for SpeakOptions<'_> {
    fn default() -> Self {
        SpeakOptions {
            voice: DEFAULT_VOICE,
            speed: 1.0,
            model_path: None,
            voices_path: None,
        }
    }
}

/// Synthesized speech: 24 kHz mono f32 samples in roughly `[-1, 1]`.
#[derive(Debug, Clone)]
pub struct Wav {
    /// The mono PCM samples.
    pub samples: Vec<f32>,
    /// Sample rate in Hz (always [`SAMPLE_RATE`]).
    pub sample_rate: u32,
}

impl Wav {
    /// Duration of the clip in seconds.
    pub fn duration_secs(&self) -> f32 {
        self.samples.len() as f32 / self.sample_rate.max(1) as f32
    }

    /// Root-mean-square energy of the samples — a cheap "is this real audio, not
    /// silence?" measure (silence ≈ 0; speech is typically ~0.02–0.2).
    pub fn rms(&self) -> f32 {
        if self.samples.is_empty() {
            return 0.0;
        }
        let sum_sq: f64 = self.samples.iter().map(|&s| (s as f64) * (s as f64)).sum();
        (sum_sq / self.samples.len() as f64).sqrt() as f32
    }

    /// Write the clip as a 24 kHz mono 16-bit PCM WAV. The de-facto interchange
    /// format the rest of the tree (ffmpeg, the muxer) reads.
    pub fn write_wav(&self, path: &Path) -> Result<()> {
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: self.sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(path, spec)
            .with_context(|| format!("creating WAV '{}'", path.display()))?;
        for &s in &self.samples {
            // Clamp to [-1, 1] then scale to i16 — the model occasionally exceeds
            // unit range slightly; clipping is the standard handling.
            let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
            writer.write_sample(v).context("writing a WAV sample")?;
        }
        writer.finalize().context("finalizing the WAV")?;
        Ok(())
    }
}

/// The curated voice catalog: every voice id with a short human label (gender,
/// accent, character) for the Studio to RECOMMEND from. English voices first.
pub fn voices() -> Vec<VoiceInfo> {
    voices::CATALOG.to_vec()
}

/// Synthesize `text` to speech with the given [`SpeakOptions`].
///
/// Resolves the model + voices (explicit path → env override → `~/.onda/models/`
/// cache, downloading on first use), phonemizes via espeak-ng, and runs Kokoro.
pub fn synthesize(text: &str, opts: &SpeakOptions) -> Result<Wav> {
    let text = text.trim();
    if text.is_empty() {
        bail!("nothing to speak (empty text)");
    }
    // Validate the voice up front for a friendly error (and to pick en-us/en-gb).
    if voices::voice_info(opts.voice).is_none() {
        let ids: Vec<&str> = voices::CATALOG.iter().map(|v| v.id).collect();
        bail!(
            "unknown voice '{}'. Known voices: {} (or run `onda speak --list-voices`)",
            opts.voice,
            ids.join(", ")
        );
    }
    // Sane speed clamp: the model is robust in ~0.5..2.0; outside that it degrades.
    let speed = opts.speed.clamp(0.5, 2.0);

    // Phonemize → tokens. UK voices (bf_/bm_) use espeak en-gb; the rest en-us.
    let uk = voices::is_uk(opts.voice);
    let (phoneme_str, mut tokens) =
        phonemes::text_to_tokens(text, uk).with_context(|| format!("phonemizing '{text}'"))?;

    // Kokoro's context is MAX_PHONEME_LENGTH tokens (excluding the two pad tokens).
    if tokens.len() > voices::MAX_PHONEME_LENGTH {
        eprintln!(
            "onda-tts: script is long ({} tokens); truncating to {} (split long scripts into lines for full coverage)",
            tokens.len(),
            voices::MAX_PHONEME_LENGTH
        );
        tokens.truncate(voices::MAX_PHONEME_LENGTH);
    }
    let n_tokens = tokens.len();

    // The style row is indexed by the token count BEFORE the pad tokens are added
    // (matching the reference `voice[len(tokens)]`).
    let voices_file =
        model::resolve_voices_path(opts.voices_path).context("resolving the Kokoro voices file")?;
    let voice_styles = voices::load_voice(&voices_file, opts.voice)?;
    let style = voice_styles.style_for_len(n_tokens);

    // The model input is the tokens bracketed by the pad token 0.
    let mut padded: Vec<i64> = Vec::with_capacity(n_tokens + 2);
    padded.push(0);
    padded.extend_from_slice(&tokens);
    padded.push(0);

    let model_file =
        model::resolve_model_path(opts.model_path).context("resolving the Kokoro ONNX model")?;
    let mut session = Session::builder()
        .context("creating an ONNX Runtime session builder")?
        .commit_from_file(&model_file)
        .with_context(|| format!("loading the Kokoro model '{}'", model_file.display()))?;

    // Discover the input names this export uses. The v1.0 onnx ONDA ships uses
    // `tokens`/`style`/`speed`; newer exports rename `tokens`→`input_ids` and make
    // `speed` int32. Support both so a re-exported model still works.
    let input_names: Vec<String> = session.inputs.iter().map(|i| i.name.clone()).collect();
    let uses_input_ids = input_names.iter().any(|n| n == "input_ids");
    let tokens_name = if uses_input_ids {
        "input_ids"
    } else {
        "tokens"
    };

    let tokens_tensor = Tensor::from_array(([1usize, padded.len()], padded))
        .context("building the tokens tensor")?;
    let style_tensor = Tensor::from_array(([1usize, voices::STYLE_DIM], style.to_vec()))
        .context("building the style tensor")?;

    let start = Instant::now();
    // `speed` is float32 in the v1.0 export; the input_ids export wants int32.
    let outputs = if uses_input_ids {
        let speed_tensor = Tensor::from_array(([1usize], vec![speed.round() as i32]))
            .context("building the speed tensor")?;
        session
            .run(ort::inputs![
                tokens_name => tokens_tensor,
                "style" => style_tensor,
                "speed" => speed_tensor,
            ])
            .context("running Kokoro inference")?
    } else {
        let speed_tensor =
            Tensor::from_array(([1usize], vec![speed])).context("building the speed tensor")?;
        session
            .run(ort::inputs![
                tokens_name => tokens_tensor,
                "style" => style_tensor,
                "speed" => speed_tensor,
            ])
            .context("running Kokoro inference")?
    };
    let infer = start.elapsed();

    // Output 0 is the waveform (`audio`), float32 @ 24 kHz.
    let (_, data) = outputs[0]
        .try_extract_tensor::<f32>()
        .context("extracting the audio waveform (output 0)")?;
    let samples = data.to_vec();
    if samples.is_empty() {
        bail!("Kokoro produced no audio samples for '{text}'");
    }

    let wav = Wav {
        samples,
        sample_rate: SAMPLE_RATE,
    };

    // A loud-enough RMS guard: a real narration is ~0.02+; near-zero means the
    // model emitted silence/noise (a sign of a bad voice/style/token mismatch).
    let rms = wav.rms();
    if rms < 0.005 {
        bail!(
            "Kokoro produced near-silent audio (RMS {rms:.5}) for '{text}' — phonemes were '{phoneme_str}'"
        );
    }

    let dur = wav.duration_secs();
    let rtf = if dur > 0.0 {
        infer.as_secs_f32() / dur
    } else {
        0.0
    };
    eprintln!(
        "onda-tts: \"{}\" → {:.2}s @ {} Hz, voice {}, {} tokens (infer {:.2}s, {:.1}× realtime, RMS {:.3})",
        truncate(text, 48),
        dur,
        SAMPLE_RATE,
        opts.voice,
        n_tokens,
        infer.as_secs_f32(),
        if rtf > 0.0 { 1.0 / rtf } else { 0.0 },
        rms,
    );

    Ok(wav)
}

/// Truncate a string to `n` chars for the log line (no panic on multibyte).
fn truncate(s: &str, n: usize) -> String {
    if s.chars().count() <= n {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(n).collect();
        out.push('…');
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// The dev-cached model/voices paths (reuse the pre-downloaded `/tmp` copies if
    /// present, else the `~/.onda/models/` cache). `None` if neither exists, so the
    /// model-dependent test self-skips (like onda-transcribe's golden test).
    fn dev_assets() -> Option<(PathBuf, PathBuf)> {
        let model_candidates = [
            std::env::var_os("ONDA_KOKORO_MODEL").map(PathBuf::from),
            Some(PathBuf::from("/tmp/kokoro-v1.0.onnx")),
            std::env::var_os("HOME")
                .map(|h| PathBuf::from(h).join(".onda/models/kokoro-v1.0.onnx")),
        ];
        let voices_candidates = [
            std::env::var_os("ONDA_KOKORO_VOICES").map(PathBuf::from),
            Some(PathBuf::from("/tmp/voices-v1.0.bin")),
            std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".onda/models/voices-v1.0.bin")),
        ];
        let model = model_candidates
            .into_iter()
            .flatten()
            .find(|p| p.exists())?;
        let voices = voices_candidates
            .into_iter()
            .flatten()
            .find(|p| p.exists())?;
        Some((model, voices))
    }

    #[test]
    fn catalog_is_well_formed() {
        let v = voices();
        assert!(!v.is_empty());
        // The default voice is in the catalog and is English.
        let def = v
            .iter()
            .find(|x| x.id == DEFAULT_VOICE)
            .expect("default voice present");
        assert!(def.english, "default voice should be an English voice");
        // No duplicate ids.
        let mut ids: Vec<&str> = v.iter().map(|x| x.id).collect();
        ids.sort();
        let n = ids.len();
        ids.dedup();
        assert_eq!(ids.len(), n, "duplicate voice ids in the catalog");
    }

    /// End-to-end: synthesize a short line and assert it's real, non-silent audio
    /// at 24 kHz. Skips if the model assets aren't present (so CI without them
    /// stays green), mirroring onda-transcribe's gated golden test.
    #[test]
    fn synthesize_short_line_is_real_audio() {
        let Some((model, voices_file)) = dev_assets() else {
            eprintln!("skipping: Kokoro model/voices not cached (set ONDA_KOKORO_MODEL/VOICES or /tmp copies)");
            return;
        };
        // Pass the dev asset paths explicitly (highest priority — no env/download).
        let opts = SpeakOptions {
            voice: "af_heart",
            speed: 1.0,
            model_path: Some(&model),
            voices_path: Some(&voices_file),
        };
        let wav =
            synthesize("Onda turns a script into a finished video.", &opts).expect("synthesize");

        assert_eq!(wav.sample_rate, SAMPLE_RATE);
        // A ~2s line of speech: non-trivial duration.
        assert!(
            wav.duration_secs() > 0.8,
            "expected > 0.8s, got {:.2}s",
            wav.duration_secs()
        );
        // Real narration, not silence: RMS well above the silence floor.
        assert!(
            wav.rms() > 0.01,
            "expected non-trivial RMS, got {:.5}",
            wav.rms()
        );
    }
}
