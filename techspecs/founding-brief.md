# ONDA Engine — Founding Engineering Brief

## Mission

Build the world's best open-source motion graphics engine.

Not a video editor.

Not an AI product.

Not a design tool.

A rendering engine and runtime that allows developers, creators, AI agents, and future visual tools to create cinematic motion graphics and videos programmatically.

The goal is not to build a clone of Remotion.

The goal is to create the next generation of programmatic motion graphics infrastructure.

The project must preserve the developer experience that made Remotion successful while replacing the architectural limitations that prevent it from scaling to the next decade of motion graphics, AI-generated content, and GPU-native rendering.

---

# Executive Vision

Today, most programmatic video systems are built on browser rendering.

The dominant architecture is:

```txt
React
↓
Browser
↓
DOM
↓
Chromium
↓
Screenshots
↓
Encoder
↓
Video
```

This model is powerful because developers already understand React.

However, it introduces unavoidable constraints:

* Browser overhead
* DOM overhead
* CSS interpretation overhead
* Chromium scaling bottlenecks
* IPC overhead
* High memory usage
* Poor utilization of modern GPUs
* Limited parallel rendering scalability

ONDA must replace this architecture with:

```txt
React
↓
Scene Graph
↓
Animation Runtime
↓
Native Renderer
↓
GPU
↓
Encoder
↓
Video
```

The browser becomes a deployment target.

The renderer becomes the source of truth.

The scene graph becomes the universal language.

---

# Success Definition

Success is not building a faster renderer.

Success is creating a runtime that can replace Remotion in production while offering:

* Superior architecture
* Superior performance
* Superior scalability
* Superior motion graphics capabilities
* Superior typography
* Superior developer experience
* Superior AI compatibility

A developer should be able to choose ONDA over Remotion for serious motion graphics work.

---

# Research Foundations

Before implementation begins, the team must deeply study the following projects.

## Programmatic Video

* Remotion
* Motion Canvas
* Rustymotion
* MoviePy
* Manim
* Lottie

Study:

* rendering architecture
* composition model
* animation systems
* export pipelines
* developer experience
* performance bottlenecks

---

## Motion Graphics Systems

* Rive
* After Effects
* Blender
* Cavalry
* Principle
* Framer Motion

Study:

* timelines
* keyframes
* interpolation
* state machines
* typography workflows
* reusable animation primitives

---

## Rendering Systems

* WGPU
* WebGPU
* Vello
* Skia
* Flutter Engine
* Bevy Renderer
* Unreal Engine
* Unity Render Pipeline
* Zed Renderer

Study:

* scene graphs
* GPU batching
* shader pipelines
* texture atlases
* incremental rendering
* frame scheduling

---

## Typography Systems

* HarfBuzz
* Rustybuzz
* Cosmic Text
* Swash
* Skrifa
* FreeType

Study:

* text shaping
* font fallback
* glyph caching
* ligatures
* variable fonts
* GPU text rendering

---

## React Architecture

* React Fiber
* React Reconciler
* React Native
* React Three Fiber
* React Pixi
* React PDF
* Ink

Study:

* custom renderers
* reconciliation
* host configs
* scene graph updates

---

## Audio and Media

* FFmpeg
* Symphonia
* Rodio
* CPAL
* GStreamer

Study:

* synchronization
* encoding
* decoding
* streaming
* waveform analysis

---

# Product Principles

## Principle 1

Developer Experience Is Sacred.

A developer should be able to install ONDA and create motion graphics in minutes.

Example:

```tsx
<Composition>
  <Text>Hello World</Text>
</Composition>
```

The complexity of the engine must never leak into the API.

---

## Principle 2

Renderer First.

The renderer is the product.

Everything else is an adapter.

React is an adapter.

The Player is an adapter.

The Studio is an adapter.

AI is an adapter.

The renderer is the platform.

---

## Principle 3

Scene Graph Is The Universal Language.

Every system must compile into the same internal representation.

React.

JSON.

Visual editors.

AI systems.

Everything becomes:

