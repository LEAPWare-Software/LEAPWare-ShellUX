import { expect, test } from '@playwright/test';

/**
 * ============================================================================
 * WHAT THE DEV SERVER SERVES AT `/`, WHICH IS NOT A DOM QUESTION.
 * ============================================================================
 * Every other assertion in this repository is about a document that has already
 * been loaded. This file is about WHICH document loads, and that is decided by a
 * middleware in `vite.config.ts` before any markup exists. Vitest cannot see it:
 * jsdom has no server, `vite.config.ts` is never executed by the unit suite, and
 * a rewrite that silently stopped working would leave all 1079 of those tests
 * green while `npm run dev` opened an empty shell again.
 *
 * That empty shell is GitHub issue #39's developer-facing half — "nobody has ever
 * run the app" — so the routing that fixes it is pinned here rather than trusted.
 *
 * **These cases deliberately do not use `openShell`.** That helper navigates to
 * `/dev.html` by name, which is the thing under test.
 * ============================================================================
 */

test.describe('the dev server at /', () => {
  test('serves the fixture shell at the bare root, with both remotes registered', async ({
    page,
  }) => {
    await page.goto('/');

    // The three panes prove a shell rendered at all; the two navigation entries
    // prove it is the FIXTURE shell. `src/App.tsx` registers nothing, so an
    // un-rewritten `/` produces the first three and none of the last two — which
    // is exactly the failure this case exists to catch.
    const navigation = page.getByRole('region', { name: 'Navigation' });
    await expect(navigation).toBeVisible();
    await expect(page.getByRole('region', { name: 'List' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Detail' })).toBeVisible();

    await expect(navigation.getByRole('button', { name: 'Mail' })).toBeVisible();
    await expect(navigation.getByRole('button', { name: 'Database' })).toBeVisible();
  });

  test('keeps the URL at / rather than redirecting the browser to /dev.html', async ({ page }) => {
    // A server-side rewrite and a 302 are indistinguishable from the rendered
    // DOM and are not the same thing: a redirect would change what a user copies
    // out of the address bar and what a bookmark resolves to. The rewrite happens
    // inside the middleware, so the browser is never told to go anywhere.
    //
    // The fixture assertion below is here for NON-VACUITY, not for coverage. An
    // earlier draft asserted only the pathname, and that version passed with the
    // middleware deleted — the production shell also answers at `/` and also has
    // a Navigation region, so "the URL is still /" was true for the wrong reason.
    // Asserting the fixture arrived AND the URL did not move is what makes this a
    // statement about a rewrite rather than about a page that happened to load.
    await page.goto('/');
    await expect(
      page.getByRole('region', { name: 'Navigation' }).getByRole('button', { name: 'Mail' }),
    ).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
  });

  test('leaves /index.html on the production shell, whose registry is empty', async ({ page }) => {
    // The rewrite is scoped to exactly one path. This is the control case: it
    // fails if somebody later widens the middleware to catch every HTML request,
    // which would make the empty-registry shell unreachable and would quietly
    // put the mocks in front of every reader.
    await page.goto('/index.html');

    const navigation = page.getByRole('region', { name: 'Navigation' });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole('button', { name: 'Mail' })).toHaveCount(0);
    await expect(navigation.getByRole('button', { name: 'Database' })).toHaveCount(0);
  });

  test('still serves the fixture at /dev.html, which the rest of this lane navigates to', async ({
    page,
  }) => {
    // `e2e/shell.ts`'s `FIXTURE_PATH` is still `/dev.html`, and every other spec
    // in this directory goes through it. Adding a second route to the fixture
    // must not remove the first.
    await page.goto('/dev.html');
    await expect(
      page.getByRole('region', { name: 'Navigation' }).getByRole('button', { name: 'Mail' }),
    ).toBeVisible();
  });
});
