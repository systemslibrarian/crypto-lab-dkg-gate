/**
 * Polynomials over Z_L — the machinery under every Shamir-style sharing.
 *
 * A dealer's secret is the constant term f(0); party i's share is f(i).
 * Any t points on a degree-(t-1) polynomial pin it down exactly (Lagrange);
 * t-1 points leave the constant term uniformly undetermined.
 */
import { add, inv, mul, sub } from './field.ts'
import { randomScalar, type Rng, defaultRng } from './group.ts'

/** coeffs[j] is the coefficient of x^j; coeffs[0] is the secret. */
export type Poly = bigint[]

/** Random polynomial of the given degree — degree+1 uniform coefficients. */
export function randomPoly(degree: number, rng: Rng = defaultRng): Poly {
  if (degree < 0) throw new RangeError('degree must be >= 0')
  return Array.from({ length: degree + 1 }, () => randomScalar(rng))
}

/** Horner evaluation: f(x) = a_0 + x(a_1 + x(a_2 + …)). */
export function evalPoly(coeffs: Poly, x: bigint): bigint {
  let acc = 0n
  for (let j = coeffs.length - 1; j >= 0; j--) acc = add(mul(acc, x), coeffs[j])
  return acc
}

/**
 * Lagrange weight λ_i for interpolating at x = 0 from the given x-coordinates:
 * λ_i = Π_{j≠i} x_j / (x_j − x_i). Duplicate x-coordinates are a caller bug
 * and fail closed (division by zero → inv throws).
 */
export function lagrangeAtZero(xs: bigint[], i: number): bigint {
  let num = 1n
  let den = 1n
  for (let j = 0; j < xs.length; j++) {
    if (j === i) continue
    num = mul(num, xs[j])
    den = mul(den, sub(xs[j], xs[i]))
  }
  return mul(num, inv(den))
}

/** Interpolate f(0) from points (x_k, y_k): Σ λ_k · y_k. */
export function interpolateAtZero(points: Array<{ x: bigint; y: bigint }>): bigint {
  const xs = points.map((p) => p.x)
  let acc = 0n
  for (let k = 0; k < points.length; k++) acc = add(acc, mul(lagrangeAtZero(xs, k), points[k].y))
  return acc
}
