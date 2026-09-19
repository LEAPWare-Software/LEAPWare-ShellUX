/**
 * ============================================================================
 * `/shared/react.js` — THE HOST'S REACT, AS A MODULE A PLUGIN CAN IMPORT.
 * ============================================================================
 * ADR-0006 decision 5 ("Shared modules by build-time rewrite, not an import
 * map"), implementation step 2. A plugin build marks `react` external and
 * rewrites the specifier to `/shared/react.js`; this file is what that URL
 * serves. `vite.config.ts` lists it as a build input named `shared/react` and
 * gives it an unhashed file name, so the URL is stable across builds.
 *
 * **It re-exports; it holds nothing.** Because this module and
 * `paneview.html`'s entry import the same `react` module in one build, the
 * bundler emits one copy of React and both reach it. That is the whole point: a
 * second copy of React breaks every hook a plugin calls. Whether the build
 * actually does that is not something jsdom can see — it is a property of the
 * emitted chunks, measured in a real browser. *Tests:* `e2e/shared-modules.spec.ts`
 * — "a module importing /shared/react.js receives the React instance the
 * extension surface renders with".
 *
 * **Every name `react` exports, and only those.** The list is written out rather
 * than `export *`, because `react` is CommonJS and a star re-export of it has
 * no static list of names to give an ES-module importer. The list is checked
 * against the installed package, so a React upgrade that adds or drops an export
 * fails a test rather than a plugin. *Tests:* `src/sdk/__tests__/sharedModules.test.ts`
 * — "/shared/react.js exports exactly the names the installed react exports".
 *
 * **Two names `@types/react` does not declare** — the internals object and
 * `unstable_act` — are read off the module namespace and re-exported as
 * constants, rather than by widening the `react` module's declared types for the
 * whole program. React 18's CommonJS build assigns each once, when the module
 * runs, and never reassigns it, so a constant holds the same object the live
 * binding would. The internals object is
 * how any second React renderer a plugin brings finds the host's dispatcher, so
 * leaving it out would make this file something other than `react`.
 * ============================================================================
 */
import * as ReactModule from 'react';

const undeclared: Readonly<Record<string, unknown>> = ReactModule;

export const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: unknown =
  undeclared['__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED'];
export const unstable_act: unknown = undeclared['unstable_act'];

export {
  default,
  Children,
  Component,
  Fragment,
  Profiler,
  PureComponent,
  StrictMode,
  Suspense,
  act,
  cloneElement,
  createContext,
  createElement,
  createFactory,
  createRef,
  forwardRef,
  isValidElement,
  lazy,
  memo,
  startTransition,
  useCallback,
  useContext,
  useDebugValue,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  version,
} from 'react';
