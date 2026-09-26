#!/usr/bin/env node
// Row C-53: `docs/RELEASE.md` §0 and §1 are rewritten to the new truth in the
// same commit that landed `provider: github` — §0 no longer calls the feed host
// "not provisioned", and §1's "decide where updates come from" and "decide
// visibility" items are recorded done, citing D-34/D-43.
import { readFileSync } from 'node:fs';

const release = readFileSync('docs/RELEASE.md', 'utf8');
const section0 = release.slice(release.indexOf('## 0.'), release.indexOf('## 1.'));
const section1 = release.slice(release.indexOf('## 1.'), release.indexOf('## 2.'));

const noLongerUnprovisioned = !/is \*\*not provisioned\*\*/.test(section0);
const section0CitesD34 = /D-34/.test(section0) && /D-43/.test(section0);
const section0NamesGuardrail = /guardrail/i.test(section0);

const decideFeedTicked = /- \[x\] \*\*Decide where updates come from/.test(section1);
const decideVisibilityTicked = /- \[x\] \*\*Decide the repository's visibility/.test(section1);
const section1CitesGithubRoute = /provider: github/.test(section1);

console.log(`section0_no_longer_unprovisioned=${noLongerUnprovisioned ? 1 : 0}`);
console.log(`section0_cites_d34_d43=${section0CitesD34 ? 1 : 0}`);
console.log(`section0_names_guardrail=${section0NamesGuardrail ? 1 : 0}`);
console.log(`section1_decide_feed_ticked=${decideFeedTicked ? 1 : 0}`);
console.log(`section1_decide_visibility_ticked=${decideVisibilityTicked ? 1 : 0}`);
console.log(`section1_cites_github_route=${section1CitesGithubRoute ? 1 : 0}`);
