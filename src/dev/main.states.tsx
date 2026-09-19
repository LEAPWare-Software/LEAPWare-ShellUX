import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StatesFixture } from './StatesFixture';
import '../index.css';

/**
 * The bootstrap for `states.html`, the browser lane's fixture for the wave-3
 * state primitives. Same shape as `main.dev.tsx`, `StrictMode` included.
 */

const container = document.getElementById('root');

if (container === null) {
  throw new Error('ShellUX states fixture: #root container is missing from states.html');
}

createRoot(container).render(
  <StrictMode>
    <StatesFixture />
  </StrictMode>,
);
