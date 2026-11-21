/**
 * Exhibit 2 — prove the shares are real: pick any t of them, Lagrange them
 * back together, and compare x·G against the ceremony's PK byte for byte.
 * Below t, the interpolation lands on a wrong secret — shown, not asserted.
 */
import { reconstructSecret, type DkgTranscript } from '../dkg/dkg.ts'
import { baseMul, pointHex } from '../dkg/group.ts'
import { el, mark, scalarHex, shortHex } from './dom.ts'

export function mountThreshold(root: HTMLElement): { setTranscript: (t: DkgTranscript | null) => void } {
  let transcript: DkgTranscript | null = null

  const picker = el('fieldset', { class: 'picker' }, el('legend', {}, 'Choose which parties bring their share'))
  const btn = el('button', { type: 'button', class: 'btn btn-primary' }, 'Reconstruct & compare') as HTMLButtonElement
  const out = el('div', { class: 'compare-out', role: 'status', 'aria-live': 'polite' })
  const idle = el('p', { class: 'note dim' }, 'Complete a ceremony in Exhibit 1 first — this panel works on its real output.')

  const boxes: HTMLInputElement[] = []

  const renderPicker = (): void => {
    boxes.length = 0
    picker.replaceChildren(el('legend', {}, 'Choose which parties bring their share'))
    if (!transcript) return
    transcript.partyShares.forEach((s, i) => {
      const id = `th-p${i + 1}`
      const box = el('input', { type: 'checkbox', id }) as HTMLInputElement
      box.checked = i < transcript!.t
      boxes.push(box)
      picker.append(
        el(
          'span',
          { class: 'field field-check' },
          box,
          el('label', { for: id }, `P${i + 1} `, el('code', {}, shortHex(scalarHex(s), 4, 2))),
        ),
      )
    })
  }

  btn.addEventListener('click', () => {
    if (!transcript) return
    const chosen = boxes.map((b, i) => ({ b, i })).filter(({ b }) => b.checked)
    if (chosen.length === 0) {
      out.replaceChildren(el('p', { class: 'note note-bad' }, mark('bad', ''), ' Select at least one share.'))
      return
    }
    const candidate = reconstructSecret(chosen.map(({ i }) => ({ index: i + 1, share: transcript!.partyShares[i] })))
    const lhs = pointHex(baseMul(candidate))
    const rhs = pointHex(transcript.publicKey)
    const equal = lhs === rhs
    const t = transcript.t
    const k = chosen.length
    const enough = k >= t
    // Two independent facts, each reported on its own: how many shares were
    // selected against t, and whether the reconstruction matched the PK. The
    // reading below is chosen from BOTH, so neither fact is ever inferred
    // from the other.
    const countFact = `Selected: ${k} of ${transcript.partyShares.length} shares, so ${k} shares ${enough ? '≥' : '<'} t = ${t}.`
    const matchFact = `Result: reconstructed·G ${equal ? 'matches' : 'does not match'} the ceremony PK.`
    const expected = enough === equal
    let reading: string
    if (enough && equal) {
      reading = 'As expected: with at least t shares, Lagrange interpolation regenerates the group key exactly.'
    } else if (enough) {
      reading = 'Unexpected: t or more valid shares should always reconstruct the key. This indicates a bug.'
    } else if (!equal) {
      reading =
        'As expected: Lagrange still produces a number, but not the secret. From the shares alone, every possible secret is equally consistent with too few points. The public commitments shown in Exhibit 1 (each dealer’s A₀ and the PK itself) do determine the secret, so against this coalition secrecy rests on the hardness of discrete log, not on missing information.'
    } else {
      reading = 'Unexpected: fewer than t shares should match the key only with negligible probability. This indicates a bug.'
    }
    const verdict = el(
      'div',
      { class: `note ${expected ? 'note-ok' : 'note-bad'}` },
      el('p', {}, countFact),
      el('p', {}, matchFact),
      el('p', {}, mark(expected ? 'ok' : 'bad', ''), ` ${reading}`),
    )
    out.replaceChildren(
      verdict,
      el(
        'dl',
        { class: 'compare-list' },
        el('dt', {}, 'reconstructed·G'),
        el('dd', {}, el('code', { class: `wrap ${equal ? '' : 'code-bad'}` }, lhs)),
        el('dt', {}, 'ceremony PK'),
        el('dd', {}, el('code', { class: 'wrap' }, rhs)),
      ),
    )
  })

  const setTranscript = (t: DkgTranscript | null): void => {
    transcript = t
    btn.disabled = t === null
    idle.classList.toggle('is-hidden', t !== null)
    picker.classList.toggle('is-hidden', t === null)
    out.replaceChildren()
    renderPicker()
  }

  root.append(
    el(
      'p',
      { class: 'note' },
      'This deliberately does what a real deployment never would: pull t shares onto one machine. It is the X-ray that proves the ceremony produced a genuine t-of-n sharing — the protocols that ',
      el('em', {}, 'use'),
      ' these shares (FROST, threshold decryption) sign or decrypt without ever reconstructing.',
    ),
    idle,
    picker,
    el('div', { class: 'btn-row' }, btn),
    out,
  )
  setTranscript(null)
  return { setTranscript }
}
