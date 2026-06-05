import { describe, expect, it } from 'vitest'
import {
  AbsoluteFill,
  Composition,
  Ellipse,
  Flex,
  Group,
  Path,
  Rect,
  Svg,
  Text,
  clipRect,
  linearGradient,
  radialGradient,
  renderToScene,
} from './index.js'

describe('renderToScene', () => {
  it('maps a composition tree to scene-graph JSON', () => {
    const scene = renderToScene(
      <Composition width={800} height={600} fps={24} durationInFrames={48}>
        <Rect width={800} height={600} fill="#000000" />
        <Text id={1} x={10} y={20} fontSize={32} color="#ff0000">
          Hi
        </Text>
      </Composition>,
    )

    expect(scene.composition).toEqual({ width: 800, height: 600, fps: 24, duration_in_frames: 48 })
    expect(scene.root.kind).toEqual({ type: 'group' })

    const children = scene.root.children ?? []
    expect(children).toHaveLength(2)

    const rect = children[0]
    expect(rect?.kind).toEqual({
      type: 'shape',
      geometry: { shape: 'rect', size: { width: 800, height: 600 } },
      fill: { r: 0, g: 0, b: 0 },
    })

    const text = children[1]
    expect(text?.id).toBe(1)
    expect(text?.transform).toEqual({ translate: { x: 10, y: 20 } })
    expect(text?.kind).toEqual({
      type: 'text',
      content: 'Hi',
      font_size: 32,
      color: { r: 1, g: 0, b: 0 },
    })
  })

  it('parses shorthand and alpha hex colors, and stroke', () => {
    const scene = renderToScene(
      <Composition width={1} height={1} fps={1} durationInFrames={1}>
        <Ellipse width={4} height={4} fill="#f00" stroke="#00ff0080" strokeWidth={2} />
      </Composition>,
    )
    const kind = scene.root.children?.[0]?.kind
    expect(kind?.type).toBe('shape')
    if (kind?.type === 'shape') {
      expect(kind.geometry.shape).toBe('ellipse')
      expect(kind.fill).toEqual({ r: 1, g: 0, b: 0 })
      expect(kind.stroke?.width).toBe(2)
      expect(kind.stroke?.color.a).toBeCloseTo(128 / 255, 5)
    }
  })

  it('nests groups and composes children', () => {
    const scene = renderToScene(
      <Composition width={10} height={10} fps={1} durationInFrames={1}>
        <Group x={5} opacity={0.5}>
          <Rect width={2} height={2} fill="#fff" />
        </Group>
      </Composition>,
    )
    const group = scene.root.children?.[0]
    expect(group?.kind).toEqual({ type: 'group' })
    expect(group?.transform).toEqual({ translate: { x: 5, y: 0 } })
    expect(group?.opacity).toBe(0.5)
    expect(group?.children?.[0]?.kind).toMatchObject({ type: 'shape' })
  })

  it('supports function components and React composition', () => {
    function Banner({ label }: { label: string }) {
      return (
        <Group>
          <Rect width={100} height={20} fill="#123456" />
          <Text x={4} y={2}>
            {label}
          </Text>
        </Group>
      )
    }
    const scene = renderToScene(
      <Composition width={100} height={20} fps={1} durationInFrames={1}>
        <Banner label="composed" />
      </Composition>,
    )
    const text = scene.root.children?.[0]?.children?.[1]
    expect(text?.kind).toEqual({ type: 'text', content: 'composed' })
  })

  it('emits a Path shape from SVG path data', () => {
    const scene = renderToScene(
      <Composition width={10} height={10} fps={1} durationInFrames={1}>
        <Path d="M0 0 L10 0 L10 10 Z" fill="#ffcc00" stroke="#333" strokeWidth={2} />
      </Composition>,
    )
    const kind = scene.root.children?.[0]?.kind
    expect(kind?.type).toBe('shape')
    if (kind?.type === 'shape') {
      expect(kind.geometry).toEqual({ shape: 'path', data: 'M0 0 L10 0 L10 10 Z' })
      expect(kind.fill).toEqual({ r: 1, g: 0.8, b: 0 })
      expect(kind.stroke?.width).toBe(2)
    }
  })

  it('emits linear and radial gradient fills', () => {
    const scene = renderToScene(
      <Composition width={100} height={100} fps={1} durationInFrames={1}>
        <Rect
          width={100}
          height={20}
          gradient={linearGradient(
            [0, 0],
            [100, 0],
            [
              { offset: 0, color: '#ff0000' },
              { offset: 1, color: '#0000ff' },
            ],
          )}
        />
        <Ellipse
          width={40}
          height={40}
          gradient={radialGradient([20, 20], 20, [
            { offset: 0, color: { r: 1, g: 1, b: 1 } },
            { offset: 1, color: { r: 0, g: 0, b: 0, a: 0 } },
          ])}
        />
      </Composition>,
    )
    const [rect, ellipse] = scene.root.children ?? []
    if (rect?.kind.type === 'shape') {
      expect(rect.kind.gradient).toEqual({
        gradient: 'linear',
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 },
        stops: [
          { offset: 0, color: { r: 1, g: 0, b: 0 } },
          { offset: 1, color: { r: 0, g: 0, b: 1 } },
        ],
      })
    }
    if (ellipse?.kind.type === 'shape') {
      expect(ellipse.kind.gradient?.gradient).toBe('radial')
      if (ellipse.kind.gradient?.gradient === 'radial') {
        expect(ellipse.kind.gradient.center).toEqual({ x: 20, y: 20 })
        expect(ellipse.kind.gradient.radius).toBe(20)
        expect(ellipse.kind.gradient.stops[1]?.color.a).toBe(0)
      }
    }
  })

  it('emits a clip region on a node', () => {
    const scene = renderToScene(
      <Composition width={50} height={50} fps={1} durationInFrames={1}>
        <Group clip={clipRect(30, 20, 4)}>
          <Text>clipped</Text>
        </Group>
      </Composition>,
    )
    const group = scene.root.children?.[0]
    expect(group?.clip).toEqual({
      shape: 'rect',
      size: { width: 30, height: 20 },
      corner_radius: 4,
    })
  })

  it('emits an Svg node from src or markup', () => {
    const scene = renderToScene(
      <Composition width={50} height={50} fps={1} durationInFrames={1}>
        <Svg x={5} y={5} src="logo.svg" />
        <Svg markup="<svg/>" />
      </Composition>,
    )
    const [bySrc, byMarkup] = scene.root.children ?? []
    expect(bySrc?.transform).toEqual({ translate: { x: 5, y: 5 } })
    expect(bySrc?.kind).toEqual({ type: 'svg', src: 'logo.svg' })
    expect(byMarkup?.kind).toEqual({ type: 'svg', markup: '<svg/>' })
  })

  it('rejects an Svg with neither src nor markup', () => {
    expect(() =>
      renderToScene(
        <Composition width={1} height={1} fps={1} durationInFrames={1}>
          <Svg />
        </Composition>,
      ),
    ).toThrow(/src.*markup|markup.*src/)
  })

  it('emits rich text runs with per-run color and size', () => {
    const scene = renderToScene(
      <Composition width={400} height={100} fps={1} durationInFrames={1}>
        <Text
          fontSize={40}
          color="#ffffff"
          runs={[{ text: 'a ' }, { text: 'b', color: '#ff0000', fontSize: 80 }]}
        />
      </Composition>,
    )
    const kind = scene.root.children?.[0]?.kind
    expect(kind?.type).toBe('text')
    if (kind?.type === 'text') {
      expect(kind.runs).toEqual([
        { text: 'a ' },
        { text: 'b', color: { r: 1, g: 0, b: 0 }, font_size: 80 },
      ])
    }
  })

  it('emits font family / weight / italic on text and runs', () => {
    const scene = renderToScene(
      <Composition width={400} height={100} fps={1} durationInFrames={1}>
        <Text
          fontFamily="IBM Plex Sans"
          fontWeight={700}
          italic
          runs={[
            { text: 'a' },
            { text: 'b', fontFamily: 'IBM Plex Sans', fontWeight: 700, italic: true },
          ]}
        />
      </Composition>,
    )
    const kind = scene.root.children?.[0]?.kind
    if (kind?.type === 'text') {
      expect(kind.font_family).toBe('IBM Plex Sans')
      expect(kind.weight).toBe(700)
      expect(kind.italic).toBe(true)
      expect(kind.runs?.[1]).toEqual({
        text: 'b',
        font_family: 'IBM Plex Sans',
        weight: 700,
        italic: true,
      })
    } else {
      throw new Error('expected text node')
    }
  })

  it('emits rotation on the transform', () => {
    const scene = renderToScene(
      <Composition width={10} height={10} fps={1} durationInFrames={1}>
        <Rect x={2} width={4} height={4} fill="#fff" rotation={45} />
      </Composition>,
    )
    expect(scene.root.children?.[0]?.transform).toEqual({
      translate: { x: 2, y: 0 },
      rotate: 45,
    })
  })

  it('emits a flex layout on a Flex container', () => {
    const scene = renderToScene(
      <Composition width={200} height={200} fps={1} durationInFrames={1}>
        <Flex direction="row" justify="center" align="center" gap={12}>
          <Rect width={20} height={20} fill="#fff" />
        </Flex>
      </Composition>,
    )
    const group = scene.root.children?.[0]
    expect(group?.kind).toEqual({ type: 'group' })
    expect(group?.layout).toEqual({ direction: 'row', justify: 'center', align: 'center', gap: 12 })
  })

  it('AbsoluteFill fills the composition and lays out as a column', () => {
    const scene = renderToScene(
      <Composition width={320} height={240} fps={1} durationInFrames={1}>
        <AbsoluteFill justify="center" align="center">
          <Rect width={10} height={10} fill="#fff" />
        </AbsoluteFill>
      </Composition>,
    )
    expect(scene.root.children?.[0]?.layout).toEqual({
      direction: 'column',
      justify: 'center',
      align: 'center',
      width: 320,
      height: 240,
    })
  })

  it('emits a blur effect from the `blur` sugar prop', () => {
    const scene = renderToScene(
      <Composition width={50} height={50} fps={1} durationInFrames={1}>
        <Group blur={6}>
          <Text>soft</Text>
        </Group>
      </Composition>,
    )
    expect(scene.root.children?.[0]?.effects).toEqual([{ effect: 'blur', sigma: 6 }])
  })

  it('omits the effects key when there is no blur', () => {
    const scene = renderToScene(
      <Composition width={50} height={50} fps={1} durationInFrames={1}>
        <Group>
          <Text>sharp</Text>
        </Group>
      </Composition>,
    )
    expect(scene.root.children?.[0]?.effects).toBeUndefined()
  })

  it('prepends the blur sugar before explicit effects', () => {
    const scene = renderToScene(
      <Composition width={50} height={50} fps={1} durationInFrames={1}>
        <Group blur={4} effects={[{ effect: 'blur', sigma: 2 }]}>
          <Text>stacked</Text>
        </Group>
      </Composition>,
    )
    expect(scene.root.children?.[0]?.effects).toEqual([
      { effect: 'blur', sigma: 4 },
      { effect: 'blur', sigma: 2 },
    ])
  })

  it('emits a bloom effect from the `bloom` sugar prop (number = sigma, with defaults)', () => {
    const scene = renderToScene(
      <Composition width={50} height={50} fps={1} durationInFrames={1}>
        <Group bloom={10}>
          <Text>glow</Text>
        </Group>
      </Composition>,
    )
    expect(scene.root.children?.[0]?.effects).toEqual([
      { effect: 'bloom', threshold: 0.7, intensity: 1, sigma: 10 },
    ])
  })

  it('honors the `bloom` object form (threshold/intensity overrides)', () => {
    const scene = renderToScene(
      <Composition width={50} height={50} fps={1} durationInFrames={1}>
        <Group bloom={{ sigma: 12, threshold: 0.4, intensity: 1.8 }}>
          <Text>neon</Text>
        </Group>
      </Composition>,
    )
    expect(scene.root.children?.[0]?.effects).toEqual([
      { effect: 'bloom', threshold: 0.4, intensity: 1.8, sigma: 12 },
    ])
  })

  it('emits a color_grade effect from the `grade` sugar prop (fields default to identity)', () => {
    const scene = renderToScene(
      <Composition width={50} height={50} fps={1} durationInFrames={1}>
        <Group grade={{ exposure: 0.2, contrast: 1.2, temperature: 0.5 }}>
          <Text>clip</Text>
        </Group>
      </Composition>,
    )
    expect(scene.root.children?.[0]?.effects).toEqual([
      {
        effect: 'color_grade',
        exposure: 0.2,
        contrast: 1.2,
        saturation: 1,
        temperature: 0.5,
        tint: 0,
      },
    ])
  })

  it('omits a neutral `grade` (a no-op identity stays a zero-diff)', () => {
    const scene = renderToScene(
      <Composition width={50} height={50} fps={1} durationInFrames={1}>
        <Group grade={{}}>
          <Text>plain</Text>
        </Group>
      </Composition>,
    )
    expect(scene.root.children?.[0]?.effects).toBeUndefined()
  })

  it('emits a goo effect from the `goo` sugar prop (number = sigma, threshold defaults to 0.5)', () => {
    const scene = renderToScene(
      <Composition width={50} height={50} fps={1} durationInFrames={1}>
        <Group goo={8}>
          <Text>blob</Text>
        </Group>
      </Composition>,
    )
    expect(scene.root.children?.[0]?.effects).toEqual([{ effect: 'goo', sigma: 8, threshold: 0.5 }])
  })

  it('honors the `goo` object form (threshold override)', () => {
    const scene = renderToScene(
      <Composition width={50} height={50} fps={1} durationInFrames={1}>
        <Group goo={{ sigma: 10, threshold: 0.6 }}>
          <Text>blob</Text>
        </Group>
      </Composition>,
    )
    expect(scene.root.children?.[0]?.effects).toEqual([
      { effect: 'goo', sigma: 10, threshold: 0.6 },
    ])
  })

  it('requires a single Composition root', () => {
    expect(() => renderToScene(<Group />)).toThrow(/Composition/)
  })
})
