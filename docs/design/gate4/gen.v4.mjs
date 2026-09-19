// Generates the ShellUX 1.0 gate-4 screens as static .dc.html artboards.
// Every colour is a LEAPWare Light / Dark generated token value (tokens.generated.css, 2026-09-18).
import { writeFileSync } from 'node:fs';

const LIGHT = {
  pane: '#ffffff', chrome: '#f0f0f1', frame: '#f6f6f7', hover: '#eaebec', selected: '#e5e5e7', subtle: '#dbdcde',
  ink1: '#1e1f21', ink2: '#414448', ink3: '#5c5f64', disabled: '#a6a8ab',
  ruleS: '#c9cacd', ruleD: '#7e8085', accent: '#006e65', accentDeep: '#004f48', wash: '#e7f4f1', onAccent: '#ffffff', accentBorder: '#448f86',
  danger: '#a52f2a', dangerSub: '#ffebe9', dangerText: '#7d1716',
  warning: '#805500', warnSub: '#f9efe1', warnText: '#5d3c00',
  success: '#007238', succSub: '#e7f5ea', successText: '#005227', info: '#00688d', infoSub: '#e4f3fc',
  chart1: '#004e8f', grid: '#c9cacd', axis: '#7e8085', label: '#5c5f64', skeleton: '#eaebec',
  sunken: '#f0f0f1', // --surface-sunken: the hairline between rows and table rows
};
const DARK = {
  pane: '#171717', chrome: '#262728', frame: '#1f1f20', hover: '#2d2e2f', selected: '#353637', subtle: '#404143',
  ink1: '#ebedf0', ink2: '#ced1d8', ink3: '#b2b6be', disabled: '#6a6c70',
  ruleS: '#515255', ruleD: '#7d8086', accent: '#6dc9bd', accentDeep: '#99e1d7', wash: '#202928', onAccent: '#171717', accentBorder: '#448f86',
  danger: '#ff9387', dangerSub: '#322321', dangerText: '#ffbfb6',
  warning: '#eba737', warnSub: '#2d261b', warnText: '#ffc674',
  success: '#6cce8a', succSub: '#202a22', successText: '#98e6ad', info: '#46c4fd', infoSub: '#1d292f',
  chart1: '#3d8fe4', grid: '#515255', axis: '#7d8086', label: '#b2b6be', skeleton: '#2d2e2f',
  sunken: '#262728', // --surface-sunken
};
// Token names each key stands for (wireframe-to-code map; values above are tokens.generated.css):
// pane --surface-pane, chrome --surface-raised, frame --surface-app, hover --surface-hover, selected --surface-selected,
// subtle --surface-subtle (badge chip, identity tile), ink1/2/3 --text-primary/secondary/muted, disabled --text-disabled,
// ruleS --border-subtle, ruleD --border-default, accent --accent-solid, accentDeep --accent-solid-hover, wash --accent-subtle,
// onAccent --text-on-accent, accentBorder --accent-border, danger/warning/success/info --status-*, *Sub --status-*-subtle,
// dangerText/warnText/successText --text-danger/warning/success.

const FONT = "'Segoe UI Variable Text', 'Segoe UI', system-ui, -apple-system, sans-serif";
const W = 1440, H = 900, ZOOM = 1.5, FW = W * ZOOM, FH = H * ZOOM;

// ---------- icons: 16px, 1.5 stroke, one style ----------
const P = {
  box: '<path d="M2.5 5 8 2.5 13.5 5v6L8 13.5 2.5 11z"></path><path d="M2.5 5 8 7.5 13.5 5M8 7.5v6"></path>',
  mail: '<rect x="2" y="3.5" width="12" height="9" rx="1"></rect><path d="m2.5 4.5 5.5 4 5.5-4"></path>',
  truck: '<path d="M1.5 4h8v7h-8zM9.5 6.5h3l2 2.5v2h-5"></path><circle cx="4.5" cy="12" r="1.3"></circle><circle cx="11.5" cy="12" r="1.3"></circle>',
  building: '<path d="M3 13.5V3h7v10.5M10 6h3v7.5M1.5 13.5h13M5 5.5h1M7 5.5h1M5 8h1M7 8h1M5 10.5h1M7 10.5h1"></path>',
  puzzle: '<path d="M3 5h3a1.5 1.5 0 1 1 3 0h3v3a1.5 1.5 0 1 0 0 3v2.5H3V11a1.5 1.5 0 1 0 0-3z"></path>',
  search: '<circle cx="7" cy="7" r="4.5"></circle><path d="m10.5 10.5 3 3"></path>',
  panel: '<rect x="2" y="3" width="12" height="10" rx="1"></rect><path d="M6 3v10"></path>',
  chevR: '<path d="m6 4 4 4-4 4"></path>',
  chevD: '<path d="m4 6 4 4 4-4"></path>',
  more: '<circle cx="4" cy="8" r="0.6"></circle><circle cx="8" cy="8" r="0.6"></circle><circle cx="12" cy="8" r="0.6"></circle>',
  filter: '<path d="M2.5 3.5h11l-4.2 5v4l-2.6 1v-5z"></path>',
  alert: '<path d="M8 2.5 14 13H2z"></path><path d="M8 6.5v3M8 11.2v.1"></path>',
  stop: '<circle cx="8" cy="8" r="5.5"></circle><path d="M8 5v3.5M8 10.8v.1"></path>',
  refresh: '<path d="M13 4v3h-3"></path><path d="M12.6 7A5 5 0 1 0 13 9.5"></path>',
  upload: '<path d="M8 11V3M5 6l3-3 3 3M3 11v2h10v-2"></path>',
  bell: '<path d="M4 11V7.5a4 4 0 0 1 8 0V11l1 1.5H3zM6.5 14h3"></path>',
  gear: '<circle cx="8" cy="8" r="2"></circle><path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M3.6 12.4l1.2-1.2M11.2 4.8l1.2-1.2"></path>',
  copy: '<rect x="5" y="5" width="8" height="8" rx="1"></rect><path d="M11 5V3H3v8h2"></path>',
  enter: '<path d="M13 3.5v5H4M6.5 6 4 8.5 6.5 11"></path>',
  shieldX: '<path d="M8 1.8 13 3.8v3.7c0 3-2.1 5.2-5 6.6-2.9-1.4-5-3.6-5-6.6V3.8z"></path><path d="m6 6 4 4M10 6l-4 4"></path>',
  x: '<path d="m4.5 4.5 7 7M11.5 4.5l-7 7"></path>',
  printer: '<path d="M4.5 6V2.5h7V6M4.5 11.5h-2v-5.5h11v5.5h-2"></path><rect x="4.5" y="9.5" width="7" height="4"></rect>',
  undo: '<path d="M5.5 3.5 2.5 6.5l3 3"></path><path d="M2.5 6.5h7a3.5 3.5 0 0 1 0 7H7"></path>',
  clock: '<circle cx="8" cy="8" r="5.5"></circle><path d="M8 5v3l2 1.5"></path>',
};
// D-40 fallback: a plugin with no manifest icon gets a filled identity tile with its initial.
const tile = (initial, T, size = 16) =>
  `<span style="display: inline-flex; align-items: center; justify-content: center; flex: none; width: ${size}px; height: ${size}px; border-radius: 2px; background: ${T.subtle}; color: ${T.ink2}; font-size: 11px; font-weight: 600; line-height: 1">${initial}</span>`;
// Badge: neutral chip (--surface-subtle, --text-primary) unless the count is a crossed threshold,
// then the warning wash with warning ink (--status-warning-subtle, --text-warning) and a 1px warning rule.
const badge = (n, T, threshold = false) =>
  `<span style="position: absolute; top: 1px; right: 0; min-width: 14px; height: 14px; padding: 0 3px; box-sizing: border-box; border-radius: 7px; background: ${threshold ? T.warnSub : T.subtle}; color: ${threshold ? T.warnText : T.ink1}; ${threshold ? `box-shadow: inset 0 0 0 1px ${T.warning};` : ''} font-size: 11px; font-weight: 600; line-height: 14px; text-align: center; font-variant-numeric: tabular-nums">${n}</span>`;
