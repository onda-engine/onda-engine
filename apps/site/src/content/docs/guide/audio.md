---
title: "Audio — spectrum, beats & synth"
description: "Sound in ONDA: the <Audio> timeline node, frame-accurate beat/spectrum analysis for audio-reactive motion, and declarative AudioGraph synthesis."
---

Sound is part of the graph, not bolted on. ONDA covers three things: **playing** an audio clip on the timeline, **reacting** to music (beats and spectrum, frame-accurate), and **synthesising** audio from a declarative graph.

## `<Audio>` — a clip on the timeline

A non-visual node that plays during preview and is **muxed into the MP4** on export (GIF has no audio track).

```tsx
import { Audio, Sequence } from '@onda-engine/react'

<Sequence from={30}>
  <Audio src="/score.mp3" start={1} startAt={0.5} volume={0.8} />
</Sequence>
```

- **`src`** — path, URL, or `data:` URI.
- **`start`** — composition time (seconds) at which it begins. Default `0`.
- **`startAt`** — seconds into the source to begin from (trim the head). Default `0`.
- **`volume`** — linear gain `0..1`. Default `1`.

`@onda-engine/components` wraps this with a fade envelope as `<AudioClip>`.

## Audio-reactive motion — cut to the music

`@onda-engine/components` analyses a clip into a **frame-unit beat grid** that is deterministic and identical in preview and export. Drive motion straight from it.

```tsx
import { useAudioBeats, beatPulse, isBeat } from '@onda-engine/components'

function Kick({ src }) {
  const frame = useCurrentFrame()
  const b = useAudioBeats(src)              // { tempo, beats, onsets, onsetEnv }
  const pulse = beatPulse(frame, b?.beats ?? [])   // 1 → 0 punch on each beat
  return <Rect scaleX={1 + 0.3 * pulse} scaleY={1 + 0.3 * pulse} /* … */ />
}
```

- **`useAudioBeats(src)`** → `{ tempo, beats, onsets, onsetEnv }`, all in **frame units**.
- **`beatPulse(frame, beats, decay?)`** — a `1 → 0` punch on each beat (hit an element on the kick).
- **`isBeat(frame, beats)`** — boolean, for hard cuts on the beat.
- **`onsetEnv[frame]`** (`0..1`) — transient energy, for glows and shakes.
- **`useAudioData(src)`** → the lower-level `AudioAnalyzer` (spectrogram bands) behind a spectrum **`<AudioVisualizer>`**.

Analysis runs through **`@onda-engine/wasm-audio`** (`symphonia` + `rustfft`), so the browser and native export compute **identical** spectra and beat grids.

:::tip[Edited *to* the music]
`beatPulse` punches on the beat, `isBeat` cuts on it, and `onsetEnv` drives transient glows — the "edited to the track" layer. It's deterministic, so what you punch in preview is exactly what exports.
:::

## Synthesis — a declarative `AudioGraph`

ONDA generates sound too. `audio-rs` defines a declarative **`AudioGraph`** (the audio analogue of the scene graph): voices summed through an optional reverb, each voice an oscillator/chord/noise source shaped by an envelope and optional biquad filter and tremolo. Pure Rust, deterministic, wasm-ready.

- **Sources** — `Osc { wave }`, `Chord`, `Noise`.
- **Envelopes** — `Adsr { a, d, s, r }`, `ExpDecay { attack, tau }`.
- **Per-voice** — biquad `Filter`, `Tremolo`.
- **Bus** — a `Reverb` send.

Good for beds, risers, impacts, stabs and SFX (not real vocals or foley). The `synth_json` example CLI takes an `AudioGraph` JSON and writes a WAV — the same path the Studio `audio_synth` tool drives.

```bash
cargo run -p onda-cli --example synth_json -- graph.json out.wav
```

## What runs where

| Capability | Browser preview | Native export |
| --- | :---: | :---: |
| `<Audio>` playback | ✅ plays | ✅ muxed to AAC in MP4 |
| beats / spectrum (`@onda-engine/wasm-audio`) | ✅ | ✅ (identical) |
| `AudioGraph` synthesis | ✅ (wasm) | ✅ |

## See also

- [Effects & finishing](/guide/effects) — grade the visuals you cut to the beat.
- [Composing — complete reference](/guide/composing) — `useAudioBeats` recipes.
