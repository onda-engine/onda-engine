//! Text → IPA phonemes → Kokoro token ids.
//!
//! Mirrors the validated `kokoro-onnx` Python pipeline exactly:
//! 1. espeak-ng phonemizes the text to IPA (`with_stress`, `preserve_punctuation`),
//! 2. the phoneme string is filtered to the 114-entry Kokoro vocab (anything not
//!    in the vocab — stray espeak markers, unsupported symbols — is dropped),
//! 3. each surviving symbol maps to its token id via the vocab.
//!
//! The model input is then `[0, ...token_ids, 0]` (the bracketing pad tokens).

use std::path::{Path, PathBuf};
use std::sync::Once;

use anyhow::{bail, Context, Result};

/// Point espeak-rs at a COMPLETE `espeak-ng-data` (one with a real `phondata`)
/// exactly once, before the first phonemization. espeak-rs looks up
/// `espeak-ng-data` under `PIPER_ESPEAKNG_DATA_DIRECTORY`, then the cwd, then the
/// exe dir — and the vendored build doesn't reliably produce the data, so we set
/// the env var to a complete dir we locate. Order: an already-set
/// `PIPER_ESPEAKNG_DATA_DIRECTORY` (respected), the path embedded at build time
/// (`ONDA_ESPEAK_DATA_PARENT` — a system espeak-ng install), then common system
/// locations. A no-op if espeak's default search would already work.
fn ensure_espeak_data() {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        // If the user already pointed espeak at data, respect it.
        if let Some(p) = std::env::var_os("PIPER_ESPEAKNG_DATA_DIRECTORY") {
            let parent = PathBuf::from(p);
            if parent.join("espeak-ng-data").join("phondata").is_file() {
                return;
            }
        }
        // The parent dir embedded by build.rs (a complete system data dir), then
        // common system install parents.
        let mut parents: Vec<PathBuf> = Vec::new();
        if let Some(embedded) = option_env!("ONDA_ESPEAK_DATA_PARENT") {
            parents.push(PathBuf::from(embedded));
        }
        parents.extend(
            [
                "/opt/homebrew/share",
                "/usr/local/share",
                "/usr/share",
                "/usr/lib/x86_64-linux-gnu",
            ]
            .iter()
            .map(PathBuf::from),
        );
        if let Some(parent) = parents.into_iter().find(|p: &PathBuf| has_complete_data(p)) {
            std::env::set_var("PIPER_ESPEAKNG_DATA_DIRECTORY", &parent);
        }
        // If nothing is found we don't set anything; espeak's init will fail with
        // its own actionable "set PIPER_ESPEAKNG_DATA_DIRECTORY" message, which we
        // surface verbatim.
    });
}

/// True if `parent/espeak-ng-data/phondata` exists (a complete data dir).
fn has_complete_data(parent: &Path) -> bool {
    parent.join("espeak-ng-data").join("phondata").is_file()
}

/// The Kokoro vocabulary: 114 (symbol → token id) entries, verbatim from
/// `kokoro-onnx`'s `config.json`. The symbols are single Unicode scalar values
/// (IPA letters, stress/length marks, punctuation, intonation arrows).
const VOCAB: &[(char, i64)] = &[
    (';', 1),
    (':', 2),
    (',', 3),
    ('.', 4),
    ('!', 5),
    ('?', 6),
    ('—', 9),
    ('…', 10),
    ('"', 11),
    ('(', 12),
    (')', 13),
    ('“', 14),
    ('”', 15),
    (' ', 16),
    ('\u{0303}', 17),
    ('ʣ', 18),
    ('ʥ', 19),
    ('ʦ', 20),
    ('ʨ', 21),
    ('ᵝ', 22),
    ('ꭧ', 23),
    ('A', 24),
    ('I', 25),
    ('O', 31),
    ('Q', 33),
    ('S', 35),
    ('T', 36),
    ('W', 39),
    ('Y', 41),
    ('ᵊ', 42),
    ('a', 43),
    ('b', 44),
    ('c', 45),
    ('d', 46),
    ('e', 47),
    ('f', 48),
    ('h', 50),
    ('i', 51),
    ('j', 52),
    ('k', 53),
    ('l', 54),
    ('m', 55),
    ('n', 56),
    ('o', 57),
    ('p', 58),
    ('q', 59),
    ('r', 60),
    ('s', 61),
    ('t', 62),
    ('u', 63),
    ('v', 64),
    ('w', 65),
    ('x', 66),
    ('y', 67),
    ('z', 68),
    ('ɑ', 69),
    ('ɐ', 70),
    ('ɒ', 71),
    ('æ', 72),
    ('β', 75),
    ('ɔ', 76),
    ('ɕ', 77),
    ('ç', 78),
    ('ɖ', 80),
    ('ð', 81),
    ('ʤ', 82),
    ('ə', 83),
    ('ɚ', 85),
    ('ɛ', 86),
    ('ɜ', 87),
    ('ɟ', 90),
    ('ɡ', 92),
    ('ɥ', 99),
    ('ɨ', 101),
    ('ɪ', 102),
    ('ʝ', 103),
    ('ɯ', 110),
    ('ɰ', 111),
    ('ŋ', 112),
    ('ɳ', 113),
    ('ɲ', 114),
    ('ɴ', 115),
    ('ø', 116),
    ('ɸ', 118),
    ('θ', 119),
    ('œ', 120),
    ('ɹ', 123),
    ('ɾ', 125),
    ('ɻ', 126),
    ('ʁ', 128),
    ('ɽ', 129),
    ('ʂ', 130),
    ('ʃ', 131),
    ('ʈ', 132),
    ('ʧ', 133),
    ('ʊ', 135),
    ('ʋ', 136),
    ('ʌ', 138),
    ('ɣ', 139),
    ('ɤ', 140),
    ('χ', 142),
    ('ʎ', 143),
    ('ʒ', 147),
    ('ʔ', 148),
    ('ˈ', 156),
    ('ˌ', 157),
    ('ː', 158),
    ('ʰ', 162),
    ('ʲ', 164),
    ('↓', 169),
    ('→', 171),
    ('↗', 172),
    ('↘', 173),
    ('ᵻ', 177),
];