const icon = (name, color, size = 16) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="flex: none; display: block">${P[name]}</svg>`;

const kbd = (t, T) =>
  `<span style="display: inline-flex; align-items: center; height: 16px; padding: 0 4px; border: 1px solid ${T.ruleS}; border-radius: 2px; font-size: 11px; line-height: 14px; color: ${T.ink3}; background: ${T.pane}; font-variant-numeric: tabular-nums">${t}</span>`;

const btnQuiet = (label, T, extra = '') =>
  `<div style="display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border: 1px solid ${T.ruleD}; border-radius: 4px; background: ${T.pane}; color: ${T.ink1}; font-size: 12px; font-weight: 500; ${extra}">${label}</div>`;
const btnPrimary = (label, T) =>
  `<div style="display: flex; align-items: center; height: 24px; padding: 0 12px; border-radius: 4px; background: ${T.accent}; color: ${T.onAccent}; font-size: 12px; font-weight: 500">${label}</div>`;

// ---------- data ----------
function series(seed, n, base, drift) {
  let x = seed * 9301 + 49297, v = base; const out = [];
  for (let i = 0; i < n; i++) { x = (x * 9301 + 49297) % 233280; v += (x / 233280 - 0.5 + drift) * base * 0.12; out.push(Math.max(4, v)); }
  return out;
}
const ITEMS = [
  ['Pallet wrap, 500mm', '40-1182', 412, 150],
  ['Carton, double wall 600x400', '40-0917', 1280, 400],
  ['Strapping band, 12mm', '40-2204', 96, 120],
  ['Label roll, 100x150', '41-0033', 2310, 600],
  ['Void fill, paper 400m', '40-1560', 58, 80],
  ['Tape, 48mm clear', '40-0012', 744, 300],
  ['Corner board, 50x50', '40-3308', 305, 100],
  ['Stretch hood, 1200mm', '40-1190', 188, 90],
  ['Desiccant pack, 250g', '42-0151', 1020, 250],
  ['Pallet, EUR 1200x800', '39-0001', 64, 60],
  ['Bubble wrap, 750mm', '40-1575', 211, 80],
  ['Mailer bag, 400x500', '41-2210', 3380, 900],
  ['Edge protector, 35mm', '40-3312', 142, 60],
  ['Carton, single wall 300x200', '40-0902', 1995, 500],
  ['Pallet collar, 1200x800', '39-0044', 37, 50],
  ['Kraft paper, 900mm', '40-1601', 420, 120],
  ['Cable tie, 300mm', '43-0107', 8800, 2000],
  ['Foam corner, 60mm', '40-3350', 612, 150],
  ['Shrink film, 19mu', '40-1204', 280, 100],
  ['Tote lid, 600x400', '44-0012', 156, 40],
  ['Pallet label, A5', '41-0051', 930, 300],
  ['Glove, nitrile L', '45-0203', 1450, 500],
  ['Seal, security tag', '43-0310', 77, 100],
  ['Tape dispenser, 50mm', '45-0410', 42, 20],
  ['Carton, triple wall 1200x800', '40-0960', 318, 120],
  ['Pallet cover, 1200x1000', '39-0102', 509, 200],
];
const rowsData = ITEMS.map(([t, sku, qty, thr], i) => {
  const s = series(i + 3, 24, qty * 1.15, -0.06);
  s[s.length - 1] = qty;
  return { t, sku, qty, thr, s, low: qty < thr, sel: i === 0 };
});

function spark(r, T, w = 64, h = 20) {
  const max = Math.max(...r.s, r.thr) * 1.05;
  const y = (v) => (h - (v / max) * h).toFixed(1);
  const pts = r.s.map((v, i) => `${((i / (r.s.length - 1)) * (w - 3)).toFixed(1)},${y(v)}`).join(' ');
  const thrY = +y(r.thr);
  const line = r.low ? T.warning : T.ink3;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="flex: none; display: block">
    ${r.low ? `<rect x="0" y="${thrY}" width="${w}" height="${(h - thrY).toFixed(1)}" fill="${T.warnSub}"></rect>` : ''}
    <polyline points="${pts}" fill="none" stroke="${line}" stroke-width="1.25" stroke-linejoin="round"></polyline>
    <circle cx="${w - 3}" cy="${y(r.qty)}" r="1.8" fill="${line}"></circle></svg>`;
}

// ---------- shell pieces ----------
function contextBar(T, opts = {}) {
  return `<div style="display: flex; align-items: center; height: 32px; padding: 0 8px; gap: 12px; background: ${T.chrome}; border-bottom: 1px solid ${T.ruleS}; flex: none">
    <div style="display: flex; align-items: center; gap: 8px; width: 224px">
      ${icon('panel', T.ink2)}
      <div style="display: flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 500; color: ${T.ink2}">
        ${(opts.crumbs ?? ['Inventory', 'Warehouse 4']).map((c, i, a) => i < a.length - 1 ? `<span>${c}</span>${icon('chevR', T.ink3, 12)}` : `<span style="color: ${T.ink1}">${c}</span>`).join('')}
      </div>
    </div>
    <div style="display: flex; align-items: center; gap: 8px; width: 320px; height: 24px; padding: 0 8px; border: 1px solid ${T.ruleS}; border-radius: 4px; background: ${T.pane}; color: ${T.ink3}; font-size: 12px">
      ${icon('search', T.ink3, 14)}<span style="flex: 1">Search or run a command</span>${kbd('Ctrl K', T)}
    </div>
    <div style="flex: 1"></div>
    ${opts.noContext ? '' : `<div style="display: flex; align-items: center; gap: 8px">
      ${btnQuiet('Adjust stock', T)}${btnQuiet('Move to bay', T)}${btnQuiet('Reorder', T)}
    </div>`}
    <div style="display: flex; align-items: center; gap: 4px; padding-left: 8px; border-left: 1px solid ${T.ruleS}">
      <div style="position: relative; display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 4px; ${opts.bellOpen ? `background: ${T.selected}` : ''}">${icon('bell', T.ink2)}${badge(3, T)}</div>
      <div style="display: flex; align-items: center; justify-content: center; width: 24px; height: 24px">${icon('gear', T.ink2)}</div>
    </div>
  </div>`;
}

// focused: the region that holds keyboard focus (F6 / Shift+F6) draws a 2px --accent-solid inset rule
// along the header's top edge, on --surface-raised, and its title goes to ink primary.
const paneHeader = (title, T, right = '', focused = false) =>
  `<div style="display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 8px; background: ${T.chrome}; border-bottom: 1px solid ${T.ruleS}; flex: none; ${focused ? `box-shadow: inset 0 2px 0 ${T.accent}` : ''}">
    <span style="flex: 1; font-size: 12px; font-weight: 500; color: ${focused ? T.ink1 : T.ink2}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${title}</span>${right}
    ${icon('more', T.ink3)}</div>`;

function navItem(T, { label, iconName, initial = '', depth = 0, current = false, count = '', warn = false, open = null }) {
  const bg = current ? T.wash : 'transparent';
  const color = current ? T.ink1 : T.ink2;
  const chevron = open === null ? '<span style="width: 12px; flex: none"></span>' : icon(open ? 'chevD' : 'chevR', T.ink3, 12);
  const badge = count ? `<span style="font-size: 11px; color: ${warn ? T.warnText : T.ink3}; font-weight: ${warn ? 600 : 400}; font-variant-numeric: tabular-nums">${count}</span>` : '';
  return `<div style="display: flex; align-items: center; gap: 6px; height: 28px; padding: 0 8px 0 ${8 + depth * 14}px; margin: 0 4px; border-radius: 4px; background: ${bg}; color: ${color}; font-size: 12px; font-weight: ${current ? 600 : 500}">
    ${chevron}${iconName ? icon(iconName, current ? T.accent : T.ink3) : initial ? tile(initial, T) : ''}<span style="flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${label}</span>${badge}</div>`;
}

