//! Voice styles: load the packed `voices-v1.0.bin` and curate the catalog.
//!
//! `voices-v1.0.bin` is a NumPy `.npz` (a zip archive of one `.npy` per voice).
//! Each entry is a `(510, 1, 256)` float32 tensor: a style vector for every
//! phoneme-length bucket (Kokoro indexes the style by token count — `style =
//! voices[voice][n_tokens]`). We read the one row the utterance needs.

use std::io::Read;
use std::path::Path;

use anyhow::{bail, Context, Result};

/// The style-vector width Kokoro expects (`shape[2]` of each voice tensor).
pub const STYLE_DIM: usize = 256;
/// The maximum phoneme/token length Kokoro was trained for (`shape[0]`); also the
/// number of length-indexed style rows per voice.
pub const MAX_PHONEME_LENGTH: usize = 510;

/// A voice the engine can speak with, plus a curated human label for the Studio
/// to RECOMMEND from (gender, accent, a one-word character).
#[derive(Debug, Clone, serde::Serialize)]
pub struct VoiceInfo {
    /// The voice id passed to `--voice` (e.g. `af_heart`).
    pub id: &'static str,
    /// A short human label, e.g. "af_heart — US English, female, warm".
    pub label: &'static str,
    /// True for the US/UK English voices that match our espeak en-us/en-gb
    /// phonemization (the ones that narrate correctly). The non-English voices
    /// ship in the model but mispronounce English IPA — listed, not recommended.
    pub english: bool,
}

