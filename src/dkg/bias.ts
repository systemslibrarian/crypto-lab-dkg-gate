/**
 * The GJKR observation: naive Pedersen/Joint-Feldman DKG lets a *rushing*
 * adversary bias the key.
 *
 * In the naive protocol the Feldman commitments go out in round 1, so before
 * QUAL is settled the adversary already sees every dealer's key contribution
 * A_{d,0} — including its own k corrupted dealers'. Contributions are binding
 * (it cannot change them), but it still holds one lever: it can knock any of
 * its own dealers *out* of QUAL at will (have that dealer deal bad shares and
 * double down on the complaint). That yields 2^k candidate final keys
 *   PK(S) = Σ honest A_0  +  Σ_{d∈S} A_0[d],   S ⊆ corrupted dealers,
 * all computable in advance — so the adversary just picks the S whose key
 * satisfies its predicate (here: "last hex nibble = target"). One corrupted
 * party doubles the odds; four corrupted dealers give 16 tries at a 1-in-16
 * event. The output is no longer uniformly random.
 *
 * GJKR's fix is commit-then-reveal: round 1 broadcasts *hiding* Pedersen
 * commitments C_j = a_j·G + b_j·H instead (see pedersen.ts). Complaints and
 * QUAL are settled while every A_0 is still information-theoretically hidden,
 * and only the fixed QUAL set then reveals Feldman commitments to extract the
 * key. The lever still exists — the information to aim it is gone.
 *
 * Everything below is real group math: real contributions, real subset sums,
 * a real hiding view. No simulated outcomes.
 */
import { Point, baseMul, mulPoint, pointHex, randomScalar, H, type GroupElement, type Rng, defaultRng } from './group.ts'

export interface BiasCandidate {
  /** Which of the adversary's dealers stay in QUAL (indices into its dealer list). */
  keep: number[]
  key: GroupElement
  hex: string
  hit: boolean
}

export interface BiasResult {
  mode: 'naive' | 'gjkr'
  targetNibble: string
  honest: Array<{ index: number; A0: GroupElement; pedersenC0: GroupElement }>
  adversary: Array<{ index: number; secret: bigint; A0: GroupElement; pedersenC0: GroupElement }>
  /** All 2^k subset keys. In gjkr mode these exist mathematically but are NOT in the adversary's view. */
  candidates: BiasCandidate[]
  /** What the adversary actually knows when it must choose (hex strings, for display). */
  adversaryView: Array<{ index: number; label: string; hex: string }>
  chosenKeep: number[]
  finalKey: GroupElement
  finalHex: string
  success: boolean
  /** Fraction of the 2^k candidates that hit — the adversary's success odds in this run. */
  candidateHitRate: number
}

const lastNibble = (hex: string): string => hex[hex.length - 1]

export function runBiasAttack(
  nHonest: number,
  k: number,
  targetNibble: string,
  mode: 'naive' | 'gjkr',
  rng: Rng = defaultRng,
): BiasResult {
  if (!Number.isInteger(nHonest) || nHonest < 1) throw new RangeError('need at least 1 honest dealer')
  if (!Number.isInteger(k) || k < 1 || k > 6) throw new RangeError('adversary dealers must be 1..6')
  if (!/^[0-9a-f]$/.test(targetNibble)) throw new RangeError('target must be one hex nibble')

  // Round 1 as the adversary sees it: every contribution is already committed.
  const honest = Array.from({ length: nHonest }, (_, i) => {
    const secret = randomScalar(rng)
    const mask = randomScalar(rng)
    return {
      index: i + 1,
      A0: baseMul(secret),
      pedersenC0: baseMul(secret).add(mulPoint(H, mask)),
    }
  })
  const adversary = Array.from({ length: k }, (_, i) => {
    const secret = randomScalar(rng)
    const mask = randomScalar(rng)
    return {
      index: nHonest + i + 1,
      secret,
      A0: baseMul(secret),
      pedersenC0: baseMul(secret).add(mulPoint(H, mask)),
    }
  })
  const honestSum = honest.reduce((acc, h) => acc.add(h.A0), Point.ZERO)

  // The full candidate space (ground truth in both modes — the lever exists either way).
  const candidates: BiasCandidate[] = []
  for (let mask = 0; mask < 1 << k; mask++) {
    const keep = adversary.map((_, i) => i).filter((i) => mask & (1 << i))
    const key = keep.reduce((acc, i) => acc.add(adversary[i].A0), honestSum)
    const hex = pointHex(key)
    candidates.push({ keep, key, hex, hit: lastNibble(hex) === targetNibble })
  }

  // What the adversary can actually read before it must commit to a QUAL outcome.
  const adversaryView =
    mode === 'naive'
      ? [
          ...honest.map((h) => ({ index: h.index, label: `A₀ of P${h.index}`, hex: pointHex(h.A0) })),
          ...adversary.map((a) => ({ index: a.index, label: `A₀ of P${a.index} (ours)`, hex: pointHex(a.A0) })),
        ]
      : [
          ...honest.map((h) => ({
            index: h.index,
            label: `C₀ of P${h.index} (hiding)`,
            hex: pointHex(h.pedersenC0),
          })),
          ...adversary.map((a) => ({ index: a.index, label: `C₀ of P${a.index} (ours, hiding)`, hex: pointHex(a.pedersenC0) })),
        ]

  // The choice. Naive: search the candidate list for a hit. GJKR: every C_0 is
  // hiding, so no candidate key is computable — keeping all dealers is as good
  // as any other blind pick.
  const allIn = adversary.map((_, i) => i)
  const chosenKeep = mode === 'naive' ? (candidates.find((c) => c.hit)?.keep ?? allIn) : allIn

  const finalKey = chosenKeep.reduce((acc, i) => acc.add(adversary[i].A0), honestSum)
  const finalHex = pointHex(finalKey)
  return {
    mode,
    targetNibble,
    honest,
    adversary,
    candidates,
    adversaryView,
    chosenKeep,
    finalKey,
    finalHex,
    success: lastNibble(finalHex) === targetNibble,
    candidateHitRate: candidates.filter((c) => c.hit).length / candidates.length,
  }
}
