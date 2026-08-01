import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DevShell } from './DevShell';
import '../index.css';

/**
 * The bootstrap for the browser lane's fixture document, `dev.html`.
 *
 * Deliberately the same shape as `src/main.tsx`, down to `StrictMode`: dropping
 * it here would make the fixture an easier target than the real application, and
 * the double-invoked effects that `DatabasePlugin`'s 200ms interval and both
 * plug-ins' mount-time `setSelectedItem` have to survive are exactly what a
 * browser test should be running against.
 *
 * See `src/dev/DevShell.tsx` for why this entry point exists and how it is kept
 * out of the production bundle.
 */

const container = document.getElementById('root');

if (container === null) {
  throw new Error('ShellUX dev fixture: #root container is missing from dev.html');
}

createRoot(container).render(
  <StrictMode>
    <DevShell />
  </StrictMode>,
);
