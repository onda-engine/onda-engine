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
/// A word below this mean token probability is treated as low-confidence (likely
/// misheard). Whisper text tokens on clear speech sit ~0.8–0.95.
const LOW_CONFIDENCE: f32 = 0.5;

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
    /// Mean Whisper token probability for this word (0..1). Low = the model was
    /// unsure here — noisy audio, a heavy accent, or a hallucination over
    /// non-speech. Drives the [`TranscriptQuality`] verdict.
    pub confidence: f32,
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
    /// Mean confidence of this line's words (0..1) — lets a caller point at the
    /// specific lines worth a human re-read.
    pub confidence: f32,
}

/// A measured quality read on a transcript — the "should the agent trust these
/// captions?" verdict, so it never ships hallucinated or misheard words blind.
/// Computed from Whisper's own per-token probabilities (confidence) plus cheap
/// text/timing heuristics; the agent surfaces it alongside the scene-graph
/// checks `inspect()` already runs.
///
/// NOTE: Whisper's `no_speech_prob` (the cleanest silence/music hallucination
/// signal) is not yet reachable through `whisper-rs` 0.14 (both the context and
/// state pointers are private) — so v1 leans on token confidence + a repetition
/// detector, which together catch the common failure modes. Surfacing
/// `no_speech_prob` is a clean follow-up once the binding exposes it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TranscriptQuality {
    /// Mean per-word confidence across the transcript (0..1).
    pub mean_confidence: f32,
    /// Fraction of words below the low-confidence floor (likely misheard).
    pub low_confidence_frac: f32,
    /// Largest share any single word takes of the transcript (0..1) — a loop
    /// detector. High = a repeated phrase, the classic non-speech hallucination.
    pub repetition: f32,
    /// Spoken span ÷ audio duration (0..1) — low can mean dropped speech.
    pub coverage: f32,
    /// Overall read: "good" | "fair" | "poor".
    pub verdict: String,
    /// Human-facing reasons (empty-then-defaulted), for the agent to relay.
    pub reasons: Vec<String>,
    /// Indices into [`Transcript::segments`] of the lines below the confidence
    /// floor — the specific captions worth a human re-read.
    pub weak_segments: Vec<usize>,
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
    /// Measured quality of this transcript (confidence + heuristics + verdict).
    pub quality: TranscriptQuality,
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

    // Text tokens have ids below the first special token (`eot`); timestamp and
    // other special tokens are at/above it. We average confidence over text
    // tokens only, so a high-probability timestamp token can't mask a guessed word.
    let eot = ctx.token_eot();

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

        let confidence = segment_confidence(&state, i, eot);

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
            confidence,
        });
    }

    let segments = group_into_lines(&words);
    // 16 kHz mono → ms; the quality read needs the clip length for coverage.
    let audio_ms = (pcm_16k_mono.len() as u64 * 1000 / 16_000) as u32;
    let quality = assess_quality(&words, &segments, audio_ms);

    Ok(Transcript {
        language,
        words,
        segments,
        quality,
    })
}

