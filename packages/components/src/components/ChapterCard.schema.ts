//! Runtime prop schema for {@link ChapterCard} — @onda-native (mirrors ChapterCardProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { placementSchema } from '../placement.js'

export const chapterCardSchema = z.object({
  chapter: z.string().describe("The chapter heading \u2014 the focal text on the card."),
  number: z.string().default('01').describe("Numbered index above the chapter; a string so leading zeros (\"01\") read as intended."),
  delay: z.number().int().default(0).describe("Frames before the number starts fading in; the whole card sequences off this."),
  accent: z.boolean().default(true).describe("When true, the number takes numberColor (the rose) and an underline punctuates the title."),
  numberColor: z.string().optional().describe("Number color when accent is true (the Onda rose); defaults to theme accent."),
  color: z.string().optional().describe("Chapter title color; defaults to theme text."),
  subtitleColor: z.string().optional().describe("Number color when accent is false \u2014 quiet metadata dim; defaults to theme textMuted."),
  numberFontSize: z.number().default(32).describe("Number font size in px \u2014 smaller than the title, sitting above it."),
  numberFontWeight: z.number().default(600).describe("Number font weight."),
  titleFontSize: z.number().default(96).describe("Chapter title font size in px \u2014 the focal element."),
  titleFontWeight: z.number().default(600).describe("Title font weight."),
  fontFamily: z.string().optional().describe("Onda display font applied to both number and title; defaults to theme headingFamily ?? fontFamily."),
  placement: placementSchema.optional().describe("Where the element sits: a region keyword ('center', 'lower-third', 'upper-third', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right') or normalized {x,y} (0-1 canvas fractions, element-center anchored). Default 'center'."),
})

export type ChapterCardSchemaProps = z.infer<typeof chapterCardSchema>
