import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Shared machinery for the WCAG gate.
 *
 * Four rules govern everything here:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The gate this replaces
 *     pushed `animation:none!important; transition:none!important` through
 *     `addStyleTag` before each of its two scans. On this page that override
 *     did not merely freeze the page, it BROKE it: `.chip` ships at
 *     `opacity: 0` and is animated to 1 by `chip-in ... forwards`, so
 *     cancelling the animation with no `opacity` to go with it leaves every
 *     key-assembly chip — the "PK = ΣA₀" sum that is the whole point of Exhibit
 *     1 — painted at zero opacity. The gate was scanning a state no reader ever
 *     sees, and it could not have noticed, because axe skips what is invisible.
 *
 *     The stylesheet's own `@media (prefers-reduced-motion: reduce)` block gets
 *     this right — `.chip { animation: none; opacity: 1 }`, cancelling AND
 *     restoring the end state — which is exactly the thing the injection
 *     bypassed rather than exercised. `boot` asks for the preference, asserts it
 *     took effect, `settle` waits for the animations to drain, and
 *     `expectNotBlank` asserts nothing landed at zero opacity, which is what
 *     makes "the reduced-motion path restores the end state" a measurement
 *     rather than a reading of the CSS.
 *
 *  2. IT FORCE-OPENED EVERY `<details>` FROM SCRIPT before each scan, so the
 *     shut state — which is how all three `.xray-details` panels arrive — was
 *     never scanned, and the open one was never reached the way a reader
 *     reaches it. Each is now opened by clicking its own `<summary>`.
 *
 *  3. IT SCANNED TWICE PER THEME, AT ONE VIEWPORT. The drive itself was
 *     genuinely good — it armed the cheat, ran the ceremony to key assembly,
 *     reconstructed above and below the threshold, and ran both bias modes —
 *     but every one of those states was thrown away unmeasured except the last
 *     two, because `scan()` was called only at the end. The stepped rounds, the
 *     complaint, the disqualification, the fail-closed abort, the "backs down"
 *     branch, the empty-selection error, the reset, and the whole 380px column
 *     had never been scanned at all. This drive scans after every single step,
 *     in both themes, at 1280px and 380px.
 *
 *  4. `violations` IS NOT THE WHOLE ORACLE. See `scan`. The previous gate did
 *     add four landmark best-practice rules on top of the WCAG tags, which was
 *     right; those are kept.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Transitions drain in waves, not in one batch, so a poll for "nothing running
 * right now" can exit through a gap between waves. Require quiescence to hold
 * for several consecutive frames instead.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __quietFrames?: number };
      const running = document.getAnimations().filter((a) => a.playState === 'running');
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      return w.__quietFrames >= 6;
    },
    undefined,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion block
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set. This lab is
 * one keyword away from being that page: `.chip` declares `opacity: 0` and
 * relies on `chip-in ... forwards` to bring it to 1, and its reduced-motion
 * block writes `animation: none` — which alone would leave every key-assembly
 * chip invisible. It gets away with it because the same block also writes
 * `opacity: 1`. This assertion is what turns "the block also writes opacity"
 * from something you read in the CSS into something the gate measured, in
 * every state where a chip is on screen.
 *
 * `aria-hidden` subtrees are excluded. The cost of that exclusion is stated
 * plainly: text removed from the accessibility tree AND painted at zero opacity
 * is not checked here.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([]);
}

/**
 * Uncaught page errors and console errors, collected from the moment the page
 * is created.
 *
 * Kept from the gate this replaces, which was right about it: a renderer that
 * throws halfway through leaves an earlier state on screen, and a gate that
 * scans that state reports green for a page that is broken. Attach before
 * `boot`, assert after the drive.
 */
export function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  return errors;
}

/**
 * Exactly one banner landmark: the shared bar. The lab's own `<header
 * class="cl-hero">` is a direct child of `<main id="app">`, which scopes it out
 * of the banner role — but `index.html` ALSO runs a `dedupeBanner()` script that
 * demotes stray banners, and this asserts the outcome rather than either
 * mechanism, so a change to either one is caught.
 */
