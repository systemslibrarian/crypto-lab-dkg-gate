/**
 * Exhibit 1 — the ceremony, stepped round by round.
 *
 * The headline mechanism this demo exists to show: n dealers each run a
 * Feldman VSS toward everyone else, the shares get checked in public, cheats
 * get complained about and thrown out, and the surviving sharings SUM into
 * one key that no single party ever chose or held.
 */
import {
  DkgAbortError,
  runDkg,
  verifyFinalShare,
  type CheatConfig,
  type DkgPartial,
  type DkgTranscript,
} from '../dkg/dkg.ts'
import { baseMul, pointHex } from '../dkg/group.ts'
import { el, mark, scalarHex, scrollRegion, shortHex } from './dom.ts'

const PHASES = [
  'Round 1 — every party deals',
  'Round 2 — everyone verifies',
  'Complaints & reveals',
  'Qualified set',
  'Key assembly',
] as const

type View =
  | { kind: 'ok'; t: DkgTranscript }
  | { kind: 'abort'; p: DkgPartial; msg: string }

interface State {
  n: number
  t: number
  cheatOn: boolean
  cheatDealer: number
  cheatVictim: number
  reveal: CheatConfig['reveal']
  /** -1 = not started; 0..4 = index of the furthest phase revealed. */
  phase: number
  view: View | null
}

