/**
 * The DKG itself — Pedersen's protocol (a.k.a. Joint-Feldman), the synchronous
 * honest-majority core that GJKR (Gennaro–Jarecki–Krawczyk–Rabin 1999) builds
 * on. n parties each act as a Feldman VSS dealer toward the other n−1:
 *
 *   Round 1  every party d broadcasts commitments A_{d,j} and privately sends
 *            party i the share f_d(i).
 *   Round 2  every party verifies every received share against the dealer's
 *            public commitments and broadcasts a COMPLAINT for each failure.
 *   Resolve  a complained-against dealer must reveal the disputed share
 *            publicly; a reveal that fails the same public check (or none at
 *            all) disqualifies the dealer. QUAL = the survivors.
 *   Assemble PK = Σ_{d∈QUAL} A_{d,0} and x_i = Σ_{d∈QUAL} f_d(i) — one key
 *            that no single party chose, shared t-of-n with no dealer.
 *
 * The magic identity: the sum of n degree-(t-1) sharings is itself a
 * degree-(t-1) sharing of the summed secret. Summing per-dealer commitments
 * coefficient-wise gives public commitments to that joint polynomial, so
 * every final share is publicly checkable too.
 *
 * Invariants embodied here (not merely described):
 *   1. No trusted dealer — the group secret exists only as the sum of QUAL
 *      contributions; the `groupSecret` field is a demo X-ray, marked so.
 *   2. Complaints are public and resolution is deterministic: reveal verifies
 *      → complainer adopts the revealed share; reveal fails → dealer out.
 *   3. Fail closed: |QUAL| < t aborts with no key rather than a weak key.
 *   4. Disqualification removes a dealer's *entire* contribution — shares and
 *      commitment — never partially.
 */
import { add } from './field.ts'
import { Point, baseMul, type GroupElement, type Rng, defaultRng } from './group.ts'
import { deal, verifyShare, commitmentAt, type FeldmanDealing } from './feldman.ts'
import { interpolateAtZero } from './poly.ts'

export interface CheatConfig {
  /** 1-based index of the misbehaving dealer. */
  dealer: number
  /** 1-based index of the party dealt a corrupted share. */
  victim: number
  /**
   * How the dealer answers the complaint: 'double-down' re-broadcasts the bad
   * share (→ disqualified); 'back-down' reveals the correct share publicly
   * (→ stays qualified, but the disputed share is now public).
   */
  reveal: 'double-down' | 'back-down'
}

export interface Complaint {
  accuser: number
  dealer: number
}

export interface Reveal {
  dealer: number
  accuser: number
  share: bigint
  ok: boolean
}

export interface DkgTranscript {
  n: number
  t: number
  dealings: FeldmanDealing[]
  /** delivered[d-1][i-1] — what dealer d actually sent party i (corruption happens here). */
  delivered: bigint[][]
  /** verified[d-1][i-1] — party i's Feldman check on that share. */
  verified: boolean[][]
  complaints: Complaint[]
  reveals: Reveal[]
  qual: number[]
  disqualified: number[]
  /** Coefficient-wise sums Σ_{d∈QUAL} A_{d,j} — commitments to the joint polynomial. */
  jointCommitments: GroupElement[]
  /** PK = jointCommitments[0]. */
  publicKey: GroupElement
  /** partyShares[i-1] = x_i = Σ_{d∈QUAL} (accepted share from d). */
  partyShares: bigint[]
  /** Demo X-ray only: Σ_{d∈QUAL} a_{d,0}. Never exists in one place in a real run. */
  groupSecret: bigint
}

/** Everything that happened before a fail-closed abort — so a UI can show *why*. */
export interface DkgPartial {
  n: number
  t: number
  dealings: FeldmanDealing[]
  delivered: bigint[][]
  verified: boolean[][]
  complaints: Complaint[]
  reveals: Reveal[]
  qual: number[]
  disqualified: number[]
}

export class DkgAbortError extends Error {
  constructor(
    message: string,
    readonly partial: DkgPartial,
  ) {
    super(message)
    this.name = 'DkgAbortError'
  }
}

