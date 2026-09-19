/**
 * Tests for scripts/claims/plan.mjs: finding task items, their text, and heading counts.
 *
 * The GFM cases are checked against GitHub's own renderer: each fixture carries the
 * HTML that GitHub's REST `POST /markdown` (mode gfm) returned for it, captured once on
 * 2026-09-18 and committed, and its count of rendered checkboxes. A must-pass case has
 * to parse without ambiguity and find exactly as many task items as GitHub rendered; a
 * must-fail case has to be reported as ambiguous.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { headingErrors, normaliseItemText, parsePlan } from '../claims/plan.mjs';

const renderings = JSON.parse(readFileSync(new URL('./fixtures/claims/gfm-renderings.json', import.meta.url), 'utf8'));
const NBSP = String.fromCharCode(0xa0);

describe('task items against GitHub renderings (§3.2)', () => {
  for (const c of renderings.cases) {
    it(`${c.expect}: ${c.name}`, () => {
      const { items, errors } = parsePlan(c.markdown);
      if (c.expect === 'must-pass') {
        assert.deepEqual(errors, [], JSON.stringify(errors));
        assert.equal(items.length, c.githubTaskItems, `GitHub rendered ${c.githubTaskItems} checkbox(es)`);
      } else {
        assert.ok(errors.some((e) => /ambiguous task item/.test(e.message)), `expected ambiguity, got ${JSON.stringify(errors)}`);
      }
    });
  }

  it('carries the NBSP case the design names, with a real U+00A0', () => {
    const nbsp = renderings.cases.find((c) => c.name === 'nbsp');
    assert.ok(nbsp.markdown.includes(NBSP));
    assert.equal(nbsp.githubTaskItems, 0);
  });

  it('reports a [x] item as ambiguous when the file defines a link reference labelled x', () => {
    const { errors } = parsePlan('[x]: /url\n\n- [x] item\n');
    assert.ok(errors.some((e) => /labelled x/.test(e.message)));
    const fixture = renderings.cases.find((c) => c.name === 'link-definition-x');
    assert.equal(fixture.githubTaskItems, 0, 'GitHub renders the box as a link');
  });

  it('reports an NBSP after the marker as ambiguous', () => {
    const { errors } = parsePlan(`-${NBSP}[x] looks like an item\n`);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /ambiguous/);
  });

  it('reports an ordered item that cannot interrupt a paragraph as ambiguous', () => {
    const { items, errors } = parsePlan('Some text\n3. [x] reads as an item\n');
    assert.equal(items.length, 0);
    assert.equal(errors[0].line, 2);
  });

  it('finds nested and blockquoted items, ticked and not', () => {
    const { items, errors } = parsePlan('- [x] a\n  - [ ] b\n> * [X] c\n2) [ ] d\n');
    assert.deepEqual(errors, []);
    assert.deepEqual(items.map((i) => [i.line, i.checked]), [[1, true], [2, false], [3, true], [4, false]]);
  });
});

describe('item text (§3.2)', () => {
  const text = (md) => parsePlan(md).items[0];

  it('slices from after the box to the end of the first paragraph, for plain, bold and code starts', () => {
    assert.equal(text('- [x] plain text here\n').text, 'plain text here');
    assert.equal(text('- [x] **Bold** then text.\n').text, '**Bold** then text.');
    assert.equal(text('- [x] `code` then text\n').text, '`code` then text');
  });

  it('removes the tag, collapses whitespace and keeps markdown syntax', () => {
    const item = text('- [x]   Two   spaces [C-12] and **more**.\n');
    assert.equal(item.text, 'Two spaces and **more**.');
    assert.deepEqual(item.tags, ['C-12']);
  });

  it('joins a wrapped first paragraph and stops before a nested list or second paragraph', () => {
    const item = text('- [x] line one\n  line two [C-3]\n  - nested bullet\n\n  second paragraph\n');
    assert.equal(item.text, 'line one line two');
    assert.equal(item.rawText.includes('nested'), false);
  });

  it('collects every tag, so a doubly tagged item can be refused', () => {
    assert.deepEqual(text('- [x] a [C-1] b [C-2]\n').tags, ['C-1', 'C-2']);
  });

  it('refuses a bare box as ambiguous: GitHub renders it as text, not a checkbox', () => {
    const { items, errors } = parsePlan('- [x]\n');
    assert.equal(items.length, 0);
    assert.match(errors[0].message, /ambiguous/);
  });

  it('normalises text the same way everywhere', () => {
    assert.equal(normaliseItemText('  a [C-9]\n\tb  '), 'a b');
  });
});

describe('heading counts (§3.2)', () => {
  it('counts items from a heading to the next heading of the same or higher level, sub-sections included', () => {
    const md = [
      '## Step 1  (2/3)',
      '- [x] a',
      '### Sub (1/2)',
      '- [x] b',
      '- [ ] c',
      '## Step 2 (0/1)',
      '- [ ] d',
      '# Top',
      '- [x] e',
    ].join('\n');
    const { headings } = parsePlan(md);
    assert.deepEqual(
      headings.map((h) => [h.line, h.actual.checked, h.actual.total]),
      [
        [1, 2, 3],
        [3, 1, 2],
        [6, 0, 1],
      ],
    );
    assert.deepEqual(headingErrors(headings), []);
  });

  it('reports a heading count off by one', () => {
    const { headings } = parsePlan('## Step (0/2)\n- [x] a\n- [ ] b\n');
    const errors = headingErrors(headings);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /says \(0\/2\) but its items count \(1\/2\)/);
  });

  it('reads the last (x/y) on a heading line and ignores headings with none', () => {
    const { headings } = parsePlan('## Step 3 (1/9) — later (1/1)\n- [x] a\n## Plain\n- [ ] b\n');
    assert.equal(headings.length, 1);
    assert.deepEqual(headings[0].stated, { checked: 1, total: 1 });
  });
});

describe('the plan as committed', () => {
  it('parses docs/plans/v1-production.md with no ambiguity and every heading count right', () => {
    const source = readFileSync(new URL('../../docs/plans/v1-production.md', import.meta.url), 'utf8');
    const { errors, headings } = parsePlan(source);
    assert.deepEqual(errors, []);
    assert.deepEqual(headingErrors(headings), []);
  });
});
