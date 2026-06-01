import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import './custom.css'

// The default VitePress theme, restyled to ONDA's brand via custom.css.
export default {
  extends: DefaultTheme,
} satisfies Theme
