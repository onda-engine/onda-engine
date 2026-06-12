//! A punchy 128-BPM track composed THROUGH the engine synth (kick + bass + hats + pad)
//! for a kinetic-typography reel: `cargo run -p onda-audio --example beat_track -- out.wav`.
use onda_audio::{
    synthesize, write_wav, AudioGraph, Envelope, Filter, FilterKind, Reverb, Source, Tremolo,
    Voice, Wave,
};

fn main() {
    let bpm = 128.0_f32;
    let beat = 60.0 / bpm;
    let secs = 6.4_f32;
    let nbeats = (secs / beat) as usize;
    let mut v: Vec<Voice> = Vec::new();

    for i in 0..nbeats {
        let t = i as f32 * beat;
        // kick body — low sine, fast exp decay
        v.push(Voice {
            start: t,
            duration: 0.30,
            gain: 0.95,
            source: Source::Osc {
                wave: Wave::Sine,
                freq: 52.0,
                detune: 0.0,
                harmonics: 0,
            },
            env: Envelope::ExpDecay {
                attack: 0.002,
                tau: 0.10,
            },
            filter: None,
            tremolo: None,
            seed: 0,
        });
        // kick click — short hi-passed noise transient
        v.push(Voice {
            start: t,
            duration: 0.02,
            gain: 0.4,
            source: Source::Noise,
            env: Envelope::ExpDecay {
                attack: 0.0005,
                tau: 0.006,
            },
            filter: Some(Filter {
                kind: FilterKind::Highpass,
                cutoff: 2500.0,
                q: 0.7,
            }),
            tremolo: None,
            seed: i as u32,
        });
        // bass — filtered saw on the root (A1)
        v.push(Voice {
            start: t,
            duration: beat * 0.92,
            gain: 0.5,
            source: Source::Osc {
                wave: Wave::Saw,
                freq: 55.0,
                detune: 0.006,
                harmonics: 0,
            },
            env: Envelope::Adsr {
                a: 0.005,
                d: 0.1,
                s: 0.5,
                r: 0.1,
            },
            filter: Some(Filter {
                kind: FilterKind::Lowpass,
                cutoff: 420.0,
                q: 1.2,
            }),
            tremolo: None,
            seed: 0,
        });
        // hat — hi-passed noise on the off-beat
        v.push(Voice {
            start: t + beat * 0.5,
            duration: 0.08,
            gain: 0.26,
            source: Source::Noise,
            env: Envelope::ExpDecay {
                attack: 0.001,
                tau: 0.03,
            },
            filter: Some(Filter {
                kind: FilterKind::Highpass,
                cutoff: 8000.0,
                q: 0.7,
            }),
            tremolo: None,
            seed: (i + 100) as u32,
        });
    }
    // a moody Am pad (A2 C3 E3) under it all
    v.push(Voice {
        start: 0.0,
        duration: secs,
        gain: 0.18,
        source: Source::Chord {
            wave: Wave::Saw,
            freqs: vec![110.0, 130.81, 164.81],
            detune: 0.006,
            harmonics: 0,
        },
        env: Envelope::Points {
            points: vec![[0.0, 0.0], [0.6, 1.0], [secs - 0.5, 1.0], [secs, 0.0]],
        },
        filter: Some(Filter {
            kind: FilterKind::Lowpass,
            cutoff: 1200.0,
            q: 0.8,
        }),
        tremolo: Some(Tremolo {
            rate: 0.5,
            depth: 0.1,
        }),
        seed: 0,
    });

    let g = AudioGraph {
        duration: secs,
        sample_rate: 44_100,
        voices: v,
        reverb: Some(Reverb {
            room: 0.5,
            wet: 0.12,
        }),
        normalize: 0.9,
    };
    let buf = synthesize(&g);
    let out = std::env::args()
        .nth(1)
        .expect("usage: beat_track <out.wav>");
    write_wav(&buf, &out).expect("write wav");
    println!(
        "beat track: {} voices, {secs:.1}s @ {bpm} BPM -> {out}",
        g.voices.len()
    );
}
