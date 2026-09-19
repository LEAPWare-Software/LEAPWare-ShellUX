#!/usr/bin/env node
// Rollout QA row C-91 (docs/proof-of-completion.md rollout step 2, case d2): a
// throwaway, no-op check used only to exercise the expect-bound rule. It
// prints `gamma` exactly once, but with a value that exceeds the row's
// declared bound (expect gamma <= 5).
console.log('gamma=10');