export function mountCeremony(root: HTMLElement, onComplete: (t: DkgTranscript | null) => void): void {
  const state: State = {
    n: 5,
    t: 3,
    cheatOn: false,
    cheatDealer: 2,
    cheatVictim: 4,
    reveal: 'double-down',
    phase: -1,
    view: null,
  }

  const stage = el('div', { class: 'stage' })
  const status = el('p', { class: 'status-line', role: 'status', 'aria-live': 'polite' })
  const phaseNav = el('ol', { class: 'phase-nav', 'aria-label': 'Ceremony phases' })

  // ---- controls -----------------------------------------------------------

  const select = (id: string, label: string, options: string[], value: string): [HTMLElement, HTMLSelectElement] => {
    const sel = el('select', { id })
    for (const o of options) sel.append(el('option', { value: o }, o))
    sel.value = value
    const wrap = el('div', { class: 'field' }, el('label', { for: id }, label), el('span', { class: 'select-wrap' }, sel))
    return [wrap, sel]
  }

  const [nField, nSel] = select('c-n', 'Parties n', ['3', '4', '5', '6', '7'], '5')
  const [tField, tSel] = select('c-t', 'Threshold t', ['2', '3', '4', '5'], '3')
  const [dealerField, dealerSel] = select('c-dealer', 'Cheating dealer', [], 'P2')
  const [victimField, victimSel] = select('c-victim', 'Deals a bad share to', [], 'P4')
  const [revealField, revealSel] = select(
    'c-reveal',
    'When challenged, the dealer…',
    ['doubles down (re-broadcasts the bad share)', 'backs down (reveals the correct share)'],
    'doubles down (re-broadcasts the bad share)',
  )

  const cheatBox = el('input', { type: 'checkbox', id: 'c-cheat' }) as HTMLInputElement
  const cheatField = el(
    'div',
    { class: 'field field-check' },
    cheatBox,
    el('label', { for: 'c-cheat' }, 'One dealer cheats'),
  )

  const btnStep = el('button', { type: 'button', class: 'btn btn-primary' }, 'Run round 1 — deal')
  const btnAll = el('button', { type: 'button', class: 'btn' }, 'Run whole ceremony')
  const btnReset = el('button', { type: 'button', class: 'btn' }, 'Reset')

  const refreshOptions = (): void => {
    const ts = Array.from({ length: state.n - 1 }, (_, i) => String(i + 2))
    tSel.replaceChildren(...ts.map((v) => el('option', { value: v }, v)))
    tSel.value = String(Math.min(state.t, state.n))
    const parties = Array.from({ length: state.n }, (_, i) => `P${i + 1}`)
    dealerSel.replaceChildren(...parties.map((p) => el('option', { value: p }, p)))
    dealerSel.value = `P${Math.min(state.cheatDealer, state.n)}`
    victimSel.replaceChildren(
      ...parties.filter((p) => p !== dealerSel.value).map((p) => el('option', { value: p }, p)),
    )
    const victim = `P${Math.min(state.cheatVictim, state.n)}`
    victimSel.value = victim !== dealerSel.value ? victim : (parties.find((p) => p !== dealerSel.value) ?? 'P1')
    state.t = Number(tSel.value)
    state.cheatDealer = Number(dealerSel.value.slice(1))
    state.cheatVictim = Number(victimSel.value.slice(1))
    const cheatCtl = [dealerField, victimField, revealField]
    cheatCtl.forEach((f) => f.classList.toggle('is-hidden', !state.cheatOn))
  }

  const reset = (announce: string): void => {
    state.phase = -1
    state.view = null
    btnStep.textContent = 'Run round 1 — deal'
    btnStep.disabled = false
    render()
    status.textContent = announce
    onComplete(null)
  }

  nSel.addEventListener('change', () => {
    state.n = Number(nSel.value)
    refreshOptions()
    reset('Settings changed — ceremony reset.')
  })
  tSel.addEventListener('change', () => {
    state.t = Number(tSel.value)
    reset('Settings changed — ceremony reset.')
  })
  dealerSel.addEventListener('change', () => {
    state.cheatDealer = Number(dealerSel.value.slice(1))
    refreshOptions()
    reset('Settings changed — ceremony reset.')
  })
  victimSel.addEventListener('change', () => {
    state.cheatVictim = Number(victimSel.value.slice(1))
    reset('Settings changed — ceremony reset.')
  })
  revealSel.addEventListener('change', () => {
    state.reveal = revealSel.value.startsWith('doubles') ? 'double-down' : 'back-down'
    reset('Settings changed — ceremony reset.')
  })
  cheatBox.addEventListener('change', () => {
    state.cheatOn = cheatBox.checked
    refreshOptions()
    reset(state.cheatOn ? 'Cheat armed — the dealer will corrupt one share.' : 'All dealers honest.')
  })

  const start = (): void => {
    const cheats = state.cheatOn
      ? [{ dealer: state.cheatDealer, victim: state.cheatVictim, reveal: state.reveal }]
      : []
    try {
      state.view = { kind: 'ok', t: runDkg(state.n, state.t, { cheats }) }
    } catch (e) {
      if (!(e instanceof DkgAbortError)) throw e
      state.view = { kind: 'abort', p: e.partial, msg: e.message }
    }
  }

  const announcePhase = (): void => {
    const v = state.view
    if (!v) return
    const p = v.kind === 'ok' ? v.t : v.p
    const msgs: string[] = [
      `Round 1 complete: ${p.n} dealers each broadcast ${p.t} commitments and dealt ${p.n} shares.`,
      p.complaints.length === 0
        ? 'Round 2 complete: every share verified against its dealer’s public commitments.'
        : `Round 2 complete: ${p.complaints.length} share check${p.complaints.length > 1 ? 's' : ''} failed.`,
      p.complaints.length === 0
        ? 'No complaints — nothing to resolve.'
        : `Complaints resolved: ${p.disqualified.length} dealer${p.disqualified.length === 1 ? '' : 's'} disqualified.`,
      v.kind === 'abort'
        ? 'Too few qualified dealers — the ceremony aborts with no key.'
        : `Qualified set fixed: ${p.qual.map((d) => `P${d}`).join(', ')}.`,
      v.kind === 'ok'
        ? `Key assembled: PK = ${shortHex(pointHex(v.t.publicKey), 10, 4)} — the sum of ${v.t.qual.length} contributions.`
        : 'No key: the ceremony aborted (fail closed).',
    ]
    status.textContent = msgs[state.phase] ?? ''
  }

  const advance = (to: number): void => {
    if (state.phase === -1) start()
    const lastPhase = state.view?.kind === 'abort' ? 3 : 4
    state.phase = Math.min(to, lastPhase)
    render()
    announcePhase()
    if (state.phase >= lastPhase) {
      btnStep.disabled = true
      btnStep.textContent = state.view?.kind === 'abort' ? 'Aborted — reset to retry' : 'Ceremony complete'
      if (state.view?.kind === 'ok') onComplete(state.view.t)
    } else {
      btnStep.textContent = `Next: ${PHASES[state.phase + 1]}`
    }
  }

  btnStep.addEventListener('click', () => advance(state.phase + 1))
  btnAll.addEventListener('click', () => advance(4))
  btnReset.addEventListener('click', () => reset('Ceremony reset.'))

  // ---- rendering ----------------------------------------------------------

  const partyCards = (): HTMLElement => {
    const v = state.view
    const row = el('div', { class: 'party-row' })
    for (let i = 1; i <= state.n; i++) {
      const card = el('div', { class: 'party-card' }, el('span', { class: 'party-name' }, `P${i}`))
      if (v) {
        const p = v.kind === 'ok' ? v.t : v.p
        const d = p.dealings[i - 1]
        card.append(
          el('span', { class: 'party-line xray' }, 'a₀ ', el('code', {}, shortHex(scalarHex(d.secret), 4, 2))),
          el('span', { class: 'party-line' }, 'A₀ ', el('code', {}, shortHex(pointHex(d.commitments[0]), 4, 2))),
        )
        if (state.phase >= 3) {
          const out = p.disqualified.includes(i)
          card.classList.add(out ? 'party-disq' : 'party-qual')
          const badge = el('span', { class: 'party-badge' })
          badge.append(
            mark(out ? 'bad' : 'ok', ''),
            el('span', {}, out ? ' disqualified' : ' qualified'),
          )
          card.append(badge)
        }
      }
      row.append(card)
    }
    return row
  }

  const shareMatrix = (): HTMLElement => {
    const v = state.view
    if (!v) return el('div')
    const p = v.kind === 'ok' ? v.t : v.p
    const table = el('table', { class: 'share-matrix' })
    const cap = el(
      'caption',
      {},
      'Every row is one dealer’s Feldman sharing; every column is what one party receives. ',
      el('strong', {}, `Each party ends up holding one share from every dealer.`),
    )
    const head = el('tr', {}, el('th', { scope: 'col' }, 'dealer ↓ to →'))
    for (let i = 1; i <= state.n; i++) head.append(el('th', { scope: 'col' }, `P${i}`))
    table.append(cap, el('thead', {}, head))
    const body = el('tbody')
    for (let d = 1; d <= state.n; d++) {
      const tr = el('tr', {}, el('th', { scope: 'row' }, `P${d} deals`))
      for (let i = 1; i <= state.n; i++) {
        const val = p.delivered[d - 1][i - 1]
        const cheated = state.cheatOn && d === state.cheatDealer && i === state.cheatVictim
        const td = el('td', { class: cheated ? 'cell-cheat' : '' }, el('code', {}, shortHex(scalarHex(val), 4, 2)))
        if (cheated && state.phase < 1) td.append(mark('warn', 'corrupted by the dealer'))
        if (state.phase >= 1) {
          const ok = p.verified[d - 1][i - 1]
          td.classList.add(ok ? 'cell-ok' : 'cell-bad')
          td.append(mark(ok ? 'ok' : 'bad', ok ? 'verifies against commitments' : 'fails the commitment check'))
        }
        tr.append(td)
      }
      body.append(tr)
    }
    table.append(body)
    return scrollRegion('Share delivery matrix', table)
  }

  const complaintsZone = (): HTMLElement => {
    const v = state.view
    if (!v || state.phase < 2) return el('div')
    const p = v.kind === 'ok' ? v.t : v.p
    const zone = el('div', { class: 'zone' }, el('h3', {}, 'Complaints & reveals'))
    if (p.complaints.length === 0) {
      const note = el('p', { class: 'note note-ok' })
      note.append(mark('ok', ''), ' No complaints. Every dealt share satisfied s·G = Σ i^j·A_j in public view.')
      zone.append(note)
      return zone
    }
    for (const c of p.complaints) {
      const line = el('p', { class: 'note note-bad' })
      line.append(
        mark('bad', ''),
        ` P${c.accuser} broadcasts a COMPLAINT against P${c.dealer} — the share failed the public check. `,
        'Everyone can re-run the same equation; no one has to take P',
        String(c.accuser),
        '’s word for it.',
      )
      zone.append(line)
    }
    for (const r of p.reveals) {
      const line = el('p', { class: r.ok ? 'note note-ok' : 'note note-bad' })
      line.append(
        mark(r.ok ? 'ok' : 'bad', ''),
        ` P${r.dealer} must answer in public. It reveals `,
        el('code', {}, shortHex(scalarHex(r.share), 6, 4)),
        r.ok
          ? ` — this one verifies, so P${r.dealer} stays qualified and P${r.accuser} adopts the revealed share. The cheat cost P${r.dealer} nothing but exposure.`
          : ` — it fails the same public check. P${r.dealer} is disqualified and its entire contribution is discarded.`,
      )
      zone.append(line)
    }
    return zone
  }

  const qualZone = (): HTMLElement => {
    const v = state.view
    if (!v || state.phase < 3) return el('div')
    const zone = el('div', { class: 'zone' }, el('h3', {}, 'Qualified set'))
    if (v.kind === 'abort') {
      const banner = el('p', { class: 'banner banner-bad' })
      banner.append(mark('bad', ''), ' ', v.msg, ' — better no key than a key the group can never use.')
      zone.append(banner)
      return zone
    }
    const p = v.t
    zone.append(
      el(
        'p',
        { class: 'note' },
        `QUAL = { ${p.qual.map((d) => `P${d}`).join(', ')} }. From here on, only these dealers’ sharings exist. `,
        p.disqualified.length
          ? `P${p.disqualified.join(', P')} contributed nothing — a caught cheater is erased, not punished with a weaker key.`
          : 'Nobody was disqualified.',
      ),
    )
    return zone
  }

  const assemblyZone = (): HTMLElement => {
    const v = state.view
    if (!v || v.kind !== 'ok' || state.phase < 4) return el('div')
    const t = v.t
    const zone = el('div', { class: 'zone assemble' }, el('h3', {}, 'Key assembly — the sum nobody chose'))

    const chips = el('div', { class: 'chip-row', role: 'list', 'aria-label': 'Public key as a sum of contributions' })
    t.qual.forEach((d, idx) => {
      const chip = el('span', { class: 'chip', role: 'listitem' })
      chip.style.setProperty('--i', String(idx))
      chip.append(el('strong', {}, `P${d}`), ' ', el('code', {}, shortHex(pointHex(t.dealings[d - 1].commitments[0]), 6, 2)))
      chips.append(chip)
      if (idx < t.qual.length - 1) chips.append(el('span', { class: 'chip-op', 'aria-hidden': 'true' }, '+'))
    })
    const pkChip = el('span', { class: 'chip chip-pk', role: 'listitem' })
    pkChip.style.setProperty('--i', String(t.qual.length))
    pkChip.append(el('strong', {}, 'PK'), ' ', el('code', {}, shortHex(pointHex(t.publicKey), 10, 6)))
    chips.append(el('span', { class: 'chip-op', 'aria-hidden': 'true' }, '='), pkChip)
    zone.append(
      el(
        'p',
        { class: 'note' },
        'PK = Σ A₀ over the qualified dealers. Change any one contribution and the sum moves — no party knows the discrete log of PK, because no party knows the others’ a₀.',
      ),
      chips,
    )

    const shareList = el('ul', { class: 'final-shares', role: 'list' })
    t.partyShares.forEach((s, i) => {
      const okFinal = verifyFinalShare(i + 1, s, t.jointCommitments)
      const li = el('li', { role: 'listitem' })
      li.append(
        el('strong', {}, `P${i + 1}`),
        ' holds x = Σ column = ',
        el('code', {}, shortHex(scalarHex(s), 6, 4)),
        ' ',
        mark(okFinal ? 'ok' : 'bad', okFinal ? 'verifies on the joint polynomial' : 'FAILS the joint polynomial'),
        el('span', { class: 'dim' }, okFinal ? ' on the joint polynomial' : ' — should never happen'),
      )
      shareList.append(li)
    })
    zone.append(
      el(
        'p',
        { class: 'note' },
        'Each party sums the column of shares it received. Because a sum of degree-(t−1) sharings is itself a degree-(t−1) sharing, every final share is publicly checkable against the coefficient-wise summed commitments:',
      ),
      shareList,
    )

    const secretHexFull = scalarHex(t.groupSecret)
    const lhs = pointHex(baseMul(t.groupSecret))
    const rhs = pointHex(t.publicKey)
    const xray = el('details', { class: 'xray-details' })
    xray.append(
      el('summary', {}, 'X-ray: the group secret (exists only in this demo)'),
      el(
        'p',
        {},
        'In a real run the joint secret x = Σ a₀ never exists anywhere — it is only ever implied by the shares. This demo can show it because it plays all parties at once: ',
        el('code', { class: 'wrap' }, secretHexFull),
      ),
      el('p', { class: lhs === rhs ? 'note note-ok' : 'note note-bad' }, mark(lhs === rhs ? 'ok' : 'bad', ''), ` computing both sides: x·G ${lhs === rhs ? '=' : '≠'} PK, byte for byte.`),
    )
    zone.append(xray)
    return zone
  }

  const render = (): void => {
    phaseNav.replaceChildren(
      ...PHASES.map((name, i) => {
        const attrs: Record<string, string> = { class: i <= state.phase ? 'phase-done' : 'phase-todo' }
        if (i === state.phase) attrs['aria-current'] = 'step'
        return el('li', attrs, name)
      }),
    )
    stage.replaceChildren(partyCards(), state.view ? shareMatrix() : el('p', { class: 'note dim' }, 'Pick n and t, optionally arm a cheat, then run round 1.'), complaintsZone(), qualZone(), assemblyZone())
  }

  root.append(
    el(
      'div',
      { class: 'controls' },
      nField,
      tField,
      cheatField,
      dealerField,
      victimField,
      revealField,
    ),
    el('p', { class: 'hint' }, 'With t = n, a single disqualification drops QUAL below t and the ceremony aborts with no key — fail closed. Try n = 3, t = 3 with a doubling-down cheater.'),
    el('div', { class: 'btn-row' }, btnStep, btnAll, btnReset),
    phaseNav,
    status,
    stage,
  )
  refreshOptions()
  render()
  status.textContent = 'Ready. Five parties, threshold three, everyone honest.'
}
