#!/usr/bin/env node
// Rollout QA row C-93 (docs/proof-of-completion.md rollout step 2, case i): a
// throwaway repo row that reads the tree only (no network), to confirm a
// normal row still passes in the same run as the network-blocked row C-92.
import { readFileSync } from 'node:fs';

const value = readFileSync('scripts/claims/checks/rollout-case-i-fixture.txt', 'utf8').trim();
console.log(`fixture_value=${value}`);
