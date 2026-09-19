import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import * as sharedJsxRuntime from '../shared/react-jsx-runtime';
import * as sharedReact from '../shared/react';

/**
 * The two shared modules that stand in for a package, checked against the
 * installed package itself.
 *
 * This is NOT the claim that a plugin gets the React the extension surface
 * renders with. That is a property of the emitted chunks, and jsdom never sees a
 * chunk; it is measured in a real browser by `e2e/shared-modules.spec.ts`. What
 * this file pins is the half a Node module graph can decide: each shared module
 * exports exactly what its package exports, and each export is the package's own
 * object rather than a copy.
 */
const requireInstalled = createRequire(import.meta.url);

function assertSameModule(shared: Readonly<Record<string, unknown>>, installed: Readonly<Record<string, unknown>>): void {
  expect(Object.keys(shared).filter((name) => name !== 'default').sort()).toEqual(Object.keys(installed).sort());
  for (const name of Object.keys(installed)) {
    expect(shared[name], name).toBe(installed[name]);
  }
}

describe('the shared modules, against the packages they stand for', () => {
  it('/shared/react.js exports exactly the names the installed react exports', () => {
    const installed = requireInstalled('react') as Readonly<Record<string, unknown>>;
    assertSameModule(sharedReact, installed);
    expect(sharedReact.default).toBe(installed);
  });

  it('/shared/react-jsx-runtime.js exports exactly the names the installed runtime exports', () => {
    const installed = requireInstalled('react/jsx-runtime') as Readonly<Record<string, unknown>>;
    assertSameModule(sharedJsxRuntime, installed);
  });
});
