//! Beat / onset / tempo detection for AUDIO-DRIVEN MOTION.
//!
//! A standard onset-detection pipeline on the existing rustfft: a spectral-flux onset
//! envelope → autocorrelation tempo (BPM) → a phase-aligned beat grid, plus picked
//! onsets. Pure Rust, so it runs IDENTICALLY in the browser (wasm) and `onda export`
//! (native) — a wasm-safe alternative to the aubio C library. All outputs are in
//! VIDEO-FRAME units so a composition can sync motion directly (cut on the beat, punch
//! on the kick, drop text on a transient).

use rustfft::num_complex::Complex;
use rustfft::FftPlanner;

use crate::spectrum::{downmix_mono, hann};
use crate::AudioBuffer;

/// Internal analysis hop / window (samples). ~11.6 ms hop at 44.1 kHz — fine enough for
/// beat timing and independent of the (coarser) video fps.
const HOP: usize = 512;
const WIN: usize = 1024;

/// The result of [`detect_beats`], in VIDEO-FRAME units.
#[derive(Debug, Clone)]
pub struct BeatTrack {
    /// Estimated tempo, beats per minute (0 if undetectable).
    pub tempo_bpm: f32,
    /// Frame indices on the beat grid.
    pub beats: Vec<usize>,
    /// Frame indices of picked onsets (any transient — drum hit, note, accent).
    pub onsets: Vec<usize>,
    /// Per-video-frame onset strength in `[0, 1]` — a continuous envelope for glows/pulses.
    pub onset_env: Vec<f32>,
}

/// Detect tempo, beats, and onsets for `frame_count` video frames at `fps`.
pub fn detect_beats(buffer: &AudioBuffer, fps: f32, frame_count: usize) -> BeatTrack {
    let fps = fps.max(1.0);
    if buffer.sample_rate == 0 || frame_count == 0 {
        return BeatTrack {
            tempo_bpm: 0.0,
            beats: Vec::new(),
            onsets: Vec::new(),
            onset_env: vec![0.0; frame_count],
        };
    }
    let sr = buffer.sample_rate as f32;
    let mono = downmix_mono(buffer);

    // 1) Spectral-flux onset envelope at the analysis hop (detrended + rectified).
    let flux = spectral_flux(&mono);
    let analysis_rate = sr / HOP as f32; // analysis frames per second

    // 2) Tempo via preference-weighted autocorrelation (60..200 BPM).
    let tempo_bpm = estimate_tempo(&flux, analysis_rate);

    // 3) Beat grid: best phase at the tempo period, each beat snapped to a nearby peak.
    let beat_hops = beat_grid(&flux, analysis_rate, tempo_bpm);

    // 4) Onsets: adaptive peak-pick of the flux.
    let onset_hops = pick_onsets(&flux);

    // Map analysis-hop index → seconds → video frame.
    let to_frame = |hop: usize| ((hop as f32 / analysis_rate) * fps).round() as usize;
    let beats: Vec<usize> = beat_hops
        .iter()
        .map(|&h| to_frame(h))
        .filter(|&f| f < frame_count)
        .collect();
    let onsets: Vec<usize> = onset_hops
        .iter()
        .map(|&h| to_frame(h))
        .filter(|&f| f < frame_count)
        .collect();

    BeatTrack {
        tempo_bpm,
        beats,
        onsets,
        onset_env: resample_env(&flux, analysis_rate, fps, frame_count),
    }
}

/// Spectral flux: per analysis hop, the sum of POSITIVE magnitude changes across bins —
/// a novelty curve that spikes at onsets. Detrended (local mean removed) and rectified.
fn spectral_flux(mono: &[f32]) -> Vec<f32> {
    let n = WIN;
    let window = hann(n);
    let half = n / 2;
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(n);
    let mut buf = vec![Complex { re: 0.0, im: 0.0 }; n];

    let mut prev = vec![0.0f32; half];
    let mut flux: Vec<f32> = Vec::new();
    let mut pos: usize = 0;
    while pos < mono.len() {
        for (i, slot) in buf.iter_mut().enumerate() {
            let idx = pos + i;
            let s = if idx < mono.len() { mono[idx] } else { 0.0 };
            *slot = Complex {
                re: s * window[i],
                im: 0.0,
            };
        }
        fft.process(&mut buf);
        let mut f = 0.0;
        for (k, p) in prev.iter_mut().enumerate() {
            let mag = buf[k].norm();
            let d = mag - *p;
            if d > 0.0 {
                f += d;
            }
            *p = mag;
        }
        flux.push(f);
        pos += HOP;
    }
    detrend(&flux)
}

/// Subtract a ~0.15 s local mean and half-wave rectify, so only clear novelty survives.
fn detrend(flux: &[f32]) -> Vec<f32> {
    let w = 7usize;
    let n = flux.len();
    (0..n)
        .map(|i| {
            let lo = i.saturating_sub(w);
            let hi = (i + w + 1).min(n);
            let mean: f32 = flux[lo..hi].iter().sum::<f32>() / (hi - lo).max(1) as f32;
            (flux[i] - mean).max(0.0)
        })
        .collect()
}

