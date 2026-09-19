import { afterEach, describe, expect, it, vi } from 'vitest';
import { installRendererDiagnostics } from '../reportRendererDiagnostics';

/**
 * ============================================================================
 * WHY THESE EVENTS ARE HAND-BUILT RATHER THAN DISPATCHED THROUGH JSDOM.
 * ============================================================================
 * CLAUDE.md's "jsdom is blind" section documents `PointerEvent` as one thing
 * jsdom does not implement; `PromiseRejectionEvent` is another, and it is the
 * exact event `window.addEventListener('unhandledrejection', ...)` receives in
 * a real browser. `new PromiseRejectionEvent(...)` throws in this suite's
 * environment (jsdom has no such constructor), so a test that tried to
 * construct and dispatch a real one would not be testing this module — it
 * would be testing whether jsdom grew the constructor.
 *
 * The listeners this module installs are captured directly off
 * `window.addEventListener` instead, and called with plain objects that carry
 * exactly the properties `onWindowError`/`onUnhandledRejection` read
 * (`ErrorEvent`'s `error`/`message`/`filename`/`lineno`/`colno`,
 * `PromiseRejectionEvent`'s `reason`). That is real behaviour of real code,
 * observed through a seam that does not require a browser API jsdom lacks —
 * the same trade CLAUDE.md documents for `PointerEvent` fixtures elsewhere in
 * this repository, applied to the event this module actually needs.
 * ============================================================================
 */

interface CapturedListeners {
  error: (event: unknown) => void;
  unhandledrejection: (event: unknown) => void;
}

function captureListeners(): CapturedListeners {
  const captured: Partial<CapturedListeners> = {};
  vi.spyOn(window, 'addEventListener').mockImplementation((type: string, listener: unknown) => {
    if (type === 'error') captured.error = listener as (event: unknown) => void;
    if (type === 'unhandledrejection') captured.unhandledrejection = listener as (event: unknown) => void;
  });
  return captured as CapturedListeners;
}

function stubBridge(): { report: ReturnType<typeof vi.fn> } {
  const report = vi.fn();
  Object.defineProperty(window, 'shelluxHost', {
    configurable: true,
    value: { diagnostics: { report } },
  });
  return { report };
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'shelluxHost');
});

describe('installRendererDiagnostics', () => {
  it('attaches an error listener and an unhandledrejection listener', () => {
    const addEventListener = vi.spyOn(window, 'addEventListener');
    installRendererDiagnostics('renderer-chrome');
    expect(addEventListener).toHaveBeenCalledWith('error', expect.any(Function));
    expect(addEventListener).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));
  });

  it('forwards a window.onerror event carrying an Error, with source and kind', () => {
    const listeners = captureListeners();
    const { report } = stubBridge();
    installRendererDiagnostics('renderer-chrome');

    const error = new Error('render threw');
    listeners.error({ error, message: 'ignored when error is present', filename: 'App.tsx', lineno: 10, colno: 4 });

    expect(report).toHaveBeenCalledWith({
      source: 'renderer-chrome',
      kind: 'window.onerror',
      message: 'render threw',
      stack: error.stack,
      filename: 'App.tsx',
      lineno: 10,
      colno: 4,
    });
  });

  it('falls back to null stack when an Error has no stack property', () => {
    const listeners = captureListeners();
    const { report } = stubBridge();
    installRendererDiagnostics('renderer-chrome');

    const error = new Error('stackless');
    Object.defineProperty(error, 'stack', { value: undefined });
    listeners.error({ error, message: 'ignored', filename: '', lineno: 0, colno: 0 });

    expect(report).toHaveBeenCalledWith(expect.objectContaining({ stack: null }));
  });

  it('falls back to event.message and null location fields when error is not an Error', () => {
    const listeners = captureListeners();
    const { report } = stubBridge();
    installRendererDiagnostics('renderer-extension');

    listeners.error({ error: null, message: 'a string error', filename: '', lineno: 0, colno: 0 });

    expect(report).toHaveBeenCalledWith({
      source: 'renderer-extension',
      kind: 'window.onerror',
      message: 'a string error',
      stack: null,
      filename: null,
      lineno: null,
      colno: null,
    });
  });

  it('forwards an unhandledrejection event carrying an Error', () => {
    const listeners = captureListeners();
    const { report } = stubBridge();
    installRendererDiagnostics('renderer-chrome');

    const reason = new Error('rejected');
    listeners.unhandledrejection({ reason });

    expect(report).toHaveBeenCalledWith({
      source: 'renderer-chrome',
      kind: 'unhandledrejection',
      message: 'rejected',
      stack: reason.stack,
    });
  });

  it('falls back to null stack when a rejected Error has no stack property', () => {
    const listeners = captureListeners();
    const { report } = stubBridge();
    installRendererDiagnostics('renderer-chrome');

    const reason = new Error('stackless rejection');
    Object.defineProperty(reason, 'stack', { value: undefined });
    listeners.unhandledrejection({ reason });

    expect(report).toHaveBeenCalledWith(expect.objectContaining({ stack: null }));
  });

  it('stringifies a non-Error rejection reason', () => {
    const listeners = captureListeners();
    const { report } = stubBridge();
    installRendererDiagnostics('renderer-chrome');

    listeners.unhandledrejection({ reason: 'plain string reason' });

    expect(report).toHaveBeenCalledWith({
      source: 'renderer-chrome',
      kind: 'unhandledrejection',
      message: 'plain string reason',
      stack: null,
    });
  });

  it('does nothing, and does not throw, when window.shelluxHost is absent', () => {
    const listeners = captureListeners();
    installRendererDiagnostics('renderer-chrome');

    expect(() => {
      listeners.error({ error: new Error('no host'), message: 'no host', filename: '', lineno: 0, colno: 0 });
      listeners.unhandledrejection({ reason: new Error('no host') });
    }).not.toThrow();
  });

  it('swallows a throw from diagnostics.report', () => {
    const listeners = captureListeners();
    Object.defineProperty(window, 'shelluxHost', {
      configurable: true,
      value: {
        diagnostics: {
          report: () => {
            throw new Error('bridge is gone');
          },
        },
      },
    });
    installRendererDiagnostics('renderer-chrome');

    expect(() => {
      listeners.error({ error: new Error('x'), message: 'x', filename: '', lineno: 0, colno: 0 });
    }).not.toThrow();
  });

  it('removes both listeners when the returned cleanup is called', () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const addEventListener = vi.spyOn(window, 'addEventListener');
    const uninstall = installRendererDiagnostics('renderer-chrome');
    const errorListener = addEventListener.mock.calls.find((call) => call[0] === 'error')?.[1];
    const rejectionListener = addEventListener.mock.calls.find((call) => call[0] === 'unhandledrejection')?.[1];

    uninstall();

    expect(removeEventListener).toHaveBeenCalledWith('error', errorListener);
    expect(removeEventListener).toHaveBeenCalledWith('unhandledrejection', rejectionListener);
  });
});
