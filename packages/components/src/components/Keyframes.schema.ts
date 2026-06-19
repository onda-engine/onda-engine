//! Runtime prop schema for {@link Keyframes} — @onda-native (mirrors KeyframesProps).
//! The Studio agent generates against this; the preview/export renderer validates with it.

import { z } from 'zod'

// Easing: a named curve OR a raw cubic-bezier [x1,y1,x2,y2] (so an AE/Lottie handle transcribes 1:1).
const easeSchema = z
  .union([
    z.enum(['linear', 'ease', 'easeIn', 'easeOut', 'easeInOut']),
    z.tuple([z.number(), z.number(), z.number(), z.number()]),
  ])
  .optional()
  .describe('Easing of the segment ENDING at this key — named, or a cubic-bezier [x1,y1,x2,y2].')

const posKey = z.object({
  at: z.number().describe('Frame.'),
  x: z.number(),
  y: z.number(),
  ease: easeSchema,
})
const valKey = z.object({
  at: z.number().describe('Frame.'),
  v: z.number(),
  ease: easeSchema,
})

// A tile can be filled three ways, in priority order: an `src` image, a
// `gradient`, or a solid `color` (falling back to the theme surface). This lets a
// template ship as editable color/gradient cards the user can swap for images.
const gradientStop = z.object({ offset: z.number(), color: z.string() })
const point = z.union([
  z.tuple([z.number(), z.number()]),
  z.object({ x: z.number(), y: z.number() }),
])
const gradientSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('linear'), start: point, end: point, stops: z.array(gradientStop) }),
    z.object({
      type: z.literal('radial'),
      center: point,
      radius: z.number(),
      stops: z.array(gradientStop),
    }),
    z.object({
      type: z.literal('fbm'),
      stops: z.array(gradientStop),
      scale: z.number().optional(),
      time: z.number().optional(),
      warp: z.number().optional(),
    }),
  ])
  .describe('Gradient fill (linear/radial/fbm) used when `src` is absent — wins over `color`.')

// ── Slot binding ──────────────────────────────────────────────────────────────
// A NAMED, optional convenience layer for re-skinning a template into a FAMILY — it does
// NOT restrict editing. Any field is still freely settable to a plain literal (the agent
// edits ANYTHING directly), and the motion keyframes are edited as tracks; slots just add
// a shareable handle on top. A slot-bound field carries: `slot` (the binding id —
// elements may SHARE one, so one set_slot recolors/resizes them together); `default` (the
// original literal, rendered until something sets `value`, so a converted template is
// byte-identical); and `value` (the override, which wins). For a color, value/default is
// ANY string: a brand-token name ("accent" → recolors with the brand) OR a literal hex
// ("#00ff00" → fixed). NOT limited to brand tokens.
const slotRef = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({
    slot: z
      .string()
      .describe('Slot binding id — the handle set_slot targets; fills may share one.'),
    default: inner.describe(
      'Original literal — rendered when the slot is unset (keeps the template byte-identical).',
    ),
    value: inner
      .optional()
      .describe('Override value (set_slot) — wins over `default` when present.'),
  })
/** A field that accepts a literal value OR a `{slot}` binding that can override it. */
const slottable = <T extends z.ZodTypeAny>(inner: T) => z.union([inner, slotRef(inner)])

