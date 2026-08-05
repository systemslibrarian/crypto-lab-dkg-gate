# DKG Gate

**Pedersen DKG · Gennaro–Jarecki–Krawczyk–Rabin (GJKR), 1999**

A dealerless distributed key generation you can run, break, and bias in the browser. `n` parties jointly produce one public key and a `t`-of-`n` secret sharing of the matching private key — with no trusted dealer, and with nobody ever holding the whole secret. Then you get to cheat as a dealer and watch the protocol catch you, and mount the specific attack GJKR wrote their paper to close.

**Live demo → https://systemslibrarian.github.io/crypto-lab-dkg-gate/**

## What It Is

Threshold cryptography always begins with the same hand-wave: *"assume the parties already hold shares of a secret key."* **DKG is how those shares come to exist without anyone being trusted to deal them.**

The primitives, exactly:

- **Pedersen's DKG** (a.k.a. Joint-Feldman): every party runs a **Feldman VSS** as a dealer toward all the others, and the `n` independent sharings are summed coefficient-wise into one joint sharing. The group public key is `PK = Σ A₀` over the qualified dealers; each party's long-term share is the sum of the shares it received.
- **Feldman VSS** is the per-dealer commitment layer: the dealer broadcasts `A_j = a_j·G` ("the polynomial in the exponent") so any share `s` is publicly checkable via `s·G = Σ_j iʲ·A_j`. Provable cheating, not trusted honesty.
- **The GJKR fix.** Naive Pedersen DKG is *biasable*: a rushing adversary who controls `k` dealers sees every contribution before choosing which of its own dealers to sacrifice to the complaint round, and that choice steers the "random" key among `2ᵏ` values. GJKR's fix is **commit-then-reveal** with *hiding* **Pedersen commitments** `C_j = a_j·G + b_j·H` — the qualified set is fixed while every contribution is still information-theoretically hidden.

