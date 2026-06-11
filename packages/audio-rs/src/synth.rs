//! Generative AUDIO SYNTHESIS — the audio analogue of the scene graph.
//!
//! A declarative [`AudioGraph`] of layered, time-placed [`Voice`]s renders to an
//! [`AudioBuffer`]: oscillators / chords / seeded noise, shaped by an [`Envelope`] and an
//! optional biquad [`Filter`] + [`Tremolo`], summed with an optional [`Reverb`]. Pure Rust
//! and DETERMINISTIC (seeded noise), so it runs identically in the browser (wasm) and the
//! native export — the same contract as the spectrum/beat analysis. The agent composes a
//! score from these primitives instead of hand-writing sample loops; the whole graph is
//! `serde` data, so it travels as JSON just like a composition.

use serde::{Deserialize, Serialize};

use crate::AudioBuffer;

const TAU: f32 = std::f32::consts::TAU;

/// Oscillator waveform.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Wave {
    Sine,
    Saw,
    Square,
    Triangle,
}

/// What generates a voice's raw signal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Source {
    /// One oscillator at `freq` Hz, optionally fattened by a detuned copy (`detune`, a
    /// fractional offset like `0.004`) and `harmonics` extra overtones (each ~½ the last).
    Osc {
        wave: Wave,
        freq: f32,
        #[serde(default)]
        detune: f32,
        #[serde(default)]
        harmonics: u8,
    },
    /// A stack of oscillators (a chord), each fattened the same way — for pads.
    Chord {
        wave: Wave,
        freqs: Vec<f32>,
        #[serde(default)]
        detune: f32,
        #[serde(default)]
        harmonics: u8,
    },
    /// White noise (seeded → deterministic) — for risers, whooshes, air.
    Noise,
}

/// Amplitude shape over a voice's life.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Envelope {
    /// Linear breakpoints `[time_s, level]` (held at the last) — arbitrary swells/fades.
    Points { points: Vec<[f32; 2]> },
    /// Attack / Decay / Sustain / Release (seconds; `s` is the sustain level 0..1). The
    /// release ends at the voice's end.
    Adsr { a: f32, d: f32, s: f32, r: f32 },
    /// Fast attack then exponential decay with time-constant `tau` — bells, kicks, impacts.
    ExpDecay { attack: f32, tau: f32 },
}

/// Biquad filter type.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FilterKind {
    Lowpass,
    Highpass,
    Bandpass,
}

/// A resonant biquad applied to a voice (shape noise into a whoosh, tame a saw, …).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Filter {
    pub kind: FilterKind,
    pub cutoff: f32,
    #[serde(default = "default_q")]
    pub q: f32,
}
fn default_q() -> f32 {
    0.707
}

/// Slow amplitude modulation — a pad that "breathes", a tremolo.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Tremolo {
    pub rate: f32,
    pub depth: f32,
}

/// One layered, time-placed synth voice.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Voice {
    /// Start time (seconds).
    pub start: f32,
    /// Length (seconds).
    pub duration: f32,
    #[serde(default = "default_gain")]
    pub gain: f32,
    pub source: Source,
    pub env: Envelope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<Filter>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tremolo: Option<Tremolo>,
    /// Seed for `Noise` voices (so two differ). Ignored by oscillators.
    #[serde(default)]
    pub seed: u32,
}
fn default_gain() -> f32 {
    1.0
}

/// A simple room reverb (Schroeder combs + allpasses).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Reverb {
    /// Tail size 0..1.
    #[serde(default = "default_room")]
    pub room: f32,
    /// Wet/dry mix 0..1.
    pub wet: f32,
}
fn default_room() -> f32 {
    0.7
}

/// A full synthesized audio composition — the audio scene graph.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AudioGraph {
    pub duration: f32,
    #[serde(default = "default_sr")]
    pub sample_rate: u32,
    pub voices: Vec<Voice>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reverb: Option<Reverb>,
    /// Peak-normalize the final mix to this linear level (e.g. `0.86`). `0` disables it.
    #[serde(default = "default_norm")]
    pub normalize: f32,
}
fn default_sr() -> u32 {
    44_100
}
fn default_norm() -> f32 {
    0.86
}

/// Render an [`AudioGraph`] to a mono [`AudioBuffer`].
pub fn synthesize(graph: &AudioGraph) -> AudioBuffer {
    let sr = graph.sample_rate.max(8000);
    let n = (graph.duration.max(0.0) * sr as f32).ceil() as usize;
    let mut out = vec![0.0f32; n];
    for v in &graph.voices {
        render_voice(v, sr, &mut out);
    }
    if let Some(rev) = graph.reverb {
        apply_reverb(&mut out, sr, rev);
    }
    if graph.normalize > 0.0 {
        normalize(&mut out, graph.normalize);
    }
    AudioBuffer {
        sample_rate: sr,
        channels: 1,
        samples: out,
    }
}

