import { describe, expect, it } from 'vitest'
import { noise2D, noise3D, random } from './index.js'

describe('random', () => {
  it('is deterministic per seed and within [0, 1)', () => {
    expect(random('hello')).toBe(random('hello'))
    expect(random(42)).toBe(random(42))
    for (const seed of ['a', 'b', 7, 1000]) {
      const v = random(seed)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('decorrelates different seeds', () => {
    expect(random('a')).not.toBe(random('b'))
    expect(random(0)).not.toBe(random(1))
  })
})

describe('noise', () => {
  it('noise2D is deterministic and in [-1, 1]', () => {
    expect(noise2D('s', 1.25, 3.5)).toBe(noise2D('s', 1.25, 3.5))
    for (let i = 0; i < 64; i++) {
      const v = noise2D('s', i * 0.37, i * 0.71)
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('noise2D is smooth (nearby inputs give nearby outputs)', () => {
    const a = noise2D('s', 5, 5)
    const b = noise2D('s', 5.01, 5)
    expect(Math.abs(a - b)).toBeLessThan(0.1)
  })

  it('different seeds give different fields', () => {
    expect(noise2D('s', 2, 2)).not.toBe(noise2D('t', 2, 2))
  })

  it('noise3D is deterministic and in [-1, 1]', () => {
    expect(noise3D('s', 1, 2, 3)).toBe(noise3D('s', 1, 2, 3))
    const v = noise3D('s', 1.5, 2.5, 3.5)
    expect(v).toBeGreaterThanOrEqual(-1)
    expect(v).toBeLessThanOrEqual(1)
  })
})
