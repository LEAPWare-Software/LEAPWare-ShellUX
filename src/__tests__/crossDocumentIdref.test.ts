import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * ============================================================================
 * AN IDREF CANNOT CROSS A DOCUMENT, AND THE SHELL NOW HAS TWO.
 * ============================================================================
 * WAI-ARIA 1.2 defines a valid IDREF as *"a reference to a target element in the
 * **same document** that has a matching ID"*. Until Phase 7 that was a rule with
 * nothing to violate: the shell was one document, so every `aria-labelledby`,
 * `aria-controls`, `aria-describedby`, `aria-owns` and `aria-activedescendant`
 * in it resolved by construction.
 *
 * **The topology spike measured what happens when it does not.** On Electron
 * 43.2.0 / Chromium 150, a control in one pane whose `aria-labelledby` named a
 * heading in the other pane got: `getElementById` → `null`, the name source
 * marked **`invalid: true`**, zero `labelledby` related nodes, and an accessible
 * name silently falling back to the control's own text. **Nothing throws, nothing
 * warns, and the rendered pixels are identical.** The same markup as two
 * `<iframe>`s in ONE web contents produced byte-identical readings, which is how
 * the spike established that the boundary is the *document* rather than the
 * view — see `spike/topology/RESULTS.md` measurement 2.
 *
 * So the failure mode this file guards is: somebody writes an IDREF in host
 * chrome that names an element in the extension surface, every test stays green,
 * every pixel is right, and a screen-reader user hears the wrong label. That is
 * exactly the class of defect §10 of the plan says jsdom cannot see — and this
 * scan does not see it either. What it sees is the *source*, before it becomes a
 * behaviour.
 *
 * ---------------------------------------------------------------------------
 * HOW THE TWO DOCUMENTS ARE DECIDED
 * ---------------------------------------------------------------------------
 * By walking the relative-import graph from each document's own entry point —
 * `src/main.tsx` for host chrome and `src/paneview/main.paneview.tsx` for the
 * extension surface — rather than by naming directories. A directory rule would
 * be a convention this test believed; an import walk is what the bundler
 * actually does, so a module that gets pulled into a document by a new import
 * enters this scan on the same commit.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS ASSERTED
 * ---------------------------------------------------------------------------
 *  1. **Every literal IDREF resolves inside its own document.** A value that is
 *     defined only in the *other* document is reported as the cross-document
 *     case; one defined nowhere is reported as a dangling reference, which is the
 *     defect `ContextBar.tsx` decision 5 already fixed once inside one document.
 *  2. **No module rendered in BOTH documents mints a literal DOM `id`.** This is
 *     the half with teeth today. A shared component with a hardcoded id produces
 *     *the same id in two documents*, so an IDREF naming it is ambiguous in
 *     exactly the way the spike measured and resolves to whichever copy the
 *     reader happens to be in. Every id the shell mints today is composed from a
 *     prop — `rowDomId(listId, index)` in `VirtualizedList.tsx` — which is why
 *     this passes, and it would stop passing the moment one was written flat.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT ASSERTED, STATED RATHER THAN GLOSSED
 * ---------------------------------------------------------------------------
 * **Assertion 1 is vacuous against the current tree, and saying so is the point.**
 * `src/` contains no literal IDREF at all: every one is computed. A scan whose
 * only evidence is its own emptiness is the pattern ADR-0001 Amendment G exists
 * to refuse, so the planted cases below are not decoration — they are the whole
 * of the evidence that this scan can fail, and they cover the cross-document
 * case, the dangling case and the shared-literal-id case.
 *
 * A COMPUTED IDREF IS INVISIBLE HERE. `aria-activedescendant={rowDomId(listId,
 * i)}` cannot be resolved by a source scan, and the repository's every IDREF is
 * of that shape. What makes that acceptable rather than a hole is that all of
 * them are minted and consumed inside ONE component — a list and its own rows —
 * so there is no source in the repository for a computed IDREF that could name
 * another document. The day a helper starts returning ids that cross a component
 * boundary, this scan will not catch it, and that limit belongs in the review of
 * that change rather than in a false claim here.
 * ============================================================================
 */