Group arithmetic is **ristretto255** (RFC 9496) via [`@noble/curves`](https://github.com/paulmillr/noble-curves); every field, polynomial, VSS, complaint, and attack is hand-rolled in `src/dkg/` so the mechanism is inspectable.

**Not production crypto — a teaching demo.** One browser tab plays all `n` parties, so the "private channels" between them are deliberately visible; a real deployment runs one party per machine over authenticated broadcast. The math is real; the isolation is simulated on purpose, and labelled where it is.

## Exhibits

1. **The ceremony (with break-it cheating)** — step Pedersen's DKG round by round for your choice of `n` and `t`: round 1 (every party deals), round 2 (everyone verifies against public commitments), complaints & reveals, the qualified set, and key assembly. The share-delivery matrix shows every dealt share; the assembly panel shows `PK` built as a live sum of contributions. Arm one dealer to send a corrupted share and watch the victim raise a public **complaint**: the dealer either **doubles down** (its reveal fails the same public check → disqualified, entire contribution discarded) or **backs down** (reveals the correct share → stays qualified, victim adopts it). With `t = n`, one disqualification drops `QUAL` below `t` and the ceremony **aborts with no key** — fail closed.
2. **Prove the threshold** — pick any subset of the real final shares, Lagrange-reconstruct, and **compare `reconstructed·G` against the ceremony's `PK` byte for byte.** `t` shares regenerate the key; `t−1` land on a wrong secret — shown, not asserted.
3. **Bias the key — the GJKR attack & fix** — run the real rushing-adversary attack against naive commitments: all `2ᵏ` candidate keys are enumerated as genuine subset sums, and the adversary steers the final key to a target. Flip on the GJKR hiding commitments and the same lever produces only blind `1/16` luck. A ×20 batch counts the empirical success rate against theory.

**A note on scope.** The runnable ceremony (Exhibit 1) is **Pedersen's DKG / Joint-Feldman** — every party deals a Feldman VSS and the sharings sum into one key, with public complaints and fail-closed qualification. Exhibit 3 then **models the specific attack GJKR (1999) closes and its fix**: it uses real hiding Pedersen commitments and real subset-sum key math to show why a rushing adversary can bias the naive key and why commit-then-reveal removes the information to aim with. It is a faithful model of the bias and the fix, **not** a second full commit-then-reveal ceremony with a separate Feldman-extraction phase — the insight is the teaching target, and it is exact.

## When to Use It

- **Use DKG** whenever a threshold system needs a key that no single party is trusted to have generated: threshold wallets, validator/consensus keys, distributed randomness beacons, MPC signing setups.
- **Do NOT use a hand-rolled DKG in production**, and do not use *this* one anywhere real. Use an audited implementation of a well-specified variant (e.g. FROST's DKG, or a GJKR implementation) with authenticated channels and the security model your deployment actually faces.
- **Do NOT reach for DKG when a trusted dealer is acceptable** — if one party may generate and split the key, plain [Shamir](https://systemslibrarian.github.io/crypto-lab-shamir-gate/) or [VSS](https://systemslibrarian.github.io/crypto-lab-vss-gate/) is simpler.

## Live Demo

At the [live site](https://systemslibrarian.github.io/crypto-lab-dkg-gate/) you can choose `n`, `t`, and a cheating configuration; step the ceremony or run it all at once; reconstruct the secret from any share subset; and run the biasing attack with and without the fix. Everything computes in-browser on real ristretto255 points — no backend, no persistence.

## What Can Go Wrong

- **A malicious dealer** deals shares inconsistent with its commitments. Caught by the public complaint round; the same equation every honest party can run decides the outcome, so honesty is not a matter of trust. (Exhibit 1.)
- **A rushing adversary** biases the joint key by choosing which of its own dealers survive to `QUAL` after seeing all contributions. This is the real flaw in naive Pedersen DKG, and the reason GJKR exists. (Exhibit 3.)
- **Too many disqualifications** leave fewer than `t` honest dealers. The protocol **aborts with no key** rather than emitting a weak one.
- **Reconstructing the secret** onto one machine — which this demo does in Exhibit 2 as an X-ray — is exactly what threshold *use* protocols avoid; doing it in production would defeat the entire point.

## Threat Model, Property by Property

Two different numbers govern the claims: `t` is the **reconstruction threshold** (`t` shares rebuild the secret, `t−1` do not); `f` is **how many parties the adversary corrupts**. They are not the same quantity, and each property has its own bound on `f`:

- **Correctness & agreement** (all finishers agree on `QUAL` and `PK`): any number of cheating dealers, because complaints are decided by a public equation — but only under the synchronous rounds and reliable broadcast this demo simulates in one tab. Implemented and tested.
- **Secrecy of the group secret**: a coalition of `f ≤ t−1` share holders cannot reconstruct (Shamir's bound); secrecy is computational (discrete log) because Feldman commitments publish each dealer's `A₀ = a₀·G`. Exhibit 2's reconstruction X-ray deliberately violates it on screen, and says so.
- **Output uniformity**: fails against a rushing adversary with even one corrupted dealer in the naive flow (Exhibit 3's attack); restored by GJKR commit-then-reveal, which Exhibit 3 models.
- **Availability** (finishing; later `t`-of-`n` use): needs `≥ t` qualified dealers and later `≥ t` responsive holders, so tolerates `f ≤ n−t` withholding or crashed parties. Message loss is otherwise unmodeled.
- **Channels**: authenticated private dealer-to-holder channels and reliable synchronous broadcast are assumed; one tab playing all parties makes equivocation impossible by construction here, not defended against.
- **Corruption model**: static, fixed before the run. Rushing appears only in Exhibit 3; adaptive corruption and denial of service are unmodeled.

## Real-World Usage

DKG underpins production threshold systems: FROST and GG20 threshold signatures (custody, multi-party wallets), distributed validator keys in proof-of-stake, DKG-based randomness beacons (e.g. drand-style), and MPC key-management services. The Pedersen/GJKR line is the classical synchronous, honest-majority foundation those build on.

## How to Run Locally

```bash
npm install
npm run dev        # serve at the Vite dev URL
npm test           # Vitest unit tests + spec KATs
npm run build      # typecheck (tsc --noEmit) + production build
npm run test:a11y  # axe-core WCAG gate on the production build (needs: npx playwright install chromium)
```

## Related Demos

- [crypto-lab-vss-gate](https://systemslibrarian.github.io/crypto-lab-vss-gate/) — one dealer, verifiable secret sharing; the layer this demo composes `n` times.
- [crypto-lab-frost-threshold](https://systemslibrarian.github.io/crypto-lab-frost-threshold/) — threshold Schnorr signing that *consumes* DKG shares.
- [crypto-lab-threshold-decrypt](https://systemslibrarian.github.io/crypto-lab-threshold-decrypt/) — threshold decryption over shared keys.
- [crypto-lab-reshare-circle](https://systemslibrarian.github.io/crypto-lab-reshare-circle/) — proactive share refresh, the "re-deal to heal compromise" step.
- [crypto-lab-gg20-wallet](https://systemslibrarian.github.io/crypto-lab-gg20-wallet/) — an ECDSA threshold wallet end to end.

## Build & Verify

- **96 unit tests** (Vitest), colocated as `src/dkg/*.test.ts`, run in CI before every deploy.
- **52 spec KATs** from **RFC 9496** (ristretto255): 16 generator multiples, 29 rejected invalid encodings, 7 one-way-map vectors — in `src/dkg/rfc9496.test.ts`. The scalar field constant `L` is pinned to the library's group order in `src/dkg/field.test.ts`.
- Correctness suites prove: every honest share verifies and every bad one is rejected (`feldman.test.ts`, `pedersen.test.ts`); any `t` final shares reconstruct `PK` while `t−1` do not (`dkg.test.ts`); a doubling-down cheater is disqualified and a backing-down one is absorbed; `|QUAL| < t` aborts fail-closed; and the rushing-adversary bias is real against naive commitments and neutralized under the GJKR fix (`bias.test.ts`).
- **Accessibility gate:** `@axe-core/playwright` scans the production build for zero WCAG 2.1 A/AA violations in **both** themes, driving every exhibit into its post-interaction state first. The GitHub Pages deploy is blocked on any regression.

## Performance

Everything is a handful of ristretto255 scalar multiplications per interaction — imperceptible in-browser. The bias exhibit enumerates `2ᵏ` (≤ 32) subset sums per run; the ×20 batch is still instant.

---

*Part of the [Crypto Lab](https://crypto-lab.systemslibrarian.dev/) suite.*

*"So whether you eat or drink or whatever you do, do it all for the glory of God." — 1 Corinthians 10:31*
