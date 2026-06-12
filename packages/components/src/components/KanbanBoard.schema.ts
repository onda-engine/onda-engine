//! Runtime prop schema for {@link KanbanBoard} — @onda-native (mirrors KanbanBoardProps).
//! GENERATED from the component's props. The Studio agent generates against this
//! and the preview/export renderer validates with it. Edit the component +
//! re-run the catalog codegen rather than hand-editing.

import { z } from 'zod'
import { timeSchema } from '../time.js'

export const kanbanBoardSchema = z.object({
  columns: z.any().default([{ title: 'Todo', cards: ['Storyboard the intro', 'Source b-roll', 'Write VO script'] }, { title: 'In Progress', accent: '#d96b82', cards: ['Animate the title card', 'Color-grade scene 2'] }, { title: 'Done', cards: ['Lock the edit', 'Render preview', 'Sound pass', 'Export master'] }]).describe("The columns, laid out left-to-right; each is { title, accent?, cards? } and holds its own ticket cards."),
  width: z.number().default(1040).describe("Overall board width in px, split evenly across the columns."),
  gap: z.number().default(20).describe("Gap between columns (and between cards within a column) in px."),
  delay: timeSchema.default(0).describe("Frames before the first card enters."),
  stagger: timeSchema.optional().describe("Frames between successive cards rising in (house stagger = 4)."),
  fontSize: z.number().default(22).describe("Base column-header font size in px (ticket labels derive from it)."),
  fontFamily: z.string().optional().describe("Loaded font family for headers and ticket labels (defaults to theme fontFamily)."),
  accent: z.string().optional().describe("Default accent for the dot/count when a column omits its own (defaults to theme accent)."),
  textColor: z.string().optional().describe("Header / title text color (defaults to theme text)."),
  cardTextColor: z.string().optional().describe("Ticket-label text color (defaults to theme textMuted)."),
  faintColor: z.string().optional().describe("Faint color for neutral dots, counts, and card accent stripes (defaults to theme textMuted)."),
  columnFill: z.string().optional().describe("Glass column fill, translucent (defaults to theme surface)."),
  columnStroke: z.string().optional().describe("Glass column border color (defaults to theme border)."),
  cardFill: z.string().optional().describe("Ticket card fill, translucent (defaults to theme surface)."),
})

export type KanbanBoardSchemaProps = z.infer<typeof kanbanBoardSchema>