/// The curated voice catalog. English voices first (Studio recommends these), then
/// the other-language voices (present in the model, but only speak their own
/// language well — English text would be mispronounced).
pub const CATALOG: &[VoiceInfo] = &[
    // ── US English (espeak en-us) ───────────────────────────────────────────
    VoiceInfo {
        id: "af_heart",
        label: "af_heart — US English, female, warm (default)",
        english: true,
    },
    VoiceInfo {
        id: "af_bella",
        label: "af_bella — US English, female, bright",
        english: true,
    },
    VoiceInfo {
        id: "af_nicole",
        label: "af_nicole — US English, female, soft",
        english: true,
    },
    VoiceInfo {
        id: "af_sarah",
        label: "af_sarah — US English, female, neutral",
        english: true,
    },
    VoiceInfo {
        id: "af_sky",
        label: "af_sky — US English, female, light",
        english: true,
    },
    VoiceInfo {
        id: "af_nova",
        label: "af_nova — US English, female, crisp",
        english: true,
    },
    VoiceInfo {
        id: "af_aoede",
        label: "af_aoede — US English, female, smooth",
        english: true,
    },
    VoiceInfo {
        id: "af_kore",
        label: "af_kore — US English, female, steady",
        english: true,
    },
    VoiceInfo {
        id: "af_alloy",
        label: "af_alloy — US English, female, even",
        english: true,
    },
    VoiceInfo {
        id: "af_jessica",
        label: "af_jessica — US English, female, casual",
        english: true,
    },
    VoiceInfo {
        id: "af_river",
        label: "af_river — US English, female, calm",
        english: true,
    },
    VoiceInfo {
        id: "am_michael",
        label: "am_michael — US English, male, warm",
        english: true,
    },
    VoiceInfo {
        id: "am_adam",
        label: "am_adam — US English, male, deep",
        english: true,
    },
    VoiceInfo {
        id: "am_echo",
        label: "am_echo — US English, male, neutral",
        english: true,
    },
    VoiceInfo {
        id: "am_eric",
        label: "am_eric — US English, male, clear",
        english: true,
    },
    VoiceInfo {
        id: "am_liam",
        label: "am_liam — US English, male, friendly",
        english: true,
    },
    VoiceInfo {
        id: "am_onyx",
        label: "am_onyx — US English, male, rich",
        english: true,
    },
    VoiceInfo {
        id: "am_puck",
        label: "am_puck — US English, male, lively",
        english: true,
    },
    VoiceInfo {
        id: "am_fenrir",
        label: "am_fenrir — US English, male, bold",
        english: true,
    },
    VoiceInfo {
        id: "am_santa",
        label: "am_santa — US English, male, jovial",
        english: true,
    },
    // ── UK English (espeak en-gb) ───────────────────────────────────────────
    VoiceInfo {
        id: "bf_emma",
        label: "bf_emma — UK English, female, warm",
        english: true,
    },
    VoiceInfo {
        id: "bf_alice",
        label: "bf_alice — UK English, female, bright",
        english: true,
    },
    VoiceInfo {
        id: "bf_isabella",
        label: "bf_isabella — UK English, female, refined",
        english: true,
    },
    VoiceInfo {
        id: "bf_lily",
        label: "bf_lily — UK English, female, soft",
        english: true,
    },
    VoiceInfo {
        id: "bm_george",
        label: "bm_george — UK English, male, warm",
        english: true,
    },
    VoiceInfo {
        id: "bm_daniel",
        label: "bm_daniel — UK English, male, neutral",
        english: true,
    },
    VoiceInfo {
        id: "bm_fable",
        label: "bm_fable — UK English, male, storyteller",
        english: true,
    },
    VoiceInfo {
        id: "bm_lewis",
        label: "bm_lewis — UK English, male, deep",
        english: true,
    },
    // ── Other languages (present in the model; not for English narration) ────
    VoiceInfo {
        id: "ef_dora",
        label: "ef_dora — Spanish, female (not English)",
        english: false,
    },
    VoiceInfo {
        id: "em_alex",
        label: "em_alex — Spanish, male (not English)",
        english: false,
    },
    VoiceInfo {
        id: "em_santa",
        label: "em_santa — Spanish, male (not English)",
        english: false,
    },
    VoiceInfo {
        id: "ff_siwis",
        label: "ff_siwis — French, female (not English)",
        english: false,
    },
    VoiceInfo {
        id: "hf_alpha",
        label: "hf_alpha — Hindi, female (not English)",
        english: false,
    },
    VoiceInfo {
        id: "hf_beta",
        label: "hf_beta — Hindi, female (not English)",
        english: false,
    },
    VoiceInfo {
        id: "hm_omega",
        label: "hm_omega — Hindi, male (not English)",
        english: false,
    },
    VoiceInfo {
        id: "hm_psi",
        label: "hm_psi — Hindi, male (not English)",
        english: false,
    },
    VoiceInfo {
        id: "if_sara",
        label: "if_sara — Italian, female (not English)",
        english: false,
    },
    VoiceInfo {
        id: "im_nicola",
        label: "im_nicola — Italian, male (not English)",
        english: false,
    },
    VoiceInfo {
        id: "jf_alpha",
        label: "jf_alpha — Japanese, female (not English)",
        english: false,
    },
    VoiceInfo {
        id: "jf_gongitsune",
        label: "jf_gongitsune — Japanese, female (not English)",
        english: false,
    },
    VoiceInfo {
        id: "jf_nezumi",
        label: "jf_nezumi — Japanese, female (not English)",
        english: false,
    },
    VoiceInfo {
        id: "jf_tebukuro",
        label: "jf_tebukuro — Japanese, female (not English)",
        english: false,
    },
    VoiceInfo {
        id: "jm_kumo",
        label: "jm_kumo — Japanese, male (not English)",
        english: false,
    },
    VoiceInfo {
        id: "pf_dora",
        label: "pf_dora — Portuguese, female (not English)",
        english: false,
    },
    VoiceInfo {
        id: "pm_alex",
        label: "pm_alex — Portuguese, male (not English)",
        english: false,
    },
    VoiceInfo {
        id: "pm_santa",
        label: "pm_santa — Portuguese, male (not English)",
        english: false,
    },
    VoiceInfo {
        id: "zf_xiaobei",
        label: "zf_xiaobei — Chinese, female (not English)",
        english: false,
    },
    VoiceInfo {
        id: "zf_xiaoni",
        label: "zf_xiaoni — Chinese, female (not English)",
        english: false,
    },
    VoiceInfo {
        id: "zf_xiaoxiao",
        label: "zf_xiaoxiao — Chinese, female (not English)",
        english: false,
    },
    VoiceInfo {
        id: "zf_xiaoyi",
        label: "zf_xiaoyi — Chinese, female (not English)",
        english: false,
    },
    VoiceInfo {
        id: "zm_yunjian",
        label: "zm_yunjian — Chinese, male (not English)",
        english: false,
    },
    VoiceInfo {
        id: "zm_yunxi",
        label: "zm_yunxi — Chinese, male (not English)",
        english: false,
    },
    VoiceInfo {
        id: "zm_yunxia",
        label: "zm_yunxia — Chinese, male (not English)",
        english: false,
    },
    VoiceInfo {
        id: "zm_yunyang",
        label: "zm_yunyang — Chinese, male (not English)",
        english: false,
    },
];

/// Look up a voice in the catalog (so we can give a friendly error if it's an
/// unknown id, and so the default is centralized).
pub fn voice_info(id: &str) -> Option<&'static VoiceInfo> {
    CATALOG.iter().find(|v| v.id == id)
}

/// True if the voice's `bf_`/`bm_` prefix means UK English (espeak `en-gb`); else
/// US English (`en-us`). Only meaningful for the English voices.
pub fn is_uk(voice: &str) -> bool {
    voice.starts_with("bf_") || voice.starts_with("bm_")
}

