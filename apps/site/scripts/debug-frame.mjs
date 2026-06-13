import { fontMetrics } from '@onda/components'
import { Composition, Group, Rect, Text } from '@onda/react'
import { createElement as h } from 'react'

const SIZE = 290,
  SANS = 'IBM Plex Sans',
  WEIGHT = 400,
  BG = '#ECECEC'
const FM = fontMetrics(SIZE, { fontFamily: SANS, fontWeight: WEIGHT })
const cyText = Math.round(720 / 2 - FM.capTop - FM.capHeight / 2)
const cursorX = Math.round(1280 * 0.62) // = 794

// Just render the 11-char preroll text at startX = cursorX - 1359
const startX = Math.round(cursorX - 1359)

function Debug({ width, height }) {
  return h(
    Group,
    null,
    h(Rect, { x: 0, y: 0, width, height, fill: BG }),
    h(
      Text,
      {
        x: startX,
        y: cyText,
        fontSize: SIZE,
        fontFamily: SANS,
        fontWeight: WEIGHT,
        color: '#E8732B',
      },
      'test 3 colo',
    ),
    h(Rect, {
      x: cursorX + 2,
      y: cyText + FM.capTop,
      width: 10,
      height: FM.capHeight,
      fill: '#F08030',
    }),
    // Red marker at cursorX so we can see where the text SHOULD end
    h(Rect, { x: cursorX, y: 0, width: 3, height, fill: '#FF0000', opacity: 0.5 }),
  )
}

export default function ({ fps, durationInFrames, width, height }) {
  return h(
    Composition,
    { width, height, fps, durationInFrames, linear: true },
    h(Debug, { width, height }),
  )
}
