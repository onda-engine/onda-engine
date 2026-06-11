//! Run ONDA's beat detection on an audio file: `cargo run -p onda-audio --example detect -- <file> [fps]`.
//! Prints `{ tempo, frames, beats, onsets }` (frame indices) as JSON.
use onda_audio::{decode, detect_beats};

fn main() {
    let path = std::env::args()
        .nth(1)
        .expect("usage: detect <audio> [fps]");
    let fps: f32 = std::env::args()
        .nth(2)
        .and_then(|s| s.parse().ok())
        .unwrap_or(30.0);
    let buf = decode(&path).expect("decode audio");
    let frames = (buf.duration_secs() * fps).ceil() as usize;
    let t = detect_beats(&buf, fps, frames);
    println!(
        "{{\"tempo\":{:.1},\"frames\":{},\"beats\":{:?},\"onsets\":{:?}}}",
        t.tempo_bpm, frames, t.beats, t.onsets
    );
}
