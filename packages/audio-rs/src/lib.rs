//! ONDA audio: decode, mix, and WAV-encode audio for video export.
//!
//! The video pipeline renders silent frames; this crate provides the audio side:
//! decode source clips (`symphonia` — mp3/aac/m4a/flac/ogg/wav/…) to interleaved
//! f32 PCM, [`mix`] several clips (with per-clip start offset + gain) into a
//! single stereo bed of a fixed duration, and [`write_wav`] it so the export
//! step can mux it alongside the rendered video (e.g. via ffmpeg).
//!
//! Per the charter this is plain, renderer-agnostic data: no scene-graph or GPU
//! types here. Resampling is naive linear interpolation — fine for v1 muxing;
//! a higher-quality resampler can replace it later without touching the API.

use std::io::Cursor;
#[cfg(feature = "native-io")]
use std::path::Path;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

mod beats;
mod spectrum;
mod synth;
pub use beats::{detect_beats, BeatTrack};
pub use spectrum::{frame_bands, spectrogram, SpectrumOpts};
pub use synth::{
    synthesize, AudioGraph, Envelope, Filter, FilterKind, Reverb, Source, Tremolo, Voice, Wave,
};

/// Decoded PCM audio: interleaved f32 samples (`channels` per frame), in `-1..=1`.
#[derive(Debug, Clone, PartialEq)]
pub struct AudioBuffer {
    pub sample_rate: u32,
    pub channels: u16,
    /// Interleaved samples: `[ch0, ch1, …, ch0, ch1, …]`, length = frames × channels.
    pub samples: Vec<f32>,
}

impl AudioBuffer {
    /// Number of sample frames (samples per channel).
    pub fn frames(&self) -> usize {
        match self.channels {
            0 => 0,
            c => self.samples.len() / c as usize,
        }
    }

    /// Duration in seconds.
    pub fn duration_secs(&self) -> f32 {
        match self.sample_rate {
            0 => 0.0,
            rate => self.frames() as f32 / rate as f32,
        }
    }
}

/// An error decoding or encoding audio.
#[derive(Debug)]
pub enum AudioError {
    Io(std::io::Error),
    /// Decoding failed (probe, codec, or stream error).
    Decode(String),
    /// The input has no usable audio track or codec.
    Unsupported(String),
}

impl std::fmt::Display for AudioError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AudioError::Io(e) => write!(f, "audio I/O error: {e}"),
            AudioError::Decode(m) => write!(f, "audio decode error: {m}"),
            AudioError::Unsupported(m) => write!(f, "unsupported audio: {m}"),
        }
    }
}

impl std::error::Error for AudioError {}

impl From<std::io::Error> for AudioError {
    fn from(e: std::io::Error) -> Self {
        AudioError::Io(e)
    }
}

/// Decode an audio file to interleaved f32 PCM. Format is detected from content
/// (with the file extension as a hint). Native only (filesystem); the wasm build
/// uses [`decode_from_bytes`].
#[cfg(feature = "native-io")]
pub fn decode(path: impl AsRef<Path>) -> Result<AudioBuffer, AudioError> {
    let path = path.as_ref();
    let file = std::fs::File::open(path)?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    decode_stream(mss, hint)
}

/// Decode audio from in-memory bytes (no filesystem) — the browser/wasm path, and
/// any caller that already holds the bytes. `ext_hint` is the file extension
/// (`"mp3"`, `"wav"`, …) to aid format detection; `""` is fine (content probing
/// still runs). The decode is byte-for-byte identical to [`decode`] on the same
/// data, which is what keeps the in-browser preview and `onda export` in sync.
pub fn decode_from_bytes(bytes: &[u8], ext_hint: &str) -> Result<AudioBuffer, AudioError> {
    let mss = MediaSourceStream::new(Box::new(Cursor::new(bytes.to_vec())), Default::default());
    let mut hint = Hint::new();
    if !ext_hint.is_empty() {
        hint.with_extension(ext_hint);
    }
    decode_stream(mss, hint)
}

/// Shared decode core: probe the stream, pick the first decodable audio track,
/// and decode every packet into interleaved f32 PCM.
fn decode_stream(mss: MediaSourceStream, hint: Hint) -> Result<AudioBuffer, AudioError> {
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| AudioError::Decode(e.to_string()))?;
    let mut format = probed.format;

    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| AudioError::Unsupported("no decodable audio track".into()))?;
    let track_id = track.id;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| AudioError::Decode(e.to_string()))?;

    let mut sample_rate = track.codec_params.sample_rate.unwrap_or(48_000);
    let mut channels = track.codec_params.channels.map_or(2, |c| c.count() as u16);
    let mut samples: Vec<f32> = Vec::new();
    let mut sample_buf: Option<SampleBuffer<f32>> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            // Clean end of stream (symphonia signals EOF as an UnexpectedEof I/O error).
            Err(SymphoniaError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                break;
            }
            Err(SymphoniaError::ResetRequired) => break,
            Err(e) => return Err(AudioError::Decode(e.to_string())),
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                if sample_buf.is_none() {
                    let spec = *decoded.spec();
                    sample_rate = spec.rate;
                    channels = spec.channels.count() as u16;
                    sample_buf = Some(SampleBuffer::<f32>::new(decoded.capacity() as u64, spec));
                }
                if let Some(buf) = sample_buf.as_mut() {
                    buf.copy_interleaved_ref(decoded);
                    samples.extend_from_slice(buf.samples());
                }
            }
            // A corrupt packet is recoverable — skip it and keep going.
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(SymphoniaError::IoError(_)) => break,
            Err(e) => return Err(AudioError::Decode(e.to_string())),
        }
    }

    Ok(AudioBuffer {
        sample_rate,
        channels,
        samples,
    })
}

