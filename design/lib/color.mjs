/**
 * ============================================================================
 * COLOUR MATHS FOR THE TOKEN PIPELINE. ZERO DEPENDENCIES, ONE COPY.
 * ============================================================================
 * `generate.mjs` and `check-contrast.mjs` both import this module, and that is
 * the whole reason it exists as a file rather than as two private copies. If the
 * generator's OKLCH -> sRGB conversion and the checker's ever disagreed, the
 * checker would be measuring a colour the stylesheet does not contain and every
 * green run would mean nothing. One module, one conversion, no drift.
 *
 * WHAT IS IMPLEMENTED HERE, AND AGAINST WHICH SPECIFICATION:
 *
 *  - OKLab / OKLCH -> linear sRGB, using Bjorn Ottosson's published matrices,
 *    which are the ones CSS Color Level 4 normatively references.
 *  - Linear sRGB -> gamma-encoded sRGB, the piecewise IEC 61966-2-1 transfer
 *    function.
 *  - Gamut mapping by chroma reduction at constant lightness and hue. A binary
 *    search on chroma, not a per-channel clip: clipping changes hue and
 *    lightness, which would silently move a colour away from the one the token
 *    declares. The generator emits the MAPPED value, so the browser has nothing
 *    left to map and what it paints is what this module measured.
 *  - WCAG 2.x relative luminance and contrast ratio, computed from the 8-bit
 *    quantised sRGB triplet. Quantised deliberately: 8-bit hex is what a
 *    stylesheet and every third-party contrast checker actually operate on, so
 *    a ratio reported here can be reproduced by hand.
 *  - CIE Lab (D65) and CIEDE2000, for the chart-series separation check.
 *
 * WHAT IS NOT IMPLEMENTED, STATED SO IT IS NOT ASSUMED:
 *
 *  - APCA. It is a different model with a different threshold table and it is
 *    not a WCAG 2.x criterion. Where APCA reasoning influenced a value it did so
 *    through a human decision recorded in `README.md`, not through a computation
 *    in this file.
 *  - Any colour space other than sRGB. Display-P3 output would need its own
 *    matrix and its own gamut boundary.
 *  - Chromatic adaptation. Everything here is D65 throughout.
 * ============================================================================
 */

/** Convert an OKLCH triple to OKLab. Hue in degrees. */
export function oklchToOklab({ l, c, h }) {
  const radians = (h * Math.PI) / 180;
  return { L: l, a: c * Math.cos(radians), b: c * Math.sin(radians) };
}

/** OKLab to linear-light sRGB. Ottosson's matrices, as referenced by CSS Color 4. */
export function oklabToLinearSrgb({ L, a, b }) {
  const lRoot = L + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = L - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = L - 0.0894841775 * a - 1.291485548 * b;

  const lCone = lRoot * lRoot * lRoot;
  const mCone = mRoot * mRoot * mRoot;
  const sCone = sRoot * sRoot * sRoot;

  return {
    r: 4.0767416621 * lCone - 3.3077115913 * mCone + 0.2309699292 * sCone,
    g: -1.2684380046 * lCone + 2.6097574011 * mCone - 0.3413193965 * sCone,
    b: -0.0041960863 * lCone - 0.7034186147 * mCone + 1.707614701 * sCone,
  };
}

/** The IEC 61966-2-1 transfer function, linear-light to gamma-encoded. */
function encodeSrgbChannel(value) {
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value);
  if (magnitude <= 0.0031308) {
    return sign * magnitude * 12.92;
  }
  return sign * (1.055 * Math.pow(magnitude, 1 / 2.4) - 0.055);
}

/** The same transfer function inverted, gamma-encoded to linear-light. */
function decodeSrgbChannel(value) {
  const sign = value < 0 ? -1 : 1;
  const magnitude = Math.abs(value);
  if (magnitude <= 0.04045) {
    return (sign * magnitude) / 12.92;
  }
  return sign * Math.pow((magnitude + 0.055) / 1.055, 2.4);
}

/**
 * Is this linear-light triple representable in sRGB?
 *
 * The epsilon absorbs the accumulated floating-point error of the two matrix
 * multiplications; without it the binary search below rejects colours that are
 * in gamut by a ten-thousandth and reports a chroma lower than the true one.
 */
