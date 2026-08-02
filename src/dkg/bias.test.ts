import { describe, expect, it } from 'vitest'
import { Point, pointHex } from './group.ts'
import { runBiasAttack } from './bias.ts'
import { seededRng } from './testutil.ts'

describe('rushing-adversary bias against naive Joint-Feldman', () => {
  const r = runBiasAttack(3, 4, 'a', 'naive', seededRng('bias-naive'))

  it('enumerates all 2^k candidate keys and each is a real subset sum', () => {
    expect(r.candidates).toHaveLength(16)
    const honestSum = r.honest.reduce((acc, h) => acc.add(h.A0), Point.ZERO)
    for (const c of r.candidates) {
      const recomputed = c.keep.reduce((acc, i) => acc.add(r.adversary[i].A0), honestSum)
      expect(pointHex(recomputed)).toBe(c.hex)
    }
  })

  it('the adversary view exposes every A_0 in the clear', () => {
    expect(r.adversaryView).toHaveLength(7)
    expect(r.adversaryView[0].hex).toBe(pointHex(r.honest[0].A0))
  })

  it('whenever any candidate hits, the adversary succeeds', () => {
    if (r.candidates.some((c) => c.hit)) {
      expect(r.success).toBe(true)
      expect(r.finalHex.endsWith(r.targetNibble)).toBe(true)
    }
    expect(r.finalHex).toBe(pointHex(r.finalKey))
  })

  it('across seeds, k=4 corrupted dealers hit far more often than chance', () => {
    // Deterministic: fixed seeds. Expected hit ≈ 1-(15/16)^16 ≈ 64% per run vs 1/16 blind.
    const runs = Array.from({ length: 12 }, (_, i) =>
      runBiasAttack(3, 4, 'a', 'naive', seededRng(`bias-batch-${i}`)),
    )
    const wins = runs.filter((x) => x.success).length
    expect(wins).toBeGreaterThanOrEqual(4)
  })
})

describe('GJKR commit-then-reveal closes the leak', () => {
  const r = runBiasAttack(3, 4, 'a', 'gjkr', seededRng('bias-gjkr'))

  it('the adversary view contains only hiding commitments — no A_0 appears', () => {
    const clearA0s = [...r.honest.map((h) => pointHex(h.A0)), ...r.adversary.map((a) => pointHex(a.A0))]
    for (const v of r.adversaryView) {
      expect(v.label).toContain('hiding')
      expect(clearA0s).not.toContain(v.hex)
    }
  })

  it('with nothing to aim with, the adversary keeps all dealers (blind choice)', () => {
    expect(r.chosenKeep).toEqual([0, 1, 2, 3])
    const all = r.candidates[r.candidates.length - 1]
    expect(all.keep).toEqual([0, 1, 2, 3])
    expect(r.finalHex).toBe(all.hex)
  })

  it('paired seeds: blind (gjkr) wins are rare, rushing (naive) wins on the same seeds exceed them', () => {
    // Paired trials — the same 12 seeds drive both modes, so the only variable
    // is what the adversary's view reveals. Seeded RNG makes the counts exact
    // properties of these seeds, not statistical estimates: 1 blind win in 12
    // sits where a 1/16 guess should (expectation 0.75); 5 rushing wins reflect
    // the ~64% per-run independence heuristic for k = 4. If either pinned count
    // changes, the sampling changed — that is worth noticing, not retrying.
    const runs = Array.from({ length: 12 }, (_, i) =>
      runBiasAttack(3, 4, 'a', 'gjkr', seededRng(`bias-batch-${i}`)),
    )
    const naiveRuns = Array.from({ length: 12 }, (_, i) =>
      runBiasAttack(3, 4, 'a', 'naive', seededRng(`bias-batch-${i}`)),
    )
    const blindWins = runs.filter((x) => x.success).length
    const rushWins = naiveRuns.filter((x) => x.success).length
    expect(blindWins).toBe(1)
    expect(rushWins).toBe(5)
    expect(rushWins).toBeGreaterThan(blindWins)
  })

  it('rejects invalid parameters (fail closed)', () => {
    expect(() => runBiasAttack(0, 2, 'a', 'naive')).toThrow(RangeError)
    expect(() => runBiasAttack(3, 7, 'a', 'naive')).toThrow(RangeError)
    expect(() => runBiasAttack(3, 2, 'z', 'naive')).toThrow(RangeError)
    expect(() => runBiasAttack(3, 2, 'ab', 'naive')).toThrow(RangeError)
  })
})
