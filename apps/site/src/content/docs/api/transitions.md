---
title: "Transitions"
---

`<TransitionSeries>` plays sequences back-to-back like
[`<Series>`](/api/timeline), but consecutive sequences **overlap** by a
transition's duration — during which the outgoing scene animates out and the
incoming one animates in. It's built entirely on the engine's primitives
(opacity, transform, a clip mask), so transitions need no special engine
support.

:::tip[See them play]
The [transitions showcase](/transitions) plays every presentation A→B live in
your browser, with the copyable code for each.
:::

## Usage

A transition sits between two `Sequence`s. A `presentation` decides how the
scenes look at each point in the transition; a `timing` decides how the
transition's progress evolves over its duration.

```tsx
import { TransitionSeries, iris, linearTiming } from 'onda-engine/react'

<TransitionSeries>
  <TransitionSeries.Sequence durationInFrames={50}>
    <SceneA />
  </TransitionSeries.Sequence>
  <TransitionSeries.Transition
    presentation={iris()}
    timing={linearTiming({ durationInFrames: 25 })}
  />
  <TransitionSeries.Sequence durationInFrames={50}>
    <SceneB />
  </TransitionSeries.Sequence>
</TransitionSeries>
```

## Presentations

| Presentation | Effect |
| --- | --- |
| `fade()` | Cross-fade via opacity. |
| `slide({ direction })` | The scenes slide across; the incoming enters from an edge. |
| `wipe({ direction })` | The incoming scene wipes over the outgoing behind a growing mask. |
| `flip()` | A 2D card flip about the centre line. |
| `clockWipe()` | An angular sweep, clockwise from 12 o'clock. |
| `iris()` | A circular reveal expanding from the centre. |
| `none()` | A hard cut — the overlap timing with no visual effect. |

`direction` is one of `'from-left'` / `'from-right'` / `'from-top'` /
`'from-bottom'`.

### Custom presentations

A presentation is just a function `(children, state) => ReactElement` that wraps
a scene for a point in the transition. `state` is `{ progress, entering, width,
height }` — return identity at the resting state (entering `progress` 1, exiting
`progress` 0). For example, a zoom:

```tsx
import { Group } from 'onda-engine/react'
import type { TransitionPresentation } from 'onda-engine/react'

const zoom = (): TransitionPresentation => (children, { progress, entering }) => {
  const scale = entering ? progress : 1 + progress * 0.2
  return <Group scaleX={scale} scaleY={scale} opacity={entering ? progress : 1 - progress}>{children}</Group>
}
```

## Timings

| Timing | Curve |
| --- | --- |
| `linearTiming({ durationInFrames })` | Linear `0 → 1` over the duration. |
| `springTiming({ durationInFrames?, config? })` | Spring-driven (natural ease, optional overshoot). |