function isInGamut({ r, g, b }, epsilon = 1e-6) {
  return (
    r >= -epsilon && r <= 1 + epsilon && g >= -epsilon && g <= 1 + epsilon && b >= -epsilon && b <= 1 + epsilon
  );
}

/**
 * The largest chroma at this lightness and hue that sRGB can hold.
 *
 * Binary search rather than an analytic boundary: the sRGB gamut boundary in
 * OKLCH has no closed form, and 24 bisections resolve chroma to better than one
 * part in sixteen million, which is far below 8-bit quantisation.
 */
export function maxChromaFor(l, h, ceiling = 0.5) {
  if (!isInGamut(oklabToLinearSrgb(oklchToOklab({ l, c: 0, h })))) {
    // The achromatic axis itself is outside sRGB, which means lightness is out
    // of [0, 1]. There is no chroma that rescues it.
    return 0;
  }
  let low = 0;
  let high = ceiling;
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2;
    if (isInGamut(oklabToLinearSrgb(oklchToOklab({ l, c: middle, h })))) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return low;
}

/**
 * An OKLCH colour reduced into the sRGB gamut, keeping lightness and hue.
 *
 * Returns the mapped OKLCH alongside its 8-bit sRGB triple and hex, because
 * every consumer wants at least two of the three and recomputing invites drift.
 */
export function resolveOklch({ l, c, h }) {
  const lightness = Math.min(1, Math.max(0, l));
  const chroma = Math.max(0, Math.min(c, maxChromaFor(lightness, h)));
  const linear = oklabToLinearSrgb(oklchToOklab({ l: lightness, c: chroma, h }));
  const channels = [linear.r, linear.g, linear.b].map((value) =>
    Math.min(255, Math.max(0, Math.round(encodeSrgbChannel(value) * 255))),
  );
  return {
    oklch: { l: lightness, c: chroma, h },
    rgb: channels,
    hex: `#${channels.map((value) => value.toString(16).padStart(2, '0')).join('')}`,
    /** True when the requested chroma had to be reduced to fit sRGB. */
    clipped: chroma < c - 1e-9,
  };
}

/** Parse `#rgb` or `#rrggbb` into an 8-bit triple. */
export function hexToRgb(hex) {
  const text = hex.trim().replace(/^#/, '');
  const full =
    text.length === 3
      ? text
          .split('')
          .map((character) => character + character)
          .join('')
      : text;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`Not a hex colour: ${hex}`);
  }
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * WCAG 2.x relative luminance of an 8-bit sRGB triple.
 *
 * The coefficients and the 0.03928/12.92 split are quoted from the WCAG 2
 * definition rather than from the sRGB standard, which uses 0.04045. The two
 * differ in the fourth decimal place and WCAG's is the one a conformance claim
 * is measured against, so it is the one used here.
 */