/// The loaded style tensors for one voice: `MAX_PHONEME_LENGTH` rows of
/// `STYLE_DIM` floats. We pull the row at `n_tokens` for an utterance.
pub struct VoiceStyles {
    /// Row-major `[MAX_PHONEME_LENGTH][STYLE_DIM]` f32.
    rows: Vec<f32>,
}

impl VoiceStyles {
    /// The style row Kokoro wants for an utterance of `n_tokens` phoneme tokens
    /// (the model is length-conditioned). Clamped to the valid row range.
    pub fn style_for_len(&self, n_tokens: usize) -> &[f32] {
        let row = n_tokens.min(MAX_PHONEME_LENGTH - 1);
        let start = row * STYLE_DIM;
        &self.rows[start..start + STYLE_DIM]
    }
}

/// Load one voice's `(510, 1, 256)` f32 style tensor out of the packed `.npz`.
pub fn load_voice(voices_bin: &Path, voice: &str) -> Result<VoiceStyles> {
    let file = std::fs::File::open(voices_bin)
        .with_context(|| format!("opening voices file '{}'", voices_bin.display()))?;
    let mut zip = zip::ZipArchive::new(file)
        .with_context(|| format!("'{}' is not a valid .npz archive", voices_bin.display()))?;

    let entry_name = format!("{voice}.npy");
    let mut entry = zip.by_name(&entry_name).map_err(|_| {
        let avail = available_voice_ids(voices_bin).unwrap_or_default();
        anyhow::anyhow!(
            "voice '{voice}' is not in '{}'. Available: {}",
            voices_bin.display(),
            avail.join(", ")
        )
    })?;
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut bytes)
        .with_context(|| format!("reading voice tensor '{entry_name}'"))?;

    let rows = parse_npy_f32(&bytes)
        .with_context(|| format!("parsing the .npy style tensor for voice '{voice}'"))?;
    let expected = MAX_PHONEME_LENGTH * STYLE_DIM;
    if rows.len() != expected {
        bail!(
            "voice '{voice}' style tensor has {} floats, expected {expected} ({MAX_PHONEME_LENGTH}×{STYLE_DIM})",
            rows.len()
        );
    }
    Ok(VoiceStyles { rows })
}

/// The voice ids actually present in the packed file (the catalog is the curated
/// view; this is the ground truth, used for the "available voices" error).
pub fn available_voice_ids(voices_bin: &Path) -> Result<Vec<String>> {
    let file = std::fs::File::open(voices_bin)
        .with_context(|| format!("opening voices file '{}'", voices_bin.display()))?;
    let mut zip = zip::ZipArchive::new(file)
        .with_context(|| format!("'{}' is not a valid .npz archive", voices_bin.display()))?;
    let mut ids: Vec<String> = (0..zip.len())
        .filter_map(|i| zip.by_index(i).ok().map(|f| f.name().to_string()))
        .map(|n| n.strip_suffix(".npy").unwrap_or(&n).to_string())
        .collect();
    ids.sort();
    Ok(ids)
}

/// Parse a NumPy `.npy` (v1.0) holding a `<f4` (little-endian f32) array, returning
/// the flat data row-major. We only need the values in order (the model wants a
/// `(n_tokens-indexed)` row of 256), so we parse the header for the dtype/order
/// guard and then read the body as f32.
fn parse_npy_f32(bytes: &[u8]) -> Result<Vec<f32>> {
    // Magic: \x93NUMPY, then version (1 byte major, 1 byte minor).
    if bytes.len() < 10 || &bytes[0..6] != b"\x93NUMPY" {
        bail!("not a .npy file (bad magic)");
    }
    let major = bytes[6];
    // v1.0 has a 2-byte little-endian header length; v2.0+ uses 4 bytes.
    let (header_len, header_start) = if major >= 2 {
        let len = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]) as usize;
        (len, 12)
    } else {
        let len = u16::from_le_bytes([bytes[8], bytes[9]]) as usize;
        (len, 10)
    };
    let header_end = header_start + header_len;
    if header_end > bytes.len() {
        bail!(".npy header runs past end of file");
    }
    let header = std::str::from_utf8(&bytes[header_start..header_end])
        .context(".npy header is not valid UTF-8")?;
    // Guard the dtype: must be little-endian f32, C order. (Fortran order would
    // transpose the rows; the Kokoro voices are all '<f4', C order.)
    if !header.contains("'<f4'") && !header.contains("\"<f4\"") {
        bail!(".npy is not little-endian float32 ('<f4'): {header}");
    }
    if header.contains("'fortran_order': True") {
        bail!(".npy is Fortran-ordered; expected C order");
    }

    let body = &bytes[header_end..];
    if body.len() % 4 != 0 {
        bail!(
            ".npy float32 body length {} is not a multiple of 4",
            body.len()
        );
    }
    let mut out = Vec::with_capacity(body.len() / 4);
    for chunk in body.chunks_exact(4) {
        out.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    Ok(out)
}
