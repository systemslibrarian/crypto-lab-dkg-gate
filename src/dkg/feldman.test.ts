import { describe, expect, it } from 'vitest'
import { add } from './field.ts'
import { baseMul } from './group.ts'
import { commitmentAt, deal, verifyShare } from './feldman.ts'
import { evalPoly, interpolateAtZero } from './poly.ts'
import { seededRng } from './testutil.ts'

const rng = seededRng('feldman')

describe('Feldman VSS', () => {
  const n = 5
  const t = 3
  const d = deal(1, n, t, rng)

  it('shapes: t commitments, n shares, A_0 = secret·G', () => {
    expect(d.commitments).toHaveLength(t)
    expect(d.shares).toHaveLength(n)
    expect(d.commitments[0].equals(baseMul(d.secret))).toBe(true)
  })

  it('every honestly dealt share verifies', () => {
    d.shares.forEach((s, i) => expect(verifyShare(i + 1, s, d.commitments)).toBe(true))
  })

  it('commitmentAt matches direct evaluation in the exponent', () => {
    for (let i = 1; i <= n; i++) {
      expect(commitmentAt(i, d.commitments).equals(baseMul(evalPoly(d.poly, BigInt(i))))).toBe(true)
    }
  })

  it('rejects a tampered share (off by 1) and a swapped-recipient share', () => {
    expect(verifyShare(2, add(d.shares[1], 1n), d.commitments)).toBe(false)
    expect(verifyShare(2, d.shares[0], d.commitments)).toBe(false)
  })

  it('any t shares reconstruct the secret; t-1 do not', () => {
    const pts = (idx: number[]) => idx.map((i) => ({ x: BigInt(i), y: d.shares[i - 1] }))
    expect(interpolateAtZero(pts([1, 2, 3]))).toBe(d.secret)
    expect(interpolateAtZero(pts([2, 4, 5]))).toBe(d.secret)
    expect(interpolateAtZero(pts([1, 5]))).not.toBe(d.secret)
  })

  it('rejects invalid parameters (fail closed)', () => {
    expect(() => deal(1, 2, 3, rng)).toThrow(RangeError)
    expect(() => deal(1, 5, 1, rng)).toThrow(RangeError)
  })
})
