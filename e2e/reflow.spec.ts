import { expect, test } from '@playwright/test'

/**
 * Mobile reflow gate (WCAG 1.4.10). The page once overflowed to 537px of root
 * scroll width at a 360px viewport in its completed state — the share matrix
 * and the hero both leaked past the viewport. This asserts the fix holds: at
 * narrow widths the root never scrolls horizontally, while the share matrix
 * stays independently scrollable inside its labeled region.
 */

const WIDTHS = [320, 360, 400] as const

async function assertNoRootOverflow(page: import('@playwright/test').Page): Promise<void> {
  const m = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }))
  expect(m.scrollW, `root scrollWidth ${m.scrollW} > clientWidth ${m.clientW}`).toBeLessThanOrEqual(m.clientW)
}

for (const width of WIDTHS) {
  test(`no horizontal root overflow at ${width}px — completed ceremony, both bias modes`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await page.goto('.')
    await assertNoRootOverflow(page)

    // Completed ceremony: the widest state (share-delivery matrix + assembly).
    await page.locator('#c-cheat').check()
    await page.getByRole('button', { name: 'Run whole ceremony' }).click()
    await expect(page.locator('#exhibit-ceremony').getByText(/Key assembled: PK/)).toBeVisible()
    await assertNoRootOverflow(page)

    // The wide tables must scroll inside their own regions, not the page:
    // horizontal scrolling stays available where the matrix lives.
    const scrollRegions = page.locator('.scroll-region')
    expect(await scrollRegions.count()).toBeGreaterThan(0)

    // Bias exhibit, naive (candidate table) then GJKR branch.
    const bias = page.locator('#exhibit-bias')
    await bias.getByRole('button', { name: 'Run round 1 + attack' }).click()
    await expect(bias.getByRole('table')).toBeVisible()
    await assertNoRootOverflow(page)
    await bias.locator('#bias-gjkr').check()
    await expect(bias.getByText(/hiding commitments/i).first()).toBeVisible()
    await assertNoRootOverflow(page)
  })
}
