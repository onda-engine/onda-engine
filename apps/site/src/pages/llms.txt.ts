import { FIDELITY_SUMMARY } from '@onda/components'
import type { APIRoute } from 'astro'
import { GALLERY } from '../components/gallery-data.js'

// /llms.txt — an LLM-oriented index of the docs (https://llmstxt.org/). Points
// at the machine-readable component spec, the live gallery, and the key guides
// so an agent (e.g. ONDA Studio) can find the API fast. Generated at build time.
export const prerender = true

const SITE = 'https://onda.video'

export const GET: APIRoute = () => {
  const total = GALLERY.length
  const themeable = GALLERY.filter((g) => g.themed).length

  const txt = `# ONDA

> Open-source, GPU-native motion-graphics engine in Rust. Author compositions in React (\`@onda/react\`) → scene-graph JSON → a native GPU renderer (Vello) or a CPU reference, with a wasm path for in-browser preview. \`@onda/components\` is a ${total}-component motion library; a single \`<ThemeProvider theme={…}>\` brand kit re-skins a whole composition (${themeable} of ${total} components are themeable).

The scene graph is the universal language; the renderer is the platform. Components are pure React that emit scene nodes — no DOM, no browser at render time.

**Engine capabilities (author for these):** GPU vector fills/strokes/paths, trim paths (\`trimStart\`/\`trimEnd\`/\`trimOffset\` on any stroked shape — the mograph stroke "line-draw"; animate \`trimEnd\` 0→1), \`<Repeater count offsetX offsetY rotation scale startOpacity endOpacity>\` (stamp a subtree into grids / radial arrays / compounding spirals; nest for 2D grids), \`<Merge op="union|difference|intersect|xor">\` (boolean "merge paths" — combine shape children into one outline: ring = circle−circle, lens = circle∩circle), \`<Particles count seed x y speed angle spread gravity lifetime emitOver loop size opacity colors spin>\` (DETERMINISTIC particle emitter — bursts / fountains / confetti / sparks / dust / snow; every particle is a pure function of frame+seed+index, frame-based units, renders as plain shapes so CPU==GPU), linear+radial gradients, fBm animated gradients, per-glyph vector text, taffy flexbox layout, 2D affine transforms (translate/scale/rotate on EVERY node via \`x\`/\`y\`/\`scaleX\`/\`scaleY\`/\`rotation\`/\`originX\`/\`originY\`), physics springs (\`spring()\`), \`Camera\` (pan/zoom viewport), clipping (\`clip\`), \`matte\` (reveal through alpha/luminance — masks, shape wipes), \`<Precomp>\` (flatten a subtree to ONE layer so its opacity/blend apply to the composited result, not per-child — AE precomp; fixes fading-a-group double-darkening overlaps; an "adjustment layer" = a \`<Group>\` with an effect wrapping the layers below it), images/video, audio decode + FFT spectrum + BEAT/onset/tempo detection (see audio-driven motion below), render-to-texture effects on any node: \`blur\` (Gaussian), \`directionalBlur\` (1D motion smear along an angle), \`backdropBlur\` (frosted glass behind the node), \`bloom\`, \`grade\` (brightness/contrast/saturation/temperature), \`grain\` (film grain), \`goo\` (metaball), \`lightWrap\` (bleed backdrop light onto edges), \`shadow\`, plus per-pixel passes \`chromaticAberration\` (lens RGB split), \`vignette\` (radial edge darkening), \`posterize\` (quantize to N levels), \`duotone\` (map luminance to two colors), \`chromaKey\` (knock out a key color). **Composition-level cinematic FINISH** (\`<Composition finish={{ bloom, halation, temperature, contrast, saturation, vignette, grain, exposure }}>\`): the whole finishing chain run after raster in scene-linear HDR → one ACES film tone-map ("looks shot" output transform; bloom bleeds real light past 1.0); GPU/export only. **Per-object MOTION BLUR** (\`<Composition motionBlur={{ shutter: 180, samples: 16 }}>\`): shutter-angle temporal supersampling — moving elements smear by their own motion (translation, rotation, scale), static stays sharp; export-only (N× cost). **DEPTH OF FIELD** (2.5D rack focus): give layers a \`depth\` and the comp a \`dof={{ focus, aperture }}\` — each layer defocuses by its distance from the focus plane (animate \`focus\` for a focus pull); resolves to a per-layer blur, both backends. **3D SCENE** (\`<Scene3D camera={{ position, target, fov }}>\`): wrap layers to place them in ONE shared perspective 3D world — each direct child is a flat plane positioned by \`position3d={[x,y,z]}\` (z goes INTO the screen, the After Effects convention) and tilted by \`rotation3d={[x,y,z]}\` degrees (X pitch / Y yaw / Z roll), viewed through a perspective camera with a real depth buffer (layers occlude + intersect by true depth). Camera fly-throughs, card walls / cover-flow, parallax, exploded UI, 3D titles. A layer at \`z=0\` with no rotation renders pixel-identical to its 2D placement, so wrapping in \`<Scene3D>\` changes nothing until you move layers in z (animate the camera or layers for motion). GPU runs the TRUE perspective + out-of-plane rotation; the CPU reference and web preview degrade to a 2.5D depth-sorted projection (perspective scale + position, no tilt) — so judge the 3D look on a native/export render, not live preview. **EXTRUDED 3D solids** (\`extrude\`): inside a \`<Scene3D>\`, a shape or text layer becomes a LIT 3D SOLID via \`extrude={depth}\` (or \`extrude={{ depth }}\`) — \`<Text extrude={80}>ONDA</Text>\` or \`<Rect extrude={80}>\` grows front + back faces and side walls (lyon-tessellated, holes handled), shaded by a directional light so it catches the light as it rotates: the "3D logo / title". GPU only — the CPU + live preview draw the flat outline. **AUDIO-DRIVEN MOTION** (sync motion to music): \`useAudioBeats(src)\` (from \`@onda/components\`) analyzes an audio clip into \`{ tempo, beats, onsets, onsetEnv }\` in FRAME units (deterministic, same in preview + export, via the same \`@onda/wasm-audio\` as the FFT) — \`beats\`/\`onsets\` are frame indices, \`onsetEnv\` is a per-frame 0..1 strength. Drive motion with the pure helper \`beatPulse(frame, beats, decay)\` (a 1→0 punch on each beat): e.g. \`scaleX={1 + 0.3 * beatPulse(frame, b.beats)}\` makes an element HIT on the beat; \`isBeat(frame, beats)\` for hard cuts/swaps; \`onsetEnv[frame]\` to drive a glow off transients. For deterministic export the agent can bake the \`beats\` array into the comp as a constant and use the helpers directly. This is the "edited TO the music" layer — cut on the beat, punch on the kick, drop text on a transient. Timeline primitives: \`<Sequence>\`, \`<Loop>\`, \`<Series>\` (auto-offset stacking), \`<TransitionSeries>\` with 14 transitions (crossFade, slide, blur, iris, glassWipe, dipToColor…). **NOT supported — do NOT author for:** imported 3D MODELS / glTF meshes (3D *layers* via \`<Scene3D>\` AND extruded shapes/text via \`extrude\` ARE supported — see above; arbitrary imported 3D models are not yet), SVG filters, blend modes on the CPU backend. See \`capabilities\` in the JSON.

**Choosing components:** of ${total}, ${FIDELITY_SUMMARY.firstClass} are \`first_class\` (faithful, engine-native), ${FIDELITY_SUMMARY.degraded} \`degraded\` (work but visibly off until a named engine feature lands), ${FIDELITY_SUMMARY.apesRemotion} \`apes_remotion\` (imitates a browser feature — avoid). **Default to the \`recommendedPalette\` (the first-class set); reach for degraded only when the design demands it; never pick a \`backend:"gpu_only"\` component for a CPU-verified render.** A stray size-role token ("hero"/"subheading") belongs only on a documented size prop — see \`authoring.sizeRoles\`.

## Components

- [Component API (JSON)](${SITE}/api/components.json): machine-readable spec for all ${total} components — per-component \`fidelity\`/\`engineNative\`/\`needsFeature\`/\`backend\`, props, a usage snippet, the theme tokens, the engine \`capabilities\`, the \`recommendedPalette\`, and an \`authoring\` guide (scene/track/entry model, timing, placement, size-roles, choreography, transitions, brand). Start here to generate compositions.
- [Component gallery](${SITE}/components): every component rendered live in the browser, with an editable theme/brand-kit configurator and copyable code.
- [Theming & brand kit](${SITE}/guide/theming): the Theme tokens and how \`<ThemeProvider>\` flows through the scene graph.

## Guides

- [Composing — complete reference](${SITE}/guide/composing): **start here to write a composition** — the full node surface (every NodeProps prop: x/y/scaleX/scaleY/rotation/originX/originY/opacity/blur/directionalBlur/backdropBlur/bloom/grade/grain/goo/lightWrap/shadow/chromaticAberration/vignette/posterize/duotone/chromaKey/clip/matte), animation (spring/interpolate), timeline (Sequence/Loop/Series/TransitionSeries), Camera, @onda/components shortcuts (ScaleIn/SlideIn/FadeIn/Typewriter/KineticText…), footguns, and a file template.
- [What is ONDA?](${SITE}/guide/introduction)
- [Why not Remotion?](${SITE}/guide/why-onda)
- [Getting started](${SITE}/guide/getting-started)
- [Authoring with React](${SITE}/guide/authoring-react)
- [Rendering & export](${SITE}/guide/rendering)
- [Layout](${SITE}/guide/layout)
- [Typography & fonts](${SITE}/guide/typography)
- [Backends](${SITE}/guide/backends)

## Concepts

- [The scene graph](${SITE}/concepts/scene-graph)
- [Composition & nodes](${SITE}/concepts/composition)
- [Transforms, opacity & clip](${SITE}/concepts/transforms)

## API reference

- [@onda/react components](${SITE}/api/react)
- [Hooks](${SITE}/api/hooks)
- [Animation](${SITE}/api/animation)
- [Timeline (Sequence/Series/Loop)](${SITE}/api/timeline)
- [Scene-graph JSON](${SITE}/api/scene-json)
- [onda CLI](${SITE}/api/cli)
`

  return new Response(txt, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}
