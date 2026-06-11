# Studio element-detection strategy — pixel-accurate boxes, cheap, Node-native

From the `vision-element-detection-sota` research. Replaces the brittle color-mask
detector in `studio-vision-correction-loop.md`. Goal: detect EVERY element of a
reference frame with pixel-tight boxes, cheaply enough for a FREE tier (≈$0/video),
with the premium path on Creator/Pro.

## The core inversion (the whole insight)
**Never ask the vision model for pixel coordinates.** It's an architectural limit, not
a prompt problem: vision encoders downsample + tokenize into 14–28px patches, so any
coordinate is patch-quantized and small/edge elements are physically unrepresentable
(even Gemini 3 Pro ≈0.41 mAP; "90% RefCOCO" only means IoU>0.5, not pixel-tight).
So split by strength:
- **VLM = SEMANTICS**: enumerate every element, classify (card/text/icon/shape/image),
  READ the text strings, report fill/stroke colors, Z-ORDER, and a COARSE point per
  element. Its boxes are HINTS that seed detectors — discarded, never final.
- **Deterministic tools = GEOMETRY**: own every pixel-tight box.

## The pipeline (each step Node-runnable)
0. **Enumerate + label** — VLM (Claude/GPT/Gemini API). List elements + types + exact
   strings + colors + z-order + a coarse point. (paid-tier call)
1a. **Text → boxes** — OCR: PaddleOCR-ONNX (onnxruntime-node) or **tesseract.js** (pure
    wasm, zero deps). Per-word/line boxes from real glyph pixels + the string. Free.
1b. **Icons/cards/shapes → boxes** — **Florence-2 via transformers.js** (ONNX, MIT, runs
    in Node, WebGPU/wasm): `<DENSE_REGION_CAPTION>` for inventory,
    `<CAPTION_TO_PHRASE_GROUNDING>` to ground each VLM-named element. OWLv2 (Apache-2.0,
    one-shot via image exemplar) for recurring components. (NB: avoid OmniParser's
    YOLOv8 weights — AGPL — but copy its architecture.)
1c. **Organic/AI-media → masks** — SAM2 / MobileSAM / SlimSAM (ONNX). Feed the VLM's
    point as a prompt → mask bbox is pixel-tight by construction. Encode once/frame,
    cache, snap all elements with the cheap decoder.
2. **Merge + dedupe** — plain-JS IoU, drop >90% overlaps.
3. **Snap pixel-tight** — **opencv.js** (`@techstark/opencv-js`, wasm): Canny + morph
   close + findContours + boundingRect; projection profiles for text (gives cap-height/
   baseline for font sizing); CEBox "+10% then test" so a box doesn't clip a card's
   border/shadow. For ONDA's crisp flat-color cards this is ~as tight as SAM at a
   fraction of the cost — and deterministic.
4. **Set-of-Mark relabel** — overlay the now-tight boxes with numeric IDs; VLM ONLY
   assigns each ID to the taxonomy + confirms z-order + flags MISSED regions. (SoM proof:
   GPT-4V RefCOCOg grounding 25.7 → 75.6 mIoU with marks; residual error is the
   segmenter's, not the language model's.)
5. **Coarse-to-fine for tiny elements** — crop+upscale the region, RE-RUN OCR/Florence-2
   on the high-res crop (re-detect, not just crop), map coords back. Beats the patch limit.
6. **Render → diff → converge (ONDA's unfair advantage)** — build the scene to the boxes,
   render deterministically, per-element IoU + SSIM + pixelmatch vs the reference (cropped
   to the REFERENCE's bounds, never ours), nudge mismatches, re-render to convergence.
   The engine IS the verifier — no Playwright, no GPU service. This is what hits ~100%.

## Cost tiers (the business fit)
- **FREE (≈$0/video):** steps 1a/1b-lite/3/6 only — OCR + opencv.js contour snapping +
  render→diff→converge. NO per-element VLM calls (or one cached enumerate). For clean
  flat-color UI/graphics frames this already gets pixel-tight. "Good, it works."
- **CREATOR/PRO (cost covered by subscription):** add steps 0/1b-full/1c/4/5 — VLM
  enumerate + Florence-2/SAM + Set-of-Mark relabel + coarse-to-fine. Handles arbitrary/
  photographic/AI-media references, exact replication. "Studio-tier."

## Honest limits
VLM coords are seeds only. SAM/Florence need ONNX runtime (heavier first-load on
client; fine server-side). The render→diff→converge loop is the only step that turns
"near" into "exact" — and it's the one ONDA gets nearly free. Links:
[[onda-flows-replication-and-vision-loop]] [[onda-engine-public-studio-moat]]
