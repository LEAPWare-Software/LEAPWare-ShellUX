'use strict';
/*
 * ============================================================================
 * ADR-0005 PANE TOPOLOGY SPIKE — THE THROWAWAY HOST.
 * ============================================================================
 *
 * NOT PART OF THE SHIPPING APPLICATION. Nothing under `spike/` is imported by
 * `src/`, by `electron/`, or by any gate in `npm run verify`. It exists to be
 * launched by hand for arm B (NVDA, a human) and by `probe.mjs` for the arms a
 * machine can measure. Delete the directory when ADR-0005 is accepted.
 *
 * FOUR ASSEMBLIES OF THE SAME TWO PANES, selected with `--mode=`:
 *
 *   views           two WebContentsViews side by side in one BaseWindow.
 *                   This is ADR-0005 option A's boundary, in miniature.
 *   views-deferred  one WebContentsView; the second is added later, on demand,
 *                   which is the shape electron/electron#42339 describes.
 *   iframes         one WebContentsView, two sibling iframes. The control that
 *                   separates "document boundary" from "WebContentsView
 *                   boundary" — ADR-0005 finding 5 turns on that distinction.
 *   divs            one WebContentsView, two sibling divs. No boundary at all.
 *                   ADR-0005 option B's extension pane pair, in miniature.
 *
 * The pane markup is identical in all four; only the assembly differs. See
 * pane.js.
 *
 * `globalThis.__spike.probes` is the whole automated surface. `probe.mjs` drives
 * it through Playwright's `electronApp.evaluate`, which runs a function in THIS
 * process — so every measurement below has the main process's own view of the
 * window, the views and their webContents, and nothing has to be serialised
 * across a boundary the spike is trying to measure.
 *
 * SECURITY SETTINGS ARE THE SHIPPING ONES on purpose. `contextIsolation`,
 * `sandbox` and `nodeIntegration: false` all match electron/main/index.ts
 * decision 1, because an accessibility measurement taken against a differently
 * configured renderer is a measurement of a different renderer.
 */

const { app, BaseWindow, WebContentsView } = require('electron');
const { join } = require('node:path');
const { release } = require('node:os');

const HERE = __dirname;

const DOCUMENTS = {
  paneA: join(HERE, 'pane-a.html'),
  paneB: join(HERE, 'pane-b.html'),
  iframes: join(HERE, 'iframes.html'),
  divs: join(HERE, 'divs.html'),
};

const WINDOW_WIDTH = 1280;
const WINDOW_HEIGHT = 720;

const MODES = ['views', 'views-deferred', 'iframes', 'divs'];

/**
 * Command-line switches this file is willing to REPORT.
 *
 * Playwright hands the Electron binary a user-data directory and a debugging
 * switch of its own, and both carry machine-specific paths. Reporting
 * `process.argv` wholesale would put an absolute path through somebody's home
 * directory into results.json — which is the local-environment dependency
 * ADR-0002 forbids, arriving from the tool measuring the spike. So the report is
 * an allowlist rather than a filter.
 */
const REPORTABLE_SWITCHES = ['--mode=', '--enable-features=', '--disable-features='];