// loadedOnly: the plugin-manager screen lists only plugins that are actually loaded (Shipments is
// incompatible and Supplier portal failed its file check there, so neither contributes navigation).
function pane1(T, currentKey = 'wh4', { loadedOnly = false, focused = false } = {}) {
  const c = (k) => currentKey === k;
  return `<div style="display: flex; flex-direction: column; width: 240px; background: ${T.pane}; flex: none">
    ${paneHeader('Workspace', T, '', focused)}
    <div style="display: flex; flex-direction: column; gap: 2px; padding: 8px 0">
      ${navItem(T, { label: 'Inventory', iconName: 'box', open: true })}
      ${navItem(T, { label: 'Warehouse 4', depth: 1, current: c('wh4'), count: '128' })}
      ${navItem(T, { label: 'Warehouse 7', depth: 1, count: '96' })}
      ${navItem(T, { label: 'Below reorder point', depth: 1, count: '6', warn: true })}
      ${navItem(T, { label: 'Open purchase orders', depth: 1, count: '14' })}
      ${loadedOnly ? '' : navItem(T, { label: 'Shipments', iconName: 'truck', open: false })}
      ${navItem(T, { label: 'Mail', iconName: 'mail', open: false, count: '12' })}
      ${loadedOnly ? '' : navItem(T, { label: 'Supplier portal', iconName: 'building', open: false })}
      ${navItem(T, { label: 'Quality checks', initial: 'Q', open: false })}
    </div>
    <div style="flex: 1"></div>
    <div style="border-top: 1px solid ${T.ruleS}; padding: 6px 0">
      ${navItem(T, { label: 'Plugins', iconName: 'puzzle', current: c('plugins'), count: '6' })}
    </div>
  </div>`;
}

function listRow(r, T, focusRing = false) {
  const bg = r.sel ? T.selected : T.pane;
  const status = r.low ? `<span style="display: inline-flex; align-items: center; gap: 3px; color: ${T.warnText}; font-weight: 600">${icon('alert', T.warning, 11)}Below reorder point</span><span>·</span>` : '';
  const ring = focusRing && r.sel ? `outline: 2px solid ${T.accent}; outline-offset: -2px;` : '';
  return `<div style="display: flex; align-items: center; gap: 12px; height: 32px; padding: 0 8px 0 12px; background: ${bg}; border-bottom: 1px solid ${T.sunken}; ${ring}">
    <div style="display: flex; flex-direction: column; flex: 1; min-width: 0">
      <span style="font-size: 12px; line-height: 15px; font-weight: ${r.sel ? 600 : 400}; color: ${T.ink1}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${r.t}</span>
      <span style="display: flex; gap: 4px; font-size: 11px; line-height: 14px; color: ${T.ink3}; font-variant-numeric: tabular-nums; white-space: nowrap">${status}<span>${r.sku}</span></span>
    </div>
    ${spark(r, T)}
    <span style="width: 44px; text-align: right; font-size: 12px; color: ${r.low ? T.warnText : T.ink1}; font-weight: ${r.low ? 600 : 400}; font-variant-numeric: tabular-nums">${r.qty.toLocaleString('en-US')}</span>
  </div>`;
}

function pane2(T, rows = rowsData, width = 360, focused = false) {
  return `<div style="display: flex; flex-direction: column; width: ${width}px; background: ${T.pane}; flex: none; overflow: hidden">
    ${paneHeader('Warehouse 4', T, `<span style="font-size: 11px; color: ${T.ink3}; font-variant-numeric: tabular-nums">128 items</span>`, focused)}
    <div style="display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 8px; border-bottom: 1px solid ${T.ruleS}; flex: none">
      <div style="display: flex; align-items: center; gap: 6px; flex: 1; height: 24px; padding: 0 8px; border: 1px solid ${T.ruleD}; border-radius: 4px; color: ${T.ink3}; font-size: 12px">${icon('filter', T.ink3, 14)}Filter items</div>
      <span style="font-size: 11px; color: ${T.ink3}">Stock, low first</span>
    </div>
    <div style="display: flex; justify-content: space-between; padding: 6px 8px 4px 12px; font-size: 11px; color: ${T.ink3}"><span>Item</span><span style="display: flex; gap: 12px"><span style="width: 64px">30 days</span><span style="width: 44px; text-align: right">On hand</span></span></div>
    ${rows.map((r) => listRow(r, T, focused)).join('')}
  </div>`;
}

function chartBlock(T, width, endQty = 412) {
  const r = rowsData[0];
  const s = series(11, 30, 520, -0.02); s[29] = endQty;
  const w = width - 72, h = 150, max = 700;
  const y = (v) => (h - (v / max) * h).toFixed(1);
  const pts = s.map((v, i) => `${((i / 29) * w).toFixed(1)},${y(v)}`).join(' ');
  const grid = [0, 200, 400, 600].map((v) => `<line x1="0" x2="${w}" y1="${y(v)}" y2="${y(v)}" stroke="${T.grid}" stroke-width="1"></line><text x="-8" y="${+y(v) + 4}" text-anchor="end" font-size="11" fill="${T.label}">${v}</text>`).join('');
  const days = ['19 Aug', '26 Aug', '2 Sep', '9 Sep', '16 Sep'].map((d, i) => `<text x="${(i / 4) * w}" y="${h + 18}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}" font-size="11" fill="${T.label}">${d}</text>`).join('');
  return `<section style="display: flex; flex-direction: column; gap: 8px">
    <div style="display: flex; align-items: baseline; justify-content: space-between">
      <h3 style="margin: 0; font-size: 12px; font-weight: 500; color: ${T.ink1}">Stock on hand, last 30 days</h3>
      <span style="display: flex; align-items: center; gap: 12px; font-size: 11px; color: ${T.ink3}">
        <span style="display: flex; align-items: center; gap: 4px"><span style="width: 12px; height: 2px; background: ${T.chart1}"></span>On hand</span>
        <span style="display: flex; align-items: center; gap: 4px"><span style="width: 12px; height: 0; border-top: 1px dashed ${T.warning}"></span>Reorder point</span>
        ${icon('more', T.ink3)}</span>
    </div>
    <svg width="${width}" height="${h + 26}" viewBox="-40 0 ${width} ${h + 26}" style="display: block; font-family: ${FONT}; font-variant-numeric: tabular-nums">
      ${grid}
      <rect x="0" y="${y(r.thr)}" width="${w}" height="${(h - +y(r.thr)).toFixed(1)}" fill="${T.warnSub}"></rect>
      <line x1="0" x2="${w}" y1="${y(r.thr)}" y2="${y(r.thr)}" stroke="${T.warning}" stroke-width="1" stroke-dasharray="4 3"></line>
      <polyline points="${pts}" fill="none" stroke="${T.chart1}" stroke-width="1.75" stroke-linejoin="round"></polyline>
      <circle cx="${w}" cy="${y(endQty)}" r="3" fill="${T.chart1}"></circle>
      ${days}
    </svg>
  </section>`;
}

