# @onda-engine/components

## 0.3.0

### Minor Changes

- eb9efb3: Keyframes: text `align`/`vAlign` 9-point anchoring + slot-bindable content fields.

  - **Text alignment** — Keyframes text content gains `align` (`left`/`center`/`right`) and `vAlign` (`top`/`middle`/`bottom`), each measured via the shared glyph-line primitive and anchored on the `position` point. Combine for the full 9-point grid. Overrides the legacy `anchorX`/`anchorY`; unset = previous behaviour (backward-compatible).
  - **Slot bindings** — image `src`/`gradient`/`color`/`stroke` and text `text`/`color` accept a `{ slot, default, value }` binding so a template's fills/copy can be swapped without touching its frozen motion tracks. `slotValue()` resolves `value ?? default`; literals still work unchanged.

## 0.2.1

### Patch Changes

- 12c3b02: Relicense to FSL-1.1-ALv2 (Functional Source License, Apache-2.0 future).

  License metadata only — no runtime or API changes. Each package now declares
  `FSL-1.1-ALv2` instead of `MIT OR Apache-2.0`. The engine is source-available
  (read, run, self-host, modify, build non-competing products); each release
  converts to Apache-2.0 two years after publication. This patch republishes the
  packages so consumers (incl. ONDA Studio's CI/prod build) pull the correct
  license.

- Updated dependencies [12c3b02]
  - @onda-engine/react@0.1.1
  - @onda-engine/wasm@0.1.1
  - @onda-engine/wasm-audio@0.1.1

## 0.2.0

### Minor Changes

- d2cdfba: Add **CardShowcase** — a tilted card-conveyor brand showcase component — and **ImageReveal** `motion: 'none'` (held still, no entrance). Both are registered in the manifest as agent-facing.