export function runDkg(
  n: number,
  t: number,
  opts: { cheats?: CheatConfig[]; rng?: Rng } = {},
): DkgTranscript {
  if (!Number.isInteger(n) || !Number.isInteger(t) || t < 2 || n < t) {
    throw new RangeError(`need 2 <= t <= n; got n=${n}, t=${t}`)
  }
  const rng = opts.rng ?? defaultRng
  const cheats = opts.cheats ?? []
  for (const c of cheats) {
    if (c.dealer < 1 || c.dealer > n || c.victim < 1 || c.victim > n || c.dealer === c.victim) {
      throw new RangeError(`invalid cheat config: dealer=${c.dealer}, victim=${c.victim}`)
    }
  }

  // Round 1 — every party deals a Feldman VSS of its own random secret.
  const dealings = Array.from({ length: n }, (_, d) => deal(d + 1, n, t, rng))

  // Delivery — a cheating dealer corrupts the one share sent to its victim.
  const delivered = dealings.map((dl, d) =>
    dl.shares.map((s, i) => {
      const cheat = cheats.find((c) => c.dealer === d + 1 && c.victim === i + 1)
      return cheat ? add(s, 1n) : s
    }),
  )

  // Round 2 — everyone checks everyone's share; failures become public complaints.
  const verified = delivered.map((row, d) =>
    row.map((s, i) => verifyShare(i + 1, s, dealings[d].commitments)),
  )
  const complaints: Complaint[] = []
  for (let d = 0; d < n; d++) {
    for (let i = 0; i < n; i++) {
      if (!verified[d][i]) complaints.push({ accuser: i + 1, dealer: d + 1 })
    }
  }

  // Resolution — the dealer must reveal the disputed share; the same public
  // check that caught it now decides, so honesty is not a matter of trust.
  const reveals: Reveal[] = complaints.map((c) => {
    const cheat = cheats.find((x) => x.dealer === c.dealer && x.victim === c.accuser)
    const share =
      cheat?.reveal === 'double-down'
        ? delivered[c.dealer - 1][c.accuser - 1]
        : dealings[c.dealer - 1].shares[c.accuser - 1]
    return { dealer: c.dealer, accuser: c.accuser, share, ok: verifyShare(c.accuser, share, dealings[c.dealer - 1].commitments) }
  })

  const disqualified = [...new Set(reveals.filter((r) => !r.ok).map((r) => r.dealer))].sort((a, b) => a - b)
  const qual = Array.from({ length: n }, (_, d) => d + 1).filter((d) => !disqualified.includes(d))
  if (qual.length < t) {
    throw new DkgAbortError(
      `only ${qual.length} qualified dealers remain but t=${t} are required — abort with no key (fail closed)`,
      { n, t, dealings, delivered, verified, complaints, reveals, qual, disqualified },
    )
  }

  // Assembly — sum the surviving sharings. A complainer whose complaint was
  // answered adopts the publicly revealed (correct) share.
  const acceptedShare = (d: number, i: number): bigint => {
    const fixed = reveals.find((r) => r.dealer === d && r.accuser === i && r.ok)
    return fixed ? fixed.share : delivered[d - 1][i - 1]
  }
  const jointCommitments = Array.from({ length: t }, (_, j) =>
    qual.reduce((acc, d) => acc.add(dealings[d - 1].commitments[j]), Point.ZERO),
  )
  const partyShares = Array.from({ length: n }, (_, i) =>
    qual.reduce((acc, d) => add(acc, acceptedShare(d, i + 1)), 0n),
  )
  const groupSecret = qual.reduce((acc, d) => add(acc, dealings[d - 1].secret), 0n)

  return {
    n,
    t,
    dealings,
    delivered,
    verified,
    complaints,
    reveals,
    qual,
    disqualified,
    jointCommitments,
    publicKey: jointCommitments[0],
    partyShares,
    groupSecret,
  }
}

/** Public check available to anyone: does party i's final share match the joint commitments? */
export function verifyFinalShare(i: number, share: bigint, jointCommitments: GroupElement[]): boolean {
  return baseMul(share).equals(commitmentAt(i, jointCommitments))
}

/**
 * Lagrange-reconstruct the group secret from t (index, share) pairs.
 * Demo X-ray only: doing this for real puts the whole secret on one machine,
 * which is precisely what threshold signing/decryption protocols avoid.
 */
export function reconstructSecret(shares: Array<{ index: number; share: bigint }>): bigint {
  return interpolateAtZero(shares.map((s) => ({ x: BigInt(s.index), y: s.share })))
}
