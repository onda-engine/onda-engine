//! Runtime prop schema for {@link Terminal} — @onda-native (mirrors TerminalProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { placementSchema } from '../placement.js'

export const terminalSchema = z.object({
  command: z.string().default('npx ondajs add code-block').describe("The command that types itself out after the prompt."),
  output: z.array(z.string()).default(['✓ added code-block', '✓ wrote 4 files']).describe("Output lines that appear, staggered, once the command finishes typing."),
  prompt: z.string().default('$').describe("The shell prompt glyph."),
  title: z.string().default('zsh').describe("Title-bar label; empty hides it (dots still show if chrome is on)."),
  chrome: z.boolean().default(true).describe("Show window chrome (dots + title bar)."),
  delay: z.number().int().default(0).describe("Frames before typing starts."),
  typeSpeed: z.number().int().default(30).describe("Frames to type the whole command (linear cadence)."),
  outputDelay: z.number().int().default(8).describe("Frames after the command finishes before output begins."),
  fontFamily: z.string().optional().describe("Monospace font stack (default: theme monoFamily)."),
  fontSize: z.number().default(48).describe("Font size in px, sized for a 1080p+ video canvas."),
  width: z.number().default(1100).describe("Width of the window in px, fixed so the frame stays stable while the command types."),
  textColor: z.string().optional().describe("Command text color (default: theme text)."),
  promptColor: z.string().optional().describe("Prompt glyph color \u2014 the earned accent (default: theme accent)."),
  outputColor: z.string().optional().describe("Output line color (default: theme textMuted)."),
  background: z.string().optional().describe("Window background color (default: theme surface)."),
  cornerRadius: z.number().optional().describe("Window corner radius in px (default: theme radius)."),
  x: z.number().optional().describe("Absolute x of the window's top-left; defaults to horizontally centered."),
  y: z.number().optional().describe("Absolute y of the window's top-left; defaults to vertically centered."),
  placement: placementSchema.optional().describe("Where the element sits: a region keyword ('center', 'lower-third', 'upper-third', 'top', 'bottom', 'left', 'right', 'top-left', 'top-right', 'bottom-left', 'bottom-right') or normalized {x,y} (0-1 canvas fractions, element-center anchored). Default 'center'."),
})

export type TerminalSchemaProps = z.infer<typeof terminalSchema>