/// Mean Whisper token probability over a segment's TEXT tokens (ids `< eot`),
/// i.e. the word's confidence in 0..1. Returns 1.0 if a segment has no readable
/// token probabilities (never penalize on a read failure).
fn segment_confidence(state: &whisper_rs::WhisperState, segment: i32, eot: i32) -> f32 {
    let n = match state.full_n_tokens(segment) {
        Ok(n) => n,
        Err(_) => return 1.0,
    };
    let mut sum = 0f32;
    let mut count = 0u32;
    for j in 0..n {
        match state.full_get_token_id(segment, j) {
            Ok(id) if id >= eot => continue, // special/timestamp token — skip
            Ok(_) => {}
            Err(_) => continue,
        }
        if let Ok(p) = state.full_get_token_prob(segment, j) {
            sum += p;
            count += 1;
        }
    }
    if count == 0 {
        1.0
    } else {
        sum / count as f32
    }
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
        let confidence =
            current.iter().map(|&i| words[i].confidence).sum::<f32>() / current.len() as f32;
        segments.push(Segment {
            text,
            start_ms,
            end_ms,
            confidence,
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

/// Assess transcript quality from per-word confidence + cheap text/timing
/// heuristics — the agent reads `verdict` to decide whether to trust the
/// captions or flag specific lines. See [`TranscriptQuality`].
fn assess_quality(words: &[Word], segments: &[Segment], audio_ms: u32) -> TranscriptQuality {
    let n = words.len();
    let weak_segments: Vec<usize> = segments
        .iter()
        .enumerate()
        .filter(|(_, s)| s.confidence < LOW_CONFIDENCE)
        .map(|(i, _)| i)
        .collect();

    if n == 0 {
        return TranscriptQuality {
            mean_confidence: 0.0,
            low_confidence_frac: 0.0,
            repetition: 0.0,
            coverage: 0.0,
            verdict: "poor".to_string(),
            reasons: vec!["no words were transcribed".to_string()],
            weak_segments,
        };
    }

    let mean_confidence = words.iter().map(|w| w.confidence).sum::<f32>() / n as f32;
    let low = words
        .iter()
        .filter(|w| w.confidence < LOW_CONFIDENCE)
        .count();
    let low_confidence_frac = low as f32 / n as f32;
    let repetition = dominant_word_fraction(words);
    let speech_span = match (words.first(), words.last()) {
        (Some(a), Some(b)) => b.end_ms.saturating_sub(a.start_ms),
        _ => 0,
    };
    let coverage = if audio_ms > 0 {
        (speech_span as f32 / audio_ms as f32).clamp(0.0, 1.0)
    } else {
        0.0
    };

    let mut level = 0u8; // 0 good, 1 fair, 2 poor
    let mut reasons: Vec<String> = Vec::new();
    let raise = |l: u8, why: String, level: &mut u8, reasons: &mut Vec<String>| {
        if l > *level {
            *level = l;
        }
        reasons.push(why);
    };

    // Confidence — the primary signal.
    if mean_confidence < 0.55 {
        raise(
            2,
            format!(
                "low-confidence transcription overall (avg {:.0}%) — many words are likely misheard (noisy audio, a heavy accent, or music under the speech)",
                mean_confidence * 100.0
            ),
            &mut level,
            &mut reasons,
        );
    } else if mean_confidence < 0.72 || low_confidence_frac >= 0.25 {
        raise(
            1,
            format!(
                "{:.0}% of words are low-confidence — re-read the flagged lines before shipping",
                low_confidence_frac * 100.0
            ),
            &mut level,
            &mut reasons,
        );
    }

    // Repetition — a loop is the classic hallucination over non-speech.
    if repetition >= 0.5 {
        raise(
            2,
            "the transcript loops on a repeated phrase — the classic Whisper hallucination over music or silence; trim the non-speech audio and re-run".to_string(),
            &mut level,
            &mut reasons,
        );
    } else if repetition >= 0.35 {
        raise(
            1,
            "a phrase repeats unusually often — check it isn't a transcription loop".to_string(),
            &mut level,
            &mut reasons,
        );
    }

    // Coverage — soft; only flag big dropouts on a long clip.
    if audio_ms > 5_000 && coverage < 0.2 {
        raise(
            1,
            "speech covers only a small part of the clip — captions may be missing for long stretches".to_string(),
            &mut level,
            &mut reasons,
        );
    }

    let verdict = match level {
        0 => "good",
        1 => "fair",
        _ => "poor",
    }
    .to_string();
    if reasons.is_empty() {
        reasons.push("confident across the transcript, no repetition loops".to_string());
    }

    TranscriptQuality {
        mean_confidence,
        low_confidence_frac,
        repetition,
        coverage,
        verdict,
        reasons,
        weak_segments,
    }
}

/// The largest share any single (normalized) word takes of the transcript — a
/// cheap repetition / loop detector. 0 for short transcripts (< 10 words, where
/// the ratio is too noisy to mean anything).
fn dominant_word_fraction(words: &[Word]) -> f32 {
    if words.len() < 10 {
        return 0.0;
    }
    use std::collections::HashMap;
    let mut counts: HashMap<String, u32> = HashMap::new();
    let mut total = 0u32;
    for w in words {
        let key: String = w
            .text
            .chars()
            .filter(|c| c.is_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect();
        if key.is_empty() {
            continue;
        }
        *counts.entry(key).or_insert(0) += 1;
        total += 1;
    }
    let max = counts.values().copied().max().unwrap_or(0);
    if total == 0 {
        0.0
    } else {
        max as f32 / total as f32
    }
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
        let w = |text: &str, start_ms: u32, end_ms: u32| Word {
            text: text.into(),
            start_ms,
            end_ms,
            confidence: 0.9,
        };
        let words = vec![
            w("Hello", 0, 100),
            w("world.", 100, 200),
            w("This", 200, 300),
            w("is", 300, 400),
            w("a", 400, 500),
            w("test", 500, 600),
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
                confidence: 0.9,
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
    fn quality_flags_low_confidence_and_loops() {
        let w = |text: &str, conf: f32| Word {
            text: text.into(),
            start_ms: 0,
            end_ms: 100,
            confidence: conf,
        };

        // Clean, confident, varied → good.
        let good: Vec<Word> = "the quick brown fox jumps over the lazy dog today"
            .split(' ')
            .map(|t| w(t, 0.9))
            .collect();
        let segs = group_into_lines(&good);
        let q = assess_quality(&good, &segs, 1_000);
        assert_eq!(q.verdict, "good", "reasons: {:?}", q.reasons);

        // A repetition loop → poor (dominant-word fraction is high).
        let loopy: Vec<Word> = (0..12).map(|_| w("thanks", 0.9)).collect();
        let segs = group_into_lines(&loopy);
        let q = assess_quality(&loopy, &segs, 1_000);
        assert!(q.repetition > 0.9, "repetition {}", q.repetition);
        assert_eq!(q.verdict, "poor", "reasons: {:?}", q.reasons);

        // Low confidence throughout → poor, with every line flagged.
        let unsure: Vec<Word> = "maybe it said something here or not at all who knows"
            .split(' ')
            .map(|t| w(t, 0.3))
            .collect();
        let segs = group_into_lines(&unsure);
        let q = assess_quality(&unsure, &segs, 1_000);
        assert_eq!(q.verdict, "poor", "reasons: {:?}", q.reasons);
        assert!(!q.weak_segments.is_empty());
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
