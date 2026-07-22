/** Deterministic RNG for tests — SHA-512 counter stream over a seed label. */
import { sha512 } from '@noble/hashes/sha2.js'
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import type { Rng } from './group.ts'

export function seededRng(seed: string): Rng {
  let ctr = 0
  return (len) => {
    const blocks: Uint8Array[] = []
    let got = 0
    while (got < len) {
      const block = sha512(utf8ToBytes(`${seed}:${ctr++}`))
      blocks.push(block)
      got += block.length
    }
    return concatBytes(...blocks).slice(0, len)
  }
}