/// A clip placed in a [`mix`]: its audio, when it starts on the timeline
/// (seconds), how far into the source to begin (`source_in_secs`, trims the
/// head), and a gain multiplier (1.0 = unchanged).
pub struct MixTrack<'a> {
    pub buffer: &'a AudioBuffer,
    pub start_secs: f32,
    pub volume: f32,
    /// Seconds into the source to begin reading (trim the head). Default 0.
    pub source_in_secs: f32,
}

impl<'a> MixTrack<'a> {
    pub fn new(buffer: &'a AudioBuffer, start_secs: f32, volume: f32) -> Self {
        MixTrack {
            buffer,
            start_secs,
            volume,
            source_in_secs: 0.0,
        }
    }

    /// Builder: skip the first `secs` of the source (trim the head). Negative
    /// values are clamped to 0.
    pub fn with_source_in(mut self, secs: f32) -> Self {
        self.source_in_secs = secs.max(0.0);
        self
    }
}

/// Mix clips into a single **stereo** buffer of exactly `duration_secs` at
/// `sample_rate`. Each clip is read from its `source_in_secs` point (head trim),
/// gain-scaled, resampled (linear) to the target rate, down/up-mixed to stereo,
/// placed at its start offset, summed, and the result is clamped to `-1..=1`.
pub fn mix(tracks: &[MixTrack], duration_secs: f32, sample_rate: u32) -> AudioBuffer {
    let rate = sample_rate.max(1);
    let total_frames = (duration_secs.max(0.0) * rate as f32).round() as usize;
    let mut out = vec![0.0f32; total_frames * 2];

    for track in tracks {
        let src = track.buffer;
        let src_frames = src.frames();
        if src_frames == 0 || src.sample_rate == 0 || track.volume == 0.0 {
            continue;
        }
        let start_frame = (track.start_secs.max(0.0) * rate as f32).round() as usize;
        if start_frame >= total_frames {
            continue;
        }
        // Source frames advanced per output frame.
        let step = src.sample_rate as f32 / rate as f32;
        // Head trim: where in the source (in source frames) reading begins.
        let src_in_off = track.source_in_secs.max(0.0) * src.sample_rate as f32;

        for out_frame in 0..(total_frames - start_frame) {
            let src_pos = src_in_off + out_frame as f32 * step;
            let i = src_pos as usize;
            if i >= src_frames {
                break;
            }
            let (l, r) = sample_stereo(src, i, src_pos - i as f32);
            let oi = (start_frame + out_frame) * 2;
            out[oi] += l * track.volume;
            out[oi + 1] += r * track.volume;
        }
    }

    for s in &mut out {
        *s = s.clamp(-1.0, 1.0);
    }
    AudioBuffer {
        sample_rate: rate,
        channels: 2,
        samples: out,
    }
}

/// Linear-interpolated stereo sample at fractional frame `i + frac` of `src`,
/// down/up-mixing the source's channel count to L/R.
fn sample_stereo(src: &AudioBuffer, i: usize, frac: f32) -> (f32, f32) {
    let channels = src.channels.max(1) as usize;
    let last = src.frames().saturating_sub(1);
    let next = (i + 1).min(last);
    let at = |frame: usize, ch: usize| -> f32 {
        src.samples
            .get(frame * channels + ch.min(channels - 1))
            .copied()
            .unwrap_or(0.0)
    };
    let lerp = |ch: usize| at(i, ch) * (1.0 - frac) + at(next, ch) * frac;
    if channels == 1 {
        let m = lerp(0);
        (m, m)
    } else {
        (lerp(0), lerp(1))
    }
}