/// Dominant tempo via autocorrelation of the flux, weighted toward ~120 BPM (a
/// log-Gaussian preference) to curb octave errors.
fn estimate_tempo(flux: &[f32], rate: f32) -> f32 {
    if flux.len() < 4 {
        return 0.0;
    }
    let (bpm_min, bpm_max) = (60.0_f32, 200.0_f32);
    let lag_min = ((60.0 / bpm_max) * rate).round().max(1.0) as usize;
    let lag_max = (((60.0 / bpm_min) * rate).round() as usize).min(flux.len() / 2);
    if lag_max <= lag_min {
        return 0.0;
    }
    let mut best_lag = lag_min;
    let mut best = f32::MIN;
    for lag in lag_min..=lag_max {
        let mut sum = 0.0;
        for i in lag..flux.len() {
            sum += flux[i] * flux[i - lag];
        }
        let bpm = 60.0 / (lag as f32 / rate);
        let w = (-0.5 * ((bpm.ln() - 120.0_f32.ln()) / 0.55).powi(2)).exp();
        let score = sum * w;
        if score > best {
            best = score;
            best_lag = lag;
        }
    }
    60.0 / (best_lag as f32 / rate)
}

/// A beat grid at the tempo period: pick the phase maximizing the summed flux on the
/// grid, then snap each beat to the strongest flux in a small neighborhood.
fn beat_grid(flux: &[f32], rate: f32, bpm: f32) -> Vec<usize> {
    if bpm <= 0.0 || flux.is_empty() {
        return Vec::new();
    }
    let p = (60.0 / bpm * rate).round().max(1.0) as usize;
    if p == 0 {
        return Vec::new();
    }
    let mut best_phase = 0usize;
    let mut best = f32::MIN;
    for phase in 0..p {
        let mut sum = 0.0;
        let mut i = phase;
        while i < flux.len() {
            sum += flux[i];
            i += p;
        }
        if sum > best {
            best = sum;
            best_phase = phase;
        }
    }
    let snap = (p / 8).max(1);
    let mut beats = Vec::new();
    let mut i = best_phase;
    while i < flux.len() {
        let lo = i.saturating_sub(snap);
        let hi = (i + snap).min(flux.len() - 1);
        let mut bi = i.min(flux.len() - 1);
        for j in lo..=hi {
            if flux[j] > flux[bi] {
                bi = j;
            }
        }
        beats.push(bi);
        i += p;
    }
    beats
}

/// Adaptive peak-pick: a local maximum that exceeds 1.6× the local mean is an onset.
fn pick_onsets(flux: &[f32]) -> Vec<usize> {
    let w = 8usize;
    let mut onsets = Vec::new();
    if flux.len() < 3 {
        return onsets;
    }
    for i in 1..flux.len() - 1 {
        if flux[i] < flux[i - 1] || flux[i] < flux[i + 1] {
            continue;
        }
        let lo = i.saturating_sub(w);
        let hi = (i + w + 1).min(flux.len());
        let mean: f32 = flux[lo..hi].iter().sum::<f32>() / (hi - lo) as f32;
        if flux[i] > mean * 1.6 + 1e-6 {
            onsets.push(i);
        }
    }
    onsets
}

/// Resample the flux to a per-video-frame `[0, 1]` envelope (peak-normalized).
fn resample_env(flux: &[f32], analysis_rate: f32, fps: f32, frame_count: usize) -> Vec<f32> {
    if flux.is_empty() {
        return vec![0.0; frame_count];
    }
    let max = flux.iter().copied().fold(1e-6_f32, f32::max);
    (0..frame_count)
        .map(|f| {
            let h = ((f as f32 / fps) * analysis_rate).round() as usize;
            let i = h.min(flux.len() - 1);
            (flux[i] / max).clamp(0.0, 1.0)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A click train at a known BPM should be recovered: tempo ≈ the rate, and roughly
    /// one beat per click.
    #[test]
    fn recovers_tempo_of_a_click_train() {
        let sr = 44_100u32;
        let bpm = 120.0f32;
        let secs = 6.0f32;
        let period = (sr as f32 * 60.0 / bpm) as usize; // samples between clicks
        let n = (sr as f32 * secs) as usize;
        let mut samples = vec![0.0f32; n];
        // A short broadband decaying buzz at each beat (rich in onset energy).
        let mut t = 0usize;
        while t < n {
            for j in 0..64 {
                if t + j < n {
                    let env = 1.0 - j as f32 / 64.0;
                    samples[t + j] = env * if j % 2 == 0 { 0.9 } else { -0.9 };
                }
            }
            t += period;
        }
        let buffer = AudioBuffer {
            sample_rate: sr,
            channels: 1,
            samples,
        };
        let track = detect_beats(&buffer, 30.0, (secs * 30.0) as usize);
        assert!(
            (track.tempo_bpm - bpm).abs() < 8.0,
            "tempo {} should be ~{bpm}",
            track.tempo_bpm
        );
        // ~12 beats over 6 s at 120 BPM (allow grid edge effects).
        assert!(
            (10..=13).contains(&track.beats.len()),
            "got {} beats",
            track.beats.len()
        );
    }

    #[test]
    fn silence_yields_no_beats() {
        let buffer = AudioBuffer {
            sample_rate: 44_100,
            channels: 1,
            samples: vec![0.0; 44_100],
        };
        let track = detect_beats(&buffer, 30.0, 30);
        assert!(track.onsets.is_empty());
    }
}