/// The id the vocab assigns to a symbol, if any.
fn token_id(c: char) -> Option<i64> {
    VOCAB.iter().find(|(s, _)| *s == c).map(|(_, id)| *id)
}

/// Map an IPA phoneme string to Kokoro token ids: keep only symbols in the vocab,
/// in order. (espeak emits a few symbols Kokoro doesn't model — e.g. an
/// affricate written as two chars, a tie bar — those are simply dropped, exactly
/// like the Python `filter(lambda p: p in vocab, phonemes)`.)
pub fn tokens_from_phonemes(phonemes: &str) -> Vec<i64> {
    phonemes.chars().filter_map(token_id).collect()
}

/// Phonemize `text` to a single IPA string for the given English variant, then to
/// Kokoro token ids. `uk` selects espeak `en-gb` (UK voices) vs `en-us`.
///
/// espeak returns one string per sentence; we join them with a space so a
/// multi-sentence script becomes one utterance (Kokoro handles the pauses from
/// the preserved punctuation). Returns the joined phoneme string (for debugging /
/// the CLI summary) and the token ids.
pub fn text_to_tokens(text: &str, uk: bool) -> Result<(String, Vec<i64>)> {
    let text = text.trim();
    if text.is_empty() {
        bail!("nothing to speak (empty text)");
    }
    // espeak-rs sets the voice via `espeak_SetVoiceByName`, which only accepts the
    // bare top-level names: `en-us` (American) and `en` (which defaults to British
    // English — `en-gb` as a SetVoiceByName arg is rejected). So US voices use
    // `en-us`; UK voices use `en` (British pronunciation).
    let lang = if uk { "en" } else { "en-us" };
    // Make sure espeak can find its phoneme tables (set the data dir once).
    ensure_espeak_data();
    // `text_to_phonemes` returns IPA with stress marks + preserved punctuation
    // (espeak's with_stress / preserve_punctuation), one entry per sentence.
    let sentences = espeak_rs::text_to_phonemes(text, lang, None)
        .map_err(|e| anyhow::anyhow!("espeak-ng phonemization failed: {e}"))
        .context("converting text to IPA phonemes")?;
    let phonemes = sentences.join(" ");
    let tokens = tokens_from_phonemes(&phonemes);
    if tokens.is_empty() {
        bail!("no speakable phonemes produced for '{text}' (got phonemes: '{phonemes}')");
    }
    Ok((phonemes, tokens))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vocab_has_114_entries_and_no_dupes() {
        assert_eq!(VOCAB.len(), 114);
        // No duplicate symbols, no duplicate ids.
        let mut syms: Vec<char> = VOCAB.iter().map(|(s, _)| *s).collect();
        syms.sort();
        syms.dedup();
        assert_eq!(syms.len(), 114, "duplicate symbols in vocab");
    }

    #[test]
    fn filters_unknown_symbols() {
        // 'h','ə','l','o' are in-vocab; '🔥' and 'ñ' are not → dropped.
        let toks = tokens_from_phonemes("h🔥əlño");
        assert_eq!(
            toks,
            vec![
                token_id('h').unwrap(),
                token_id('ə').unwrap(),
                token_id('l').unwrap(),
                token_id('o').unwrap(),
            ]
        );
    }

    #[test]
    fn known_ids_match_reference() {
        // Spot-check a few ids against the reference config.json.
        assert_eq!(token_id(' '), Some(16));
        assert_eq!(token_id('ˈ'), Some(156)); // primary stress
        assert_eq!(token_id('ə'), Some(83)); // schwa
        assert_eq!(token_id('.'), Some(4));
    }
}
