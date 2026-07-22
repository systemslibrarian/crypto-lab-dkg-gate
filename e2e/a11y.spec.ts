import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/**
 * Put EVERY panel into its post-interaction state before scanning — axe only
 * checks what's in the DOM, and this demo's result regions (share matrix,
 * complaint zone, key-assembly chips, bias tables) only exist after the user
 * drives the flow. An unscanned state is an ungated state.
 */
async function driveDemos(page: Page): Promise<void> {
  // Exhibit 1 — arm the cheat so the complaint + disqualification path renders,
  // then run the whole ceremony to reach key assembly.
  await page.locator('#c-cheat').check().catch(() => {})
  await page.getByRole('button', { name: 'Run whole ceremony' }).click().catch(() => {})
  await page.waitForTimeout(200)

  // Exhibit 2 — the transcript is now live; reconstruct and compare.
  await page.getByRole('button', { name: 'Reconstruct & compare' }).click().catch(() => {})
  // Also exercise the "too few shares" branch: uncheck one box and re-run.
  const boxes = page.locator('.picker input[type="checkbox"]')
  if ((await boxes.count()) > 0) {
    await boxes.first().uncheck().catch(() => {})
    await page.getByRole('button', { name: 'Reconstruct & compare' }).click().catch(() => {})
  }

  // Exhibit 3 — run the naive attack (candidate table), the batch counter, then
  // flip to the GJKR fix so both result panels get scanned.
  await page.getByRole('button', { name: 'Run round 1 + attack' }).click().catch(() => {})
  await page.getByRole('button', { name: 'Run ×20 and count' }).click().catch(() => {})
  await page.locator('#bias-gjkr').check().catch(() => {})
  await page.waitForTimeout(200)

  // Open every collapsible so the math/X-ray content is in the DOM.
  await page.evaluate(() => {
    document.querySelectorAll('details').forEach((d) => ((d as HTMLDetailsElement).open = true))
  })
  await page.waitForTimeout(200)
}

async function scan(page: Page): Promise<void> {
  await page.addStyleTag({ content: `*,*::before,*::after{animation:none!important;transition:none!important}` })
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  expect(
    violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5) })),
  ).toEqual([])
}

test('no WCAG A/AA violations — dark theme', async ({ page }) => {
  await page.goto('.')
  await driveDemos(page)
  await scan(page)
})

test('no WCAG A/AA violations — light theme', async ({ page }) => {
  await page.goto('.')
  await page.locator('#cl-theme-toggle').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await driveDemos(page)
  await scan(page)
})