function movementsBlock(T, extra = []) {
  const rows = [
    ...extra,
    ['17 Sep 16:02', 'Picked', 'Order 88213', '−24', 'R. Okafor'],
    ['17 Sep 11:40', 'Picked', 'Order 88190', '−36', 'R. Okafor'],
    ['16 Sep 09:15', 'Received', 'PO 5512, Nordpack', '+240', 'J. Varga'],
    ['15 Sep 14:28', 'Adjusted', 'Cycle count', '−3', 'M. Lindqvist'],
    ['15 Sep 08:51', 'Picked', 'Order 88011', '−48', 'S. Duarte'],
  ];
  const th = (t, a = 'left') => `<th style="text-align: ${a}; font-weight: 400; font-size: 11px; color: ${T.ink3}; padding: 0 8px 4px 0; border-bottom: 1px solid ${T.ruleS}">${t}</th>`;
  const td = (t, a = 'left', c = T.ink1) => `<td style="text-align: ${a}; padding: 0 8px 0 0; height: 28px; font-size: 12px; color: ${c}; border-bottom: 1px solid ${T.sunken}">${t}</td>`;
  return `<section style="display: flex; flex-direction: column; gap: 8px">
    <div style="display: flex; align-items: baseline; justify-content: space-between">
      <h3 style="margin: 0; font-size: 12px; font-weight: 500; color: ${T.ink1}">Recent movements</h3>
      <span style="font-size: 11px; color: ${T.accent}">View all ${214 + extra.length}</span>
    </div>
    <table style="width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums">
      <thead><tr>${th('When')}${th('Type')}${th('Reference')}${th('Quantity', 'right')}${th('By')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${td(r[0], 'left', T.ink3)}${td(r[1])}${td(r[2])}${td(r[3], 'right', r[3].startsWith('+') ? T.successText : T.ink1)}${td(r[4], 'left', T.ink2)}</tr>`).join('')}</tbody>
    </table>
  </section>`;
}

function pane3(T, width, { selection = false, focused = false, legend = false, undo = false } = {}) {
  const onHand = undo ? 520 : 412;
  const facts = [['On hand', String(onHand)], ['Reorder point', '150'], ['On order', '0'], ['Daily use, 30-day avg', '14.2'], ['Days of cover', '29']];
  return `<div style="position: relative; display: flex; flex-direction: column; flex: 1; min-width: 0; background: ${T.pane}">
    ${paneHeader('Item', T, '', focused)}
    <div style="display: flex; flex-direction: column; gap: 20px; padding: 16px 20px; flex: 1; overflow: hidden">
      <div style="display: flex; flex-direction: column; gap: 4px">
        <h2 style="margin: 0; font-size: 13px; font-weight: 600; color: ${T.ink1}">Pallet wrap, 500mm</h2>
        <span style="font-size: 11px; color: ${T.ink3}; font-variant-numeric: tabular-nums">SKU 40-1182 · Aisle 12, bay 3 · Supplier Nordpack AB</span>
      </div>
      <dl style="display: flex; gap: 28px; margin: 0; padding: 8px 0; border-top: 1px solid ${T.ruleS}; border-bottom: 1px solid ${T.ruleS}">
        ${facts.map(([k, v]) => `<div style="display: flex; flex-direction: column; gap: 2px"><dt style="font-size: 11px; color: ${T.ink3}">${k}</dt><dd style="margin: 0; font-size: 12px; font-weight: 500; color: ${T.ink1}; font-variant-numeric: tabular-nums">${v}</dd></div>`).join('')}
      </dl>
      ${chartBlock(T, width - 40, onHand)}
      ${movementsBlock(T, undo ? REVERSALS : [])}
    </div>
    ${selection ? floatingToolbar(T) : ''}${undo ? undoStrip(T) : ''}${legend ? regionLegend(T) : ''}
    <div style="display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: ${T.chrome}; border-top: 1px solid ${T.ruleS}; flex: none">
      <div style="display: flex; align-items: center; gap: 8px; flex: 1; height: 28px; padding: 0 8px; border: 1px solid ${T.ruleD}; border-radius: 4px; background: ${T.pane}; font-size: 12px; color: ${T.ink3}">Ask about this item</div>
      <span style="display: flex; align-items: center; gap: 4px; font-size: 11px; color: ${T.ink3}">${kbd('Enter', T)} to run</span>
    </div>
  </div>`;
}

function floatingToolbar(T) {
  return `<div style="position: absolute; left: 232px; top: 388px; display: flex; align-items: center; gap: 2px; height: 32px; padding: 0 4px; background: ${T.pane}; border: 1px solid ${T.ruleS}; border-radius: 4px; box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.12), 0 4px 10px -2px rgb(0 0 0 / 0.16)">
    <span style="padding: 0 8px; font-size: 11px; color: ${T.ink3}; font-variant-numeric: tabular-nums">3 rows selected</span>
    <span style="width: 1px; height: 16px; background: ${T.ruleS}"></span>
    ${['Reverse movement', 'Export rows', 'Copy'].map((l, i) => `<span style="display: flex; align-items: center; gap: 6px; height: 24px; padding: 0 8px; border-radius: 2px; font-size: 12px; font-weight: 500; color: ${T.ink1}; ${i === 0 ? `background: ${T.hover}` : ''}">${l}${i === 0 ? kbd('Shift R', T) : ''}</span>`).join('')}
  </div>`;
}

function doc(T, body, extraStyle = '') {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>
    body { margin: 0; font-family: ${FONT}; background: ${T.frame}; -webkit-font-smoothing: antialiased; }
    a { color: ${T.accent}; } a:hover { color: ${T.accentDeep}; }
    ${extraStyle}
  </style>
</helmet>
<div style="zoom: ${ZOOM}; position: relative; width: ${W}px; height: ${H}px; display: flex; flex-direction: column; background: ${T.frame}; color: ${T.ink1}; font-family: ${FONT}; overflow: hidden">
${body}
</div>
</x-dc>
</body>
</html>
`;
}

const SHADOW_OVERLAY = '0 1px 2px 0 rgb(0 0 0 / 0.12), 0 4px 10px -2px rgb(0 0 0 / 0.16)'; // --shadow-overlay
const SHADOW_POPOVER = '0 2px 4px 0 rgb(0 0 0 / 0.1), 0 8px 20px -4px rgb(0 0 0 / 0.18)'; // --shadow-popover

// The three compensating movements a Shift+R reversal writes (newest first).
const REVERSALS = [
  ['18 Sep 10:12', 'Reversed', 'Order 88213', '+24', 'You'],
  ['18 Sep 10:12', 'Reversed', 'Order 88190', '+36', 'You'],
  ['18 Sep 10:12', 'Reversed', 'Order 88011', '+48', 'You'],
];

// Undo strip: floats over pane 3 after a reversible command runs; overlay shadow, quiet Undo.
function undoStrip(T) {
  return `<div style="position: absolute; left: 50%; bottom: 60px; transform: translateX(-50%); display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 4px 0 12px; background: ${T.pane}; border: 1px solid ${T.ruleS}; border-radius: 4px; box-shadow: ${SHADOW_OVERLAY}; white-space: nowrap">
    <span style="font-size: 12px; color: ${T.ink1}">3 movements reversed. On hand is now <span style="font-variant-numeric: tabular-nums; font-weight: 500">520</span>.</span>
    ${btnQuiet(`${icon('undo', T.ink2, 14)}Undo${kbd('Ctrl Z', T)}`, T)}
    <span style="display: flex; align-items: center; justify-content: center; width: 24px; height: 24px">${icon('x', T.ink3, 12)}</span>
  </div>`;
}

// Legend for keyboard regions. An annotation on the canvas, not product UI: dashed rule, no shadow.
function regionLegend(T) {
  const line = (k, t) => `<span style="display: flex; align-items: center; gap: 6px">${k}<span>${t}</span></span>`;
  return `<div style="position: absolute; right: 20px; bottom: 60px; width: 300px; display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; background: ${T.pane}; border: 1px dashed ${T.ruleD}; border-radius: 4px; font-size: 11px; line-height: 15px; color: ${T.ink2}">
    <span style="font-weight: 600; color: ${T.ink1}">Annotation: keyboard regions (D-37)</span>
    <span style="display: flex; gap: 12px">${line(kbd('F6', T), 'Next region')}${line(kbd('Shift F6', T), 'Previous region')}</span>
    <span>Order: context bar, Workspace, Warehouse 4, Item, composer.</span>
    <span style="display: flex; align-items: center; gap: 8px"><span style="width: 56px; height: 14px; flex: none; background: ${T.chrome}; box-shadow: inset 0 2px 0 ${T.accent}; border-bottom: 1px solid ${T.ruleS}"></span>Focused region: 2px petrol rule on its header</span>
    <span>Here the list has focus; its current row carries the focus ring.</span>
  </div>`;
}

const shellBody = (T, { p1 = pane1(T), p2 = pane2(T), p3w = W - 240 - 360 - 2, p3 = null, bar = contextBar(T) } = {}) =>
  `${bar}
  <div style="display: flex; flex: 1; gap: 1px; min-height: 0; background: ${T.frame}">
    ${p1}${p2}${p3 ?? pane3(T, p3w)}
  </div>`;