export async function assertSingleBanner(page: Page): Promise<void> {
  const banners = await page.evaluate(() => {
    const scoped = new Set(['MAIN', 'ARTICLE', 'ASIDE', 'NAV', 'SECTION']);
    const isBanner = (el: Element): boolean => {
      if (el.getAttribute('role') === 'banner') return true;
      if (el.tagName !== 'HEADER') return false;
      if (el.getAttribute('role')) return false; // explicit non-banner role wins
      for (let p = el.parentElement; p; p = p.parentElement) if (scoped.has(p.tagName)) return false;
      return true;
    };
    return [...document.querySelectorAll('header,[role="banner"]')].filter(isBanner).length;
  });
  expect(banners, 'exactly one banner landmark').toBe(1);
}

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert the content every scan relies on is really on the page — including the
 * lab's DEFAULTS, which are never assumed.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page: an emulation that silently did nothing would
 * leave the gate certifying a different rendering than the one it claims to,
 * and on this page it would specifically mean scanning invisible `.chip`s.
 *
 * The defaults are asserted because which half of this lab gets measured
 * depends on them. Exhibit 1 ships with the cheat DISARMED — so the honest path
 * (no complaints, nobody disqualified, `.note-ok`) is what a reader sees first,
 * and a gate that only ever armed the cheat would never scan it. Exhibit 3
 * ships on the NAIVE branch and, uniquely, runs itself on mount — so a full
 * candidate table is already on screen at first paint. Exhibit 2 ships locked,
 * with no transcript to work on. Each of those is a state, and each is scanned.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  // A click on a control that never becomes actionable otherwise burns the
  // whole test timeout and reports nothing useful. 20s turns that silent hang
  // into a named failure naming the locator.
  page.setDefaultTimeout(20_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  await assertSingleBanner(page);

  // All three exhibits are mounted by `src/main.ts` into empty divs, so a
  // navigation that resolves proves nothing.
  await expect(page.locator('#exhibit-ceremony .stage')).toBeVisible();
  await expect(page.locator('#exhibit-threshold .picker')).toHaveCount(1);
  await expect(page.locator('#exhibit-bias .cand-table')).toBeVisible();

  // ── Exhibit 1's shipped defaults ────────────────────────────────────────
  await expect(page.locator('#c-n')).toHaveValue('5');
  await expect(page.locator('#c-t')).toHaveValue('3');
  await expect(page.locator('#c-cheat')).not.toBeChecked();
  // The three cheat controls are hidden until the cheat is armed.
  for (const id of ['c-dealer', 'c-victim', 'c-reveal']) {
    await expect(page.locator(`#${id}`)).toBeHidden();
  }
  await expect(page.locator('#exhibit-ceremony .status-line')).toHaveText(
    'Ready. Five parties, threshold three, everyone honest.'
  );
  await expect(page.locator('.phase-nav li.phase-done')).toHaveCount(0);
  await expect(page.locator('.phase-nav li[aria-current="step"]')).toHaveCount(0);
  await expect(page.locator('#exhibit-ceremony .btn-primary')).toHaveText('Run round 1 — deal');
  await expect(page.locator('.share-matrix')).toHaveCount(0);

  // ── Exhibit 2 ships locked, with nothing to reconstruct ─────────────────
  await expect(page.locator('#exhibit-threshold .picker')).toBeHidden();
  await expect(page.locator('#exhibit-threshold .btn-primary')).toBeDisabled();

  // ── Exhibit 3 ships on the naive branch and has already run itself ──────
  await expect(page.locator('#bias-naive')).toBeChecked();
  await expect(page.locator('#bias-gjkr')).not.toBeChecked();
  await expect(page.locator('#bias-k')).toHaveValue('4');
  await expect(page.locator('#bias-nib')).toHaveValue('a');
  await expect(page.locator('#exhibit-bias .compare-out .banner')).toBeVisible();

  // Both shipped disclosures are shut; the third does not exist yet.
  await expect(page.locator('details')).toHaveCount(2);
  await expect(page.locator('details[open]')).toHaveCount(0);

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all, and this page has
 * already regressed here once — the README records 537px of root scroll width
 * at a 360px viewport in the completed state. `e2e/reflow.spec.ts` guards that
 * specific regression at 320/360/400px; this assertion runs in EVERY driven
 * state at 380px, including the ones that spec does not reach (the fail-closed
 * abort, the sub-threshold reconstruction, the empty-selection error, every
 * opened disclosure).
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. A
    // wide box inside an `overflow-x: auto` wrapper has a huge bounding rect
    // but is clipped by its scroller and contributes nothing to the document's
    // scroll width — naming it sends you off fixing the wrong element. That
    // cost a run elsewhere in this fleet, and this lab has three such decoys:
    // the share-delivery matrix, the adversary's round-1 view and the
    // candidate-key table each scroll sideways inside their own
    // `.scroll-region`, whose cells are deliberately `white-space: nowrap`.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      while (n && n !== doc) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    // Prefer an unclipped culprit; fall back to the widest clipped one rather
    // than reporting nothing, so the message always names something to look at.
    const widest = over.filter((x) => !clipped(x.el))[0] ?? over[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${clipped(widest.el) ? '[clipped] ' : ''}${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull();
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll.
 *
 * This lab already handles it — `dom.ts` has a `scrollRegion()` helper that
 * builds every one of them with `tabindex="0"`, `role="region"` and a label.
 * The assertion stays because the helper is a convention, not an enforcement:
 * the next scrolling box someone adds by hand is the one that breaks it, and
 * the failure is silent until a keyboard user meets it.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return (
          ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY)
        );
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  expect(
    Array.from(new Set(unreachable)),
    `scrolling regions with no keyboard route in state: ${label}`
  ).toEqual([]);
}

/**
 * When `A11Y_COLLECT` is set, `scan` records failures instead of throwing.
 *
 * A strict gate reports the first failing assertion in the first failing state
 * and stops, so a page with defects in several states needs one full run per
 * defect to enumerate them. The collection pass turns that into a single run.
 * It is a debugging aid only: `A11Y_COLLECT` is never set in CI or in the
 * committed workflow, and a run with it set prints every finding as it happens
 * and then fails at the end, so a green collection run cannot be mistaken for a
 * green gate.
 */
const COLLECTING = !!process.env.A11Y_COLLECT;
const collected: string[] = [];

function record(entry: string): void {
  collected.push(entry);
  // Printed as it happens, not only at the end: a hard assertion later in the
  // drive would otherwise abort the test before anything collected so far was
  // ever shown.
  console.log(`\n[A11Y_COLLECT #${collected.length}] ${entry}`);
}

function softExpect(actual: unknown, message: string, expected: unknown): void {
  if (!COLLECTING) {
    expect(actual, message).toEqual(expected);
    return;
  }
  try {
    expect(actual, message).toEqual(expected);
  } catch {
    record(`${message}\n  ${JSON.stringify(actual, null, 2)}`);
  }
}

/**
 * Fail the test if the collection pass recorded anything.
 *
 * Without this a collection run would end green, and a green collection run is
 * indistinguishable from a green gate — which is the exact confusion the whole
 * exercise exists to remove.
 */
export function reportCollected(): void {
  if (!COLLECTING) return;
  expect(collected, `A11Y_COLLECT recorded ${collected.length} failure(s)`).toEqual([]);
}

async function expectScrollersReachableSoft(page: Page, label: string): Promise<void> {
  if (!COLLECTING) return expectScrollersReachable(page, label);
  try {
    await expectScrollersReachable(page, label);
  } catch (e) {
    record(String(e).slice(0, 900));
  }
}

async function expectNoHorizontalOverflowSoft(page: Page, label: string): Promise<void> {
  if (!COLLECTING) return expectNoHorizontalOverflow(page, label);
  try {
    await expectNoHorizontalOverflow(page, label);
  } catch (e) {
    record(String(e).slice(0, 900));
  }
}

/**
 * Scan the page as it currently stands.
 *
 * Six assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - reduced-motion end state — see `expectNotBlank`.
 *  - `violations` — the usual WCAG A/AA rule failures, plus four landmark
 *    best-practice rules.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically — which matters more here than in most labs, since
 *    every surface this demo uses to state a verdict is an oklab `color-mix()`
 *    axe declines to resolve.
 *    Everything else in that bucket is a real result axe simply could not
 *    finish — including `aria-prohibited-attr`, which is where an `aria-label`
 *    on a role-less div hides, a defect that never reaches the violations array
 *    at all.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *    Note the one thing it cannot reach, `::before`/`::after` generated
 *    content; see the header of `contrast.ts` for the select chevron that was
 *    measured by hand instead.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 */
export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  const results = await new AxeBuilder({ page })
    .withTags(TAGS)
    // Kept from the gate this replaces. These four are axe "best-practice"
    // rules rather than WCAG-tagged ones, so `withTags` alone does not run
    // them — and this page has a shared sticky <header role="banner"> above a
    // lab hero that is itself a <header>, which is exactly the shape they
    // catch.
    .withRules([
      'landmark-no-duplicate-banner',
      'landmark-unique',
      'landmark-one-main',
      'landmark-complementary-is-top-level',
    ])
    .analyze();

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  softExpect(violations, `axe violations in state: ${label}`, []);

  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  softExpect(unexplainedIncomplete, `axe incomplete results in state: ${label}`, []);

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  softExpect(contrast, `measured contrast failures in state: ${label}`, []);

  await expectScrollersReachableSoft(page, label);
  await expectNoHorizontalOverflowSoft(page, label);
}



