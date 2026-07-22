/**
 * Hand-rolled arithmetic in the scalar field Z_L, L = order of ristretto255.
 *
 * This is the inspectable half of the demo's math: every share, polynomial
 * coefficient, and Lagrange weight lives in this field, and the whole point
 * of a teaching DKG is that you can read exactly how those numbers combine.
 * The group (elliptic-curve) side stays in @noble/curves — see group.ts.
 *
 * L = 2^252 + 27742317777372353535851937790883648493 (RFC 9496); a KAT in
 * field.test.ts pins this constant to the library's group order.
 */

export const L = 2n ** 252n + 27742317777372353535851937790883648493n

/** Canonical representative in [0, L). Handles negative inputs. */
export function mod(a: bigint): bigint {
  const r = a % L
  return r < 0n ? r + L : r
}

export function add(a: bigint, b: bigint): bigint {
  return mod(a + b)
}

export function sub(a: bigint, b: bigint): bigint {
  return mod(a - b)
}

export function mul(a: bigint, b: bigint): bigint {
  return mod(a * b)
}

/** Square-and-multiply. Exponent is a plain non-negative integer, not reduced mod L. */
export function pow(base: bigint, exp: bigint): bigint {
  if (exp < 0n) throw new RangeError('negative exponent')
  let result = 1n
  let b = mod(base)
  let e = exp
  while (e > 0n) {
    if (e & 1n) result = mul(result, b)
    b = mul(b, b)
    e >>= 1n
  }
  return result
}

/**
 * Multiplicative inverse via the extended Euclidean algorithm.
 * Fails closed: inverting 0 is a protocol bug upstream, never a value to paper over.
 */
export function inv(a: bigint): bigint {
  const x = mod(a)
  if (x === 0n) throw new RangeError('0 has no inverse in Z_L')
  let [old_r, r] = [x, L]
  let [old_s, s] = [1n, 0n]
  while (r !== 0n) {
    const q = old_r / r
    ;[old_r, r] = [r, old_r - q * r]
    ;[old_s, s] = [s, old_s - q * s]
  }
  return mod(old_s)
}