// ---------- 1 + 5: shell at rest, light and dark (the list region holds focus) ----------
const restBody = (T) => shellBody(T, { p2: pane2(T, rowsData, 360, true), p3: pane3(T, W - 240 - 360 - 2, { legend: true }) });
writeFileSync('Main.dc.html', doc(LIGHT, restBody(LIGHT)));
writeFileSync('ShellDark.dc.html', doc(DARK, restBody(DARK)));

// ---------- 2: command palette ----------
const palRow = (T, label, sub, sc, active = false, ic = 'box') => `<div style="display: flex; align-items: center; gap: 10px; height: 32px; padding: 0 12px; margin: 0 4px; border-radius: 4px; background: ${active ? T.wash : 'transparent'}">
      ${ic === 'Q' ? tile('Q', T) : icon(ic, active ? T.accent : T.ink3)}
      <span style="flex: 1; min-width: 0; font-size: 12px; color: ${T.ink1}; font-weight: ${active ? 500 : 400}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${label}${sub ? `<span style="color: ${T.ink3}; font-weight: 400"> · ${sub}</span>` : ''}</span>
      ${sc ? kbd(sc, T) : ''}</div>`;
const palGroup = (T, name) => `<div style="padding: 8px 16px 4px; font-size: 11px; font-weight: 500; color: ${T.ink3}">${name}</div>`;
const caret = (T) => `<span style="display: inline-block; width: 1px; height: 15px; margin-left: 1px; vertical-align: -3px; background: ${T.accent}"></span>`;

function paletteBox(T, { query, meta = '', body, enterLabel, pos = '' }) {
  const q = query ? `<span style="flex: 1; font-size: 13px; color: ${T.ink1}">${query}${caret(T)}</span>`
    : `<span style="flex: 1; font-size: 13px; color: ${T.ink3}">${caret(T)}Search or run a command</span>`;
  return `<div style="${pos || 'position: relative'}; width: 512px; display: flex; flex-direction: column; background: ${T.pane}; border-radius: 4px; box-shadow: ${SHADOW_POPOVER}; overflow: hidden">
    <div style="display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 16px; border-bottom: 1px solid ${T.ruleS}">
      ${icon('search', T.ink2)}${q}
      <span style="font-size: 11px; color: ${T.ink3}; font-variant-numeric: tabular-nums">${meta}</span>
    </div>
    <div style="display: flex; flex-direction: column; padding: 4px 0 8px">${body}</div>
    <div style="display: flex; align-items: center; gap: 16px; height: 32px; padding: 0 16px; background: ${T.chrome}; border-top: 1px solid ${T.ruleS}; font-size: 11px; color: ${T.ink3}">
      <span style="display: flex; align-items: center; gap: 6px; min-width: 0; white-space: nowrap">${kbd('Enter', T)}<span style="color: ${T.ink2}">${enterLabel}</span></span>
      <span style="flex: 1"></span>
      <span style="display: flex; align-items: center; gap: 6px">${kbd('↑', T)}${kbd('↓', T)}Move</span>
      <span style="display: flex; align-items: center; gap: 6px">${kbd('Esc', T)}Close</span>
    </div>
  </div>`;
}

function palette(T) {
  const body = `${palGroup(T, 'Inventory')}
      ${palRow(T, 'Reorder selected item', 'Pallet wrap, 500mm', 'Ctrl Shift O', true)}
      ${palRow(T, 'Open reorder queue', '', '')}
      ${palRow(T, 'Show items below reorder point', '6 items', '')}
      ${palRow(T, 'Export reorder report', 'CSV', '')}
      ${palGroup(T, 'Supplier portal')}
      ${palRow(T, 'Reorder history for Nordpack AB', '', '', false, 'building')}
      ${palGroup(T, 'ShellUX')}
      ${palRow(T, 'Open plugin manager', '', '', false, 'puzzle')}`;
  return `<div style="position: absolute; inset: 0; background: rgb(0 0 0 / 0.32)"></div>
  ${paletteBox(T, { query: 'reor', meta: '6 results', body, enterLabel: 'Reorder Pallet wrap, 500mm', pos: `position: absolute; left: ${(W - 512) / 2}px; top: 96px` })}`;
}
writeFileSync('Palette.dc.html', doc(LIGHT, shellBody(LIGHT) + palette(LIGHT)));

// ---------- 7: palette states (zero query, no match, inline failure, palette-only command) ----------
function paletteStates(T) {
  const cell = (caption, box) => `<div style="display: flex; flex-direction: column; gap: 8px"><span style="font-size: 11px; font-weight: 500; color: ${T.ink3}">${caption}</span>${box}</div>`;
  const recent = paletteBox(T, { query: '', body: `${palGroup(T, 'Recent')}
      ${palRow(T, 'Reorder selected item', 'Pallet wrap, 500mm', 'Ctrl Shift O', true)}
      ${palRow(T, 'Move to bay', 'Pallet wrap, 500mm', '')}
      ${palRow(T, 'Open Warehouse 7', '', '')}
      ${palRow(T, 'Show items below reorder point', '6 items', '')}
      ${palRow(T, 'Open plugin manager', '', '', false, 'puzzle')}`, enterLabel: 'Reorder Pallet wrap, 500mm' });
  const noMatch = paletteBox(T, { query: 'reodrer queue', meta: '0 results', body: `
      <div style="padding: 8px 16px 4px; font-size: 12px; line-height: 17px; color: ${T.ink1}">No command matches “reodrer queue”.</div>
      ${palGroup(T, 'Closest command')}
      ${palRow(T, 'Open reorder queue', 'Inventory', '', true)}`, enterLabel: 'Open reorder queue' });
  const failed = paletteBox(T, { query: 'export reorder', meta: '2 results', body: `${palGroup(T, 'Inventory')}
      ${palRow(T, 'Export reorder report', 'CSV', '', true)}
      <div style="display: flex; gap: 10px; margin: 4px 8px; padding: 10px 12px; background: ${T.dangerSub}; border-radius: 4px">
        ${icon('stop', T.danger)}
        <div style="display: flex; flex-direction: column; gap: 2px; min-width: 0">
          <span style="font-size: 12px; font-weight: 600; color: ${T.dangerText}">Export reorder report failed</span>
          <span style="font-size: 12px; line-height: 17px; color: ${T.ink1}">The Inventory plugin did not answer within 10 seconds. Nothing was exported.</span>
        </div>
      </div>
      ${palRow(T, 'Export movements for this item', 'CSV', '')}`, enterLabel: 'Try again' });
  const plugin = paletteBox(T, { query: 'plugin', meta: '3 results', body: `${palGroup(T, 'ShellUX')}
      ${palRow(T, 'Open plugin manager', '', '', true, 'puzzle')}
      ${palRow(T, 'Install plugin from file', '', '', false, 'upload')}
      ${palRow(T, 'Check for plugin updates', '', '', false, 'refresh')}`, enterLabel: 'Open plugin manager' });
  return `<div style="display: grid; grid-template-columns: 512px 512px; justify-content: center; align-content: start; gap: 40px 72px; padding: 40px 32px; height: 100%; box-sizing: border-box">
    ${cell('Zero query: Recent, the active row ready for Enter', recent)}
    ${cell('No match: says what was searched, offers the closest command', noMatch)}
    ${cell('Command failed: reported inline, the palette stays open', failed)}
    ${cell('Plugin manager: palette-only, no shortcut of its own', plugin)}
  </div>`;
}
writeFileSync('PaletteStates.dc.html', doc(LIGHT, paletteStates(LIGHT)));

