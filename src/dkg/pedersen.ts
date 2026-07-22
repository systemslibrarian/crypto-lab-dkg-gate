/**
 * Pedersen VSS — the *hiding* commitment layer GJKR adds in round 1.
 *
 * Feldman's A_0 = secret·G is binding but not hiding: it shows every observer
 * the dealer's key contribution before the qualified set is settled, which is
 * exactly the leak the rushing adversary in bias.ts exploits. Pedersen commits
 * to the same polynomial f with a masking polynomial g: C_j = a_j·G + b_j·H.
 * Because nobody knows log_G(H), C_j is statistically hiding — it reveals
 * nothing about a_j — while the two-scalar share (f(i), g(i)) is still
 * publicly checkable. GJKR runs complaints and fixes QUAL against these hiding
 * commitments, and only afterwards reveals the Feldman A_j to extract the key.
 */
import { pow } from './field.ts'
import { H, Point, baseMul, mulPoint, type GroupElement, type Rng, defaultRng } from './group.ts'
import { evalPoly, randomPoly, type Poly } from './poly.ts'

export interface PedersenDealing {
  dealer: number
  /** Broadcast: C_j = a_j·G + b_j·H — hiding, so A_0 stays secret until extraction. */
  commitments: GroupElement[]
  /** Private: party i receives the pair (f(i), g(i)). */
  shares: Array<{ f: bigint; g: bigint }>
  /** Demo X-ray only. */
  poly: Poly
  maskPoly: Poly
  secret: bigint
}

export function deal(dealer: number, n: number, t: number, rng: Rng = defaultRng): PedersenDealing {
  if (!Number.isInteger(n) || !Number.isInteger(t) || t < 2 || n < t) {
    throw new RangeError(`need 2 <= t <= n; got n=${n}, t=${t}`)
  }
  const poly = randomPoly(t - 1, rng)
  const maskPoly = randomPoly(t - 1, rng)
  const commitments = poly.map((a, j) => baseMul(a).add(mulPoint(H, maskPoly[j])))
  return {
    dealer,
    commitments,
    shares: Array.from({ length: n }, (_, i) => ({
      f: evalPoly(poly, BigInt(i + 1)),
      g: evalPoly(maskPoly, BigInt(i + 1)),
    })),
    poly,
    maskPoly,
    secret: poly[0],
  }
}

/** Pedersen check: f(i)·G + g(i)·H must equal Σ_j i^j · C_j. */
export function verifyShare(
  i: number,
  share: { f: bigint; g: bigint },
  commitments: GroupElement[],
): boolean {
  const x = BigInt(i)
  let rhs = Point.ZERO
  for (let j = 0; j < commitments.length; j++) rhs = rhs.add(mulPoint(commitments[j], pow(x, BigInt(j))))
  return baseMul(share.f).add(mulPoint(H, share.g)).equals(rhs)
}
