/**
 * Each `/shared/<name>.js` URL of ADR-0006 decision 5, and the source module
 * that answers it.
 *
 * One table for both servers: `vite.config.ts` names the build inputs from it,
 * and its dev-server route serves from it, so the two cannot list different
 * modules. It lives here rather than in `vite.config.ts` so the lookup is under
 * the coverage gate.
 *
 * **A `Map`, and the reason is the lookup's input.** The name comes from a
 * request URL. An object-literal index would answer `constructor`,
 * `hasOwnProperty` or `__proto__` with whatever `Object.prototype` holds, and the
 * route would rewrite the request to that value's string form. *Tests:*
 * `src/sdk/__tests__/sharedModules.test.ts` — "answers only the three shared
 * names, and no name Object.prototype carries".
 */
export const SHARED_MODULES: ReadonlyMap<string, string> = new Map([
  ['react', 'src/sdk/shared/react.ts'],
  ['react-jsx-runtime', 'src/sdk/shared/react-jsx-runtime.ts'],
  ['sdk', 'src/sdk/index.ts'],
]);

/** The source path, relative to the repository root, that serves `/shared/<name>.js`; `undefined` for any other name. */
export function sharedModuleSource(name: string): string | undefined {
  return SHARED_MODULES.get(name);
}