/// Deterministic LCG noise in `[-1, 1]`.
struct Lcg(u32);
impl Lcg {
    fn new(seed: u32) -> Self {
        Lcg(seed.wrapping_mul(2_654_435_761).wrapping_add(1))
    }
    fn next(&mut self) -> f32 {
        self.0 = self.0.wrapping_mul(1_103_515_245).wrapping_add(12_345);
        ((self.0 >> 8) as f32 / 16_777_215.0) * 2.0 - 1.0
    }
}

fn osc(wave: Wave, freq: f32, t: f32) -> f32 {
    match wave {
        Wave::Sine => (TAU * freq * t).sin(),
        Wave::Saw => 2.0 * (freq * t).fract() - 1.0,
        Wave::Square => {
            if (freq * t).fract() < 0.5 {
                1.0
            } else {
                -1.0
            }
        }
        Wave::Triangle => 4.0 * ((freq * t).fract() - 0.5).abs() - 1.0,
    }
}

/// One oscillator fattened by a detuned copy + `harmonics` overtones.
fn voiced(wave: Wave, freq: f32, detune: f32, harmonics: u8, t: f32) -> f32 {
    let mut s = osc(wave, freq, t);
    if detune > 0.0 {
        s = 0.6 * s + 0.6 * osc(wave, freq * (1.0 + detune), t);
    }
    let mut amp = 1.0;
    for h in 0..harmonics {
        amp *= 0.5;
        s += amp * osc(wave, freq * (h as f32 + 2.0), t);
    }
    s
}

fn source_sample(src: &Source, t: f32, rng: &mut Lcg) -> f32 {
    match src {
        Source::Osc {
            wave,
            freq,
            detune,
            harmonics,
        } => voiced(*wave, *freq, *detune, *harmonics, t),
        Source::Chord {
            wave,
            freqs,
            detune,
            harmonics,
        } => {
            if freqs.is_empty() {
                return 0.0;
            }
            freqs
                .iter()
                .map(|f| voiced(*wave, *f, *detune, *harmonics, t))
                .sum::<f32>()
                / freqs.len() as f32
        }
        Source::Noise => rng.next(),
    }
}

fn eval_env(env: &Envelope, t: f32, dur: f32) -> f32 {
    match env {
        Envelope::Points { points } => {
            if points.is_empty() {
                return 1.0;
            }
            if t <= points[0][0] {
                return points[0][1];
            }
            for w in points.windows(2) {
                let (a, b) = (w[0], w[1]);
                if t <= b[0] {
                    let k = if b[0] > a[0] {
                        (t - a[0]) / (b[0] - a[0])
                    } else {
                        0.0
                    };
                    return a[1] + (b[1] - a[1]) * k;
                }
            }
            points[points.len() - 1][1]
        }
        Envelope::Adsr { a, d, s, r } => {
            let rel = (dur - r).max(0.0);
            if t < *a {
                t / a.max(1e-4)
            } else if t < a + d {
                1.0 + (s - 1.0) * (t - a) / d.max(1e-4)
            } else if t < rel {
                *s
            } else {
                (s * (1.0 - (t - rel) / r.max(1e-4))).max(0.0)
            }
        }
        Envelope::ExpDecay { attack, tau } => {
            if t < *attack {
                t / attack.max(1e-4)
            } else {
                (-(t - attack) / tau.max(1e-4)).exp()
            }
        }
    }
}

fn render_voice(v: &Voice, sr: u32, out: &mut [f32]) {
    let n = out.len();
    let start = (v.start.max(0.0) * sr as f32) as usize;
    let dur_n = (v.duration.max(0.0) * sr as f32) as usize;
    let mut rng = Lcg::new(v.seed.wrapping_add(0x9E37_79B9));
    let mut biq = v.filter.map(|f| Biquad::new(f, sr));
    for i in 0..dur_n {
        let idx = start + i;
        if idx >= n {
            break;
        }
        let t = i as f32 / sr as f32;
        let mut s =
            source_sample(&v.source, t, &mut rng) * eval_env(&v.env, t, v.duration) * v.gain;
        if let Some(tr) = v.tremolo {
            s *= 1.0 - tr.depth + tr.depth * (0.5 + 0.5 * (TAU * tr.rate * t).sin());
        }
        if let Some(b) = biq.as_mut() {
            s = b.process(s);
        }
        out[idx] += s;
    }
}

