//! Deterministic per-frame audio spectrum for visualizers.
//!
//! Turns decoded PCM ([`AudioBuffer`]) into N frequency bands per video frame, in
//! `[0, 1]` (low → high): a Hann-windowed real FFT, log-frequency banding, and dB
//! normalization, then a SYMMETRIC temporal blend so each frame's value is a pure
//! function of the frame index — safe for ONDA's parallel / out-of-order GPU
//! render. Because this runs in Rust, the browser preview (wasm) and `onda export`
//! (native) compute IDENTICAL spectra from the same bytes.

use rustfft::num_complex::Complex;
use rustfft::FftPlanner;

use crate::AudioBuffer;

/// Knobs for [`spectrogram`]. Defaults give a musical-looking spectrum.
#[derive(Debug, Clone)]
pub struct SpectrumOpts {
    /// Number of output bands (bars).
    pub bands: usize,
    /// FFT window size in samples (power of two). Larger = finer low-freq detail.
    pub fft_size: usize,
    /// Lowest banded frequency (Hz).
    pub min_hz: f32,
    /// Highest banded frequency (Hz); capped to Nyquist.
    pub max_hz: f32,
    /// dB level mapped to 0.
    pub min_db: f32,
    /// dB level mapped to 1.
    pub max_db: f32,
    /// Temporal smoothing half-width in frames (triangular kernel over
    /// `f-smoothing ..= f+smoothing`). 0 disables. Symmetric ⇒ pure fn of frame.
    pub smoothing: usize,
}

impl Default for SpectrumOpts {
    fn default() -> Self {
        SpectrumOpts {
            bands: 64,
            fft_size: 2048,
            min_hz: 30.0,
            max_hz: 16_000.0,
            min_db: -90.0,
            max_db: -10.0,
            smoothing: 2,
        }
    }
}

/// Per-frame spectrum bands, flat and frame-major (`frame_count * opts.bands`),
/// each in `[0, 1]`, low→high. `fps` maps frame index → time (window centre).
pub fn spectrogram(
    buffer: &AudioBuffer,
    fps: f32,
    frame_count: usize,
    opts: &SpectrumOpts,
) -> Vec<f32> {
    let bands = opts.bands.max(1);
    let n = opts.fft_size.max(2);
    if frame_count == 0 || buffer.sample_rate == 0 {
        return vec![0.0; frame_count * bands];
    }
    let mono = downmix_mono(buffer);
    let sr = buffer.sample_rate as f32;
    let nyquist = sr / 2.0;
    let edges = band_edges(opts.min_hz, opts.max_hz.min(nyquist), bands);
    let win = hann(n);
    let win_sum: f32 = win.iter().sum::<f32>().max(1.0);
    let bin_hz = sr / n as f32;
    let half_bins = n / 2;

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(n);
    let mut buf = vec![Complex { re: 0.0, im: 0.0 }; n];

    let mut raw = vec![0.0f32; frame_count * bands];
    let half = n as isize / 2;
    let fps = fps.max(1.0);
    for f in 0..frame_count {
        let center = ((f as f32 / fps) * sr).round() as isize;
        let start = center - half;
        // Window the mono samples (zero-padded at the edges) into the FFT buffer.
        for (i, slot) in buf.iter_mut().enumerate() {
            let idx = start + i as isize;
            let s = if idx >= 0 && (idx as usize) < mono.len() {
                mono[idx as usize]
            } else {
                0.0
            };
            *slot = Complex {
                re: s * win[i],
                im: 0.0,
            };
        }
        fft.process(&mut buf);

        let band_slice = &mut raw[f * bands..(f + 1) * bands];
        for (b, slot) in band_slice.iter_mut().enumerate() {
            let lo = edges[b];
            let hi = edges[b + 1];
            // Average the magnitudes of the FFT bins whose centre falls in the band
            // (skip DC at k=0). Amplitude-normalize by the window's coherent gain.
            let k_lo = ((lo / bin_hz).floor().max(1.0) as usize).min(half_bins.saturating_sub(1));
            let k_hi = ((hi / bin_hz).ceil() as usize).min(half_bins.saturating_sub(1));
            let mag = if k_hi >= k_lo {
                let sum: f32 = buf[k_lo..=k_hi].iter().map(|c| c.norm() * 2.0 / win_sum).sum();
                sum / (k_hi - k_lo + 1) as f32
            } else {
                // Band narrower than the bin spacing → use the nearest bin.
                let k = (((lo + hi) * 0.5 / bin_hz).round().max(1.0) as usize)
                    .min(half_bins.saturating_sub(1));
                buf[k].norm() * 2.0 / win_sum
            };
            let db = 20.0 * (mag + 1e-9).log10();
            *slot = ((db - opts.min_db) / (opts.max_db - opts.min_db)).clamp(0.0, 1.0);
        }
    }

    if opts.smoothing > 0 {
        temporal_smooth(&raw, frame_count, bands, opts.smoothing)
    } else {
        raw
    }
}

