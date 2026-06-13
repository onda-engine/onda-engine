//! Native speech transcription — turn an audio track into a timed [`Transcript`].
//!
//! The foundation for ONDA's one-click captions and text-based editing. Given a
//! **16 kHz mono WAV** of speech, [`transcribe`] runs OpenAI's Whisper (the
//! `whisper.cpp` C++ implementation, via the [`whisper-rs`] bindings) and returns
//! both representations the downstream features need:
//!
//! - `words` — one entry per spoken word with millisecond `start_ms`/`end_ms`,
//!   from Whisper's token timestamps with `max_len = 1` (text-based editing
//!   wants to address individual words).
//! - `segments` — the same words GROUPED into readable subtitle lines (≤ ~42
//!   chars, ~3–7 words, broken on sentence punctuation), each referencing its
//!   words by index (one-click captions wants ready-to-show lines).
//!
//! The model (default `base.en`) is downloaded once to `~/.onda/models/`, mirroring
//! onda-segment's cache. See [`model`] for selection/override.
//!
//! NATIVE-ONLY: whisper.cpp is built from C++ source with cmake and cannot target
//! wasm32 — this crate is pulled in only behind onda-cli's `transcribe` feature.

mod model;

use std::path::Path;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

pub use model::WhisperModel;

/// The standard maximum subtitle line length (characters). Lines are broken
/// before exceeding this — the de-facto caption standard (~37–42 cps).
const MAX_LINE_CHARS: usize = 42;
/// Don't let a caption line run longer than this many words even without
/// punctuation, so a long unpunctuated run still breaks into readable chunks.
const MAX_LINE_WORDS: usize = 7;

/// A single transcribed word with millisecond timing. `start_ms < end_ms`, and
/// words are emitted in ascending time order.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Word {
    /// The word text, trimmed (no leading space, no bracketed non-speech tokens).
    pub text: String,
    /// Start time of the word, in milliseconds from the audio start.
    pub start_ms: u32,
    /// End time of the word, in milliseconds from the audio start.
    pub end_ms: u32,
}

/// A readable caption line: a run of consecutive [`Word`]s grouped for display.
/// `words` holds indices into the [`Transcript::words`] vec.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Segment {
    /// The joined, space-separated text of the line.
    pub text: String,
    /// Start time of the line (= the first word's `start_ms`).
    pub start_ms: u32,
    /// End time of the line (= the last word's `end_ms`).
    pub end_ms: u32,
    /// Indices into [`Transcript::words`] of the words on this line.
    pub words: Vec<usize>,
}

/// The full transcription result.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Transcript {
    /// The detected (or forced) language, as a short code (e.g. `"en"`).
    pub language: String,
    /// Every spoken word, in time order, with word-level timestamps.
    pub words: Vec<Word>,
    /// The words grouped into readable caption lines.
    pub segments: Vec<Segment>,
}

/// Options for [`transcribe`].
#[derive(Debug, Clone, Default)]
pub struct TranscribeOptions<'a> {
    /// Which named model to use when neither `model_path` nor the
    /// `ONDA_WHISPER_MODEL` env var is set. Defaults to `base.en`.
    pub model: Option<WhisperModel>,
    /// An explicit model file to load (highest priority; never downloaded).
    pub model_path: Option<&'a Path>,
    /// Force a language code (e.g. `"en"`) instead of auto-detecting. The `.en`
    /// models are English-only, so this is mostly for the multilingual models.
    pub language: Option<&'a str>,
    /// Number of CPU threads for inference (default: the available parallelism,
    /// capped at 8).
    pub threads: Option<usize>,
}

/// Transcribe a **16 kHz mono WAV** file to a [`Transcript`] with word-level and
/// line-level timing.
///
/// The model is resolved per [`model::resolve_model_path`] (explicit path → env
/// override → named model, downloading the named model on first use).
pub fn transcribe(audio_16k_mono_wav: &Path, opts: &TranscribeOptions) -> Result<Transcript> {
    let pcm = read_wav_16k_mono(audio_16k_mono_wav)
        .with_context(|| format!("reading audio '{}'", audio_16k_mono_wav.display()))?;
    transcribe_pcm(&pcm, opts)
}