// ---------- 3: plugin manager (five states, D-48) ----------
function pluginManager(T) {
  // On: --accent-subtle track, --accent-border rule, --accent-solid knob. Off: pane track, default rule, default knob.
  // Forced off (not loadable): subtle track, hover knob, no rule.
  const sw = (on, dis = false) => {
    const track = dis ? `background: ${T.subtle}` : on ? `background: ${T.wash}; box-shadow: inset 0 0 0 1px ${T.accentBorder}` : `background: ${T.pane}; box-shadow: inset 0 0 0 1px ${T.ruleD}`;
    const knob = dis ? T.hover : on ? T.accent : T.ruleD;
    return `<span style="position: relative; display: inline-block; width: 28px; height: 16px; border-radius: 8px; ${track}"><span style="position: absolute; top: 3px; left: ${on && !dis ? 15 : 3}px; width: 10px; height: 10px; border-radius: 5px; background: ${knob}"></span></span>`;
  };
  const plugins = [
    { ic: 'box', name: 'Inventory', pub: 'LEAPWare Operations', ver: '2.4.0', contract: '1.0', on: true, state: 'ok', note: 'Loaded in 184 ms' },
    { ic: 'mail', name: 'Mail', pub: 'LEAPWare Operations', ver: '1.3.2', contract: '1.0', on: true, state: 'ok', note: 'Loaded in 96 ms' },
    { ic: 'printer', name: 'Label printing', pub: 'LEAPWare Operations', ver: '1.0.4', contract: '1.0', on: false, state: 'off', note: 'Turned off on 10 Sep. Its panes and commands stay hidden until it is turned on.' },
    { ic: 'truck', name: 'Shipments', pub: 'LEAPWare Logistics', ver: '0.9.1', contract: '0.4', on: false, state: 'incompatible', note: 'Built for plugin contract 0.4. This shell runs contract 1.0, so it is not loaded. Install Shipments 1.0 or later.' },
    { ic: 'building', name: 'Supplier portal', pub: 'LEAPWare Procurement', ver: '1.1.0', contract: '1.0', on: false, state: 'files', note: 'The files for Supplier portal no longer match what was installed on 12 Sep, so it was not loaded. Reinstalling replaces them from the original package.' },
    { initial: 'Q', name: 'Quality checks', pub: 'LEAPWare Quality', ver: '0.8.0', contract: '1.0', on: true, state: 'crashed', note: 'Stopped responding at 09:41 while loading Inspections. Panes from other plugins kept running.' },
  ];
  const statusCell = (p) => ({
    ok: `<span style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: ${T.successText}"><span style="width: 6px; height: 6px; border-radius: 3px; background: ${T.success}"></span>Running</span>`,
    off: `<span style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: ${T.ink2}"><span style="width: 6px; height: 6px; box-sizing: border-box; border-radius: 3px; border: 1px solid ${T.ruleD}"></span>Turned off</span>`,
    incompatible: `<span style="display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: ${T.warnText}">${icon('alert', T.warning, 14)}Incompatible</span>`,
    files: `<span style="display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: ${T.dangerText}">${icon('shieldX', T.danger, 14)}Files changed</span>`,
    crashed: `<span style="display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: ${T.dangerText}">${icon('stop', T.danger, 14)}Crashed</span>`,
  })[p.state];
  const rowBg = (p) => (p.state === 'crashed' || p.state === 'files') ? T.dangerSub : p.state === 'incompatible' ? T.warnSub : T.pane;
  const noteInk = (p) => (p.state === 'crashed' || p.state === 'files') ? T.dangerText : p.state === 'incompatible' ? T.warnText : T.ink3;
  // One Primary Rule: Reinstall is the surface's one primary; Restart on the crashed row is quiet here.
  const actions = (p) => ({
    ok: btnQuiet('Settings', T),
    off: btnQuiet('Remove', T),
    incompatible: `${btnQuiet('Find a 1.0 version', T)}${btnQuiet('Remove', T)}`,
    files: `${btnPrimary('Reinstall', T)}${btnQuiet('View details', T)}`,
    crashed: `${btnQuiet('Restart', T)}${btnQuiet('View log', T)}`,
  })[p.state];
  const grid = 'grid-template-columns: minmax(0, 1fr) 64px 64px 120px 52px 232px';
  const body = `<div style="display: flex; flex-direction: column; flex: 1; min-width: 0; background: ${T.pane}">
    ${paneHeader('Plugins', T, '', true)}
    <div style="display: flex; flex-direction: column; gap: 16px; padding: 16px 20px">
      <div style="display: flex; align-items: flex-end; justify-content: space-between">
        <div style="display: flex; flex-direction: column; gap: 4px">
          <h2 style="margin: 0; font-size: 13px; font-weight: 600">Installed plugins</h2>
          <span style="font-size: 11px; color: ${T.ink3}; font-variant-numeric: tabular-nums">Shell contract 1.0 · 6 installed · 1 turned off · 3 need attention</span>
        </div>
        <div style="display: flex; gap: 8px">${btnQuiet(`${icon('upload', T.ink2, 14)}Install from file`, T)}${btnQuiet(`${icon('refresh', T.ink2, 14)}Check for updates`, T)}</div>
      </div>
      <div style="display: flex; flex-direction: column; border-top: 1px solid ${T.ruleS}">
        <div style="display: grid; ${grid}; gap: 16px; align-items: center; height: 28px; padding: 0 12px; font-size: 11px; color: ${T.ink3}; border-bottom: 1px solid ${T.ruleS}">
          <span>Plugin</span><span>Version</span><span>Contract</span><span>Status</span><span>Enabled</span><span></span></div>
        ${plugins.map((p) => `<div style="display: flex; flex-direction: column; background: ${rowBg(p)}; border-bottom: 1px solid ${T.ruleS}">
          <div style="display: grid; ${grid}; gap: 16px; align-items: center; min-height: 44px; padding: 6px 12px">
            <span style="display: flex; align-items: center; gap: 10px; min-width: 0">
              ${p.ic ? `<span style="display: flex; align-items: center; justify-content: center; flex: none; width: 28px; height: 28px; box-sizing: border-box; border-radius: 4px; background: ${T.chrome}; border: 1px solid ${T.ruleS}">${icon(p.ic, T.ink2)}</span>` : `<span style="display: flex; align-items: center; justify-content: center; flex: none; width: 28px; height: 28px; border-radius: 4px; background: ${T.subtle}; color: ${T.ink2}; font-size: 13px; font-weight: 600">${p.initial}</span>`}
              <span style="display: flex; flex-direction: column; min-width: 0"><span style="font-size: 12px; font-weight: 500; color: ${T.ink1}">${p.name}</span><span style="font-size: 11px; color: ${T.ink3}">${p.pub}</span></span>
            </span>
            <span style="font-size: 12px; font-variant-numeric: tabular-nums">${p.ver}</span>
            <span style="font-size: 12px; font-variant-numeric: tabular-nums; ${p.state === 'incompatible' ? `color: ${T.warnText}; font-weight: 600` : ''}">${p.contract}</span>
            ${statusCell(p)}
            ${sw(p.on, p.state === 'incompatible' || p.state === 'files')}
            <span style="display: flex; justify-content: flex-end; gap: 8px">${actions(p)}</span>
          </div>
          <div style="max-width: 72ch; padding: 0 12px 10px 50px; font-size: 11px; line-height: 15px; color: ${noteInk(p)}">${p.note}</div>
        </div>`).join('')}
      </div>
      <div style="display: flex; align-items: center; gap: 8px; padding: 10px 12px; border: 1px solid ${T.ruleS}; border-radius: 4px; font-size: 11px; line-height: 15px; color: ${T.ink3}">
        ${icon('puzzle', T.ink3, 14)}Plugins are LEAPWare modules. A plugin runs in the extension surface alongside the others: a crash is contained to its panes, but plugins are not isolated from each other.
      </div>
    </div>
  </div>`;
  return shellBody(T, { p1: pane1(T, 'plugins', { loadedOnly: true }), p2: '', p3: body, bar: contextBar(T, { noContext: true, crumbs: ['ShellUX', 'Plugins'] }) });
}
writeFileSync('PluginManager.dc.html', doc(LIGHT, pluginManager(LIGHT)));

