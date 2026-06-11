//! AURA's score, composed THROUGH the engine's synth subsystem (not a side-script):
//! `cargo run -p onda-audio --example aura_score -- out.wav`
//! A warm Fmaj7 pad + sub + airy shimmer, with a riser, whooshes, chimes, and a deep
//! impact on the logo reveal — the same sound design, now a declarative AudioGraph.
use onda_audio::{
    synthesize, write_wav, AudioGraph, Envelope, Filter, FilterKind, Reverb, Source, Tremolo,
    Voice, Wave,
};

fn pad_env() -> Envelope {
    // fade in → settle → swell into the reveal (~6 s) → hold → fade out
    Envelope::Points {
        points: vec![[0.0, 0.0], [1.8, 0.78], [6.0, 1.0], [8.0, 1.0], [9.0, 0.0]],
    }
}

fn chime(start: f32) -> Voice {
    Voice {
        start,
        duration: 0.6,
        gain: 0.13,
        source: Source::Chord {
            wave: Wave::Sine,
            freqs: vec![1244.0, 1864.0, 2489.0, 3322.0], // bright inharmonic-ish bell
            detune: 0.001,
            harmonics: 0,
        },
        env: Envelope::ExpDecay {
            attack: 0.003,
            tau: 0.18,
        },
        filter: None,
        tremolo: None,
        seed: 0,
    }
}

fn whoosh(start: f32, gain: f32, cutoff: f32, seed: u32) -> Voice {
    Voice {
        start,
        duration: 0.5,
        gain,
        source: Source::Noise,
        env: Envelope::Points {
            points: vec![[0.0, 0.0], [0.12, 1.0], [0.5, 0.0]],
        },
        filter: Some(Filter {
            kind: FilterKind::Highpass,
            cutoff,
            q: 0.7,
        }),
        tremolo: None,
        seed,
    }
}

fn main() {
    let voices = vec![
        // sub drone (F1)
        Voice {
            start: 0.0,
            duration: 9.0,
            gain: 0.30,
            source: Source::Osc {
                wave: Wave::Sine,
                freq: 43.65,
                detune: 0.003,
                harmonics: 0,
            },
            env: pad_env(),
            filter: None,
            tremolo: Some(Tremolo {
                rate: 0.22,
                depth: 0.06,
            }),
            seed: 0,
        },
        // warm pad — Fmaj7 voicing (F2 C3 E3 A3), detuned + a soft 2nd harmonic, breathing
        Voice {
            start: 0.0,
            duration: 9.0,
            gain: 0.85,
            source: Source::Chord {
                wave: Wave::Sine,
                freqs: vec![87.31, 130.81, 164.81, 220.0],
                detune: 0.0035,
                harmonics: 1,
            },
            env: pad_env(),
            filter: None,
            tremolo: Some(Tremolo {
                rate: 0.25,
                depth: 0.06,
            }),
            seed: 0,
        },
        // airy high shimmer, fades in late
        Voice {
            start: 0.0,
            duration: 9.0,
            gain: 0.10,
            source: Source::Chord {
                wave: Wave::Sine,
                freqs: vec![523.25, 698.46, 880.0],
                detune: 0.002,
                harmonics: 0,
            },
            env: Envelope::Points {
                points: vec![[0.0, 0.0], [2.5, 0.0], [5.0, 1.0], [8.0, 1.0], [9.0, 0.0]],
            },
            filter: None,
            tremolo: Some(Tremolo {
                rate: 0.18,
                depth: 0.12,
            }),
            seed: 0,
        },
        // riser into the reveal (filtered noise swelling up)
        Voice {
            start: 5.4,
            duration: 1.3,
            gain: 0.16,
            source: Source::Noise,
            env: Envelope::Points {
                points: vec![[0.0, 0.0], [1.3, 1.0]],
            },
            filter: Some(Filter {
                kind: FilterKind::Highpass,
                cutoff: 1800.0,
                q: 0.7,
            }),
            tremolo: None,
            seed: 11,
        },
        // whooshes on the transitions
        whoosh(4.78, 0.26, 950.0, 22),
        whoosh(6.30, 0.30, 1050.0, 33),
        // deep impact as the logo turns to face you
        Voice {
            start: 6.6,
            duration: 1.6,
            gain: 0.42,
            source: Source::Osc {
                wave: Wave::Sine,
                freq: 55.0,
                detune: 0.0,
                harmonics: 0,
            },
            env: Envelope::ExpDecay {
                attack: 0.01,
                tau: 0.9,
            },
            filter: None,
            tremolo: None,
            seed: 0,
        },
        // chimes sparkling on WARMTH / LIGHT / MEMORY
        chime(5.00),
        chime(5.67),
        chime(6.27),
    ];
    let graph = AudioGraph {
        duration: 9.0,
        sample_rate: 44_100,
        voices,
        reverb: Some(Reverb {
            room: 0.78,
            wet: 0.2,
        }),
        normalize: 0.86,
    };
    let buf = synthesize(&graph);
    let out = std::env::args()
        .nth(1)
        .expect("usage: aura_score <out.wav>");
    write_wav(&buf, &out).expect("write wav");
    println!(
        "synthesized {:.1}s → {out} ({} samples)",
        graph.duration,
        buf.samples.len()
    );
}
