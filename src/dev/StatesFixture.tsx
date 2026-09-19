import { useState } from 'react';
import type { ReactElement } from 'react';
import { TOKEN_CLASS } from '../core/theme/tokenClasses';
import { Banner } from '../components/ui/Banner';
import { Button } from '../components/ui/Button';

/**
 * ============================================================================
 * THE WAVE-3 STATE PRIMITIVES, ON THEIR OWN. A DEV-ONLY FIXTURE.
 * ============================================================================
 * W3-1 builds the buttons, the loading button and the four banners, and owns no
 * surface that draws them: the plan's first consumers are W3-5's blocks, W3-6's
 * palette failure and W3-8's crash surface. A primitive nothing renders cannot
 * be measured in a browser, and jsdom cannot measure it at all, so this page
 * renders each one on the content plane for `e2e/theme.spec.ts` and
 * `e2e/focus-visibility.spec.ts`.
 *
 * Reached through `states.html`, which is not a build input, exactly as
 * `dev.html` is not; see `src/dev/DevShell.tsx` for why that is how dev-only is
 * enforced here. The words are the v4 *States* screen's.
 * ============================================================================
 */
export function StatesFixture(): ReactElement {
  const [reordering, setReordering] = useState(false);
  return (
    <main className={`flex min-h-full flex-col gap-4 p-4 ${TOKEN_CLASS.paneSurface}`}>
      <section aria-label="Buttons" className="flex flex-wrap items-center gap-4">
        <Button
          id="fixture-primary"
          variant="primary"
          loading={reordering}
          loadingLabel="Reordering"
          progress={0.55}
          onClick={() => setReordering(true)}
        >
          Reorder
        </Button>
        <Button id="fixture-quiet">Adjust stock</Button>
        <Button id="fixture-primary-disabled" variant="primary" disabled>
          Post goods receipt
        </Button>
        <Button id="fixture-quiet-disabled" disabled>
          Move stock in
        </Button>
      </section>
      <section aria-label="Banners" className="flex max-w-xl flex-col gap-2">
        <Banner
          status="error"
          title="Recent movements could not be loaded"
          actions={<Button>Try again</Button>}
        >
          The Inventory plugin did not answer within 10 seconds. The rest of this item is current.
        </Banner>
        <Banner status="warning" title="Below reorder point">
          On hand 96 is under the reorder point of 120.
        </Banner>
        <Banner status="success" title="Purchase order 5530 sent">
          Nordpack AB confirms by email.
        </Banner>
        <Banner status="info" title="Counts refresh every 5 minutes">
          Last refreshed at 10:05.
        </Banner>
      </section>
    </main>
  );
}