/// Single-frame bands (no temporal smoothing) — convenience for tests / one-offs.
pub fn frame_bands(buffer: &AudioBuffer, frame: usize, fps: f32, opts: &SpectrumOpts) -> Vec<f32> {
    let mut o = opts.clone();
    o.smoothing = 0;
    let s = spectrogram(buffer, fps, frame + 1, &o);
    let bands = opts.bands.max(1);
    s[frame * bands..(frame + 1) * bands].to_vec()
}

/// Hann window of length `n` (periodic-ish; `0.5 - 0.5·cos(2πi/(n-1))`).
fn hann(n: usize) -> Vec<f32> {
    if n <= 1 {
        return vec![1.0; n];
    }
    (0..n)
        .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (n as f32 - 1.0)).cos())
        .collect()
}

/// Geometric (log) band edges from `min_hz` to `max_hz`: `bands + 1` values.
fn band_edges(min_hz: f32, max_hz: f32, bands: usize) -> Vec<f32> {
    let lo = min_hz.max(1.0);
    let hi = max_hz.max(lo * 1.001);
    let ratio = (hi / lo).powf(1.0 / bands as f32);
    (0..=bands).map(|i| lo * ratio.powi(i as i32)).collect()
}

/// Downmix an interleaved buffer to mono f32.
fn downmix_mono(buffer: &AudioBuffer) -> Vec<f32> {
    let ch = buffer.channels.max(1) as usize;
    if ch == 1 {
        return buffer.samples.clone();
    }
    let frames = buffer.samples.len() / ch;
    let mut mono = Vec::with_capacity(frames);
    for f in 0..frames {
        let sum: f32 = (0..ch).map(|c| buffer.samples[f * ch + c]).sum();
        mono.push(sum / ch as f32);
    }
    mono
}

/// Symmetric triangular temporal blend (a pure function of the frame index, so it
/// stays valid under ONDA's out-of-order / parallel frame rendering).
fn temporal_smooth(raw: &[f32], frames: usize, bands: usize, half: usize) -> Vec<f32> {
    let mut out = vec![0.0f32; raw.len()];
    let h = half as isize;
    for f in 0..frames {
        for b in 0..bands {
            let mut sum = 0.0;
            let mut wsum = 0.0;
            for d in -h..=h {
                let ff = f as isize + d;
                if ff < 0 || ff as usize >= frames {
                    continue;
                }
                let w = half as f32 + 1.0 - d.unsigned_abs() as f32; // triangular peak at d=0
                sum += raw[ff as usize * bands + b] * w;
                wsum += w;
            }
            out[f * bands + b] = if wsum > 0.0 {
                sum / wsum
            } else {
                raw[f * bands + b]
            };
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A mono sine of `freq` Hz, `secs` long, at `rate`.
    fn sine(freq: f32, secs: f32, rate: u32) -> AudioBuffer {
        let n = (secs * rate as f32) as usize;
        let samples = (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / rate as f32).sin())
            .collect();
        AudioBuffer {
            sample_rate: rate,
            channels: 1,
            samples,
        }
    }

    #[test]
    fn sine_peaks_in_the_band_containing_its_frequency() {
        let buf = sine(1000.0, 1.0, 48_000);
        let opts = SpectrumOpts::default();
        let bands = frame_bands(&buf, 15, 30.0, &opts); // a frame well inside the signal
                                                        // The loudest band must span 1000 Hz.
        let edges = band_edges(opts.min_hz, opts.max_hz.min(24_000.0), opts.bands);
        let peak = bands
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
            .unwrap()
            .0;
        assert!(
            edges[peak] <= 1000.0 && 1000.0 <= edges[peak + 1],
            "peak band {peak} spans [{}, {}], expected to contain 1000 Hz",
            edges[peak],
            edges[peak + 1]
        );
        // And the peak should be loud (near the top of the [0,1] range).
        assert!(bands[peak] > 0.7, "peak band value {} too low", bands[peak]);
    }

    #[test]
    fn is_deterministic_and_frame_indexable() {
        let buf = sine(440.0, 1.0, 44_100);
        let opts = SpectrumOpts::default();
        let a = spectrogram(&buf, 30.0, 20, &opts);
        let b = spectrogram(&buf, 30.0, 20, &opts);
        assert_eq!(a, b, "same input must yield identical spectra");
        assert_eq!(a.len(), 20 * opts.bands);
        // Reading frame 10 out of the full spectrogram matches recomputing a longer
        // one and indexing frame 10 (temporal smoothing is a pure fn of frame).
        let longer = spectrogram(&buf, 30.0, 40, &opts);
        let f10_a = &a[10 * opts.bands..11 * opts.bands];
        let f10_b = &longer[10 * opts.bands..11 * opts.bands];
        assert_eq!(f10_a, f10_b);
    }

    #[test]
    fn silence_is_all_zero() {
        let buf = AudioBuffer {
            sample_rate: 48_000,
            channels: 2,
            samples: vec![0.0; 48_000 * 2],
        };
        let s = spectrogram(&buf, 30.0, 10, &SpectrumOpts::default());
        assert!(s.iter().all(|&v| v == 0.0), "silence should map to 0");
    }
}
