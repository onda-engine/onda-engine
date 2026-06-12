//! Build-time stamping for `onda --version`.
//!
//! Embeds the short git SHA and the build date as `ONDA_GIT_SHA` /
//! `ONDA_BUILD_DATE` env vars (read in main.rs via `env!`). No dependencies —
//! std only — so the stamp adds nothing to the build graph. When git is absent
//! (e.g. building from a release tarball) the SHA is "unknown"; the date honors
//! the SOURCE_DATE_EPOCH reproducible-builds convention, falling back to the
//! current UTC date.

use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn main() {
    // Re-stamp when HEAD moves (new commit / branch switch). Harmless if the
    // paths don't exist (tarball build).
    println!("cargo:rerun-if-changed=../../.git/HEAD");
    println!("cargo:rerun-if-changed=../../.git/refs");
    println!("cargo:rerun-if-env-changed=SOURCE_DATE_EPOCH");

    println!("cargo:rustc-env=ONDA_GIT_SHA={}", git_short_sha());
    println!("cargo:rustc-env=ONDA_BUILD_DATE={}", build_date());
}

/// `git rev-parse --short HEAD`, or "unknown" when git/the repo is unavailable.
fn git_short_sha() -> String {
    let output = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output();
    match output {
        Ok(out) if out.status.success() => {
            let sha = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if sha.is_empty() {
                "unknown".to_string()
            } else {
                sha
            }
        }
        _ => "unknown".to_string(),
    }
}

/// The build date as `yyyy-mm-dd` (UTC). Uses SOURCE_DATE_EPOCH when set (the
/// reproducible-builds convention), else the current time.
fn build_date() -> String {
    let secs = std::env::var("SOURCE_DATE_EPOCH")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0)
        });
    let (y, m, d) = civil_from_unix(secs);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Unix seconds → (year, month, day) in UTC. Howard Hinnant's `civil_from_days`
/// algorithm — exact for the proleptic Gregorian calendar, std only.
fn civil_from_unix(secs: u64) -> (i64, u32, u32) {
    let days = (secs / 86_400) as i64;
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097); // [0, 146096]
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp = (5 * doy + 2) / 153; // [0, 11]
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32; // [1, 31]
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32; // [1, 12]
    (if m <= 2 { y + 1 } else { y }, m, d)
}