/// RBJ-cookbook biquad.
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}
impl Biquad {
    fn new(f: Filter, sr: u32) -> Self {
        let w0 = TAU * (f.cutoff / sr as f32).clamp(1e-4, 0.49);
        let (sn, cs) = w0.sin_cos();
        let alpha = sn / (2.0 * f.q.max(0.05));
        let (b0, b1, b2, a0, a1, a2) = match f.kind {
            FilterKind::Lowpass => {
                let k = 1.0 - cs;
                (k * 0.5, k, k * 0.5, 1.0 + alpha, -2.0 * cs, 1.0 - alpha)
            }
            FilterKind::Highpass => {
                let k = 1.0 + cs;
                (k * 0.5, -k, k * 0.5, 1.0 + alpha, -2.0 * cs, 1.0 - alpha)
            }
            FilterKind::Bandpass => (alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * cs, 1.0 - alpha),
        };
        Biquad {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }
    fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        y
    }
}

/// A small Schroeder reverb: 4 parallel damped combs → 2 series allpasses, wet/dry mixed.
fn apply_reverb(buf: &mut [f32], sr: u32, rev: Reverb) {
    let scale = sr as f32 / 44_100.0;
    let comb_lens = [1116usize, 1188, 1277, 1356];
    let ap_lens = [556usize, 441];
    let feedback = 0.70 + 0.28 * rev.room.clamp(0.0, 1.0);
    let damp = 0.2;
    let wet = rev.wet.clamp(0.0, 1.0);
    let mut combs: Vec<(Vec<f32>, usize, f32)> = comb_lens
        .iter()
        .map(|&l| (vec![0.0; ((l as f32 * scale) as usize).max(1)], 0, 0.0))
        .collect();
    let mut aps: Vec<(Vec<f32>, usize)> = ap_lens
        .iter()
        .map(|&l| (vec![0.0; ((l as f32 * scale) as usize).max(1)], 0))
        .collect();
    for x in buf.iter_mut() {
        let input = *x;
        let mut acc = 0.0;
        for (line, idx, store) in combs.iter_mut() {
            let y = line[*idx];
            *store = y * (1.0 - damp) + *store * damp;
            line[*idx] = input + *store * feedback;
            *idx = (*idx + 1) % line.len();
            acc += y;
        }
        acc /= combs.len() as f32;
        for (line, idx) in aps.iter_mut() {
            let bufout = line[*idx];
            let y = -acc + bufout;
            line[*idx] = acc + bufout * 0.5;
            *idx = (*idx + 1) % line.len();
            acc = y;
        }
        *x = input * (1.0 - wet) + acc * wet;
    }
}

fn normalize(buf: &mut [f32], peak: f32) {
    let pk = buf.iter().fold(0.0f32, |m, &s| m.max(s.abs()));
    if pk > 1e-6 {
        let g = peak / pk;
        for s in buf.iter_mut() {
            *s *= g;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synthesizes_a_chord_pad() {
        let g = AudioGraph {
            duration: 1.0,
            sample_rate: 44_100,
            voices: vec![Voice {
                start: 0.0,
                duration: 1.0,
                gain: 1.0,
                source: Source::Chord {
                    wave: Wave::Sine,
                    freqs: vec![220.0, 277.18, 329.63],
                    detune: 0.004,
                    harmonics: 1,
                },
                env: Envelope::Points {
                    points: vec![[0.0, 0.0], [0.2, 1.0], [0.8, 1.0], [1.0, 0.0]],
                },
                filter: None,
                tremolo: Some(Tremolo {
                    rate: 4.0,
                    depth: 0.1,
                }),
                seed: 0,
            }],
            reverb: Some(Reverb {
                room: 0.7,
                wet: 0.25,
            }),
            normalize: 0.86,
        };
        let buf = synthesize(&g);
        assert_eq!(buf.sample_rate, 44_100);
        assert_eq!(buf.samples.len(), 44_100);
        let pk = buf.samples.iter().fold(0.0f32, |m, &s| m.max(s.abs()));
        assert!((pk - 0.86).abs() < 0.02, "normalized to ~0.86, got {pk}");
    }

    #[test]
    fn deterministic_noise() {
        let mk = || AudioGraph {
            duration: 0.1,
            sample_rate: 44_100,
            voices: vec![Voice {
                start: 0.0,
                duration: 0.1,
                gain: 1.0,
                source: Source::Noise,
                env: Envelope::ExpDecay {
                    attack: 0.001,
                    tau: 0.05,
                },
                filter: None,
                tremolo: None,
                seed: 7,
            }],
            reverb: None,
            normalize: 0.0,
        };
        assert_eq!(synthesize(&mk()).samples, synthesize(&mk()).samples);
    }
}
