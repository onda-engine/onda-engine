---
"@onda-engine/components": patch
"@onda-engine/cinema": patch
"@onda-engine/player": patch
"@onda-engine/react": patch
"@onda-engine/render": patch
"@onda-engine/wasm": patch
"@onda-engine/wasm-vello": patch
"@onda-engine/wasm-audio": patch
---

Relicense to FSL-1.1-ALv2 (Functional Source License, Apache-2.0 future).

License metadata only — no runtime or API changes. Each package now declares
`FSL-1.1-ALv2` instead of `MIT OR Apache-2.0`. The engine is source-available
(read, run, self-host, modify, build non-competing products); each release
converts to Apache-2.0 two years after publication. This patch republishes the
packages so consumers (incl. ONDA Studio's CI/prod build) pull the correct
license.