```txt
Scene Graph
```

There must only be one runtime.

---

## Principle 4

Real-Time By Default.

Previewing ONDA projects should feel closer to:

* Figma
* Rive
* Unreal
* Unity

than traditional video software.

The engine should prioritize:

* low latency
* instant feedback
* hot reload
* incremental rendering
* GPU acceleration

---

## Principle 5

AI Native.

The architecture must support:

```txt
Prompt
↓
Scene Graph
↓
Renderer
↓
Video
```

without requiring AI to generate source code.

---

# Non Goals

Version 1 should NOT include:

* Video editor
* Timeline editor
* Collaboration
* Marketplace
* Asset management
* AI generation tools
* Cloud platform
* After Effects replacement

Focus on the engine.

---

# Architecture Principles

## Rule #1

The engine is the source of truth.

Everything consumes the engine.

Nothing inside the engine may depend on external consumers.

---

## Rule #2

No core package may depend on:

* React
* Browser APIs
* DOM APIs
* Studio APIs
* AI APIs

The runtime must remain framework agnostic.

---

## Rule #3

React is not ONDA.

React is a consumer of ONDA.

The same runtime must support:

* React
* JSON
* AI
* Studio
* CLI
* Future SDKs

without modification.

---

# Core Architecture

```txt
React
↓
Custom React Reconciler
↓
ONDA Scene Graph
↓
Animation Runtime
↓
Native Renderer
↓
GPU
↓
Frame Buffer
↓
Encoder
↓
Video
```

No DOM.

No Chromium rendering.

No screenshot pipelines.

No browser layout engine.

---

# Rendering Targets

## Browser Preview

```txt
Scene Graph
↓
WASM
↓
WebGPU
↓
Canvas
```

---

## Native Rendering

```txt
Scene Graph
↓
Rust
↓
WGPU
↓
GPU
```

---

## Server Rendering

```txt
Scene Graph
↓
Rust
↓
GPU Workers
↓
Video
```

---

# Repository Structure

```txt
onda-engine/

├── apps/
│
│   ├── playground/
│   ├── benchmark/
│   └── docs/
│
├── packages/
│
│   ├── core-rs/
│   ├── scene-rs/
│   ├── renderer-rs/
│   ├── animation-rs/
│   ├── typography-rs/
│   ├── vector-rs/
│   ├── audio-rs/
│   ├── codecs-rs/
│   ├── wasm/
│   ├── react/
│   ├── player/
│   ├── render/
│   └── cli/
│
├── examples/
│
└── scripts/
```

---

# Technology Stack

## Core Runtime

Rust

Reasons:

* memory safety
* performance
* concurrency
* WASM
* portability

---

## GPU Rendering

* wgpu
* naga
* bytemuck
* encase

---

## Vector Graphics

* vello
* lyon
* kurbo
* usvg
* resvg

---

## Typography

* cosmic-text
* swash
* skrifa
* rustybuzz
* glyphon

---

## Audio

* symphonia
* rodio
* cpal
* rubato

---

## Encoding

Initial:

* FFmpeg

Future:

* NVENC
* VideoToolbox
* QuickSync
* AV1

Do not build codecs in v1.

---

## React Layer

* React
* react-reconciler
* TypeScript
* Vite
* pnpm

---

## WASM

* wasm-bindgen
* wasm-pack
* web-sys

---

# Scene Graph

Minimum primitives:

```txt
Scene
Composition
Group
Text
Image
Video
SVG
Shape
Audio
Camera
```

Everything must derive from these primitives.

---

# Animation Runtime

Built-in support for:

```txt
Keyframes
Springs
Easing
Noise
Tracks
Sequences
State Machines
```

Animation is a first-class system.

---

# Typography Engine

Typography quality must exceed browser rendering.

Requirements:

* Variable Fonts
* OpenType Features
* Kerning
* Ligatures
* Font Fallback
* Glyph Atlas
* GPU Rendering

Typography is a strategic advantage.

---

# Vector Engine

Requirements:

