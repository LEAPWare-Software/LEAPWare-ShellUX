/**
 * ============================================================================
 * THE SDK: THE ONE HOST MODULE A PLUGIN MAY IMPORT. SERVED AS `/shared/sdk.js`.
 * ============================================================================
 * ADR-0006 decision 3, implementation step 2. A plugin built on its own imports
 * the host only through `@shellux/sdk`, and its build rewrites that specifier to
 * `/shared/sdk.js`, which is this file. `vite.config.ts` lists it as the build
 * input `shared/sdk`, beside `/shared/react.js` and
 * `/shared/react-jsx-runtime.js` (`./shared/`).
 *
 * **What is in it, and why exactly that.** The five runtime values the two mocks
 * import from outside themselves — `useChannelPayload`, `TOKEN_CLASS`,
 * `RowMetric`, `LEDGER_CONTEXT_KEY`, and React, which is its own shared module —
 * measured by grepping their `import` lines (ADR-0006 "What a separately built
 * plugin needs"). Plus the version, and the types the three first-party plugins
 * name. Types erase, so they cost the served module nothing; they are here so a
 * plugin's source names one module for the whole contract.
 *
 * **Same build, same instances.** This module and `paneview.html`'s entry are
 * two inputs of one build, so `useChannelPayload` here is the function the host
 * renders with, not a copy — the property a separately built plugin would lose
 * if it bundled these itself. What the browser lane measures of that is the
 * React instance. *Tests:* `e2e/shared-modules.spec.ts` — "a module importing
 * /shared/react.js receives the React instance the extension surface renders
 * with".
 *
 * **Changing what this file exports changes the contract.** The committed
 * baseline `./api-surface.json` records it, and a test fails when it moves and
 * `HOST_API_VERSION` does not move by at least what the change requires. That
 * check is a **guardrail**: it makes the honest omission loud, and a baseline
 * edited by hand to match is deliberate action it does not stop. *Tests:*
 * `src/sdk/__tests__/apiSurface.test.ts` — "fails when the contract changes and
 * the version does not move".
 * ============================================================================
 */

/**
 * The host contract's version, `major.minor`. It **is** `hostApiVersion`
 * (ADR-0006 decision 3): a plugin's manifest states the one it was built
 * against, and the host compares the two before it serves a byte of the plugin.
 *
 * Major moves when a plugin must change to keep working; minor moves on anything
 * additive. The rule the baseline enforces is in `./apiSurface.ts`.
 */
export const HOST_API_VERSION = '1.0';

export { useChannelPayload } from '../core/payload/PayloadChannel';
export { TOKEN_CLASS } from '../core/theme/tokenClasses';
export { LEDGER_CONTEXT_KEY } from '../core/ledger/ledgerIndex';
export { RowMetric } from '../components/ui/RowMetric';

export type { RowMetricProps } from '../components/ui/RowMetric';
export type {
  Command,
  ExtensionViewProps,
  IShellAPI,
  LEAPExtensionBlueprintInput,
  NavigationMetric,
  NavigationNode,
  RibbonAction,
  RibbonContext,
  StructuredPayload,
} from '../core/types';
