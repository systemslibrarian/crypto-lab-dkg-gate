/**
 * Feldman VSS — the per-dealer commitment layer of Pedersen's DKG.
 *
 * The dealer picks a random degree-(t-1) polynomial f, broadcasts the curve
 * points A_j = a_j·G ("the polynomial, in the exponent"), and privately sends
 * party i the share f(i). Anyone can then check a share against the public
 * commitments: s·G must equal Σ_j i^j · A_j = f(i)·G. A bad share fails this
 * equation for everyone — that public checkability is what turns "trust the
 * dealer" into "catch the dealer".
 *
 * The standalone-primitive treatment of VSS is crypto-lab-vss-gate; here it
 * exists to be composed n times by the DKG in dkg.ts.
 */
import { pow } from './field.ts'
import { Point, baseMul, mulPoint, type GroupElement, type Rng, defaultRng } from './group.ts'
import { evalPoly, randomPoly, type Poly } from './poly.ts'

export interface FeldmanDealing {
  /** 1-based index of the dealing party. */
  dealer: number
  /** Broadcast: A_j = a_j·G for j = 0..t-1. A_0 = secret·G is this dealer's key contribution. */
  commitments: GroupElement[]
  /** Private: shares[i-1] = f(i), sent to party i. */
  shares: bigint[]
  /** Demo X-ray only — a real dealer never outputs these. */
  poly: Poly
  secret: bigint
}

export function deal(dealer: number, n: number, t: number, rng: Rng = defaultRng): FeldmanDealing {
  if (!Number.isInteger(n) || !Number.isInteger(t) || t < 2 || n < t) {
    throw new RangeError(`need 2 <= t <= n; got n=${n}, t=${t}`)
  }
  const poly = randomPoly(t - 1, rng)
  return {
    dealer,
    commitments: poly.map(baseMul),
    shares: Array.from({ length: n }, (_, i) => evalPoly(poly, BigInt(i + 1))),
    poly,
    secret: poly[0],
  }
}

/** The public value f(i)·G computed purely from the commitments: Σ_j i^j · A_j. */
export function commitmentAt(i: number, commitments: GroupElement[]): GroupElement {
  const x = BigInt(i)
  let acc = Point.ZERO
  for (let j = 0; j < commitments.length; j++) acc = acc.add(mulPoint(commitments[j], pow(x, BigInt(j))))
  return acc
}

/** Feldman check: does share·G equal the committed f(i)·G? */
export function verifyShare(i: number, share: bigint, commitments: GroupElement[]): boolean {
  return baseMul(share).equals(commitmentAt(i, commitments))
}