/// Transcribe 16 kHz mono f32 PCM samples directly (the WAV-less path, e.g. when
/// the caller already has samples). Same contract as [`transcribe`].
pub fn transcribe_pcm(pcm_16k_mono: &[f32], opts: &TranscribeOptions) -> Result<Transcript> {
    if pcm_16k_mono.is_empty() {
        bail!("no audio samples to transcribe (empty input)");
    }
    let model = opts.model.unwrap_or(WhisperModel::BaseEn);
    let model_file = model::resolve_model_path(opts.model_path, model)?;

    let ctx = WhisperContext::new_with_params(
        &model_file.to_string_lossy(),
        WhisperContextParameters::default(),
    )
    .with_context(|| format!("loading Whisper model '{}'", model_file.display()))?;
    let mut state = ctx.create_state().context("creating the Whisper state")?;

    let threads = opts
        .threads
        .unwrap_or_else(|| std::thread::available_parallelism().map_or(4, |n| n.get()))
        .clamp(1, 8) as i32;

    // English-only models (`ggml-*.en.bin`) only speak English; their
    // language-detection head is unreliable (it can report a random low-prob
    // language). So for those, force `en` rather than letting whisper "detect".
    let english_only = model_file
        .file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.contains(".en."))
        .unwrap_or(false);
    let forced_language: Option<&str> =
        opts.language
            .or(if english_only { Some("en") } else { None });

    // Greedy sampling; word-level timestamps via max_len = 1 (one word/segment).
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_n_threads(threads);
    params.set_translate(false);
    params.set_token_timestamps(true);
    params.set_max_len(1); // one word per segment → word-level timestamps
    params.set_split_on_word(true);
    params.set_suppress_blank(true);
    params.set_language(forced_language);
    // Quiet: this is a library; the CLI prints its own summary.
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    state
        .full(params, pcm_16k_mono)
        .context("running Whisper inference")?;

    // Report the language: the forced one if any, else what whisper detected
    // (id → short code), defaulting to `en`.
    let language = forced_language
        .map(str::to_string)
        .or_else(|| {
            state
                .full_lang_id_from_state()
                .ok()
                .and_then(whisper_rs::get_lang_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| "en".to_string());

    let n_segments = state
        .full_n_segments()
        .context("counting Whisper segments")?;

    let mut words: Vec<Word> = Vec::new();
    for i in 0..n_segments {
        let raw = state
            .full_get_segment_text(i)
            .with_context(|| format!("reading Whisper segment {i} text"))?;
        // t0/t1 are in centiseconds (1/100 s) — convert to ms.
        let t0_cs = state.full_get_segment_t0(i).unwrap_or(0).max(0) as u32;
        let t1_cs = state.full_get_segment_t1(i).unwrap_or(0).max(0) as u32;
        let start_ms = t0_cs * 10;
        let mut end_ms = t1_cs * 10;
        if end_ms < start_ms {
            end_ms = start_ms;
        }

        let text = clean_token_text(&raw);
        if text.is_empty() {
            continue; // dropped non-speech bracket / pure punctuation artifact
        }

        // A zero-duration, punctuation-only artifact (a stray "." segment) merges
        // into the previous word rather than becoming its own entry.
        if is_punct_only(&text) {
            if let Some(prev) = words.last_mut() {
                prev.text.push_str(&text);
                if end_ms > prev.end_ms {
                    prev.end_ms = end_ms;
                }
            }
            continue;
        }

        words.push(Word {
            text,
            start_ms,
            end_ms,
        });
    }

    let segments = group_into_lines(&words);

    Ok(Transcript {
        language,
        words,
        segments,
    })
}

/// Clean a raw Whisper segment/token string: trim whitespace and strip whole
/// bracketed non-speech tokens like `[BLANK_AUDIO]`, `[_BEG_]`, `(music)`,
/// `*laughs*`. A token that is *entirely* such a marker becomes empty (dropped);
/// inline text is kept.
fn clean_token_text(raw: &str) -> String {
    let t = raw.trim();
    // Whole-token non-speech markers Whisper emits, delimited by [] () or **.
    let is_bracketed = |s: &str, open: char, close: char| {
        s.starts_with(open) && s.ends_with(close) && s.len() >= 2
    };
    if is_bracketed(t, '[', ']') || is_bracketed(t, '(', ')') || is_bracketed(t, '*', '*') {
        return String::new();
    }
    t.to_string()
}

/// True if the string is only punctuation/symbols (no letters or digits) — a
/// stray token we merge into the previous word instead of standing alone.
fn is_punct_only(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| !c.is_alphanumeric())
}

