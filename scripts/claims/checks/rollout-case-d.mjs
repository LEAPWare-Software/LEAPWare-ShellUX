#!/usr/bin/env node
// Rollout QA row C-90 (docs/proof-of-completion.md rollout step 2, case d): a
// throwaway, no-op check used only to exercise the "each expect key exactly
// once" rule. It never prints `alpha` and prints `beta` twice.
console.log('beta=1');
console.log('beta=1');
