/**
 * Exhibit 3 — the GJKR observation: why "everyone Feldman-deals, sum the
 * results" is not quite enough. A rushing adversary who controls k dealers
 * can pick WHICH of them survive to QUAL after seeing every contribution,
 * choosing among 2^k final keys. The fix: hide the contributions (Pedersen)
 * until QUAL is fixed. Both modes below run the real group math.
 */
import { runBiasAttack, type BiasResult } from '../dkg/bias.ts'
import { el, mark, scrollRegion, shortHex } from './dom.ts'

const N_HONEST = 3

export function mountBias(root: HTMLElement): void {
  const modeNaive = el('input', { type: 'radio', name: 'bias-mode', id: 'bias-naive', value: 'naive' }) as HTMLInputElement
  const modeGjkr = el('input', { type: 'radio', name: 'bias-mode', id: 'bias-gjkr', value: 'gjkr' }) as HTMLInputElement
  modeNaive.checked = true

  const modeField = el(
    'fieldset',
    { class: 'picker' },
    el('legend', {}, 'Round-1 commitment scheme'),
    el('span', { class: 'field field-check' }, modeNaive, el('label', { for: 'bias-naive' }, 'Naive Pedersen-DKG: Feldman A₀ public immediately (broken)')),
    el('span', { class: 'field field-check' }, modeGjkr, el('label', { for: 'bias-gjkr' }, 'GJKR fix: hiding Pedersen C₀ until QUAL is fixed')),
  )

  const kSel = el('select', { id: 'bias-k' })
  for (const k of ['1', '2', '3', '4', '5']) kSel.append(el('option', { value: k }, k))
  kSel.value = '4'
  const nibSel = el('select', { id: 'bias-nib' })
  for (const c of '0123456789abcdef') nibSel.append(el('option', { value: c }, c))
  nibSel.value = 'a'

  const btnRun = el('button', { type: 'button', class: 'btn btn-primary' }, 'Run round 1 + attack')
  const btnBatch = el('button', { type: 'button', class: 'btn' }, 'Run ×20 and count')
  const status = el('div', { class: 'compare-out', role: 'status', 'aria-live': 'polite' })
  const viewZone = el('div', { class: 'zone' })
  const candZone = el('div', { class: 'zone' })

  const mode = (): 'naive' | 'gjkr' => (modeNaive.checked ? 'naive' : 'gjkr')

  const renderView = (r: BiasResult): void => {
    const list = el('ul', { class: 'view-list', role: 'list' })
    for (const v of r.adversaryView) {
      list.append(el('li', { role: 'listitem' }, el('strong', {}, v.label), ' ', el('code', {}, shortHex(v.hex, 10, 4))))
    }
    viewZone.replaceChildren(
      el('h3', {}, 'What the adversary sees before QUAL is settled'),
      el(
        'p',
        { class: 'note' },
        r.mode === 'naive'
          ? 'Every A₀ is on the broadcast channel in the clear. The adversary controls the last dealers and reads everything first — a rushing adversary.'
          : 'Only hiding commitments C₀ = a₀·G + b₀·H are public. Since nobody knows log_G(H), each C₀ is consistent with every possible A₀ — there is nothing to aim with.',
      ),
      scrollRegion('Adversary’s view of round 1', list),
    )
  }

  const renderCandidates = (r: BiasResult): void => {
    if (r.mode === 'gjkr') {
      candZone.replaceChildren(
        el('h3', {}, 'The 2ᵏ candidate keys'),
        el(
          'p',
          { class: 'banner banner-ok' },
          mark('ok', ''),
          ` The lever still exists — the adversary can still knock its own dealers out of QUAL — but the ${r.candidates.length} candidate keys are not computable from hiding commitments. It must choose blind: it keeps all ${r.chosenKeep.length} dealers, and the A values are only revealed after QUAL is fixed. Too late to steer.`,
        ),
      )
      return
    }
    const table = el('table', { class: 'cand-table' })
    table.append(
      el('caption', {}, `All subset sums the adversary can force by disqualifying its own dealers (target: last nibble = ${r.targetNibble})`),
      el(
        'thead',
        {},
        el('tr', {}, el('th', { scope: 'col' }, 'keeps'), el('th', { scope: 'col' }, 'resulting PK'), el('th', { scope: 'col' }, 'last nibble'), el('th', { scope: 'col' }, 'hit?')),
      ),
    )
    const body = el('tbody')
    const chosenKey = r.chosenKeep.join(',')
    for (const c of r.candidates) {
      const isChosen = c.keep.join(',') === chosenKey
      const tr = el('tr', { class: isChosen ? 'row-chosen' : '' })
      tr.append(
        el('td', {}, c.keep.length ? c.keep.map((i) => `P${r.adversary[i].index}`).join(' ') : 'none'),
        el('td', {}, el('code', {}, shortHex(c.hex, 10, 4)), isChosen ? el('strong', { class: 'chosen-tag' }, ' ← chosen') : ''),
        el('td', {}, el('code', {}, c.hex.slice(-1))),
        el('td', {}, c.hit ? mark('bad', '') : el('span', { class: 'dim' }, '—'), c.hit ? el('span', {}, ' hit') : ''),
      )
      body.append(tr)
    }
    table.append(body)
    candZone.replaceChildren(
      el('h3', {}, 'The 2ᵏ candidate keys'),
      el(
        'p',
        { class: 'note' },
        'Contributions are binding — the adversary cannot invent a key. But choosing who gets “caught cheating” chooses among these sums, and that choice happens after everything is visible.',
      ),
      scrollRegion('Candidate final keys', table),
    )
  }

  const renderResult = (r: BiasResult): void => {
    const pct = (r.candidateHitRate * 100).toFixed(1)
    if (r.mode === 'naive') {
      if (r.success) {
        const p = el('p', { class: 'banner banner-bad' })
        p.append(
          mark('bad', ''),
          ` Key biased. The adversary kept ${r.chosenKeep.length ? r.chosenKeep.map((i) => `P${r.adversary[i].index}`).join(', ') : 'no dealers'} and steered the final key to end in “${r.targetNibble}”: `,
          el('code', {}, shortHex(r.finalHex, 12, 6)),
          ` — ${pct}% of its candidates hit this run. A “random” key an attacker can steer is not random.`,
        )
        status.replaceChildren(p)
      } else {
        const p = el('p', { class: 'banner banner-warn' })
        p.append(
          mark('warn', ''),
          ` No candidate ended in “${r.targetNibble}” this time (${(100 * (1 - Math.pow(15 / 16, r.candidates.length))).toFixed(0)}% odds with ${r.candidates.length} candidates). Run it again — a real adversary would, or would target the property it actually needs.`,
        )
        status.replaceChildren(p)
      }
    } else {
      const p = el('p', { class: r.success ? 'banner banner-warn' : 'banner banner-ok' })
      p.append(
        mark(r.success ? 'warn' : 'ok', ''),
        r.success
          ? ` The blind all-in key happened to end in “${r.targetNibble}” — 1-in-16 luck, not steering. The adversary had no information to act on.`
          : ` Final key ${shortHex(r.finalHex, 12, 6)} — last nibble “${r.finalHex.slice(-1)}”, target was “${r.targetNibble}”. Blind success rate is 1/16 regardless of how many dealers the adversary controls: the fix removed the information, not the lever.`,
      )
      status.replaceChildren(p)
    }
  }

  const run = (): void => {
    const r = runBiasAttack(N_HONEST, Number(kSel.value), nibSel.value, mode())
    renderView(r)
    renderCandidates(r)
    renderResult(r)
  }

  const runBatch = (): void => {
    const m = mode()
    const k = Number(kSel.value)
    let wins = 0
    for (let i = 0; i < 20; i++) {
      if (runBiasAttack(N_HONEST, k, nibSel.value, m).success) wins++
    }
    // Naive: 1-(15/16)^(2^k) treats the 2^k subset keys as independent draws of an
    // approximately balanced nibble — an independence heuristic, not an exact theorem
    // (subset sums are correlated). GJKR: a blind 1-in-16 guess, exactly.
    const expected = m === 'naive' ? 100 * (1 - Math.pow(15 / 16, 1 << k)) : 100 / 16
    const expectedLabel =
      m === 'naive' ? `independence heuristic ≈ ${expected.toFixed(0)}%` : `blind guess = ${expected.toFixed(1)}%`
    const p = el('p', { class: `banner ${m === 'naive' ? 'banner-bad' : 'banner-ok'}` })
    p.append(
      mark(m === 'naive' ? 'bad' : 'ok', ''),
      ` 20 fresh ceremonies, ${m === 'naive' ? 'naive commitments' : 'GJKR hiding commitments'}, k = ${k}: the adversary hit its target nibble ${wins}/20 times (${expectedLabel}). `,
      m === 'naive'
        ? 'Every extra corrupted dealer doubles the candidate space.'
        : 'Controlling more dealers buys nothing once the view is hiding.',
    )
    status.replaceChildren(p)
  }

  btnRun.addEventListener('click', run)
  btnBatch.addEventListener('click', runBatch)
  modeNaive.addEventListener('change', run)
  modeGjkr.addEventListener('change', run)

  root.append(
    modeField,
    el(
      'div',
      { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'bias-k' }, 'Corrupted dealers k (of 3 honest + k)'), el('span', { class: 'select-wrap' }, kSel)),
      el('div', { class: 'field' }, el('label', { for: 'bias-nib' }, 'Target last hex nibble'), el('span', { class: 'select-wrap' }, nibSel)),
    ),
    el('div', { class: 'btn-row' }, btnRun, btnBatch),
    status,
    viewZone,
    candZone,
    el(
      'details',
      { class: 'xray-details' },
      el('summary', {}, 'Why “ends in a” stands in for a real attack goal'),
      el(
        'p',
        {},
        'Biasing one nibble looks harmless; the point is the key is no longer uniform. GJKR’s paper shows the same lever breaks the uniform-key assumption that proofs for threshold Schnorr/DSS builds rest on. Any predicate an adversary cares about — a key that collides with something, a key with structure — gets the same 2ᵏ-fold boost.',
      ),
    ),
  )
  run()
}
