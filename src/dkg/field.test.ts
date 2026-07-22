import { describe, expect, it } from 'vitest'
import { ristretto255 } from '@noble/curves/ed25519.js'
import { L, add, inv, mod, mul, pow, sub } from './field.ts'

describe('Z_L field constant', () => {
  it('L matches the ristretto255 group order (RFC 9496)', () => {
    expect(L).toBe(ristretto255.Point.Fn.ORDER)
  })
})

describe('hand-rolled Z_L arithmetic', () => {
  const samples = [1n, 2n, 3n, 12345n, L - 1n, L / 2n, 0x1234567890abcdefn]

  it('mod canonicalizes negatives into [0, L)', () => {
    expect(mod(-1n)).toBe(L - 1n)
    expect(mod(-L)).toBe(0n)
    expect(mod(L + 5n)).toBe(5n)
  })

  it('add/sub are inverses; mul distributes over add', () => {
    for (const a of samples) {
      for (const b of samples) {
        expect(sub(add(a, b), b)).toBe(mod(a))
        expect(mul(a, add(b, 7n))).toBe(add(mul(a, b), mul(a, 7n)))
      }
    }
  })

  it('pow matches repeated multiplication', () => {
    for (const a of samples) {
      let acc = 1n
      for (let e = 0n; e <= 8n; e++) {
        expect(pow(a, e)).toBe(acc)
        acc = mul(acc, a)
      }
    }
    expect(() => pow(2n, -1n)).toThrow(RangeError)
  })

  it('inv is a true inverse and agrees with Fermat', () => {
    for (const a of samples) {
      expect(mul(a, inv(a))).toBe(1n)
      expect(inv(a)).toBe(pow(a, L - 2n))
    }
  })

  it('inv(0) fails closed', () => {
    expect(() => inv(0n)).toThrow(RangeError)
    expect(() => inv(L)).toThrow(RangeError)
  })
})