/** The ceremony's live status line, which every phase and every reset rewrites. */
const ceremonySays = (page: Page, re: RegExp): Promise<void> =>
  expect(page.locator('#exhibit-ceremony .status-line')).toHaveText(re);

/** Open one `<details>` the way a reader does, and assert it opened. */
async function openDisclosure(page: Page, summaryText: RegExp): Promise<void> {
  const summary = page.locator('details > summary').filter({ hasText: summaryText });
  await summary.click();
  await expect(summary.locator('..')).toHaveAttribute('open', '');
}

/**
 * Drive the lab through the states that render content, scanning each.
 *
 * Six things shape this drive:
 *
 *  - THE HONEST RUN IS SCANNED BEFORE THE CHEAT. The lab ships with the cheat
 *    disarmed, so "no complaints, nobody disqualified" (`.note-ok`,
 *    `.party-qual`, `.cell-ok`) is the first thing a reader sees — and it is a
 *    different set of tones from the cheating run entirely. The gate this
 *    replaces armed the cheat in its first action and never scanned the honest
 *    path at all.
 *
 *  - THE FIVE ROUNDS ARE STEPPED, NOT SKIPPED. `Run whole ceremony` jumps
 *    straight to phase 4, throwing away the four intermediate renderings: the
 *    share matrix before verification (where the corrupted cell shows only its
 *    ⚠ mark), the matrix after it (✓/✗ per cell), the complaints zone, and the
 *    qualified set before assembly. Each is reached with `Run round 1 — deal`
 *    and its successors, and each is scanned.
 *
 *  - EVERY BRANCH OF EVERY FORK. Cheat armed and disarmed; the challenged
 *    dealer doubling down (disqualified, contribution discarded) and backing
 *    down (`.note-ok`, stays qualified); a ceremony that completes and one that
 *    FAILS CLOSED at n = t = 3 with `.banner-bad` and no key; reconstruction at
 *    ≥ t and at < t and with nothing selected at all; and Exhibit 3's naive
 *    branch — in both the "biased" and the "no candidate hit" outcome — against
 *    the GJKR branch.
 *
 *  - EVERY RESET. `Reset`, and the implicit reset that every settings change
 *    performs, each return a completed ceremony to its empty state and re-lock
 *    Exhibit 2. An empty state has its own copy and its own layout.
 *
 *  - DISCLOSURES ARE OPENED BY THEIR SUMMARIES, one at a time. The third one —
 *    the group-secret X-ray — does not exist until a ceremony has assembled a
 *    key, so it can only be reached this way.
 *
 *  - NO FIXED TIMEOUTS. Every exhibit computes synchronously on the click and
 *    announces through `.status-line` or a `role="status"` region; the drive
 *    waits on those.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const scanAt = (s: string): Promise<void> => scan(page, `${theme} / ${s}`);
  const ceremony = page.locator('#exhibit-ceremony');
  const threshold = page.locator('#exhibit-threshold');
  const bias = page.locator('#exhibit-bias');
  const stepBtn = ceremony.locator('.btn-primary');
  const runAllBtn = ceremony.getByRole('button', { name: 'Run whole ceremony' });
  const resetBtn = ceremony.getByRole('button', { name: 'Reset' });

  await scanAt('first paint, ceremony idle and Exhibit 2 locked');

  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('Tab');
  await expect(page.locator('a.cl-skip-link')).toBeFocused();
  await scanAt('skip link focused');

  // ── Exhibit 1, honest, stepped round by round ────────────────────────────
  await stepBtn.click();
  await ceremonySays(page, /Round 1 complete: 5 dealers/);
  await expect(page.locator('.share-matrix')).toBeVisible();
  await expect(page.locator('.cell-ok')).toHaveCount(0);
  await scanAt('honest round 1 dealt, shares unverified');

  await stepBtn.click();
  await ceremonySays(page, /every share verified/);
  await expect(page.locator('.cell-ok').first()).toBeVisible();
  await expect(page.locator('.cell-bad')).toHaveCount(0);
  await scanAt('honest round 2, every cell verifies');

  await stepBtn.click();
  await ceremonySays(page, /No complaints/);
  await expect(page.locator('.note-ok').first()).toBeVisible();
  await scanAt('honest run, no complaints to resolve');

  await stepBtn.click();
  await ceremonySays(page, /Qualified set fixed/);
  await expect(page.locator('.party-qual')).toHaveCount(5);
  await expect(page.locator('.party-disq')).toHaveCount(0);
  await scanAt('honest run, all five dealers qualified');

  await stepBtn.click();
  await ceremonySays(page, /Key assembled: PK/);
  await expect(page.locator('.chip-pk')).toBeVisible();
  await expect(stepBtn).toBeDisabled();
  await expect(stepBtn).toHaveText('Ceremony complete');
  await scanAt('honest run, key assembled from five contributions');

  // The two disclosures that exist on arrival, plus the third that only exists
  // now that a key has been assembled.
  await openDisclosure(page, /X-ray: the group secret/);
  await scanAt('group-secret X-ray open');
  await openDisclosure(page, /The math on one screen/);
  await scanAt('ceremony math disclosure open');
  await openDisclosure(page, /Why .ends in a. stands in for a real attack goal/);
  await scanAt('bias rationale disclosure open');

  // ── Exhibit 2, now that a real transcript exists ─────────────────────────
  await expect(threshold.locator('.picker')).toBeVisible();
  await expect(threshold.locator('.btn-primary')).toBeEnabled();
  await scanAt('Exhibit 2 unlocked by the completed ceremony');

  await threshold.locator('.btn-primary').click();
  await expect(threshold.locator('.compare-out .note-ok')).toContainText('regenerates the group key exactly');
  await scanAt('reconstruction at t shares regenerates the key');

  await threshold.locator('.picker input[type="checkbox"]:checked').first().uncheck();
  await threshold.locator('.btn-primary').click();
  await expect(threshold.locator('.compare-out .note')).toContainText(/shares <\s*t/);
  await expect(threshold.locator('code.code-bad')).toBeVisible();
  await scanAt('reconstruction below t lands on the wrong secret');

  // Iterate the STABLE set of boxes, not the `:checked` subset — `all()`
  // snapshots `nth(i)` handles against a live selector, so unchecking the first
  // one shifts every later index out from under the loop.
  for (const box of await threshold.locator('.picker input[type="checkbox"]').all()) {
    if (await box.isChecked()) await box.uncheck();
  }
  await threshold.locator('.btn-primary').click();
  await expect(threshold.locator('.compare-out .note-bad')).toContainText('Select at least one share');
  await scanAt('reconstruction with nothing selected, refused');

  // ── Exhibit 1's reset, and the re-lock it forces on Exhibit 2 ────────────
  await resetBtn.click();
  await ceremonySays(page, 'Ceremony reset.');
  await expect(page.locator('.share-matrix')).toHaveCount(0);
  await expect(threshold.locator('.picker')).toBeHidden();
  await expect(threshold.locator('.btn-primary')).toBeDisabled();
  await scanAt('ceremony reset, Exhibit 2 re-locked');

  // ── Exhibit 1 with the cheat armed ───────────────────────────────────────
  await page.locator('#c-cheat').check();
  await ceremonySays(page, /Cheat armed/);
  for (const id of ['c-dealer', 'c-victim', 'c-reveal']) {
    await expect(page.locator(`#${id}`)).toBeVisible();
  }
  await scanAt('cheat armed, its three controls revealed');

  await stepBtn.click();
  await ceremonySays(page, /Round 1 complete/);
  await expect(page.locator('.cell-cheat .mark-warn')).toBeVisible();
  await scanAt('corrupted share dealt, flagged before anyone has checked it');

  await runAllBtn.click();
  await ceremonySays(page, /Key assembled: PK/);
  await expect(page.locator('.cell-bad')).toHaveCount(1);
  await expect(ceremony.getByText(/broadcasts a COMPLAINT/)).toBeVisible();
  await expect(page.locator('.party-disq')).toHaveCount(1);
  await expect(page.locator('.party-qual')).toHaveCount(4);
  await scanAt('cheater doubles down, is disqualified, key assembles without it');

  // The other half of the fork: the challenged dealer backs down.
  await page.locator('#c-reveal').selectOption({ index: 1 });
  await ceremonySays(page, /Settings changed/);
  await runAllBtn.click();
  await ceremonySays(page, /Key assembled: PK/);
  await expect(ceremony.getByText(/stays qualified/)).toBeVisible();
  await expect(page.locator('.party-disq')).toHaveCount(0);
  await scanAt('cheater backs down, reveals the correct share, stays qualified');

  // ── Fail closed: n = t = 3 with a doubling-down cheater ──────────────────
  await page.locator('#c-reveal').selectOption({ index: 0 });
  await page.locator('#c-n').selectOption('3');
  await page.locator('#c-t').selectOption('3');
  await ceremonySays(page, /Settings changed/);
  await scanAt('settings changed to n = t = 3, ceremony reset');

  await runAllBtn.click();
  await ceremonySays(page, /Too few qualified dealers/);
  await expect(ceremony.locator('.banner-bad')).toBeVisible();
  await expect(page.locator('.chip-pk')).toHaveCount(0);
  await expect(stepBtn).toHaveText('Aborted — reset to retry');
  await expect(threshold.locator('.btn-primary')).toBeDisabled();
  await scanAt('ceremony fails closed with no key');

  // ── Exhibit 3: the naive attack, both outcomes, then the GJKR fix ────────
  const biasRun = bias.getByRole('button', { name: 'Run round 1 + attack' });
  const seen = { bad: false, warn: false };
  for (let attempt = 0; attempt < 25 && !(seen.bad && seen.warn); attempt++) {
    await biasRun.click();
    await expect(bias.locator('.cand-table')).toBeVisible();
    const outcome = (await bias.locator('.compare-out .banner-bad').count()) > 0 ? 'bad' : 'warn';
    if (!seen[outcome]) {
      seen[outcome] = true;
      await scanAt(
        outcome === 'bad'
          ? 'naive bias attack steers the key to its target nibble'
          : 'naive bias attack finds no candidate on target this run'
      );
    }
  }
  expect(seen, 'both naive-attack outcomes must have been scanned').toEqual({ bad: true, warn: true });

  await bias.getByRole('button', { name: 'Run ×20 and count' }).click();
  await expect(bias.locator('.compare-out')).toContainText('fresh ceremonies');
  await scanAt('naive attack counted over 20 fresh ceremonies');

  await page.locator('#bias-gjkr').check();
  await expect(bias.getByText(/hiding commitments/i).first()).toBeVisible();
  await expect(bias.locator('.cand-table')).toHaveCount(0);
  await scanAt('GJKR hiding commitments, candidate table gone');

  await bias.getByRole('button', { name: 'Run ×20 and count' }).click();
  await expect(bias.locator('.compare-out .banner-ok')).toContainText('fresh ceremonies');
  await scanAt('GJKR counted over 20 fresh ceremonies');

  // k = 1 is the smallest adversary the exhibit models, and it is what makes
  // "every extra corrupted dealer doubles the candidate space" checkable.
  await page.locator('#bias-naive').check();
  await page.locator('#bias-k').selectOption('1');
  await biasRun.click();
  await expect(bias.locator('.cand-table tbody tr')).toHaveCount(2);
  await scanAt('naive attack with a single corrupted dealer');
}
