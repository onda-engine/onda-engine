//! Synthesize an `AudioGraph` (JSON) to a WAV — the generic, data-driven entry
//! the ONDA Studio MCP `audio_synth` tool shells to (the agent composes audio
//! graphs like scene graphs). Unlike the hand-coded example scores
//! (`aura_score`, `beat_track`), the graph comes entirely from the JSON file.
//!
//!   synth_json <graph.json> <out.wav>
use onda_audio::{synthesize, write_wav, AudioGraph};

fn main() {
    let mut args = std::env::args().skip(1);
    let in_path = args
        .next()
        .expect("usage: synth_json <graph.json> <out.wav>");
    let out_path = args
        .next()
        .expect("usage: synth_json <graph.json> <out.wav>");

    let json = std::fs::read_to_string(&in_path).expect("read graph json");
    let graph: AudioGraph = serde_json::from_str(&json).expect("parse AudioGraph json");
    let buf = synthesize(&graph);
    write_wav(&buf, &out_path).expect("write wav");
    eprintln!(
        "synth: {:.1}s · {} voices · {} Hz -> {}",
        graph.duration,
        graph.voices.len(),
        graph.sample_rate,
        out_path,
    );
}
