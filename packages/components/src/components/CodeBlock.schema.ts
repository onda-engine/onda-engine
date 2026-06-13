//! Runtime prop schema for {@link CodeBlock} — @onda-native (mirrors CodeBlockProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const codeBlockSchema = z.object({
  code: z
    .string()
    .default("const onda = motion('identity');\nexport default onda;")
    .describe('The source to render. Newlines split into reveal-able lines.'),
  title: z
    .string()
    .default('onda.ts')
    .describe(
      'Filename shown in the title bar. Empty hides the title (dots still show if chrome).',
    ),
  chrome: z
    .boolean()
    .default(true)
    .describe('Show the macOS-style window chrome (three dots + title bar).'),
  revealLines: z
    .boolean()
    .default(true)
    .describe('Reveal lines one-by-one instead of all at once.'),
  delay: timeSchema.default(0).describe('Frames before the first line appears.'),
  lineDelay: timeSchema.default(3).describe('Frames between successive line reveals.'),
  fontFamily: z
    .string()
    .optional()
    .describe('Monospace font stack; code needs column alignment (defaults to theme monoFamily).'),
  fontSize: z
    .number()
    .default(48)
    .describe('Code font size in px. Sized for a video canvas, not a screen UI.'),
  width: z.number().default(900).describe('Panel width in px.'),
  textColor: z
    .string()
    .optional()
    .describe(
      'Default text color for identifiers, punctuation, operators (defaults to theme text).',
    ),
  keywordColor: z
    .string()
    .optional()
    .describe('Keyword color \u2014 a muted, dusty violet (defaults to theme palette[1]).'),
  stringColor: z
    .string()
    .optional()
    .describe('String literal color \u2014 dusty sage (defaults to theme palette[3]).'),
  commentColor: z.string().optional().describe('Comment color (defaults to theme textMuted).'),
  numberColor: z
    .string()
    .optional()
    .describe('Numeric literal color \u2014 dusty amber (defaults to theme palette[2]).'),
  tagColor: z
    .string()
    .optional()
    .describe('JSX / HTML tag-name color \u2014 dusty cyan (defaults to theme palette[1]).'),
  panelColor: z
    .string()
    .optional()
    .describe('Panel background fill \u2014 the glass surface (defaults to theme surface).'),
  borderColor: z.string().optional().describe('Panel border color (defaults to theme border).'),
})

export type CodeBlockSchemaProps = z.infer<typeof codeBlockSchema>
