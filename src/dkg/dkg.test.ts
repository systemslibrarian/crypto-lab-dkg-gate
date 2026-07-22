import { describe, expect, it } from 'vitest'
import { baseMul, Point } from './group.ts'
import { DkgAbortError, reconstructSecret, runDkg, verifyFinalShare } from './dkg.ts'
import { seededRng } from './testutil.ts'

describe('honest run (n=5, t=3)', () => {
  const T = runDkg(5, 3, { rng: seededRng('honest') })

  it('no complaints; every dealer qualifies', () => {
    expect(T.complaints).toHaveLength(0)
    expect(T.qual).toEqual([1, 2, 3, 4, 5])
    expect(T.disqualified).toEqual([])
  })

  it('PK is the sum of all dealers’ A_0 — a key nobody chose alone', () => {
    const sum = T.dealings.reduce((acc, d) => acc.add(d.commitments[0]), Point.ZERO)
    expect(T.publicKey.equals(sum)).toBe(true)
    expect(T.publicKey.equals(baseMul(T.groupSecret))).toBe(true)
  })

  it('every final share verifies against the joint commitments', () => {
    T.partyShares.forEach((s, i) => expect(verifyFinalShare(i + 1, s, T.jointCommitments)).toBe(true))
  })

  it('any t shares reconstruct a secret matching PK; subsets agree; t-1 do not', () => {
    const pick = (idx: number[]) => idx.map((i) => ({ index: i, share: T.partyShares[i - 1] }))
    const a = reconstructSecret(pick([1, 2, 3]))
    const b = reconstructSecret(pick([2, 4, 5]))
    expect(a).toBe(b)
    expect(a).toBe(T.groupSecret)
    expect(baseMul(a).equals(T.publicKey)).toBe(true)
    expect(baseMul(reconstructSecret(pick([1, 5]))).equals(T.publicKey)).toBe(false)
  })
})

describe('cheating dealer who doubles down (n=5, t=3)', () => {
  const T = runDkg(5, 3, {
    rng: seededRng('cheat-dd'),
    cheats: [{ dealer: 2, victim: 4, reveal: 'double-down' }],
  })

  it('exactly the victim complains, about exactly the cheater', () => {
    expect(T.complaints).toEqual([{ accuser: 4, dealer: 2 }])
    expect(T.verified[1][3]).toBe(false)
  })

  it('the doubled-down reveal fails the public check → dealer disqualified', () => {
    expect(T.reveals).toHaveLength(1)
    expect(T.reveals[0].ok).toBe(false)
    expect(T.disqualified).toEqual([2])
    expect(T.qual).toEqual([1, 3, 4, 5])
  })

  it('the cheater’s entire contribution is excluded from the key', () => {
    const sumQual = T.qual.reduce((acc, d) => acc.add(T.dealings[d - 1].commitments[0]), Point.ZERO)
    expect(T.publicKey.equals(sumQual)).toBe(true)
    const sumAll = T.dealings.reduce((acc, d) => acc.add(d.commitments[0]), Point.ZERO)
    expect(T.publicKey.equals(sumAll)).toBe(false)
  })

  it('the surviving key is still fully functional t-of-n', () => {
    T.partyShares.forEach((s, i) => expect(verifyFinalShare(i + 1, s, T.jointCommitments)).toBe(true))
    const secret = reconstructSecret([1, 3, 5].map((i) => ({ index: i, share: T.partyShares[i - 1] })))
    expect(baseMul(secret).equals(T.publicKey)).toBe(true)
  })
})

describe('cheating dealer who backs down (n=5, t=3)', () => {
  const T = runDkg(5, 3, {
    rng: seededRng('cheat-bd'),
    cheats: [{ dealer: 2, victim: 4, reveal: 'back-down' }],
  })

  it('the complaint is answered with a verifying reveal → dealer stays qualified', () => {
    expect(T.complaints).toEqual([{ accuser: 4, dealer: 2 }])
    expect(T.reveals[0].ok).toBe(true)
    expect(T.qual).toEqual([1, 2, 3, 4, 5])
  })

  it('the victim adopts the revealed share and the whole key still checks out', () => {
    T.partyShares.forEach((s, i) => expect(verifyFinalShare(i + 1, s, T.jointCommitments)).toBe(true))
    const secret = reconstructSecret([2, 3, 4].map((i) => ({ index: i, share: T.partyShares[i - 1] })))
    expect(baseMul(secret).equals(T.publicKey)).toBe(true)
    expect(secret).toBe(T.groupSecret)
  })
})

describe('fail-closed abort', () => {
  it('aborts with no key when |QUAL| < t', () => {
    expect(() =>
      runDkg(4, 4, { rng: seededRng('abort'), cheats: [{ dealer: 1, victim: 2, reveal: 'double-down' }] }),
    ).toThrow(DkgAbortError)
  })

  it('rejects invalid parameters and cheat configs', () => {
    expect(() => runDkg(1, 2)).toThrow(RangeError)
    expect(() => runDkg(5, 1)).toThrow(RangeError)
    expect(() => runDkg(5, 3, { cheats: [{ dealer: 3, victim: 3, reveal: 'double-down' }] })).toThrow(RangeError)
    expect(() => runDkg(5, 3, { cheats: [{ dealer: 6, victim: 1, reveal: 'double-down' }] })).toThrow(RangeError)
  })
})