* SVG
* Paths
* Morphing
* Shape Interpolation
* Boolean Operations
* GPU Acceleration

---

# Audio Engine

Requirements:

* Sample Accurate Timing
* Audio Reactive Animation
* Waveform Analysis
* Deterministic Sync
* Offline Rendering

---

# Remotion Compatibility Layer

## Mission

ONDA must be capable of reproducing every major workflow currently supported by Remotion.

The goal is not difference.

The goal is superior implementation.

---

## Compatibility Requirements

Support:

* Composition
* Sequence
* Timeline
* Audio
* Video
* SVG
* Images
* Animation
* Spring Systems
* React Components
* TypeScript
* Local Rendering
* Embedded Players

Every major Remotion capability must have an ONDA equivalent.

---

# Benchmarking System

The repository must contain automated benchmarks.

Compare ONDA against Remotion continuously.

---

## Benchmarks

### Render Time

* Typography scenes
* SVG scenes
* Motion graphics scenes
* Particle systems
* Video compositions
* Large compositions

### Memory

* Preview
* Rendering
* Export

### Startup

* Cold start
* Hot reload
* Player initialization

### Scalability

* Multi-core rendering
* GPU rendering
* Parallel rendering

---

# Performance Goals

The goal is measurable superiority.

Metrics:

* FPS
* Render Throughput
* Memory Usage
* CPU Usage
* GPU Usage
* Startup Time
* Hot Reload Time

The team should identify opportunities for:

* 2x improvements
* 10x improvements
* 100x improvements

depending on workload.

No performance claims without benchmarks.

---

# Open Source Strategy

License:

MIT or Apache 2.0

The engine should become the standard open-source runtime for programmatic motion graphics.

Community adoption is more important than short-term monetization.

---

# Documentation Requirements

Documentation quality must rival:

* React
* Vite
* Next.js
* Remotion
* Tailwind
* Astro

---

## README Requirements

The README must answer:

* What is ONDA?
* Why does ONDA exist?
* Why not Remotion?
* How does it work?
* How do I get started?
* What can I build?
* What is the roadmap?

A developer should understand ONDA within five minutes.

---

## Examples

Provide:

### Beginner

```tsx
<Text>Hello ONDA</Text>
```

### Intermediate

* SVG animation
* Typography
* Audio synchronization

### Advanced

* Particles
* Morphing
* Cameras
* Complex compositions

---

## npm Packages

Publish:

```txt
@onda-engine/react
@onda-engine/player
@onda-engine/render
@onda-engine/wasm
@onda-engine/three
@onda-engine/skia
```

Each package must contain:

* TypeScript definitions
* Examples
* Documentation
* Versioning strategy

---

## Documentation Driven Development

Every feature is incomplete until it includes:

1. Design Document
2. API Proposal
3. Example
4. Documentation
5. Benchmark Results

Code is not finished when it compiles.

Code is finished when developers can successfully use it.

---

# Initial Milestones

## Milestone 1

Render:

```tsx
<Text>Hello ONDA</Text>
```

through:

```txt
React
↓
Scene Graph
↓
Rust
↓
GPU
```

No DOM.

No Chromium.

---

## Milestone 2

Realtime Player.

```tsx
<Player />
```

with hot reload and instant updates.

---

## Milestone 3

Animation Runtime.

Keyframes.

Springs.

Sequences.

---

## Milestone 4

Video Export.

MP4 output.

---

## Milestone 5

Benchmark Suite.

Direct comparison against Remotion.

---

# Final Success Criteria

A developer should be able to:

1. Install ONDA.
2. Create a composition in React.
3. Preview it instantly.
4. Export it to video.
5. Scale rendering across CPUs and GPUs.
6. Build motion graphics beyond what Remotion can comfortably support.
7. Never think about rendering infrastructure.

If successful, ONDA becomes the rendering foundation behind:

* Motion graphics applications
* AI video systems
* Content creation platforms
* Studio products
* Future developer-first video ecosystems

We are not building a better video editor.

We are building the rendering foundation for the next decade of motion graphics.