/// Group consecutive words into readable caption lines: break on sentence-ending
/// punctuation (`.`/`!`/`?`), or before a line would exceed [`MAX_LINE_CHARS`]
/// characters or [`MAX_LINE_WORDS`] words.
fn group_into_lines(words: &[Word]) -> Vec<Segment> {
    let mut segments: Vec<Segment> = Vec::new();
    let mut current: Vec<usize> = Vec::new();
    let mut current_len = 0usize;

    let flush = |current: &mut Vec<usize>, segments: &mut Vec<Segment>| {
        if current.is_empty() {
            return;
        }
        let text = current
            .iter()
            .map(|&i| words[i].text.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        let start_ms = words[current[0]].start_ms;
        let end_ms = words[*current.last().unwrap()].end_ms;
        segments.push(Segment {
            text,
            start_ms,
            end_ms,
            words: std::mem::take(current),
        });
    };

    for (i, w) in words.iter().enumerate() {
        let word_len = w.text.chars().count();
        // +1 for the joining space when the line already has words.
        let added = if current.is_empty() {
            word_len
        } else {
            word_len + 1
        };
        // Break BEFORE this word if it would overflow the line budget.
        if !current.is_empty()
            && (current_len + added > MAX_LINE_CHARS || current.len() >= MAX_LINE_WORDS)
        {
            flush(&mut current, &mut segments);
            current_len = 0;
        }
        let first = current.is_empty();
        current.push(i);
        current_len += if first { word_len } else { word_len + 1 };

        // Break AFTER a word that ends a sentence (keeps the punctuation on the line).
        if ends_sentence(&w.text) {
            flush(&mut current, &mut segments);
            current_len = 0;
        }
    }
    flush(&mut current, &mut segments);
    segments
}

/// True if the word ends with sentence-final punctuation (ignoring trailing
/// quotes/brackets), so the caption line should break after it.
fn ends_sentence(text: &str) -> bool {
    let trimmed = text.trim_end_matches(['"', '\'', ')', ']', '»', '”', '’']);
    matches!(
        trimmed.chars().last(),
        Some('.') | Some('!') | Some('?') | Some('…')
    )
}

/// Read a WAV file as 16 kHz mono f32 PCM in `[-1, 1]`. Errors if the WAV is not
/// 16 kHz mono (the CLI always feeds one resampled by ffmpeg, so this is a guard
/// against a mis-pipelined file rather than an in-crate resampler).
fn read_wav_16k_mono(path: &Path) -> Result<Vec<f32>> {
    let mut reader = hound::WavReader::open(path)
        .with_context(|| format!("opening WAV '{}'", path.display()))?;
    let spec = reader.spec();
    if spec.channels != 1 {
        bail!(
            "expected mono audio, got {} channels (feed ffmpeg-resampled 16 kHz mono)",
            spec.channels
        );
    }
    if spec.sample_rate != 16_000 {
        bail!(
            "expected 16 kHz audio, got {} Hz (feed ffmpeg-resampled 16 kHz mono)",
            spec.sample_rate
        );
    }
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .collect::<Result<_, _>>()
            .context("reading float WAV samples")?,
        hound::SampleFormat::Int => {
            let max = (1i64 << (spec.bits_per_sample - 1)) as f32;
            reader
                .samples::<i32>()
                .map(|s| s.map(|v| v as f32 / max))
                .collect::<Result<_, _>>()
                .context("reading int WAV samples")?
        }
    };
    Ok(samples)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_strips_bracketed_non_speech() {
        assert_eq!(clean_token_text("[BLANK_AUDIO]"), "");
        assert_eq!(clean_token_text("(music)"), "");
        assert_eq!(clean_token_text("*laughs*"), "");
        assert_eq!(clean_token_text("  hello "), "hello");
        assert_eq!(clean_token_text("world."), "world.");
    }

    #[test]
    fn punct_only_detection() {
        assert!(is_punct_only("."));
        assert!(is_punct_only("?!"));
        assert!(!is_punct_only("hi"));
        assert!(!is_punct_only("a1"));
    }

    #[test]
    fn ends_sentence_handles_trailing_quotes() {
        assert!(ends_sentence("done."));
        assert!(ends_sentence("really?\""));
        assert!(ends_sentence("stop!”"));
        assert!(!ends_sentence("and"));
        assert!(!ends_sentence("mid,"));
    }

    #[test]
    fn grouping_breaks_on_sentence_and_length() {
        let words = vec![
            Word {
                text: "Hello".into(),
                start_ms: 0,
                end_ms: 100,
            },
            Word {
                text: "world.".into(),
                start_ms: 100,
                end_ms: 200,
            },
            Word {
                text: "This".into(),
                start_ms: 200,
                end_ms: 300,
            },
            Word {
                text: "is".into(),
                start_ms: 300,
                end_ms: 400,
            },
            Word {
                text: "a".into(),
                start_ms: 400,
                end_ms: 500,
            },
            Word {
                text: "test".into(),
                start_ms: 500,
                end_ms: 600,
            },
        ];
        let segs = group_into_lines(&words);
        // "Hello world." breaks after the sentence-ending period.
        assert_eq!(segs[0].text, "Hello world.");
        assert_eq!(segs[0].start_ms, 0);
        assert_eq!(segs[0].end_ms, 200);
        assert_eq!(segs[0].words, vec![0, 1]);
        assert_eq!(segs[1].text, "This is a test");
        assert_eq!(segs[1].words, vec![2, 3, 4, 5]);
    }

    #[test]
    fn grouping_caps_word_count() {
        // Nine short words, no punctuation → must split (≤7 words/line).
        let words: Vec<Word> = (0..9)
            .map(|i| Word {
                text: "ab".into(),
                start_ms: i * 100,
                end_ms: i * 100 + 100,
            })
            .collect();
        let segs = group_into_lines(&words);
        assert!(
            segs.len() >= 2,
            "expected a split, got {} line(s)",
            segs.len()
        );
        assert!(segs.iter().all(|s| s.words.len() <= MAX_LINE_WORDS));
    }

    #[test]
    fn model_name_parsing() {
        assert_eq!(
            WhisperModel::from_name("tiny.en"),
            Some(WhisperModel::TinyEn)
        );
        assert_eq!(
            WhisperModel::from_name("base-en"),
            Some(WhisperModel::BaseEn)
        );
        assert_eq!(
            WhisperModel::from_name("SMALL"),
            Some(WhisperModel::SmallEn)
        );
        assert_eq!(WhisperModel::from_name("medium"), None);
    }

    /// End-to-end: synthesize speech with `say` + ffmpeg, transcribe with the
    /// cached tiny.en model, assert ascending word timing + grouping. Skips if the
    /// tooling/model aren't available (so CI without them stays green).
    #[test]
    fn transcribe_say_end_to_end() {
        let home = match std::env::var_os("HOME") {
            Some(h) => std::path::PathBuf::from(h),
            None => return,
        };
        let tiny = home.join(".onda/models/ggml-tiny.en.bin");
        if !tiny.exists() {
            eprintln!("skipping: tiny.en model not cached at {}", tiny.display());
            return;
        }
        if which("say").is_none() || which("ffmpeg").is_none() {
            eprintln!("skipping: `say` and/or `ffmpeg` not on PATH");
            return;
        }
        let dir = std::env::temp_dir();
        let aiff = dir.join("onda_transcribe_test.aiff");
        let wav = dir.join("onda_transcribe_test.wav");
        let phrase = "Hello world this is a test of the onda captions engine";
        let ok = std::process::Command::new("say")
            .args(["-o", aiff.to_str().unwrap(), phrase])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if !ok {
            eprintln!("skipping: `say` failed");
            return;
        }
        let ok = std::process::Command::new("ffmpeg")
            .args([
                "-y",
                "-i",
                aiff.to_str().unwrap(),
                "-ar",
                "16000",
                "-ac",
                "1",
                wav.to_str().unwrap(),
            ])
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        assert!(ok, "ffmpeg resample failed");

        let opts = TranscribeOptions {
            model_path: Some(&tiny),
            ..Default::default()
        };
        let t = transcribe(&wav, &opts).expect("transcribe");

        assert!(!t.words.is_empty(), "no words transcribed");
        assert!(!t.segments.is_empty(), "no segments");
        // Word timing: start < end, ascending starts.
        for w in &t.words {
            assert!(w.start_ms <= w.end_ms, "word {:?} has start>end", w);
        }
        for pair in t.words.windows(2) {
            assert!(
                pair[0].start_ms <= pair[1].start_ms,
                "words not ascending: {:?} then {:?}",
                pair[0],
                pair[1]
            );
        }
        // Segments must reference valid word indices and cover them.
        let referenced: usize = t.segments.iter().map(|s| s.words.len()).sum();
        assert_eq!(referenced, t.words.len(), "every word belongs to one line");
        // Rough content check: a couple of distinctive words should appear.
        let joined = t
            .words
            .iter()
            .map(|w| w.text.to_lowercase())
            .collect::<Vec<_>>()
            .join(" ");
        assert!(joined.contains("hello"), "expected 'hello' in: {joined}");
        assert!(joined.contains("test"), "expected 'test' in: {joined}");

        let _ = std::fs::remove_file(&aiff);
        let _ = std::fs::remove_file(&wav);
    }

    fn which(bin: &str) -> Option<std::path::PathBuf> {
        let path = std::env::var_os("PATH")?;
        std::env::split_paths(&path)
            .map(|d| d.join(bin))
            .find(|p| p.exists())
    }
}
