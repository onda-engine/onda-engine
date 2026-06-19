# Security Policy

ONDA is **pre-1.0**. Only the latest published `@onda-engine/*` packages and the current `main` receive security fixes — pin a version and watch releases until 1.0.

## Reporting a vulnerability

**Please report privately — do not open a public issue.**

- **Preferred:** GitHub's [private vulnerability reporting](https://github.com/onda-engine/onda-engine/security/advisories/new) (repo → **Security → Report a vulnerability**).
- If that's unavailable, contact a maintainer directly through GitHub.

Please include the affected package/version, a reproduction if possible, and — for renderer issues — your platform and GPU/driver (and whether it reproduces on the deterministic `--backend cpu` reference). We aim to **acknowledge within 3 business days** and to share a remediation timeline after triage. Please give us reasonable time to ship a fix before any public disclosure; we're glad to credit you.

## Scope & surface

ONDA renders with native and WebAssembly code. First-party Rust contains **no hand-written `unsafe`** — most of the security surface lives in dependencies:

- **Renderer:** Vello / wgpu (GPU), tiny-skia (CPU).
- **Optional CLI features:** whisper.cpp (`transcribe`), ONNX Runtime (`segment`), espeak-ng + Kokoro (`speak`), and `ffmpeg` (encode/decode).

We track upstream advisories for these and bump promptly. A vulnerability in a third-party dependency is best reported upstream as well as to us.
