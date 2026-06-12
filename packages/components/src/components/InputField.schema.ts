//! Runtime prop schema for {@link InputField} — @onda-native (mirrors InputFieldProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'
import { placementSchema } from '../placement.js'

export const inputFieldSchema = z.object({
  value: z.string().default('hello@onda.video').describe("The field's value; with `typed` on, this is what types itself in."),
  placeholder: z.string().default('Enter your email').describe("Placeholder shown while the field is empty, before any glyph is revealed."),
  label: z.string().default('Email').describe("Label above the field; an empty string hides it."),
  typed: z.boolean().default(true).describe("Animate `value` typing itself in character-by-character via useTextReveal."),
  delay: timeSchema.default(0).describe("Frames before typing starts."),
  typeDuration: timeSchema.default(36).describe("Frames to type the whole value, linear pacing."),
  focusRing: z.boolean().default(true).describe("Show the accent focus ring around the field once typing begins."),
  width: z.number().default(640).describe("Field width in px, sized for a 1080p+ video canvas, not a screen UI."),
  fontSize: z.number().default(36).describe("Text size in px."),
  fontFamily: z.string().optional().describe("UI font family; defaults to the theme `fontFamily`."),
  textColor: z.string().optional().describe("Value text color; defaults to the theme `text`."),
  placeholderColor: z.string().optional().describe("Placeholder text color; defaults to the theme `textMuted`."),
  labelColor: z.string().optional().describe("Label text color; defaults to the theme `textMuted`."),
  accentColor: z.string().optional().describe("Caret and focus-ring color, the one earned accent; defaults to the theme `accent`."),
  borderColor: z.string().optional().describe("Resting (unfocused) field border color; defaults to the theme `border`."),
  fieldColor: z.string().optional().describe("Field background fill, the glass surface; defaults to the theme `surface`."),
  x: z.number().default(0.5).describe("Horizontal center of the field as a 0\u20131 fraction of canvas width."),
  y: z.number().default(0.5).describe("Vertical center of the field as a 0\u20131 fraction of canvas height."),
  placement: placementSchema.optional().describe("Where the element sits: a region keyword ('center', 'lower-third', 'upper-third', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right') or normalized {x,y} (0-1 canvas fractions, element-center anchored). Default 'center'."),
})

export type InputFieldSchemaProps = z.infer<typeof inputFieldSchema>
