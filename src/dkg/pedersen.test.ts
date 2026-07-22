import { describe, expect, it } from 'vitest'
import { add } from './field.ts'
import { H, Point, baseMul } from './group.ts'
import { deal, verifyShare } from './pedersen.ts'
import { deal as feldmanDeal } from './feldman.ts'
import { seededRng } from './testutil.ts'

const rng = seededRng('pedersen')

describe('Pedersen generator H', () => {
  it('is a fixed, valid group element distinct from G and the identity', () => {
    expect(H.is0()).toBe(false)
    expect(H.equals(Point.BASE)).toBe(false)
    // Deterministic derivation: recomputing the module gives the same H (see group.ts).
    expect(() => Point.fromHex(H.toHex())).not.toThrow()
  })
})

describe('Pedersen VSS', () => {
  const n = 5
  const t = 3
  const d = deal(1, n, t, rng)

  it('every honestly dealt share pair verifies', () => {
    d.shares.forEach((s, i) => expect(verifyShare(i + 1, s, d.commitments)).toBe(true))
  })

  it('rejects tampering in either component', () => {
    const s = d.shares[2]
    expect(verifyShare(3, { f: add(s.f, 1n), g: s.g }, d.commitments)).toBe(false)
    expect(verifyShare(3, { f: s.f, g: add(s.g, 1n) }, d.commitments)).toBe(false)
  })

  it('commitments hide the Feldman values: C_0 ≠ secret·G', () => {
    expect(d.commitments[0].equals(baseMul(d.secret))).toBe(false)
  })

  it('two dealings of different secrets are indistinguishable in form (both verify, both hide)', () => {
    const e = deal(2, n, t, rng)
    expect(e.commitments[0].equals(baseMul(e.secret))).toBe(false)
    e.shares.forEach((s, i) => expect(verifyShare(i + 1, s, e.commitments)).toBe(true))
  })

  it('a Feldman dealing of the same parameters does NOT hide (the contrast the fix rests on)', () => {
    const f = feldmanDeal(3, n, t, rng)
    expect(f.commitments[0].equals(baseMul(f.secret))).toBe(true)
  })
})
