---
"@onda-engine/components": minor
---

Keyframes: text `align`/`vAlign` 9-point anchoring + slot-bindable content fields.

- **Text alignment** — Keyframes text content gains `align` (`left`/`center`/`right`) and `vAlign` (`top`/`middle`/`bottom`), each measured via the shared glyph-line primitive and anchored on the `position` point. Combine for the full 9-point grid. Overrides the legacy `anchorX`/`anchorY`; unset = previous behaviour (backward-compatible).
- **Slot bindings** — image `src`/`gradient`/`color`/`stroke` and text `text`/`color` accept a `{ slot, default, value }` binding so a template's fills/copy can be swapped without touching its frozen motion tracks. `slotValue()` resolves `value ?? default`; literals still work unchanged.