/// Write `buffer` as a 16-bit PCM WAV file. Native only (filesystem).
#[cfg(feature = "native-io")]
pub fn write_wav(buffer: &AudioBuffer, path: impl AsRef<Path>) -> Result<(), AudioError> {
    let channels = buffer.channels.max(1);
    let sample_rate = buffer.sample_rate.max(1);
    let bits_per_sample: u16 = 16;
    let block_align = channels * (bits_per_sample / 8);
    let byte_rate = sample_rate * block_align as u32;
    let data_len = (buffer.samples.len() * 2) as u32; // 2 bytes per i16 sample

    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // PCM fmt chunk size
    out.extend_from_slice(&1u16.to_le_bytes()); // audio format = PCM
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&bits_per_sample.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for &s in &buffer.samples {
        let v = (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16;
        out.extend_from_slice(&v.to_le_bytes());
    }

    std::fs::write(path, out)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    /// A mono sine tone at `freq` Hz for `secs` seconds, amplitude 0.5.
    fn sine(freq: f32, secs: f32, rate: u32) -> AudioBuffer {
        let n = (secs * rate as f32) as usize;
        let samples = (0..n)
            .map(|i| (2.0 * PI * freq * (i as f32 / rate as f32)).sin() * 0.5)
            .collect();
        AudioBuffer {
            sample_rate: rate,
            channels: 1,
            samples,
        }
    }

    #[test]
    fn buffer_frames_and_duration() {
        let buf = AudioBuffer {
            sample_rate: 48_000,
            channels: 2,
            samples: vec![0.0; 48_000 * 2],
        };
        assert_eq!(buf.frames(), 48_000);
        assert!((buf.duration_secs() - 1.0).abs() < 1e-6);
    }

    #[test]
    fn wav_round_trips_through_decode() {
        let tone = sine(440.0, 0.05, 48_000);
        let path = std::env::temp_dir().join("onda_audio_roundtrip.wav");
        write_wav(&tone, &path).expect("write wav");

        let back = decode(&path).expect("decode wav");
        assert_eq!(back.sample_rate, 48_000);
        assert_eq!(back.channels, 1);
        assert!((back.frames() as i64 - tone.frames() as i64).abs() <= 1);
        // 16-bit quantization preserves the ~0.5 peak amplitude.
        let peak = back.samples.iter().fold(0.0f32, |m, s| m.max(s.abs()));
        assert!((0.45..=0.55).contains(&peak), "peak was {peak}");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn mix_outputs_stereo_of_exact_duration() {
        let tone = sine(440.0, 0.1, 48_000);
        let mixed = mix(&[MixTrack::new(&tone, 0.0, 1.0)], 1.0, 48_000);
        assert_eq!(mixed.channels, 2);
        assert_eq!(mixed.samples.len(), 48_000 * 2);
    }

    #[test]
    fn mix_places_a_track_at_its_offset() {
        let tone = sine(440.0, 1.0, 48_000);
        let mixed = mix(&[MixTrack::new(&tone, 0.5, 1.0)], 1.0, 48_000);
        // First 0.5s (24_000 frames = 48_000 samples) is silent; the rest has signal.
        let head: f32 = mixed.samples[..48_000].iter().map(|s| s.abs()).sum();
        let tail: f32 = mixed.samples[48_000..].iter().map(|s| s.abs()).sum();
        assert!(head < 1.0, "expected silence before the offset, got {head}");
        assert!(tail > 100.0, "expected signal after the offset, got {tail}");
    }

    #[test]
    fn mix_trims_source_head_with_source_in() {
        // Source: 0.5s of silence followed by 0.5s of tone.
        let rate = 48_000;
        let half = rate as usize / 2;
        let mut samples = vec![0.0f32; half];
        samples
            .extend((0..half).map(|i| (2.0 * PI * 440.0 * (i as f32 / rate as f32)).sin() * 0.5));
        let src = AudioBuffer {
            sample_rate: rate,
            channels: 1,
            samples,
        };

        // Trimming the silent 0.5s head → the mixed 0.5s window is signal from frame 0.
        let trimmed = mix(
            &[MixTrack::new(&src, 0.0, 1.0).with_source_in(0.5)],
            0.5,
            rate,
        );
        let energy: f32 = trimmed.samples.iter().map(|s| s.abs()).sum();
        assert!(
            energy > 100.0,
            "source-in should skip the silent head, got {energy}"
        );

        // Control: without source-in, the same window reads the silent head.
        let untrimmed = mix(&[MixTrack::new(&src, 0.0, 1.0)], 0.5, rate);
        let head: f32 = untrimmed.samples.iter().map(|s| s.abs()).sum();
        assert!(
            head < 1.0,
            "without source-in the head is silent, got {head}"
        );
    }

    #[test]
    fn mix_sums_and_clamps() {
        // Two loud tones summed exceed 1.0 but the mix clamps to the valid range.
        let a = sine(220.0, 0.1, 48_000);
        let b = sine(440.0, 0.1, 48_000);
        let mixed = mix(
            &[MixTrack::new(&a, 0.0, 1.0), MixTrack::new(&b, 0.0, 1.0)],
            0.1,
            48_000,
        );
        assert!(mixed.samples.iter().all(|s| (-1.0..=1.0).contains(s)));
    }

    #[test]
    fn resamples_to_target_rate() {
        // A 24kHz source mixed into a 48kHz bed keeps its ~1s duration.
        let tone = sine(300.0, 1.0, 24_000);
        let mixed = mix(&[MixTrack::new(&tone, 0.0, 1.0)], 1.0, 48_000);
        assert_eq!(mixed.sample_rate, 48_000);
        // Energy is spread across ~the whole second (not crammed into the first half).
        let tail: f32 = mixed.samples[48_000..].iter().map(|s| s.abs()).sum();
        assert!(
            tail > 100.0,
            "resampled signal should fill the second half: {tail}"
        );
    }
}
