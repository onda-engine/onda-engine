//! Locate a complete `espeak-ng-data` directory and embed its path.
//!
//! espeak-rs links espeak-ng from vendored C source, but the espeak-ng *data*
//! (`phondata`/`phontab`/`phonindex`/… — the compiled phoneme tables the runtime
//! needs to phonemize) is generated at build time by espeak-ng's own data
//! compiler, which is fragile and skipped unless the `compile-espeak-intonations`
//! feature is on (and even then fails on some toolchains). So instead of relying
//! on that, we locate a COMPLETE `espeak-ng-data` (with a real `phondata`) on the
//! build machine — installed by every espeak-ng package — and embed its path so
//! the runtime can point espeak at it. The data is tiny (~12 MB) and identical
//! across platforms.
//!
//! Build-time requirement: a complete `espeak-ng-data` on disk, i.e. an espeak-ng
//! install: macOS `brew install espeak-ng`; Debian/Ubuntu `apt-get install
//! espeak-ng espeak-ng-data`. If none is found we DON'T fail the build (the C lib
//! still links) — we emit a warning and leave the runtime to search system paths
//! / honor `PIPER_ESPEAKNG_DATA_DIRECTORY`, erroring clearly only if speech is
//! actually attempted without data.

use std::path::{Path, PathBuf};

fn main() {
    // The candidate parents that may contain an `espeak-ng-data/` with a real
    // `phondata` — the common system install locations across platforms.
    let env_dir = std::env::var_os("ESPEAK_NG_DATA_DIR").map(PathBuf::from);
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(d) = env_dir {
        candidates.push(d);
    }
    candidates.extend(
        [
            "/opt/homebrew/share/espeak-ng-data", // macOS arm64 (Homebrew)
            "/usr/local/share/espeak-ng-data",    // macOS x86 / local installs
            "/usr/share/espeak-ng-data",          // Debian/Ubuntu (apt)
            "/usr/lib/x86_64-linux-gnu/espeak-ng-data",
        ]
        .iter()
        .map(PathBuf::from),
    );

    let found = candidates.into_iter().find(|d| is_complete_data_dir(d));

    if let Some(dir) = found {
        // Embed the absolute path so the runtime can set
        // PIPER_ESPEAKNG_DATA_DIRECTORY to its PARENT (espeak appends
        // `espeak-ng-data`).
        let parent = dir.parent().unwrap_or(&dir);
        println!(
            "cargo:rustc-env=ONDA_ESPEAK_DATA_PARENT={}",
            parent.display()
        );
        println!("cargo:rerun-if-changed={}", dir.display());
    } else {
        println!(
            "cargo:warning=onda-tts: no complete espeak-ng-data found at build time. \
             Install espeak-ng (macOS: `brew install espeak-ng`; Debian/Ubuntu: \
             `apt-get install espeak-ng espeak-ng-data`) or set ESPEAK_NG_DATA_DIR. \
             At runtime, set PIPER_ESPEAKNG_DATA_DIRECTORY to the dir CONTAINING \
             espeak-ng-data, else `onda speak` will fail with a clear error."
        );
    }
    println!("cargo:rerun-if-env-changed=ESPEAK_NG_DATA_DIR");
}

/// A data dir is usable only if it has a real `phondata` (the compiled phoneme
/// tables) — `lang/` + `voices/` alone (what espeak-rs ships) is not enough.
fn is_complete_data_dir(dir: &Path) -> bool {
    dir.join("phondata").is_file() && dir.join("phontab").is_file()
}