function readMode(argv) {
  for (const argument of argv) {
    if (!argument.startsWith('--mode=')) continue;
    const value = argument.slice('--mode='.length);
    if (MODES.includes(value)) return value;
  }
  return 'views';
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function makeView() {
  return new WebContentsView({
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
}

function place(view, index, count) {
  const width = Math.floor(WINDOW_WIDTH / count);
  view.setBounds({ x: index * width, y: 0, width, height: WINDOW_HEIGHT });
}

/** Every frame of a webContents, main frame first. */
function framesOf(contents) {
  const found = [];
  const walk = (frame) => {
    found.push(frame);
    for (const child of frame.frames) walk(child);
  };
  walk(contents.mainFrame);
  return found;
}

function shortName(url) {
  const parts = String(url).split('/');
  return parts[parts.length - 1] || String(url);
}

// ---------------------------------------------------------------------------
// CDP, per webContents.
//
// `webContents.debugger` is a per-web-contents CDP client owned by the main
// process. It is preferred over Playwright's page-level session for one reason:
// it does not depend on Playwright's `windows()` enumerating a WebContentsView
// as a page at all, and whether it does is itself one of the things being
// measured. If the attach fails — a DevTools window or another client already
// holds the target — the failure is recorded rather than swallowed, so a missing
// measurement is never mistaken for a negative one.
// ---------------------------------------------------------------------------

const attachFailures = new Map();

function attach(contents) {
  if (contents.debugger.isAttached()) return true;
  if (attachFailures.has(contents.id)) return false;
  try {
    contents.debugger.attach('1.3');
    return true;
  } catch (error) {
    attachFailures.set(contents.id, error && error.message ? error.message : String(error));
    return false;
  }
}

async function cdp(contents, method, parameters) {
  if (!attach(contents)) throw new Error('cdp unavailable: ' + attachFailures.get(contents.id));
  return contents.debugger.sendCommand(method, parameters || {});
}

// ---------------------------------------------------------------------------
// Shared readings
// ---------------------------------------------------------------------------

const FOCUS_SNIPPET = [
  '(function () {',
  '  var active = document.activeElement;',
  '  return {',
  '    document: location.href.split("/").pop(),',
  '    activeElement: active ? (active.id || active.tagName.toLowerCase()) : null,',
  '    documentHasFocus: document.hasFocus()',
  '  };',
  '})()',
].join('\n');

async function focusReport() {
  const spike = globalThis.__spike;
  const views = [];
  for (const view of spike.views) {
    const contents = view.webContents;
    const frames = [];
    for (const frame of framesOf(contents)) {
      frames.push(await frame.executeJavaScript(FOCUS_SNIPPET));
    }
    views.push({ webContentsId: contents.id, webContentsIsFocused: contents.isFocused(), frames });
  }
  const allFrames = views.flatMap((view) => view.frames);
  return {
    windowIsFocused: spike.window.isFocused(),
    // The two counts a host would need in order to draw exactly one focus ring.
    // In a single document both are 1 by construction. Where they are not, the
    // renderers cannot agree among themselves which of them holds focus and the
    // main process has to be the one that knows.
    documentsReportingHasFocus: allFrames.filter((frame) => frame.documentHasFocus).length,
    documentsWithANonBodyActiveElement: allFrames.filter(
      (frame) => frame.activeElement !== null && frame.activeElement !== 'body',
    ).length,
    views,
  };
}

/**
 * The frame that holds `elementId`, or null.
 *
 * Every focus arm goes through this rather than assuming a frame, because the
 * whole point of the three assemblies is that the same element lives in a
 * different frame in each of them.
 */
async function frameHolding(elementId) {
  const spike = globalThis.__spike;
  for (const view of spike.views) {
    for (const frame of framesOf(view.webContents)) {
      const present = await frame.executeJavaScript(
        'document.getElementById(' + JSON.stringify(elementId) + ') !== null',
      );
      if (present) return { view, frame };
    }
  }
  return null;
}

/**
 * Focus `elementId` and refuse to continue if the window is not foreground.
 *
 * `document.hasFocus()` is false in EVERY document while the OS window is in the
 * background, so a focus arm run against a background window returns the
 * expected negative for entirely the wrong reason. That is the single most
 * likely way this spike produces a number that looks like a finding and is not,
 * so it throws rather than recording.
 */
async function focusElement(elementId) {
  const spike = globalThis.__spike;
  const located = await frameHolding(elementId);
  if (located === null) throw new Error('no frame holds #' + elementId);
  located.view.webContents.focus();
  await located.frame.executeJavaScript(
    'document.getElementById(' + JSON.stringify(elementId) + ').focus(); true',
  );
  await delay(120);
  if (!spike.window.isFocused()) {
    throw new Error(
      'the spike window is not OS-foreground, so every focus measurement would be ' +
        'a false negative. Re-run with the window visible and unobstructed.',
    );
  }
  return located;
}

// ---------------------------------------------------------------------------
// Probes
// ---------------------------------------------------------------------------

function environment() {
  const spike = globalThis.__spike;
  return {
    mode: spike.mode,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    osRelease: release(),
    accessibilitySupportEnabled: app.isAccessibilitySupportEnabled(),
    switches: process.argv.filter((argument) =>
      REPORTABLE_SWITCHES.some((prefix) => argument.startsWith(prefix)),
    ),
    viewCount: spike.views.length,
  };
}

/**
 * ARM: do the panes report separate accessibility roots?
 *
 * What CDP can answer: how many `RootWebArea` nodes each web contents reports,
 * whether one web contents' tree contains the other pane's headings at all, and
 * what the frame tree looks like. What CDP CANNOT answer is the `AXTreeID`
 * itself — the protocol does not expose `ui::AXTreeID`, and no proxy for it is
 * substituted here. Counting platform trees is arm A's job and needs inspect.exe.
 */
/** The exact heading strings pane.js renders, so containment is an equality test. */
const PANE_A_HEADING = 'Pane A heading, the list pane';
const PANE_B_HEADING = 'Pane B heading, the detail pane';

function summariseTree(tree) {
  const nodes = (tree && tree.nodes) || [];
  const roleOf = (node) => (node.role && node.role.value) || '';
  const nameOf = (node) => (node.name && node.name.value) || '';
  return {
    nodeCount: nodes.length,
    rootWebAreaCount: nodes.filter((node) => roleOf(node) === 'RootWebArea').length,
    rootWebAreaNames: nodes.filter((node) => roleOf(node) === 'RootWebArea').map(nameOf),
    headings: nodes.filter((node) => roleOf(node) === 'heading').map(nameOf),
    landmarkRegions: nodes.filter((node) => roleOf(node) === 'region').map(nameOf),
  };
}

async function accessibilityTrees() {
  const spike = globalThis.__spike;
  const results = [];
  for (const view of spike.views) {
    const contents = view.webContents;
    const entry = {
      webContentsId: contents.id,
      webContentsType: contents.getType(),
      osProcessId: contents.getOSProcessId(),
      cdp: attach(contents) ? 'webContents.debugger' : 'unavailable',
      cdpError: attachFailures.get(contents.id) || null,
    };
    if (entry.cdp !== 'unavailable') {
      await cdp(contents, 'Page.enable');
      await cdp(contents, 'Accessibility.enable');

      const frameTree = await cdp(contents, 'Page.getFrameTree');
      const collectFrames = (node) => {
        const list = [{ id: node.frame.id, document: shortName(node.frame.url) }];
        for (const child of node.childFrames || []) list.push(...collectFrames(child));
        return list;
      };
      entry.frames = collectFrames(frameTree.frameTree);

      // Two readings, because they differ and the difference is the point. The
      // first asks the web contents for "the whole tree" with no frame named;
      // the second asks each frame in turn. Where a web contents holds more than
      // one document the first answer stops at the first document, which is
      // itself evidence about where the enumeration boundary sits.
      entry.wholeWebContents = summariseTree(await cdp(contents, 'Accessibility.getFullAXTree', {}));
      entry.perFrame = [];
      for (const frame of entry.frames) {
        try {
          const summary = summariseTree(
            await cdp(contents, 'Accessibility.getFullAXTree', { frameId: frame.id }),
          );
          entry.perFrame.push({ frameId: frame.id, document: frame.document, ...summary });
        } catch (error) {
          entry.perFrame.push({
            frameId: frame.id,
            document: frame.document,
            error: error && error.message ? error.message : String(error),
          });
        }
      }
      entry.wholeWebContentsHasPaneAHeading = entry.wholeWebContents.headings.includes(PANE_A_HEADING);
      entry.wholeWebContentsHasPaneBHeading = entry.wholeWebContents.headings.includes(PANE_B_HEADING);
    }
    results.push(entry);
  }
  return results;
}

/**
 * ARM: does an aria-labelledby / aria-controls IDREF resolve across the boundary?
 *
 * Two independent readings, because they fail differently and a reader should be
 * able to tell which one moved:
 *
 *   DOM      does `getElementById(idref)` find anything from the referring
 *            element's own document? A fact about documents, no AX layer.
 *   COMPUTED what Chromium's accessible-name computation produces. A resolved
 *            IDREF makes the name the other pane's heading; an unresolved one
 *            falls back to the control's own text content. That fallback is the
 *            observable, which is why the control has text of its own.
 */
async function crossDocumentReferences() {
  const spike = globalThis.__spike;
  const results = [];
  for (const elementId of ['pane-a-cross', 'pane-b-cross']) {
    const located = await frameHolding(elementId);
    if (located === null) continue;
    const dom = await located.frame.executeJavaScript(
      [
        '(function () {',
        '  var element = document.getElementById(' + JSON.stringify(elementId) + ');',
        '  var labelledby = element.getAttribute("aria-labelledby");',
        '  var controls = element.getAttribute("aria-controls");',
        '  return {',
        '    document: location.href.split("/").pop(),',
        '    labelledbyIdref: labelledby,',
        '    labelledbyResolvesInThisDocument: document.getElementById(labelledby) !== null,',
        '    controlsIdref: controls,',
        '    controlsResolvesInThisDocument: document.getElementById(controls) !== null,',
        '    ownTextContent: element.textContent.trim()',
        '  };',
        '})()',
      ].join('\n'),
    );
    const entry = { element: elementId, dom, computed: null };
    const contents = located.view.webContents;
    if (attach(contents)) {
      await cdp(contents, 'DOM.enable');
      await cdp(contents, 'Accessibility.enable');
      const document = await cdp(contents, 'DOM.getDocument', { depth: -1, pierce: true });
      let backendNodeId = null;
      const walk = (node) => {
        const attributes = node.attributes || [];
        for (let index = 0; index + 1 < attributes.length; index += 2) {
          if (attributes[index] === 'id' && attributes[index + 1] === elementId) {
            backendNodeId = node.backendNodeId;
          }
        }
        for (const child of node.children || []) walk(child);
        for (const root of node.shadowRoots || []) walk(root);
        if (node.contentDocument) walk(node.contentDocument);
      };
      walk(document.root);
      if (backendNodeId !== null) {
        const partial = await cdp(contents, 'Accessibility.getPartialAXTree', {
          backendNodeId,
          fetchRelatives: false,
        });
        const node = (partial.nodes || []).find((candidate) => candidate.backendDOMNodeId === backendNodeId);
        if (node) {
          const property = (name) => (node.properties || []).find((entryOf) => entryOf.name === name);
          const relatedCount = (name) => {
            const found = property(name);
            if (!found || !found.value || !Array.isArray(found.value.relatedNodes)) return 0;
            return found.value.relatedNodes.length;
          };
          entry.computed = {
            accessibleName: (node.name && node.name.value) || '',
            accessibleNameFrom: (node.name && node.name.sources || [])
              .filter((source) => source.attribute === 'aria-labelledby' || source.type === 'contents')
              .map((source) => ({
                type: source.type,
                attribute: source.attribute || null,
                superseded: source.superseded === true,
                invalid: source.invalid === true,
                value: (source.value && source.value.value) || null,
              })),
            labelledbyRelatedNodes: relatedCount('labelledby'),
            controlsRelatedNodes: relatedCount('controls'),
          };
        }
      }
    }
    results.push(entry);
  }
  return results;
}

/**
 * ARM: does Tab from the last control of pane A reach pane B, and does getting
 * focus into pane A in the first place need the host to intervene?
 *
 * The limit, stated rather than glossed: `sendInputEvent` delivers the key to a
 * CHOSEN webContents. It therefore measures where Chromium's sequential focus
 * navigation goes from that document, which is the question — but it is not the
 * same thing as proving what the operating system does with a real Tab press,
 * and it cannot be. `hostMediation` below records the other half: whether the
 * main process had to call `focus()` for the key to have anywhere to land.
 */
async function tabTraversal() {
  const spike = globalThis.__spike;
  const atStartup = await focusReport();
  const located = await focusElement('pane-a-last');
  const before = await focusReport();

  located.view.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
  located.view.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
  await delay(200);
  const afterTab = await focusReport();

  let afterHostMediation = null;
  if (spike.views.length > 1) {
    spike.views[1].webContents.focus();
    await delay(150);
    afterHostMediation = await focusReport();
  }

  return {
    atStartup,
    focusedElement: 'pane-a-last',
    before,
    afterTab,
    hostMediation: {
      neededToEnterPaneA: spike.views.length > 1 && atStartup.views[0].webContentsIsFocused === false,
      afterHostMediation,
    },
  };
}

/**
 * ARM: does pane A's `document.activeElement` survive a click into pane B?
 *
 * The click is dispatched at pane B's own coordinates, in whichever webContents
 * owns it — which in the iframes assembly means adding the iframe element's
 * offset in the top document, because a subframe's client rect is its own.
 */
async function activeElementAcrossClick() {
  const spike = globalThis.__spike;
  if (spike.mode === 'views-deferred') {
    return { skipped: 'pane B does not exist until the addChildViewFocusSteal arm creates it' };
  }
  await focusElement('pane-a-text');
  await spike.probes.type('pane-a-text', 'typed before the click');
  const before = await focusReport();
  const valueBefore = await readValue('pane-a-text');

  const target = await pointOf('pane-b-first');
  if (target === null) throw new Error('could not locate #pane-b-first');
  target.contents.sendInputEvent({ type: 'mouseDown', x: target.x, y: target.y, button: 'left', clickCount: 1 });
  target.contents.sendInputEvent({ type: 'mouseUp', x: target.x, y: target.y, button: 'left', clickCount: 1 });
  await delay(250);

  const after = await focusReport();
  return {
    before,
    clickedAt: { webContentsId: target.contents.id, x: target.x, y: target.y },
    after,
    paneATextValueBefore: valueBefore,
    paneATextValueAfter: await readValue('pane-a-text'),
    documentsClaimingAnActiveElementAfterTheClick: after.views
      .flatMap((view) => view.frames)
      .filter((frame) => frame.activeElement !== null && frame.activeElement !== 'body').length,
  };
}

async function readValue(elementId) {
  const located = await frameHolding(elementId);
  if (located === null) return null;
  return located.frame.executeJavaScript(
    'document.getElementById(' + JSON.stringify(elementId) + ').value',
  );
}

async function pointOf(elementId) {
  const located = await frameHolding(elementId);
  if (located === null) return null;
  const contents = located.view.webContents;
  const rect = await located.frame.executeJavaScript(
    [
      '(function () {',
      '  var box = document.getElementById(' + JSON.stringify(elementId) + ').getBoundingClientRect();',
      '  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };',
      '})()',
    ].join('\n'),
  );
  let offset = { x: 0, y: 0 };
  if (located.frame !== contents.mainFrame) {
    offset = await contents.mainFrame.executeJavaScript(
      [
        '(function () {',
        '  var frame = document.getElementById("frame-b");',
        '  if (!frame) return { x: 0, y: 0 };',
        '  var box = frame.getBoundingClientRect();',
        '  return { x: box.left, y: box.top };',
        '})()',
      ].join('\n'),
    );
  }
  return { contents, x: Math.round(rect.x + offset.x), y: Math.round(rect.y + offset.y) };
}

/**
 * ARM: electron/electron#42339 — does `addChildView` steal focus?
 *
 * Only meaningful in `views-deferred`, where the window starts with one view and
 * the second arrives while a control in the first is focused and being typed
 * into. `webContents.isFocused()` is the direct reading; `document.hasFocus()`
 * per document is the corroborating one.
 */
async function addChildViewFocusSteal() {
  const spike = globalThis.__spike;
  if (spike.mode !== 'views-deferred') {
    return { skipped: 'runs only in --mode=views-deferred' };
  }
  await focusElement('pane-a-text');
  await spike.probes.type('pane-a-text', 'before');
  const before = {
    report: await focusReport(),
    paneATextValue: await readValue('pane-a-text'),
  };

  const second = makeView();
  spike.window.contentView.addChildView(second);
  place(second, 1, 2);
  const immediatelyAfterAddChildView = {
    paneAWebContentsIsFocused: spike.views[0].webContents.isFocused(),
    newViewWebContentsIsFocused: second.webContents.isFocused(),
  };

  await second.webContents.loadFile(DOCUMENTS.paneB);
  await delay(400);
  spike.views.push(second);

  const afterLoad = {
    report: await focusReport(),
    paneATextValue: await readValue('pane-a-text'),
  };

  return {
    issue: 'electron/electron#42339',
    before,
    immediatelyAfterAddChildView,
    afterLoad,
    paneALostWebContentsFocus:
      before.report.views[0].webContentsIsFocused === true &&
      afterLoad.report.views[0].webContentsIsFocused === false,
  };
}

/** Types into an element by dispatching character events at its own webContents. */
async function typeInto(elementId, text) {
  const located = await frameHolding(elementId);
  if (located === null) throw new Error('no frame holds #' + elementId);
  const contents = located.view.webContents;
  for (const character of text) {
    contents.sendInputEvent({ type: 'char', keyCode: character });
  }
  await delay(120);
  return readValue(elementId);
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

/**
 * `globalThis.__spike` is published at MODULE scope, not from `whenReady`.
 *
 * Playwright's `electronApp.evaluate` can run before `app.whenReady()` has
 * resolved, and a probe that reads `undefined.ready` reports a race as a
 * measurement failure. Publishing the object immediately and resolving `ready`
 * later means the probe waits for the window instead of missing it.
 */
let markLoaded;
const loaded = new Promise((resolve) => {
  markLoaded = resolve;
});

globalThis.__spike = {
  mode: readMode(process.argv),
  window: null,
  views: [],
  ready: loaded.then(() => delay(500)),
  probes: {
    environment,
    accessibilityTrees,
    crossDocumentReferences,
    tabTraversal,
    activeElementAcrossClick,
    addChildViewFocusSteal,
    focusReport,
    type: typeInto,
  },
};

app.whenReady().then(() => {
  const spike = globalThis.__spike;
  const mode = spike.mode;
  const window = new BaseWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    title: 'ADR-0005 pane topology spike',
    show: false,
  });

  const views = spike.views;
  let ready;

  if (mode === 'views' || mode === 'views-deferred') {
    const first = makeView();
    window.contentView.addChildView(first);
    place(first, 0, 2);
    views.push(first);
    const loads = [first.webContents.loadFile(DOCUMENTS.paneA)];
    if (mode === 'views') {
      const second = makeView();
      window.contentView.addChildView(second);
      place(second, 1, 2);
      views.push(second);
      loads.push(second.webContents.loadFile(DOCUMENTS.paneB));
    }
    ready = Promise.all(loads);
  } else {
    const only = makeView();
    window.contentView.addChildView(only);
    only.setBounds({ x: 0, y: 0, width: WINDOW_WIDTH, height: WINDOW_HEIGHT });
    views.push(only);
    ready = only.webContents.loadFile(mode === 'iframes' ? DOCUMENTS.iframes : DOCUMENTS.divs);
  }

  window.show();
  window.focus();
  app.focus();

  spike.window = window;
  markLoaded(ready);
});

app.on('window-all-closed', () => {
  app.quit();
});
