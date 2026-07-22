/**
 * Thin wrapper over the ristretto255 prime-order group (@noble/curves).
 *
 * The group arithmetic comes from a maintained, audited library — hand-rolling
 * curve formulas is where teaching demos silently go wrong. Everything
 * protocol-shaped (field math, polynomials, VSS, the DKG rounds, the bias
 * attack) is hand-rolled in the sibling modules so it stays inspectable.
 *
 * ristretto255 is specified in RFC 9496; rfc9496.test.ts pins this wrapper to
 * the spec's test vectors (generator multiples, invalid encodings, and the
 * element-derivation one-way map).
 */
import { ristretto255, ristretto255_hasher } from '@noble/curves/ed25519.js'
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { L, mod } from './field.ts'

export const Point = ristretto255.Point
export type GroupElement = InstanceType<typeof Point>

export type Rng = (len: number) => Uint8Array
export const defaultRng: Rng = (len) => randomBytes(len)

/**
 * Second generator for Pedersen commitments, derived by hashing a fixed label
 * to the group (RFC 9380 one-way map). Nobody knows log_G(H) — that unknown
 * discrete log is exactly what makes a Pedersen commitment hiding, and hiding
 * is exactly what the GJKR fix needs. See pedersen.ts.
 */
export const H: GroupElement = ristretto255_hasher.hashToCurve(
  utf8ToBytes('crypto-lab-dkg-gate:v1:pedersen-generator-h'),
  { DST: 'crypto-lab-dkg-gate:v1:h2g' },
)

/**
 * Uniform nonzero scalar from 48 uniform bytes (384 bits >> 253-bit order:
 * negligible bias). Zero is rejected and resampled — a dealer whose secret is
 * zero contributes nothing to the key, so the impossible-in-practice case is
 * excluded by construction rather than by luck.
 */
export function randomScalar(rng: Rng = defaultRng): bigint {
  for (;;) {
    const s = mod(BigInt('0x' + bytesToHex(rng(48))))
    if (s !== 0n) return s
  }
}

/** Scalar multiplication that tolerates the zero scalar and the identity. */
export function mulPoint(p: GroupElement, s: bigint): GroupElement {
  const k = mod(s)
  if (k === 0n || p.is0()) return Point.ZERO
  return p.multiply(k)
}

export function baseMul(s: bigint): GroupElement {
  return mulPoint(Point.BASE, s)
}

export function pointHex(p: GroupElement): string {
  return bytesToHex(p.toBytes())
}

export { L }
export { bytesToHex, hexToBytes, utf8ToBytes }
