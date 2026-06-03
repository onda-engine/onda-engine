//! WebAssembly bindings for ONDA audio analysis.
//!
//! Decode an audio file (mp3/aac/flac/wav/ogg/…) from bytes and compute a
//! per-frame FFT spectrum — the *same* `onda-audio` code the native `onda export`
//! uses, compiled to wasm. So the in-browser preview and the exported video are
//! driven by bit-identical spectra (same decoder, same scalar FFT). Runs in the
//! browser (preview) and under Node (export preload).
//!
//! Empty on non-wasm targets so it never touches the native build.
#![cfg(target_arch = "wasm32")]

use onda_audio::{decode_from_bytes, spectrogram, AudioBuffer, SpectrumOpts};
use wasm_bindgen::prelude::*;

/// A decoded audio clip you can sample a per-frame spectrum from.
#[wasm_bindgen]
pub struct AudioAnalyzer {
    buffer: AudioBuffer,
}

#[wasm_bindgen]
impl AudioAnalyzer {
    /// Decode audio `bytes` (a fetched file / `Uint8Array`). `ext_hint` is the
    /// file extension (`"mp3"`, `"wav"`, …) to aid format detection — `""` is fine
    /// (content probing still runs). Throws if the bytes aren't decodable audio.
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8], ext_hint: &str) -> Result<AudioAnalyzer, JsError> {
        console_error_panic_hook::set_once();
        let buffer =
            decode_from_bytes(bytes, ext_hint).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(AudioAnalyzer { buffer })
    }

    /// Per-frame spectrum: a flat, frame-major `Float32Array` of length
    /// `frame_count * bands`, each value `0..1` (low→high). `fps` maps a frame
    /// index to its time. Deterministic — identical to the native export.
    pub fn spectrogram(&self, fps: f32, frame_count: usize, bands: usize) -> Vec<f32> {
        let opts = SpectrumOpts {
            bands,
            ..SpectrumOpts::default()
        };
        spectrogram(&self.buffer, fps, frame_count, &opts)
    }

    /// Clip duration in seconds.
    pub fn duration_secs(&self) -> f32 {
        self.buffer.duration_secs()
    }

    /// Decoded sample rate (Hz).
    pub fn sample_rate(&self) -> u32 {
        self.buffer.sample_rate
    }
}
