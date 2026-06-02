import { defineCollection } from 'astro:content'
import { docsLoader } from '@astrojs/starlight/loaders'
import { docsSchema } from '@astrojs/starlight/schema'

// Starlight serves every Markdown file under src/content/docs/ as a doc page,
// at the path matching its location (e.g. guide/introduction.md -> /guide/introduction).
export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
}
