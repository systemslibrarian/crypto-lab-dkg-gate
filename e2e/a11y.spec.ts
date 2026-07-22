import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/**
 * The gate's contract: every state the README says is exercised must actually
 * be in the DOM when axe runs, and a broken button or renderer must make a test
 * FAIL rather than silently scan an earlier state. So required actions use plain
 * clicks (no `.catch`), each branch asserts its expected result appeared before
 * scanning, and uncaught page errors fail the test.
 */

function guardPageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`)
  })
  return errors
}

/** Reveal collapsed content and freeze motion, then scan for WCAG A/AA + a
 *  targeted set of landmark best-practice rules axe's WCAG tags don't include. */
async function scan(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll('details').forEach((d) => ((d as HTMLDetailsElement).open = true))
  })
  await page.addStyleTag({ content: `*,*::before,*::after{animation:none!important;transition:none!important}` })
  const { violations } = await new AxeBuilder({ page })
    .withTags(TAGS)
    .withRules(['landmark-no-duplicate-banner', 'landmark-unique', 'landmark-one-main', 'landmark-complementary-is-top-level'])
    .analyze()
  expect(
    violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5) })),
  ).toEqual([])
}

/** Exactly one banner landmark (the shared bar); the hero must not be a second. */
async function assertSingleBanner(page: Page): Promise<void> {
  const banners = await page.evaluate(() => {
    const scoped = new Set(['MAIN', 'ARTICLE', 'ASIDE', 'NAV', 'SECTION'])
    const isBanner = (el: Element): boolean => {
      if (el.getAttribute('role') === 'banner') return true
      if (el.tagName !== 'HEADER') return false
      if (el.getAttribute('role')) return false // explicit non-banner role wins
      for (let p = el.parentElement; p; p = p.parentElement) if (scoped.has(p.tagName)) return false
      return true
    }
    return [...document.querySelectorAll('header,[role="banner"]')].filter(isBanner).length
  })
  expect(banners).toBe(1)
}

/**
 * Drive Exhibit 1 with an armed cheat all the way to key assembly, asserting the
 * complaint, disqualification, and assembled key each rendered.
 */
async function runCeremony(page: Page): Promise<void> {
  await page.locator('#c-cheat').check()
  await page.getByRole('button', { name: 'Run whole ceremony' }).click()
  const stage = page.locator('#exhibit-ceremony')
  await expect(stage.getByText(/broadcasts a COMPLAINT/)).toBeVisible()
  await expect(stage.getByText(/disqualified/).first()).toBeVisible()
  await expect(stage.getByText(/Key assembled: PK/)).toBeVisible()
}

/** Reconstruct in Exhibit 2 and assert both the ≥t success and <t branches render. */
async function runThreshold(page: Page): Promise<void> {
  const ex = page.locator('#exhibit-threshold')
  await ex.getByRole('button', { name: 'Reconstruct & compare' }).click()
  await expect(ex.getByText(/regenerates the group key exactly/)).toBeVisible()
  await ex.locator('.picker input[type="checkbox"]').first().uncheck()
  await ex.getByRole('button', { name: 'Reconstruct & compare' }).click()
  await expect(ex.getByText(/shares <\s*t/)).toBeVisible()
}

/** Run the naive bias attack (candidate table) then flip to the GJKR fix. */
async function runBiasNaive(page: Page): Promise<void> {
  const ex = page.locator('#exhibit-bias')
  await ex.getByRole('button', { name: 'Run round 1 + attack' }).click()
  await expect(ex.getByRole('table')).toBeVisible()
  await ex.getByRole('button', { name: 'Run ×20 and count' }).click()
  await expect(ex.getByText(/fresh ceremonies/)).toBeVisible()
}

async function switchBiasToGjkr(page: Page): Promise<void> {
  const ex = page.locator('#exhibit-bias')
  await ex.locator('#bias-gjkr').check()
  await expect(ex.getByText(/hiding commitments/i).first()).toBeVisible()
}

for (const theme of ['dark', 'light'] as const) {
  test(`WCAG A/AA — ${theme} — full drive incl. both bias modes`, async ({ page }) => {
    const errors = guardPageErrors(page)
    await page.goto('.')
    if (theme === 'light') {
      await page.locator('#cl-theme-toggle').click()
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    }
    await assertSingleBanner(page)
    await runCeremony(page)
    await runThreshold(page)
    await runBiasNaive(page)
    // Scan with the naive candidate table present…
    await scan(page)
    // …then with the GJKR branch (which replaces it) present.
    await switchBiasToGjkr(page)
    await scan(page)
    expect(errors, errors.join('\n')).toEqual([])
  })
}
