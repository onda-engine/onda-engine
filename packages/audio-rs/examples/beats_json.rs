//! Detect beats / onsets / tempo in an audio file → JSON on stdout. The generic,
//! data-driven entry the ONDA Studio MCP `analyze_audio` tool shells to (the twin
//! of `synth_json`): the agent passes the composition's fps + frame_count so the
//! returned beat/onset indices are in VIDEO-FRAME units and snap straight onto the
//! timeline (cut/animate to the beat).
//!
//!   beats_json <audio-file> <fps> <frame_count>
use onda_audio::{decode, detect_beats};

fn main() {
    let mut args = std::env::args().skip(1);
    let path = args
        .next()
        .expect("usage: beats_json <audio-file> <fps> <frame_count>");
    let fps: f32 = args
        .next()
        .and_then(|s| s.parse().ok())
        .expect("fps (number)");
    let frames: usize = args
        .next()
        .and_then(|s| s.parse().ok())
        .expect("frame_count (number)");

    let buf = decode(&path).expect("decode audio");
    let t = detect_beats(&buf, fps, frames);

    // Frames are video-frame indices; the agent times animations/cuts to them.
    println!(
        "{{\"tempo\":{:.1},\"frames\":{},\"beats\":{:?},\"onsets\":{:?}}}",
        t.tempo_bpm, frames, t.beats, t.onsets
    );
}