/** `src/`, resolved from this file's own location rather than from the cwd. */
const SRC_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** The two documents, by the entry point each is loaded from. */
const DOCUMENT_ENTRIES = Object.freeze({
  /** `index.html` → host chrome: the rail, pane 1, the context bar, the palette. */
  chrome: 'main.tsx',
  /** `paneview.html` → the extension surface: panes 2 and 3, in one document. */
  extension: 'paneview/main.paneview.tsx',
} as const);

type DocumentId = keyof typeof DOCUMENT_ENTRIES;

/** The five attributes WAI-ARIA defines as taking an IDREF or an IDREF list. */
const IDREF_ATTRIBUTES: ReadonlySet<string> = new Set([
  'aria-labelledby',
  'aria-controls',
  'aria-describedby',
  'aria-owns',
  'aria-activedescendant',
]);

/**
 * JSX attributes whose literal value is a DOM id.
 *
 * `id` alone. `key` is React's and never reaches the DOM, and `htmlFor` is an
 * IDREF in the other direction that this shell does not use — adding it would be
 * inventing a case rather than covering one.
 */
const ID_ATTRIBUTE = 'id';

/**
 * Elements whose `id` prop is NOT a DOM id.
 *
 * `react-resizable-panels` takes `id` on `Panel` and `PanelGroup` as its own
 * persistence key for the layout; it is not rendered as an attribute and cannot
 * be the target of an IDREF. Both documents legitimately spell `id="pane2"`, and
 * treating that as a shared DOM id would make assertion 2 fail on a name that
 * never reaches a document at all.
 */
const NON_DOM_ID_ELEMENTS: ReadonlySet<string> = new Set(['Panel', 'PanelGroup']);

