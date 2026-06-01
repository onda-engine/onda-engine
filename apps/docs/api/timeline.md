# Timeline: `<Sequence>`, `<Series>`, `<Loop>`

These time-shifting primitives are how you assemble a timeline — Remotion's compositional grammar. They work by manipulating the **frame context**: children inside them see a shifted `useCurrentFrame()`, and render only within their window.

## `<Sequence>`

Shifts children in time. Inside a `<Sequence from={N}>`, `useCurrentFrame()` returns `outerFrame - N`, and the children render only while `0 <= localFrame < durationInFrames`.

```ts
interface SequenceProps {
  from?: number              // frame this sequence starts (children's frame 0). Default 0.
  durationInFrames?: number  // how long it lasts; unbounded if omitted.
  children?: ReactNode
}
```

```tsx
import { Sequence, Text, interpolate, useCurrentFrame } from '@onda/react'

function Title() {
  const frame = useCurrentFrame() // 0 at the sequence's start
  const opacity = interpolate(frame, [0, 15], [0, 1])
  return <Text opacity={opacity} fontSize={96} color="#fff">Hello</Text>
}

// Title appears at frame 30 and lasts 60 frames.
<Sequence from={30} durationInFrames={60}>
  <Title />
</Sequence>
```

Outside its window the `<Sequence>` renders `null` (nothing).

## `<Series>` and `<Series.Sequence>`

Plays `<Series.Sequence>` children back-to-back: each starts where the previous ended (cumulative offsets from their `durationInFrames`). You don't compute `from` yourself.

```ts
interface SeriesSequenceProps {
  durationInFrames: number   // required
  children?: ReactNode
}
```

```tsx
import { Series } from '@onda/react'

<Series>
  <Series.Sequence durationInFrames={30}>
    <Intro />
  </Series.Sequence>
  <Series.Sequence durationInFrames={45}>
    <Body />
  </Series.Sequence>
  <Series.Sequence durationInFrames={30}>
    <Outro />
  </Series.Sequence>
</Series>
```

Here `<Intro>` plays on frames 0–29, `<Body>` on 30–74, `<Outro>` on 75–104. Each child sees its own local frame 0.

::: warning
`<Series>` children **must** be `<Series.Sequence>` elements — anything else throws `<Series> children must be <Series.Sequence>`.
:::

## `<Loop>`

Repeats children forever: inside, `useCurrentFrame()` returns `frame % durationInFrames`.

```ts
interface LoopProps {
  durationInFrames: number   // length of one iteration
  children?: ReactNode
}
```

```tsx
import { Loop, Rect, interpolate, useCurrentFrame } from '@onda/react'

function Pulse() {
  const frame = useCurrentFrame() // cycles 0..29
  const opacity = interpolate(frame, [0, 15, 30], [1, 0.3, 1])
  return <Rect opacity={opacity} width={100} height={100} fill="#22d3ee" />
}

<Loop durationInFrames={30}>
  <Pulse />
</Loop>
```

`durationInFrames <= 0` renders nothing.

## How it works

All three are React components that re-provide the internal frame context with a shifted `frame` value (and, for `<Sequence>`, conditionally render based on visibility). Because everything downstream reads the frame through that context, the shift composes naturally — nest a `<Loop>` inside a `<Sequence>` and the offsets stack.

## Not yet available

Remotion's `<Freeze>` and a declarative Rust-side equivalent are noted as TODOs and are **not** implemented today.
