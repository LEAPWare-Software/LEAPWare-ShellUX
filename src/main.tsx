import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installRendererDiagnostics } from './core/ipc/reportRendererDiagnostics';
import './index.css';

/**
 * The bootstrap for host chrome's document, `index.html`.
 *
 * **It names no surface, and that is the property worth protecting.**
 * `index.html` is two things — the production browser SPA, and host chrome's
 * `WebContentsView` inside the desktop window — and `src/App.tsx` decides which
 * one is running from the presence of the native host's preload bridge, once, at
 * module scope. There is no flag here to set wrongly and no branch here to
 * forget, which is what keeps every browser-lane test on the whole shell without
 * one of them saying so.
 */

// GitHub issue #86: no `window.onerror`, no `unhandledrejection`, anywhere in
// this application. Installed once, at module scope, before the tree renders,
// so a throw during the first render is caught by this even though
// `FaultBoundary`/`RootBoundary` cannot see an async rejection or an
// event-handler throw. A no-op outside the native host — see
// `src/core/ipc/reportRendererDiagnostics.ts`.
installRendererDiagnostics('renderer-chrome');

const container = document.getElementById('root');

if (container === null) {
  throw new Error('ShellUX: #root container is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