interface ModuleScan {
  /** Literal DOM ids this module mints. */
  readonly defines: readonly string[];
  /** Literal IDREF values this module references. */
  readonly references: readonly string[];
  /** Relative import specifiers, unresolved. */
  readonly imports: readonly string[];
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** The literal string an attribute carries, or `undefined` when it is computed. */
function literalOf(attribute: ts.JsxAttribute): string | undefined {
  const initializer = attribute.initializer;
  if (initializer === undefined) return undefined;
  if (ts.isStringLiteral(initializer)) return initializer.text;
  if (
    ts.isJsxExpression(initializer) &&
    initializer.expression !== undefined &&
    ts.isStringLiteralLike(initializer.expression)
  ) {
    return initializer.expression.text;
  }
  return undefined;
}

/** The tag name of the element an attribute list belongs to. */
function tagNameOf(attributes: ts.JsxAttributes): string {
  const parent = attributes.parent;
  if (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) {
    return parent.tagName.getText(parent.getSourceFile());
  }
  return '';
}

/** Read one module's ids, IDREFs and relative imports. */
export function scanModule(file: string, text: string): ModuleScan {
  const source = parse(file, text);
  const defines: string[] = [];
  const references: string[] = [];
  const imports: string[] = [];

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text.startsWith('.')
    ) {
      imports.push(node.moduleSpecifier.text);
    }
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(source);
      const value = literalOf(node);
      if (value !== undefined) {
        if (name === ID_ATTRIBUTE && !NON_DOM_ID_ELEMENTS.has(tagNameOf(node.parent))) {
          defines.push(value);
        } else if (IDREF_ATTRIBUTES.has(name)) {
          // An IDREF LIST is whitespace-separated, and each token is a separate
          // reference. Splitting is not a nicety: `aria-labelledby="a b"` with
          // `a` here and `b` in the other document is exactly the mixed case a
          // whole-string comparison would pass.
          for (const token of value.split(/\s+/).filter((entry) => entry !== '')) {
            references.push(token);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return { defines, references, imports };
}

/** Resolve one relative specifier the way the bundler does. */
function resolveImport(fromFile: string, specifier: string): string | null {
  const base = resolve(SRC_ROOT, dirname(fromFile), specifier);
  for (const candidate of [
    `${base}.tsx`,
    `${base}.ts`,
    join(base, 'index.tsx'),
    join(base, 'index.ts'),
  ]) {
    if (existsSync(candidate)) {
      return relative(SRC_ROOT, candidate).split(sep).join('/');
    }
  }
  // A `.css` import, or anything outside `src/`. Neither carries JSX.
  return null;
}

/** Every module reachable from one entry point, as paths relative to `src/`. */
function moduleGraph(entry: string): Map<string, ModuleScan> {
  const seen = new Map<string, ModuleScan>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    const scan = scanModule(file, readFileSync(join(SRC_ROOT, file), 'utf8'));
    seen.set(file, scan);
    for (const specifier of scan.imports) {
      const resolved = resolveImport(file, specifier);
      if (resolved !== null) queue.push(resolved);
    }
  }
  return seen;
}

const GRAPHS: Readonly<Record<DocumentId, Map<string, ModuleScan>>> = Object.freeze({
  chrome: moduleGraph(DOCUMENT_ENTRIES.chrome),
  extension: moduleGraph(DOCUMENT_ENTRIES.extension),
});

function idsOf(graph: Map<string, ModuleScan>): Set<string> {
  const ids = new Set<string>();
  for (const scan of graph.values()) {
    for (const id of scan.defines) ids.add(id);
  }
  return ids;
}

describe('the two documents — an IDREF resolves inside the document that wrote it', () => {
  it('walks a real graph from each entry point, so an empty scan cannot pass vacuously', () => {
    // Named modules rather than a count, so a walk that silently stopped at the
    // entry point fails here rather than passing everything below.
    expect([...GRAPHS.chrome.keys()]).toEqual(
      expect.arrayContaining(['main.tsx', 'App.tsx', 'components/layout/ShellLayout.tsx']),
    );
    expect([...GRAPHS.extension.keys()]).toEqual(
      expect.arrayContaining([
        'paneview/main.paneview.tsx',
        'paneview/PaneViewShell.tsx',
        'components/layout/PaneWrapper.tsx',
      ]),
    );
    // And they are genuinely two documents.
    //
    // **`ShellLayout.tsx` is in BOTH graphs, and that is the design rather than a
    // leak.** This assertion used to name it as the thing that must NOT be in the
    // extension surface's graph, at a time when that surface reimplemented panes
    // 2 and 3 for itself — and what that fork actually bought was a launched
    // application with no block ledger and no omnibox composer in either view,
    // because both live in `ShellLayout`. One component with a `surface` prop is
    // what replaced it, so the layout arithmetic, the fault-boundary order and
    // the density contract are shared rather than duplicated.
    //
    // What separates the documents is therefore the composition ABOVE that
    // component, and the assertion is ONE-DIRECTIONAL because only one direction
    // is true: **host chrome does not reach the extension surface's composition
    // at all.** If it did there would be one document twice, and every assertion
    // below would be about it.
    //
    // The other direction is deliberately not asserted, and the reason is worth
    // stating rather than leaving as a gap. `App.tsx` holds `wireExtensionSurface`
    // as well as host chrome's own tree — the two halves of one seam, within
    // reading distance of each other — so `paneview/main.paneview.tsx` imports
    // that module and this walk records it. **A module GRAPH is not a rendered
    // TREE.** What the extension document renders is `PaneViewShell`, which never
    // mentions `App`; what the bundler emits for that entry contains neither
    // `App` nor `RootBoundary`, because nothing reachable from the entry calls
    // them. The scan below is over SOURCE, so it is deliberately the more
    // pessimistic of the two readings: an id minted in a module that is merely
    // reachable still counts.
    expect(GRAPHS.chrome.has('paneview/PaneViewShell.tsx')).toBe(false);
  });

  it.each<DocumentId>(['chrome', 'extension'])(
    'resolves every literal IDREF in the %s document against ids that document defines',
    (document) => {
      const defined = idsOf(GRAPHS[document]);
      const elsewhere = idsOf(GRAPHS[document === 'chrome' ? 'extension' : 'chrome']);
      const unresolved: string[] = [];
      for (const [file, scan] of GRAPHS[document]) {
        for (const reference of scan.references) {
          if (defined.has(reference)) continue;
          unresolved.push(
            `${file} → "${reference}" (${elsewhere.has(reference) ? 'defined in the OTHER document' : 'defined nowhere'})`,
          );
        }
      }
      expect(unresolved).toEqual([]);
    },
  );

  it('lets no module rendered in BOTH documents mint a literal DOM id', () => {
    // The half with teeth. A shared component with a hardcoded id produces the
    // same id in two documents, so an IDREF naming it resolves to whichever copy
    // the reader is in — ambiguous in exactly the way the spike measured. Every
    // id this shell mints is composed from a prop, which is why this is empty and
    // why it would stop being empty the moment one was written flat.
    const shared = [...GRAPHS.chrome.keys()].filter((file) => GRAPHS.extension.has(file));
    expect(shared).toEqual(expect.arrayContaining(['components/layout/PaneWrapper.tsx']));

    const offenders: string[] = [];
    for (const file of shared) {
      for (const id of (GRAPHS.chrome.get(file) as ModuleScan).defines) {
        offenders.push(`${file} → id="${id}"`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the scan can fail, which is the only evidence that it means anything', () => {
  it('reports a cross-document IDREF, which is the case the spike measured', () => {
    const chrome = scanModule(
      'chrome.tsx',
      'export const Bar = () => <button aria-labelledby="pane-b-heading">Act</button>;\n',
    );
    const extension = scanModule(
      'extension.tsx',
      'export const Pane = () => <h1 id="pane-b-heading">Detail</h1>;\n',
    );
    expect(chrome.references).toEqual(['pane-b-heading']);
    expect(chrome.defines).toEqual([]);
    expect(extension.defines).toEqual(['pane-b-heading']);
  });

  it('reports a dangling IDREF, which is ContextBar decision 5 one document along', () => {
    const scan = scanModule(
      'bar.tsx',
      'export const Bar = () => <button aria-controls="menu-that-is-shut">Act</button>;\n',
    );
    expect(scan.references).toEqual(['menu-that-is-shut']);
  });

  it('splits an IDREF list, so a half-crossing reference is not waved through', () => {
    const scan = scanModule(
      'bar.tsx',
      'export const Bar = () => <div aria-describedby="here there">x</div>;\n',
    );
    expect(scan.references).toEqual(['here', 'there']);
  });

  it('reports a literal id in a shared component', () => {
    const scan = scanModule(
      'shared.tsx',
      'export const Row = () => <li id="shell-row">x</li>;\n',
    );
    expect(scan.defines).toEqual(['shell-row']);
  });

  it('reads an id written as a braced string literal, which is the same id', () => {
    const scan = scanModule('x.tsx', 'export const X = () => <p id={"braced"}>x</p>;\n');
    expect(scan.defines).toEqual(['braced']);
  });

  it('does not read a computed id or a computed IDREF, and that limit is the banner s', () => {
    const scan = scanModule(
      'list.tsx',
      'export const L = ({ n }: { n: string }) => (\n' +
        '  <ul id={rowDomId(n, 0)} aria-activedescendant={rowDomId(n, 1)} />\n' +
        ');\n',
    );
    expect(scan.defines).toEqual([]);
    expect(scan.references).toEqual([]);
  });

  it('does not treat a react-resizable-panels id as a DOM id, because it never reaches the DOM', () => {
    const scan = scanModule(
      'panes.tsx',
      'export const G = () => (\n' +
        '  <PanelGroup id="shell-panes"><Panel id="pane2" /></PanelGroup>\n' +
        ');\n',
    );
    expect(scan.defines).toEqual([]);
  });

  it('does not report an id written only in a comment', () => {
    const scan = scanModule(
      'prose.tsx',
      '/** A control here would carry aria-labelledby="pane-b-heading" and id="x". */\n' +
        'export const P = () => <p>none</p>;\n',
    );
    expect(scan.defines).toEqual([]);
    expect(scan.references).toEqual([]);
  });
});
