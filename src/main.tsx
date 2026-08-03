import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
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

const container = document.getElementById('root');

if (container === null) {
  throw new Error('ShellUX: #root container is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