// ---------- 4: states board ----------
function states(T) {
  const panel = (caption, inner) => `<div style="display: flex; flex-direction: column; gap: 8px; min-width: 0">
    <span style="font-size: 11px; font-weight: 500; color: ${T.ink3}">${caption}</span>
    <div style="display: flex; flex-direction: column; flex: 1; background: ${T.pane}; border: 1px solid ${T.ruleS}; overflow: hidden">${inner}</div></div>`;
  const empty = `${paneHeader('Warehouse 9', T)}
    <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 32px 24px">
      <span style="font-size: 13px; font-weight: 600; color: ${T.ink1}">No stock recorded in Warehouse 9 yet</span>
      <span style="max-width: 320px; font-size: 12px; line-height: 17px; color: ${T.ink2}">Items appear here when a goods receipt is posted against this warehouse. Existing stock can be moved in from another warehouse.</span>
      <div style="display: flex; gap: 8px; margin-top: 8px">${btnPrimary('Post goods receipt', T)}${btnQuiet('Move stock in', T)}</div>
    </div>`;
  const skel = (w) => `<div style="display: flex; align-items: center; gap: 12px; height: 32px; padding: 0 12px"><div style="display: flex; flex-direction: column; gap: 5px; flex: 1"><span style="width: ${w}%; height: 8px; border-radius: 2px; background: ${T.skeleton}"></span><span style="width: ${w / 2}%; height: 6px; border-radius: 2px; background: ${T.skeleton}"></span></div><span style="width: 64px; height: 14px; border-radius: 2px; background: ${T.skeleton}"></span><span style="width: 36px; height: 8px; border-radius: 2px; background: ${T.skeleton}"></span></div>`;
  const loading = `${paneHeader('Warehouse 4', T, `<span style="font-size: 11px; color: ${T.ink3}">Loading</span>`)}<div style="height: 2px; background: ${T.wash}"><div style="width: 38%; height: 2px; background: ${T.accent}"></div></div>${[72, 58, 80, 64, 50, 76, 60].map(skel).join('')}`;
  // Banners: status wash, no border, no side stripe; mark plus words.
  const banner = (sub, mark, title, titleInk, text, actions = '') => `<div style="display: flex; gap: 10px; padding: 10px 12px; background: ${sub}; border-radius: 4px">
        ${mark}
        <div style="display: flex; flex-direction: column; gap: 4px; flex: 1; min-width: 0">
          <span style="font-size: 12px; font-weight: 600; color: ${titleInk}">${title}</span>
          <span style="font-size: 12px; line-height: 17px; color: ${T.ink1}">${text}</span>${actions}
        </div>
      </div>`;
  const dot = (c) => `<span style="display: flex; align-items: center; justify-content: center; width: 16px; height: 16px; flex: none"><span style="width: 6px; height: 6px; border-radius: 3px; background: ${c}"></span></span>`;
  const error = `${paneHeader('Item', T)}
    <div style="display: flex; flex-direction: column; gap: 8px; padding: 12px">
      ${banner(T.dangerSub, icon('stop', T.danger), 'Recent movements could not be loaded', T.dangerText, 'The Inventory plugin did not answer within 10 seconds. The rest of this item is current.', `<div style="display: flex; gap: 8px; margin-top: 4px">${btnQuiet('Try again', T)}${btnQuiet('Copy details', T, 'border-color: transparent; background: transparent')}</div>`)}
      ${banner(T.warnSub, icon('alert', T.warning), 'Below reorder point', T.warnText, 'On hand 96 is under the reorder point of 120.')}
      ${banner(T.succSub, dot(T.success), 'Purchase order 5530 sent', T.successText, 'Nordpack AB confirms by email.')}
      ${banner(T.infoSub, dot(T.info), 'Counts refresh every 5 minutes', T.info, 'Last refreshed at 10:05.')}
    </div>`;
  const btnRow = (label, style) => `<div style="display: flex; flex-direction: column; align-items: flex-start; gap: 6px"><span style="font-size: 11px; color: ${T.ink3}">${label}</span>${style}</div>`;
  const prim = (bg, extra = '') => `<div style="display: flex; align-items: center; height: 24px; padding: 0 12px; border-radius: 4px; background: ${bg}; color: ${T.onAccent}; font-size: 12px; font-weight: 500; ${extra}">Reorder</div>`;
  const controls = `<div style="display: flex; flex-direction: column; gap: 16px; padding: 16px 20px">
    <div style="display: flex; gap: 12px 20px; flex-wrap: wrap">
      ${btnRow('Default', btnPrimary('Reorder', T))}
      ${btnRow('Hover', prim(T.accentDeep))}
      ${btnRow('Pressed', prim(T.accentDeep, `box-shadow: inset 0 0 0 1px ${T.accentBorder}`))}
      ${btnRow('Focus', prim(T.accent, `outline: 2px solid ${T.accent}; outline-offset: 1px; box-shadow: 0 0 0 1px ${T.pane}`))}
      ${btnRow('Disabled', `<div style="display: flex; align-items: center; height: 24px; padding: 0 12px; border-radius: 4px; background: ${T.hover}; color: ${T.disabled}; font-size: 12px; font-weight: 500; border: 1px solid ${T.ruleS}">Reorder</div>`)}
      ${btnRow('Loading', `<div style="position: relative; display: flex; align-items: center; height: 24px; padding: 0 12px; border-radius: 4px; background: ${T.accent}; color: ${T.onAccent}; font-size: 12px; font-weight: 500; overflow: hidden">Reordering<span style="position: absolute; left: 0; bottom: 0; width: 55%; height: 2px; background: ${T.onAccent}"></span></div>`)}
    </div>
    <div style="display: flex; gap: 12px 20px; flex-wrap: wrap">
      ${btnRow('Quiet', btnQuiet('Adjust stock', T))}
      ${btnRow('Quiet, hover', btnQuiet('Adjust stock', T, `background: ${T.hover}`))}
      ${btnRow('Quiet, pressed', btnQuiet('Adjust stock', T, `background: ${T.selected}`))}
      ${btnRow('Quiet, focus', btnQuiet('Adjust stock', T, `outline: 2px solid ${T.accent}; outline-offset: 1px`))}
      ${btnRow('Quiet, disabled', btnQuiet('Adjust stock', T, `color: ${T.disabled}; border-color: ${T.ruleS}; background: ${T.hover}`))}
    </div>
    <div style="display: flex; gap: 20px">
      ${btnRow('Field, focus', `<div style="width: 140px; height: 24px; padding: 0 8px; display: flex; align-items: center; border: 1px solid ${T.ruleD}; border-radius: 4px; font-size: 12px; color: ${T.ink1}; outline: 2px solid ${T.accent}; outline-offset: 1px">150</div>`)}
      ${btnRow('Field, error', `<div style="display: flex; flex-direction: column; gap: 4px; width: 176px"><div style="width: 140px; height: 24px; padding: 0 8px; display: flex; align-items: center; border: 1px solid ${T.danger}; border-radius: 4px; font-size: 12px; color: ${T.ink1}">-20</div><span style="font-size: 11px; color: ${T.dangerText}">Enter a reorder point of 0 or more.</span></div>`)}
    </div>
  </div>`;
  const rowsStates = `<div style="display: flex; flex-direction: column">
    ${[['Default', T.pane, 400, ''], ['Hover', T.hover, 400, ''], ['Selected', T.selected, 600, ''], ['Keyboard focus', T.pane, 400, `outline: 2px solid ${T.accent}; outline-offset: -2px`]].map(([n, bg, fw, st]) => `<div style="display: flex; align-items: center; gap: 12px; height: 32px; padding: 0 12px; background: ${bg}; ${st}; border-bottom: 1px solid ${T.sunken}">
      <div style="display: flex; flex-direction: column; flex: 1"><span style="font-size: 12px; line-height: 15px; font-weight: ${fw}">Carton, double wall 600x400</span><span style="font-size: 11px; line-height: 14px; color: ${T.ink3}">40-0917</span></div>
      <span style="font-size: 11px; color: ${T.ink3}">${n}</span></div>`).join('')}
    <div style="display: flex; flex-direction: column; gap: 6px; padding: 12px">
      ${[['Below reorder point', T.warning, T.warnText, 'alert'], ['Delivered', T.success, T.successText, null], ['Delivery overdue', T.danger, T.dangerText, 'stop'], ['Awaiting supplier', T.info, T.info, null]].map(([t, c, tc, ic]) => `<span style="display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: ${tc}">${ic ? icon(ic, c, 14) : `<span style="width: 6px; height: 6px; margin: 0 4px; border-radius: 3px; background: ${c}"></span>`}${t}</span>`).join('')}
    </div>
  </div>`;
  return `<div style="display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-template-rows: repeat(2, minmax(0, 1fr)); gap: 24px; padding: 32px; height: 100%; box-sizing: border-box">
    ${panel('Empty, teaching', empty)}
    ${panel('Loading, skeleton rows and in-place bar', loading)}
    ${panel('Banners, inline in the block: error, warning, success, info', error)}
    ${panel('Buttons and fields: default, hover, pressed, focus, disabled, loading, error', controls)}
    ${panel('Rows and status vocabulary', rowsStates)}
    ${panel('Crashed plugin, in its own panes', `${paneHeader('Quality checks', T)}<div style="display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 32px 24px">${icon('stop', T.danger, 20)}<span style="font-size: 13px; font-weight: 600">Quality checks stopped responding</span><span style="max-width: 320px; font-size: 12px; line-height: 17px; color: ${T.ink2}">It stopped at 09:41 while loading Inspections. Your other plugins are unaffected. Restarting reloads only this plugin.</span><div style="display: flex; gap: 8px; margin-top: 8px">${btnPrimary('Restart plugin', T)}${btnQuiet('View log', T)}</div></div>`)}
  </div>`;
}
writeFileSync('States.dc.html', doc(LIGHT, states(LIGHT)));

