import { expect, test } from '@playwright/test';
import { activateExtension, openShell } from './shell';

/**
 * ============================================================================
 * HOTKEY DISPATCH, END TO END, THROUGH A REAL KEYBOARD.
 * ============================================================================
 * `src/core/hotkeyDispatch.ts` owns the shell's one `keydown` listener. The unit
 * suite drives it with synthesised events; this file presses the keys.
 *
 * The suppression case is the one that most needs a real browser. The dispatcher
 * refuses to fire while focus is in a text input, and "focus is in a text input"
 * is a fact about the document's real focus state — in jsdom it is whatever the
 * test asserted it to be, which makes the guard and the assertion the same
 * statement. Here the browser decides.
 *
 * Mail's `compose` action carries Ctrl+Shift+N and appends a draft, which the
 * host renders in pane 3 and counts in the Drafts badge. Neither observable is
 * arranged by this test.
 * ============================================================================
 */

const COMPOSE_CHORD = 'Control+Shift+N';

test.describe('hotkey dispatch in a real browser', () => {
  test.beforeEach(async ({ page }) => {
    await openShell(page);
    await activateExtension(page, 'Mail');
  });

  test('advertises the chord on the action that will fire it', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Compose' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Shift+N',
    );
  });

  test('fires the foreground extension chord and the host renders the result', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Drafts badge 2' })).toBeVisible();

    await page.keyboard.press(COMPOSE_CHORD);

    // Two independent observables, both rendered by the host rather than by the
    // plug-in: the detail pane shows the new draft, and the navigation badge the
    // extension wrote through IShellAPI went up by one.
    //
    // THE HEADING, BY ROLE, AND NOT A TEXT MATCH ON THE PANE. A text locator here
    // was a race the test never declared, and CI lost it: `MailPlugin` resolves a
    // message body `BODY_FETCH_LATENCY_MS` (120ms) after the heading renders, and
    // the generated body QUOTES THE SUBJECT — `You wrote about "Untitled draft 1"
    // at Now.` So before the fetch resolves the pane holds one match and the
    // assertion passes; after it resolves the pane holds two and Playwright's
    // strict mode fails the locator outright. The test was green only while it
    // won a 120ms footrace against a latency this repository chose deliberately,
    // and it lost that race on a loaded runner.
    //
    // Asserting the heading by role is unambiguous whether or not the body has
    // arrived, which is the right assertion anyway: this case is about the CHORD
    // firing and the host rendering the result, not about body-fetch timing.
    // That timing has its own coverage — see the rapid-switch cases that exist
    // precisely because 120ms is longer than a test needs to switch extensions.
    await expect(
      page
        .getByRole('region', { name: 'Detail' })
        .getByRole('heading', { name: 'Untitled draft 1', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Drafts badge 3' })).toBeVisible();
  });

  test('does NOT fire while focus is in a text input', async ({ page }) => {
    await page.keyboard.press(COMPOSE_CHORD);
    await expect(page.getByRole('button', { name: 'Drafts badge 3' })).toBeVisible();

    // A bare input appended to the document, so the guard is exercised against a
    // real focused text field rather than against a mocked event target. The
    // shell renders no text input of its own today, and inventing one inside the
    // fixture would make this test assert something about the fixture.
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'e2e-text-input';
      document.body.append(input);
      input.focus();
    });

    // The browser's own answer, not the test's assumption.
    await expect(page.locator('#e2e-text-input')).toBeFocused();

    await page.keyboard.press(COMPOSE_CHORD);

    // Nothing happened: no second draft, and the badge did not move again.
    await expect(page.getByRole('region', { name: 'Detail' }).getByText('Untitled draft 2')).toHaveCount(
      0,
    );
    await expect(page.getByRole('button', { name: 'Drafts badge 3' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Drafts badge 4' })).toHaveCount(0);

    // And the keystroke went to the input instead, which is where a user typing
    // in a text field expects their keys to land.
    await expect(page.locator('#e2e-text-input')).toBeFocused();
  });

  test('does not fire a background extension chord', async ({ page }) => {
    // Ctrl+Shift+L belongs to the Database extension. With Mail in the
    // foreground it must do nothing at all, because a chord is live only for the
    // foreground extension.
    await activateExtension(page, 'Mail');
    await page.keyboard.press('Control+Shift+L');

    await expect(page.getByText('low stock only')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Drafts badge 2' })).toBeVisible();
  });

  test('fires that same chord once its extension is in the foreground', async ({ page }) => {
    await activateExtension(page, 'Inventory Database');

    // A leaf category, so the list has a header to change.
    await page
      .getByRole('region', { name: 'Navigation' })
      .getByRole('button', { name: /^Valves/ })
      .click();

    await page.keyboard.press('Control+Shift+L');

    await expect(
      page.getByRole('region', { name: 'List' }).getByText(/low stock only/),
    ).toBeVisible();
  });
});
