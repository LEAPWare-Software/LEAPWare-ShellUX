/**
 * `/shared/react-jsx-runtime.js` — the host's `react/jsx-runtime`.
 *
 * ADR-0006 decision 5, step 2. A plugin compiled with the automatic JSX runtime
 * imports `jsx`, `jsxs` and `Fragment` from `react/jsx-runtime`; its build
 * rewrites that specifier to this file's URL. The runtime calls into the React
 * it was bundled beside, so it has to be the host's for the same reason
 * `./react.ts` does. Written out rather than `export *` for the reason given
 * there. *Tests:* `src/sdk/__tests__/sharedModules.test.ts` —
 * "/shared/react-jsx-runtime.js exports exactly the names the installed runtime
 * exports".
 */
export { Fragment, jsx, jsxs } from 'react/jsx-runtime';