const imageContent = z.object({
  kind: z.literal('image'),
  src: slottable(z.string())
    .optional()
    .describe(
      'Tile image source (editable — swap for your own, or bind a `{slot}`). Omit for a `gradient`/`color` fill.',
    ),
  gradient: slottable(gradientSchema).optional(),
  color: slottable(z.string())
    .optional()
    .describe(
      'Solid fill — a hex, a brand-token name, or a `{slot}`; used when neither `src` nor `gradient` is set; falls back to theme surface.',
    ),
  width: slottable(z.number()).describe('Width (px) — a literal or a `{slot}` (resize).'),
  height: slottable(z.number()).describe('Height (px) — a literal or a `{slot}` (resize).'),
  cornerRadius: slottable(z.number())
    .optional()
    .describe('Corner rounding (px) — a literal or a `{slot}`.'),
  stroke: slottable(z.string())
    .optional()
    .describe('Outline color (hex/token/`{slot}`) — for a stroked/outline rect.'),
  strokeWidth: slottable(z.number())
    .optional()
    .describe('Outline thickness (px) — a literal or a `{slot}`.'),
  anchorX: z.number().optional().describe('Pivot in content space (default tile center).'),
  anchorY: z.number().optional(),
})
// Shape leaves — same per-channel tracks, drawn as vector primitives. (`rect` is the
// `image` content with a `color`/`gradient` + no `src`; `line` is a thin rect.)
const ellipseContent = z.object({
  kind: z.literal('ellipse'),
  width: slottable(z.number()).describe('Width (px) — a literal or a `{slot}` (resize).'),
  height: slottable(z.number()).describe('Height (px) — a literal or a `{slot}` (resize).'),
  color: slottable(z.string())
    .optional()
    .describe('Fill (hex/token/`{slot}`). Omit + use `stroke` for a ring.'),
  gradient: slottable(gradientSchema).optional(),
  stroke: slottable(z.string()).optional(),
  strokeWidth: slottable(z.number())
    .optional()
    .describe('Outline thickness (px) — a literal or a `{slot}`.'),
  anchorX: z.number().optional().describe('Pivot (default ellipse center).'),
  anchorY: z.number().optional(),
})
const pathContent = z.object({
  kind: z.literal('path'),
  d: z.string().describe('SVG path data in local space (e.g. "M0 0 L100 0 Z"). Native/GPU render.'),
  color: slottable(z.string()).optional().describe('Fill (hex/token/`{slot}`).'),
  gradient: slottable(gradientSchema).optional(),
  stroke: slottable(z.string()).optional(),
  strokeWidth: slottable(z.number())
    .optional()
    .describe('Outline thickness (px) — a literal or a `{slot}`.'),
  anchorX: z.number().optional().describe('Pivot (default 0,0).'),
  anchorY: z.number().optional(),
})
const textContent = z.object({
  kind: z.literal('text'),
  text: slottable(z.string()).describe('Line text (editable — or bind a `{slot}`).'),
  fontSize: slottable(z.number()).describe('Text size (px) — a literal or a `{slot}` (resize).'),
  color: slottable(z.string())
    .optional()
    .describe('Ink (hex/token/`{slot}`); defaults to theme `text`.'),
  fontFamily: slottable(z.string())
    .optional()
    .describe('Typeface — a family name or a `{slot}` (the brand font).'),
  fontWeight: slottable(z.number()).optional().describe('Weight — a literal or a `{slot}`.'),
  letterSpacing: z.number().optional(),
  align: z
    .enum(['left', 'center', 'right'])
    .optional()
    .describe(
      'Horizontal alignment about the position x — "left" (default) anchors the left edge, "center" centres the measured line, "right" ends at it. OVERRIDES anchorX. Combine with vAlign for corners.',
    ),
  vAlign: z
    .enum(['top', 'middle', 'bottom'])
    .optional()
    .describe(
      'Vertical alignment about the position y — "top" (default), "middle" (centred), "bottom". OVERRIDES anchorY. e.g. align:"right"+vAlign:"top" = top-right corner.',
    ),
  anchorX: z.number().optional().describe('Pivot in content space (default top-left 0,0).'),
  anchorY: z.number().optional(),
})

export const keyframesSchema = z.object({
  position: z.array(posKey).optional().describe('Position track (x,y over frames).'),
  opacity: z.array(valKey).optional().describe('Opacity track (0–1 over frames).'),
  scale: z.array(valKey).optional().describe('Uniform-scale track (over frames).'),
  scaleX: z
    .array(valKey)
    .optional()
    .describe('Horizontal-scale track — wins over `scale` (e.g. a bar growing wide).'),
  scaleY: z.array(valKey).optional().describe('Vertical-scale track — wins over `scale`.'),
  rotation: z.array(valKey).optional().describe('Rotation track in degrees (over frames).'),
  content: z
    .discriminatedUnion('kind', [imageContent, textContent, ellipseContent, pathContent])
    .describe('The element to animate — an image/rect tile, a text line, an ellipse, or a path.'),
})

export type KeyframesSchemaProps = z.infer<typeof keyframesSchema>
