import { describe, expect, it } from 'vitest'
import { add, mul, pow } from './field.ts'
import { evalPoly, interpolateAtZero, lagrangeAtZero, randomPoly } from './poly.ts'
import { seededRng } from './testutil.ts'

const rng = seededRng('poly')

describe('polynomial evaluation', () => {
  it('Horner matches the naive power sum', () => {
    const poly = randomPoly(4, rng)
    for (const x of [0n, 1n, 2n, 7n, 1000003n]) {
      let naive = 0n
      poly.forEach((c, j) => (naive = add(naive, mul(c, pow(x, BigInt(j))))))
      expect(evalPoly(poly, x)).toBe(naive)
    }
  })

  it('f(0) is the constant term', () => {
    const poly = randomPoly(3, rng)
    expect(evalPoly(poly, 0n)).toBe(poly[0])
  })
})

describe('Lagrange interpolation at zero', () => {
  const t = 3
  const poly = randomPoly(t - 1, rng)
  const points = [1, 2, 3, 4, 5].map((i) => ({ x: BigInt(i), y: evalPoly(poly, BigInt(i)) }))

  it('any t points recover the secret; subsets agree', () => {
    const subsets = [
      [0, 1, 2],
      [0, 2, 4],
      [1, 3, 4],
      [2, 3, 4],
    ]
    for (const idx of subsets) {
      expect(interpolateAtZero(idx.map((i) => points[i]))).toBe(poly[0])
    }
  })

  it('t-1 points do NOT recover the secret', () => {
    expect(interpolateAtZero([points[0], points[1]])).not.toBe(poly[0])
    expect(interpolateAtZero([points[3], points[4]])).not.toBe(poly[0])
  })

  it('Lagrange weights at zero sum correctly against a constant polynomial', () => {
    // For f ≡ c the interpolation must return c, i.e. Σ λ_i = 1.
    const xs = [1n, 2n, 5n]
    let sum = 0n
    xs.forEach((_, i) => (sum = add(sum, lagrangeAtZero(xs, i))))
    expect(sum).toBe(1n)
  })

  it('duplicate x-coordinates fail closed', () => {
    expect(() => interpolateAtZero([points[0], points[0], points[1]])).toThrow(RangeError)
  })
})
