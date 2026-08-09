import { expect, test } from '@playwright/test';
import { boot, driveAllStates, NARROW, reportCollected, watchPageErrors } from './gate';

/**
 * WCAG A/AA regression gate.
 *
 * The lab is driven along everything it teaches: the skip link focused; the
 * honest ceremony stepped one round at a time from dealing to key assembly, so
 * the unverified matrix, the verified matrix, the no-complaints resolution and
 * the qualified set are each measured; all three disclosures opened through
 * their summaries, including the group-secret X-ray that only exists once a key
 * is assembled; Exhibit 2 unlocked by that transcript and reconstructed at t
 * shares, below t, and with nothing selected; the ceremony reset and Exhibit 2
 * re-locked; the cheat armed, its corrupted cell scanned before anyone has
 * checked it, then the cheater doubling down into disqualification and backing
 * down into staying qualified; the fail-closed abort at n = t = 3; and Exhibit
 * 3's naive attack in both its "biased" and "no candidate hit" outcomes, its
 * 20-run count, the GJKR branch and its count, and a single-corrupted-dealer
 * run. Every one of those states is scanned, in both themes, at desktop and
 * phone width.
 *
 * See `gate.ts` for why nothing is injected into the page (on this page the old
 * injection actively blanked the key-assembly chips), why no disclosure is
 * force-opened, why the lab's defaults are asserted rather than assumed, and
 * why `violations` is not the whole oracle.
 */

for (const theme of ['dark', 'light'] as const) {
  test(`no WCAG A/AA violations in ${theme} theme`, async ({ page }) => {
    test.setTimeout(900_000);
    const errors = watchPageErrors(page);
    await boot(page, theme);
    await driveAllStates(page, theme);
    expect(errors, errors.join('\n')).toEqual([]);
    reportCollected();
  });

  test(`no WCAG A/AA violations in ${theme} theme at 380px`, async ({ page }) => {
    test.setTimeout(900_000);
    const errors = watchPageErrors(page);
    await page.setViewportSize(NARROW);
    await boot(page, theme);
    await driveAllStates(page, `${theme} @380px`);
    expect(errors, errors.join('\n')).toEqual([]);
    reportCollected();
  });
}