export function relativeLuminance([r, g, b]) {
  const channel = (value) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio between two 8-bit sRGB triples. Always >= 1. */
export function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** 8-bit sRGB to CIE XYZ, D65 white point. */
function rgbToXyz([r, g, b]) {
  const lr = decodeSrgbChannel(r / 255);
  const lg = decodeSrgbChannel(g / 255);
  const lb = decodeSrgbChannel(b / 255);
  return {
    x: 0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb,
    y: 0.2126729 * lr + 0.7151522 * lg + 0.072175 * lb,
    z: 0.0193339 * lr + 0.119192 * lg + 0.9503041 * lb,
  };
}

/** CIE Lab, D65 reference white, from an 8-bit sRGB triple. */
export function rgbToLab(rgb) {
  const white = { x: 0.9504559, y: 1.0, z: 1.0890578 };
  const { x, y, z } = rgbToXyz(rgb);
  const f = (value) => (value > 216 / 24389 ? Math.cbrt(value) : (841 / 108) * value + 4 / 29);
  const fx = f(x / white.x);
  const fy = f(y / white.y);
  const fz = f(z / white.z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/**
 * CIEDE2000 colour difference between two 8-bit sRGB triples.
 *
 * Implemented from Sharma, Wu and Dalal's 2005 formulation, including the
 * hue-rotation term and the arithmetic-mean hue conventions that the original
 * CIE publication left ambiguous. Verified against three of that paper's own
 * test pairs in `check-contrast.mjs --self-test`.
 */
export function deltaE2000(rgbA, rgbB) {
  return deltaE2000Lab(rgbToLab(rgbA), rgbToLab(rgbB));
}

/**
 * CIEDE2000 between two CIE Lab colours.
 *
 * Split out from `deltaE2000` for one reason: Sharma, Wu and Dalal publish
 * their thirty-four verification pairs as Lab values, so an implementation that
 * only accepted sRGB could not be checked against the reference data at all —
 * it could only be checked against itself. `check-contrast.mjs --self-test`
 * runs five of those pairs through this function.
 */
export function deltaE2000Lab(one, two) {
  const kL = 1;
  const kC = 1;
  const kH = 1;

  const c1 = Math.hypot(one.a, one.b);
  const c2 = Math.hypot(two.a, two.b);
  const cBar = (c1 + c2) / 2;
  const cBar7 = Math.pow(cBar, 7);
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + Math.pow(25, 7))));

  const a1p = (1 + g) * one.a;
  const a2p = (1 + g) * two.a;
  const c1p = Math.hypot(a1p, one.b);
  const c2p = Math.hypot(a2p, two.b);

  const toDegrees = (radians) => {
    const degrees = (radians * 180) / Math.PI;
    return degrees < 0 ? degrees + 360 : degrees;
  };
  const h1p = c1p === 0 ? 0 : toDegrees(Math.atan2(one.b, a1p));
  const h2p = c2p === 0 ? 0 : toDegrees(Math.atan2(two.b, a2p));

  const dLp = two.L - one.L;
  const dCp = c2p - c1p;

  let dhp;
  if (c1p * c2p === 0) {
    dhp = 0;
  } else if (Math.abs(h2p - h1p) <= 180) {
    dhp = h2p - h1p;
  } else if (h2p - h1p > 180) {
    dhp = h2p - h1p - 360;
  } else {
    dhp = h2p - h1p + 360;
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp * Math.PI) / 360);

  const lBarP = (one.L + two.L) / 2;
  const cBarP = (c1p + c2p) / 2;

  let hBarP;
  if (c1p * c2p === 0) {
    hBarP = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hBarP = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hBarP = (h1p + h2p + 360) / 2;
  } else {
    hBarP = (h1p + h2p - 360) / 2;
  }

  const radians = (degrees) => (degrees * Math.PI) / 180;
  const t =
    1 -
    0.17 * Math.cos(radians(hBarP - 30)) +
    0.24 * Math.cos(radians(2 * hBarP)) +
    0.32 * Math.cos(radians(3 * hBarP + 6)) -
    0.2 * Math.cos(radians(4 * hBarP - 63));

  const dTheta = 30 * Math.exp(-Math.pow((hBarP - 275) / 25, 2));
  const cBarP7 = Math.pow(cBarP, 7);
  const rC = 2 * Math.sqrt(cBarP7 / (cBarP7 + Math.pow(25, 7)));
  const rT = -rC * Math.sin(radians(2 * dTheta));

  const lBarP50 = Math.pow(lBarP - 50, 2);
  const sL = 1 + (0.015 * lBarP50) / Math.sqrt(20 + lBarP50);
  const sC = 1 + 0.045 * cBarP;
  const sH = 1 + 0.015 * cBarP * t;

  const termL = dLp / (kL * sL);
  const termC = dCp / (kC * sC);
  const termH = dHp / (kH * sH);

  return Math.sqrt(termL * termL + termC * termC + termH * termH + rT * termC * termH);
}

/** `oklch(L% C H)` in the spelling the generated stylesheet uses. */
export function formatOklch({ l, c, h }) {
  const lightness = `${(l * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
  const chroma = c.toFixed(4).replace(/\.?0+$/, '');
  const hue = h.toFixed(2).replace(/\.?0+$/, '');
  return `oklch(${lightness} ${chroma === '' ? '0' : chroma} ${hue === '' ? '0' : hue})`;
}
