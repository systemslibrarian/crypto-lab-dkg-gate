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
    const enough = chosen.length >= transcript.t
    const verdict = el('p', { class: `note ${equal ? 'note-ok' : enough ? 'note-bad' : 'note-ok'}` })
    if (equal) {
      verdict.append(
        mark('ok', ''),
        ` ${chosen.length} shares ≥ t = ${transcript.t}: the interpolated secret regenerates the group key exactly.`,
      )
    } else if (enough) {
      verdict.append(mark('bad', ''), ' Enough shares but the key does not match — this should be impossible; the math is broken.')
    } else {
      verdict.append(
        mark('ok', ''),
        ` ${chosen.length} shares < t = ${transcript.t}: Lagrange still produces *a* number, but it is not the secret — with too few points, every possible secret is equally consistent. The threshold property holds.`,
      )
    }
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
