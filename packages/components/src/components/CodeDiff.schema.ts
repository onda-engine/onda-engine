//! Runtime prop schema for {@link CodeDiff} — @onda-native (mirrors CodeDiffProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'

export const codeDiffSchema = z.object({
  lines: z.any().default([{ text: "const onda = motion('default');", type: 'remove' }, { text: "const onda = motion('identity');", type: 'add' }, { text: 'export default onda;', type: 'context' }]).describe("The diff lines, top to bottom; each is { text, type?: 'add' | 'remove' | 'context' }."),
  title: z.string().default('motion.ts').describe("Filename shown in the title bar."),
  chrome: z.boolean().default(true).describe("Show window chrome (traffic-light dots + title bar)."),
  revealLines: z.boolean().default(true).describe("Reveal lines one-by-one (else all appear together)."),
  delay: z.number().int().default(0).describe("Frames before the first line appears."),
  lineDelay: z.number().int().optional().describe("Frames between consecutive line reveals (canonical STAGGER = 4)."),
  fontFamily: z.string().optional().describe("Monospace font stack for code and title (defaults to theme monoFamily ?? fontFamily)."),
  fontSize: z.number().default(44).describe("Code font size in px."),
  width: z.number().default(760).describe("Panel width in px."),
  textColor: z.string().optional().describe("Default (context) text color (defaults to theme textMuted)."),
  addColor: z.string().optional().describe("Added-line color (defaults to theme palette[3])."),
  removeColor: z.string().optional().describe("Removed-line color (defaults to theme accent)."),
  surfaceColor: z.string().optional().describe("Panel surface (glass) fill (defaults to theme surface)."),
  borderColor: z.string().optional().describe("Panel border / chrome divider color (defaults to theme border)."),
  cornerRadius: z.number().optional().describe("Panel corner radius in px (defaults to theme radius)."),
  chromeDotsColor: z.string().optional().describe("Window-chrome traffic-light dot color (defaults to theme border)."),
  chromeTitleColor: z.string().optional().describe("Window-chrome title (filename) color (defaults to theme textMuted)."),
})

export type CodeDiffSchemaProps = z.infer<typeof codeDiffSchema>