// ---------- 8: notification popover ----------
function notifications(T) {
  const row = (mark, text, time, focus = false) => `<div style="display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 4px 0 12px; border-bottom: 1px solid ${T.sunken}; ${focus ? `outline: 2px solid ${T.accent}; outline-offset: -2px; background: ${T.hover}` : ''}">
      ${mark}<span style="flex: 1; min-width: 0; font-size: 12px; color: ${T.ink1}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">${text}</span>
      <span style="font-size: 11px; color: ${T.ink3}; font-variant-numeric: tabular-nums">${time}</span>
      <span style="display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; flex: none">${icon('x', T.ink3, 12)}</span></div>`;
  const pop = `<div style="position: absolute; right: 36px; top: 36px; width: 400px; display: flex; flex-direction: column; background: ${T.pane}; border-radius: 4px; box-shadow: ${SHADOW_POPOVER}; overflow: hidden; z-index: 3">
    <div style="display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 4px 0 12px; border-bottom: 1px solid ${T.ruleS}">
      <span style="flex: 1; font-size: 12px; font-weight: 500; color: ${T.ink1}">Notifications <span style="font-weight: 400; color: ${T.ink3}; font-variant-numeric: tabular-nums">3</span></span>
      ${btnQuiet('Clear all', T, 'border-color: transparent; background: transparent')}
    </div>
    ${row(icon('stop', T.danger, 14), '<span style="font-weight: 600; color: inherit">Quality checks</span> stopped responding', '09:41', true)}
    ${row(icon('alert', T.warning, 14), '6 items below reorder point in Warehouse 4', '08:30')}
    ${row(icon('box', T.ink3, 14), 'PO 5512 from Nordpack AB received', 'Tue')}
    <div style="display: flex; align-items: center; gap: 16px; height: 28px; padding: 0 12px; background: ${T.chrome}; font-size: 11px; color: ${T.ink3}">
      <span style="display: flex; align-items: center; gap: 6px">${kbd('Enter', T)}Open</span>
      <span style="display: flex; align-items: center; gap: 6px">${kbd('Del', T)}Clear</span>
      <span style="flex: 1"></span>
      <span style="display: flex; align-items: center; gap: 6px">${kbd('Esc', T)}Close, focus returns to the bell</span>
    </div>
  </div>`;
  return shellBody(T, { bar: contextBar(T, { bellOpen: true }) }) + pop;
}
writeFileSync('Notifications.dc.html', doc(LIGHT, notifications(LIGHT)));

// ---------- 6 + 9: collapsed rail; selection toolbar, then the undo strip after Shift+R ----------
function railShell(T, { undo = false } = {}) {
  const railBtn = (ic, active = false, b = '') => `<div style="position: relative; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 4px; background: ${active ? T.wash : 'transparent'}">${ic === 'Q' ? tile('Q', T) : icon(ic, active ? T.accent : T.ink2)}${b}</div>`;
  const rail = `<div style="display: flex; flex-direction: column; align-items: center; gap: 4px; width: 48px; padding: 8px 0; background: ${T.chrome}; flex: none">
    ${railBtn('box', true, badge(6, T, true))}${railBtn('truck')}${railBtn('mail')}${railBtn('building')}${railBtn('Q')}
    <div style="flex: 1"></div>${railBtn('puzzle')}</div>
    ${undo ? '' : `<div style="position: absolute; left: 52px; top: 76px; display: flex; align-items: center; gap: 8px; height: 24px; padding: 0 8px; background: ${T.ink1}; color: ${T.pane}; border-radius: 2px; font-size: 11px; box-shadow: ${SHADOW_OVERLAY}; z-index: 2">Inventory<span style="opacity: 0.75">Ctrl 1</span></div>`}`;
  const p3 = pane3(T, W - 48 - 400 - 2, { selection: !undo, focused: true, undo });
  // After the reversal the list agrees with pane 3: Pallet wrap reads 520 on hand.
  const rows = undo ? rowsData.map((r, i) => i === 0 ? { ...r, qty: 520, s: [...r.s.slice(0, -1), 520] } : r) : rowsData;
  return shellBody(T, { p1: rail, p2: pane2(T, rows, 400), p3 });
}
const railStyle = `tbody tr:nth-child(1) td, tbody tr:nth-child(2) td, tbody tr:nth-child(5) td { background: ${LIGHT.selected}; }`;
writeFileSync('RailToolbar.dc.html', doc(LIGHT, railShell(LIGHT), railStyle));
writeFileSync('UndoStrip.dc.html', doc(LIGHT, railShell(LIGHT, { undo: true })));

// ---------- canvas ----------
const SCREENS = [
  ['Main.dc.html', 'Shell at rest, light'],
  ['Palette.dc.html', 'Command palette'],
  ['PluginManager.dc.html', 'Plugin manager'],
  ['States.dc.html', 'States'],
  ['ShellDark.dc.html', 'Shell at rest, dark'],
  ['RailToolbar.dc.html', 'Collapsed rail and selection toolbar'],
  ['PaletteStates.dc.html', 'Palette states'],
  ['Notifications.dc.html', 'Notifications'],
  ['UndoStrip.dc.html', 'After Reverse movement: undo strip'],
];
writeFileSync('canvas.json', JSON.stringify({
  pages: SCREENS.map(([, name], i) => ({ id: `page-${i + 1}`, name: `${i + 1}. ${name}` })),
  artboards: SCREENS.map(([file, title], i) => ({ file, x: 0, y: 0, w: FW, h: FH, title, expand: 'fill', page: `page-${i + 1}` })),
  annotations: [
    { id: 'gate4', page: 'page-1', x: 0, y: -300, w: 1100, text: `Gate 4 of the ShellUX redesign, revision 4: the independent critique resolved on the canvas (plan step 3b), plus the D-48 "Files changed" plugin state. Drawn from DESIGN.md (The Operator’s Instrument) and the generated LEAPWare Light and Dark tokens. Shown at 150% of real size; the app itself renders at 100%. One screen per page: use the pages menu to move between them.
Owner calls applied: plugin titles and icons from the manifest (no machine IDs, no type chips); type stays 11 to 13px; full keyboard palette; runtime plugin manager.
Approve, or mark what to change, before any of this becomes component code.` },
  ],
  launch: { view: 'focused', file: 'Main.dc.html' },
}, null, 2));
console.log('ok');
