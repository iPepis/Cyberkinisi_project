/*
 * Open Prosthetic Builder: parametric geometry engine (prototype v0.0.1)
 *
 * Pure JavaScript, no dependencies. Runs in the browser and in Node, so the
 * same code drives the live preview, the STL export and the automated tests.
 *
 * Conventions
 *  - Units are millimetres.
 *  - Parts are solids of revolution about the Y axis. "d" is depth measured
 *    distally from a part's reference face, so world y = -d (elbow up, hand down).
 *  - Every part is a list of closed shells (Float32Array of triangles, 9 floats
 *    each). Joint features (lugs, ledges, stops, hand fingers) are separate
 *    shells that overlap the main body; slicers merge overlapping shells.
 *    A boolean-based exporter is planned (see docs/SPEC.md, milestone M4).
 *  - Printing orientation = assembled orientation (z up in the STL = proximal),
 *    so female collars sit on the bed and male stubs point up.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OPB = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PI = Math.PI;
  const DEG = PI / 180;
  const EPS = 1e-9;

  /* ------------------------------------------------------------------ */
  /* Standard bayonet joint (one size for every connection)              */
  /* ------------------------------------------------------------------ */
  const J = {
    Rm: 13,            // male stub outer radius
    Rmi: 8,            // male stub bore radius
    stubLen: 9.6,      // stub length beyond the shoulder face
    shoulder: 3,       // shoulder (flange) thickness
    Ro: 20.2,          // collar / shoulder outer radius (40.4 mm OD)
    lugR: 3.2,         // lug radial height
    lugH: 5,           // lug axial height
    lugA0: 10, lugA1: 50,       // lug angular span in the insertion pose (deg)
    lugFromShoulder: 4.4,       // lug bearing face above the shoulder face
    ledgeA0: 60, ledgeA1: 120,  // ledge angular span (deg); gaps sit between
    stopA0: 112, stopA1: 120,   // rotation stop (deg)
    ledgeT: 4,         // ledge thickness
    clearance: 0.5,    // radial clearance around stub and lugs
    cavity: 9.8,       // female cavity depth from the rim
    ceiling: 3,        // roof thickness behind the cavity
    collarH: 12.8,     // cavity + roof
    lock: 60           // quarter-turn is 60 degrees: three lugs, three gaps
  };
  J.Rl = J.Rm + J.lugR + J.clearance;   // cavity radius (16.7)
  J.Rf = J.Rm + J.clearance;            // ledge inner radius (13.5)

  /* ------------------------------------------------------------------ */
  /* Parameters                                                          */
  /* ------------------------------------------------------------------ */
  const DEFAULTS = {
    side: 'right',
    limbLength: 140,   // residual limb, elbow crease to distal end
    circProx: 250,     // circumference over bare skin
    circMid: 225,
    circDist: 190,
    sockPlies: 3,      // prosthetic sock ply count (0 = none)
    plyMm: 0.8,        // thickness of one ply (check your sock brand)
    linerMm: 0,        // silicone / gel liner wall thickness (0, 3 or 6)
    clearance: 1.0,    // extra radial room for print tolerance
    wall: 3.5,
    flare: true,       // rolled, flared rim so a sock does not catch
    tubeLength: 150,
    tubeWall: 4,
    wristLength: 40,
    // palm and wrist (mm)
    palmLength: 97,        // wrist ring to knuckle line
    palmWidth: 83,         // across the knuckles
    palmThickness: 26,
    wristWidth: 56,
    wristThickness: 36,
    // one length per digit (mm, straight)
    fingerThumb: 79,
    fingerIndex: 77,
    fingerMiddle: 83,
    fingerRing: 79,
    fingerPinky: 65
  };

  const LIMITS = {
    limbLength: [60, 220, 1],
    circProx: [160, 380, 1],
    circMid: [160, 380, 1],
    circDist: [160, 340, 1],
    sockPlies: [0, 15, 1],
    plyMm: [0.4, 1.5, 0.05],
    clearance: [0.5, 3, 0.1],
    wall: [2.4, 8, 0.1],
    tubeLength: [45, 320, 1],
    tubeWall: [2.4, 8, 0.1],
    wristLength: [30, 90, 1],
    palmLength: [70, 120, 1],
    palmWidth: [60, 110, 1],
    palmThickness: [18, 40, 1],
    wristWidth: [40, 75, 1],
    wristThickness: [28, 50, 1],
    fingerThumb: [55, 100, 1],
    fingerIndex: [55, 100, 1],
    fingerMiddle: [60, 105, 1],
    fingerRing: [55, 100, 1],
    fingerPinky: [45, 85, 1]
  };

  /* ------------------------------------------------------------------ */
  /* Mesh primitives                                                     */
  /* ------------------------------------------------------------------ */
  function area2(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a;
  }

  // Revolve a closed profile of [r, d] points around the Y axis.
  // Full turn by default; pass a0/a1 (radians) for a sector with end caps
  // (sector profiles must be convex).
  function revolve(profRD, a0, a1, seg) {
    a0 = a0 === undefined ? 0 : a0;
    a1 = a1 === undefined ? 2 * PI : a1;
    seg = seg || 72;
    const pts = profRD.map(function (p) { return [p[0], -p[1]]; }); // [r, y]
    if (area2(pts) < 0) pts.reverse();                              // CCW in (r, y)
    const full = Math.abs(a1 - a0 - 2 * PI) < 1e-9;
    const n = full ? seg : Math.max(1, Math.round(seg * (a1 - a0) / (2 * PI)));
    const out = [];
    const P = function (p, t) { return [p[0] * Math.cos(t), p[1], p[0] * Math.sin(t)]; };
    const tri = function (a, b, c) { out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); };
    const m = pts.length;
    for (let i = 0; i < n; i++) {
      const t0 = a0 + (a1 - a0) * i / n, t1 = a0 + (a1 - a0) * (i + 1) / n;
      for (let j = 0; j < m; j++) {
        const p = pts[j], q = pts[(j + 1) % m];
        const pAxis = p[0] < EPS, qAxis = q[0] < EPS;
        if (pAxis && qAxis) continue;
        const A = P(p, t0), B = P(q, t0), C = P(q, t1), D = P(p, t1);
        if (pAxis) tri(A, B, C);
        else if (qAxis) tri(A, C, D);
        else { tri(A, B, C); tri(A, C, D); }
      }
    }
    if (!full) {
      for (let k = 1; k < m - 1; k++) {
        const s0 = P(pts[0], a0), s1 = P(pts[k], a0), s2 = P(pts[k + 1], a0);
        tri(s0, s2, s1);
        const e0 = P(pts[0], a1), e1 = P(pts[k], a1), e2 = P(pts[k + 1], a1);
        tri(e0, e1, e2);
      }
    }
    return new Float32Array(out);
  }

  // Sector of an annulus (rectangular section): r0..r1, d0..d1, angles in degrees.
  function sector(r0, r1, d0, d1, aDeg0, aDeg1, seg) {
    return revolve([[r0, d0], [r1, d0], [r1, d1], [r0, d1]], aDeg0 * DEG, aDeg1 * DEG, seg || 72);
  }

  // Prism from a convex outline in the XZ plane, spanning y0..y1.
  function prism(polyXZ, y0, y1) {
    let pts = polyXZ.slice();
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    if (a > 0) pts.reverse();
    const out = [];
    const tri = function (a, b, c) { out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); };
    const n = pts.length;
    const T = pts.map(function (p) { return [p[0], y1, p[1]]; });
    const B = pts.map(function (p) { return [p[0], y0, p[1]]; });
    for (let k = 1; k < n - 1; k++) { tri(T[0], T[k], T[k + 1]); tri(B[0], B[k + 1], B[k]); }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      tri(B[i], B[j], T[j]);
      tri(B[i], T[j], T[i]);
    }
    return new Float32Array(out);
  }

  function roundedRect(w, t, rad, steps) {
    steps = steps || 5;
    rad = Math.min(rad, w / 2 - 0.01, t / 2 - 0.01);
    const pts = [];
    const cx = w / 2 - rad, cz = t / 2 - rad;
    const corners = [[cx, cz, 0], [-cx, cz, 90], [-cx, -cz, 180], [cx, -cz, 270]];
    corners.forEach(function (c) {
      for (let s = 0; s <= steps; s++) {
        const ang = (c[2] + 90 * s / steps) * DEG;
        pts.push([c[0] + rad * Math.cos(ang), c[1] + rad * Math.sin(ang)]);
      }
    });
    return pts;
  }

  /* ---- organic shapes (used by the hand) ---- */
  // Smooth convex outline in the XZ plane. n = 2 is an ellipse; larger n squares the corners.
  function superEllipse(w, t, n, N) {
    N = N || 28;
    const pts = [];
    for (let k = 0; k < N; k++) {
      const a = 2 * PI * k / N, c = Math.cos(a), s = Math.sin(a);
      pts.push([(w / 2) * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), (t / 2) * Math.sign(s) * Math.pow(Math.abs(s), 2 / n)]);
    }
    return pts;
  }

  // Closed shell through a stack of convex outlines that share one point count.
  // rings: [{ pts: [[x, z], ...], y }, ...]
  function loft(rings) {
    if (rings[0].y > rings[rings.length - 1].y) rings = rings.slice().reverse();
    const out = [];
    const tri = function (a, b, c) { out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); };
    const V = rings.map(function (r) { return r.pts.map(function (p) { return [p[0], r.y, p[1]]; }); });
    const n = V[0].length, last = V.length - 1;
    for (let i = 0; i < last; i++)
      for (let k = 0; k < n; k++) {
        const j = (k + 1) % n;
        tri(V[i][k], V[i][j], V[i + 1][j]);
        tri(V[i][k], V[i + 1][j], V[i + 1][k]);
      }
    for (let k = 1; k < n - 1; k++) { tri(V[last][0], V[last][k], V[last][k + 1]); tri(V[0][0], V[0][k + 1], V[0][k]); }
    const s = new Float32Array(out);
    if (volume(s) < 0) {
      for (let i = 0; i < s.length; i += 9)
        for (let k = 0; k < 3; k++) { const t = s[i + 3 + k]; s[i + 3 + k] = s[i + 6 + k]; s[i + 6 + k] = t; }
    }
    return s;
  }

  function scaleXYZ(tris, sx, sy, sz) {
    const o = new Float32Array(tris.length);
    for (let i = 0; i < tris.length; i += 3) { o[i] = tris[i] * sx; o[i + 1] = tris[i + 1] * sy; o[i + 2] = tris[i + 2] * sz; }
    return o;
  }
  function rotX(tris, a) {
    const c = Math.cos(a), s = Math.sin(a), o = new Float32Array(tris.length);
    for (let i = 0; i < tris.length; i += 3) {
      const y = tris[i + 1], z = tris[i + 2];
      o[i] = tris[i]; o[i + 1] = y * c - z * s; o[i + 2] = y * s + z * c;
    }
    return o;
  }
  function ellipsoid(rx, ry, rz, cx, cy, cz) {
    const prof = [];
    for (let s = 0; s <= 10; s++) { const a = -PI / 2 + PI * s / 10; prof.push([Math.cos(a), Math.sin(a)]); }
    return translate(scaleXYZ(revolve(prof, 0, 2 * PI, 20), rx, ry, rz), cx, cy, cz);
  }

  /* ---- transforms (return new arrays) ---- */
  function rotAxis(tris, a) {       // add `a` radians to the revolve angle
    const c = Math.cos(a), s = Math.sin(a), o = new Float32Array(tris.length);
    for (let i = 0; i < tris.length; i += 3) {
      const x = tris[i], z = tris[i + 2];
      o[i] = x * c - z * s; o[i + 1] = tris[i + 1]; o[i + 2] = x * s + z * c;
    }
    return o;
  }
  function rotZ(tris, a) {
    const c = Math.cos(a), s = Math.sin(a), o = new Float32Array(tris.length);
    for (let i = 0; i < tris.length; i += 3) {
      const x = tris[i], y = tris[i + 1];
      o[i] = x * c - y * s; o[i + 1] = x * s + y * c; o[i + 2] = tris[i + 2];
    }
    return o;
  }
  function translate(tris, dx, dy, dz) {
    const o = new Float32Array(tris.length);
    for (let i = 0; i < tris.length; i += 3) { o[i] = tris[i] + dx; o[i + 1] = tris[i + 1] + dy; o[i + 2] = tris[i + 2] + dz; }
    return o;
  }
  function concat(list) {
    let n = 0; list.forEach(function (s) { n += s.length; });
    const o = new Float32Array(n); let k = 0;
    list.forEach(function (s) { o.set(s, k); k += s.length; });
    return o;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /* ------------------------------------------------------------------ */
  /* Fit model: how limb measurements become socket dimensions           */
  /* ------------------------------------------------------------------ */
  function fitModel(p) {
    const sockMm = p.sockPlies * p.plyMm;
    const layers = p.linerMm + sockMm;              // soft goods between skin and socket
    const allowance = layers + p.clearance;         // total radial room
    const L = p.limbLength;
    const rLimb = [p.circProx, p.circMid, p.circDist].map(function (c) { return c / (2 * PI); });
    function quad(vals, d) {                        // smooth through the three stations
      const x = clamp(d, 0, L), x0 = 0, x1 = L / 2, x2 = L;
      return vals[0] * ((x - x1) * (x - x2)) / ((x0 - x1) * (x0 - x2)) +
             vals[1] * ((x - x0) * (x - x2)) / ((x1 - x0) * (x1 - x2)) +
             vals[2] * ((x - x0) * (x - x1)) / ((x2 - x0) * (x2 - x1));
    }
    const flareAmt = p.flare ? 3 : 0, flareH = 8;
    const flare = function (d) { return d >= flareH ? 0 : flareAmt * Math.pow(1 - d / flareH, 2); };
    return {
      sockMm: sockMm, layers: layers, allowance: allowance,
      rLimb: function (d) { return quad(rLimb, d); },
      rIn: function (d) { return quad(rLimb, d) + allowance + flare(d); },
      flare: flare,
      distalGap: 6 + layers                         // room below the limb end for sock and liner
    };
  }

  /* ------------------------------------------------------------------ */
  /* Parts                                                               */
  /* ------------------------------------------------------------------ */
  function lugShells() {
    // Bearing face (flat) toward the shoulder, 45 degree chamfer on the tip side.
    const db = -J.lugFromShoulder, dt = db - J.lugH;
    const prof = [
      [J.Rm - 1, db], [J.Rm + J.lugR, db], [J.Rm + J.lugR, dt + J.lugR], [J.Rm, dt], [J.Rm - 1, dt]
    ];
    const out = [];
    for (let k = 0; k < 3; k++) out.push(revolve(prof, (J.lugA0 + 120 * k) * DEG, (J.lugA1 + 120 * k) * DEG, 10));
    return out;
  }

  function ledgeShells(dRim) {
    const out = [];
    for (let k = 0; k < 3; k++) {
      out.push(sector(J.Rf, J.Rl + 1.2, dRim - J.ledgeT, dRim, J.ledgeA0 + 120 * k, J.ledgeA1 + 120 * k, 12));
      out.push(sector(J.Rm + 0.6, J.Rl + 1.2, dRim - J.cavity - 0.5, dRim - J.ledgeT + 0.5,
        J.stopA0 + 120 * k, J.stopA1 + 120 * k, 2));
    }
    return out;
  }

  function buildSocket(p, fit) {
    const w = p.wall, L = p.limbLength;
    const yf = L + fit.distalGap;                   // inner floor depth
    const yo = yf + w;                              // outer floor depth (collar starts here)
    const rd = fit.rIn(L);
    const rf = clamp(rd - (J.Ro + 1.5), 2, 10);
    const dArc = yf - rf;                           // where the distal fillet starts
    const rArc = fit.rIn(dArc);
    const cR = rArc - rf, cD = dArc;                // fillet centre
    const N = 56;
    const prof = [];
    const rcRim = (fit.rIn(0) + fit.rIn(0) + w) / 2;
    const inner = [], outer = [];
    for (let i = 0; i <= N; i++) {
      const d = dArc * i / N;
      inner.push([fit.rIn(d), d]);
      outer.push([fit.rIn(d) + w, d]);
    }
    prof.push.apply(prof, inner);
    for (let s = 1; s <= 10; s++) {                 // inner fillet, 0..90 degrees
      const ph = (90 * s / 10) * DEG;
      prof.push([cR + rf * Math.cos(ph), cD + rf * Math.sin(ph)]);
    }
    prof.push([0, yf]);
    prof.push([0, yo + J.ceiling]);
    prof.push([J.Rl, yo + J.ceiling]);
    prof.push([J.Rl, yo + J.collarH]);
    prof.push([J.Ro, yo + J.collarH]);
    prof.push([J.Ro, yo]);
    prof.push([cR, yo]);
    for (let s = 9; s >= 0; s--) {                  // outer fillet, 90..0 degrees
      const ph = (90 * s / 10) * DEG;
      prof.push([cR + (rf + w) * Math.cos(ph), cD + (rf + w) * Math.sin(ph)]);
    }
    for (let i = N - 1; i >= 0; i--) prof.push(outer[i]);
    for (let s = 1; s < 12; s++) {                  // rolled rim over the top
      const ph = PI * s / 12;
      prof.push([rcRim + (w / 2) * Math.cos(ph), -(w / 2) * Math.sin(ph)]);
    }
    const length = yo + J.collarH;
    const shells = [revolve(prof, 0, 2 * PI, 96)].concat(ledgeShells(length));
    return { name: 'socket', shells: shells, length: length, male: false, rimDepth: length };
  }

  // Forearm tube and wrist adapter share one design: male stub on the proximal end,
  // female collar on the distal end, hollow in between.
  function buildTube(name, L, wall) {
    const Rb = J.Ro - wall;
    const prof = [
      [J.Rmi, -J.stubLen], [J.Rm, -J.stubLen], [J.Rm, 0], [J.Ro, 0],
      [J.Ro, L], [J.Rl, L], [J.Rl, L - J.cavity],
      [0, L - J.cavity], [0, L - J.collarH],
      [Rb, L - J.collarH], [Rb, J.shoulder], [J.Rmi, J.shoulder]
    ];
    const shells = [revolve(prof, 0, 2 * PI, 72)].concat(lugShells(), ledgeShells(L));
    return { name: name, shells: shells, length: L, male: true, rimDepth: L };
  }

  /* ------------------------------------------------------------------ */
  /* Hand: rigid segments joined by joints with human ranges of motion   */
  /* ------------------------------------------------------------------ */
  // Hand frame (before the part is turned into the arm): palm faces +z, fingers point along -y.
  // Positive flexion bends a digit toward the palm. Positive side angles move toward the thumb.
  const FINGERS = ['index', 'middle', 'ring', 'pinky'];
  const DIGITS = ['thumb'].concat(FINGERS);
  const HAND_ROM = {};
  function rom(key, label, group, min, max, def) { HAND_ROM[key] = { label: label, group: group, min: min, max: max, def: def }; }
  rom('wrist_flex', 'Wrist, back to palm side', 'wrist', -70, 80, 0);
  rom('wrist_dev', 'Wrist, side to side', 'wrist', -30, 20, 0);
  (function () {
    const spreadMax = { index: 20, middle: 10, ring: 15, pinky: 25 };
    const spreadDef = { index: 4, middle: 0, ring: -3, pinky: -8 };
    const mcpDef = { index: 11, middle: 14, ring: 15, pinky: 18 };
    const pipDef = { index: 19, middle: 24, ring: 26, pinky: 31 };
    const dipDef = { index: 13, middle: 16, ring: 18, pinky: 21 };
    FINGERS.forEach(function (f) {
      rom(f + '_spread', 'Side to side', f, -spreadMax[f], spreadMax[f], spreadDef[f]);
      rom(f + '_mcp', 'Knuckle', f, -25, 90, mcpDef[f]);
      rom(f + '_pip', 'Middle joint', f, 0, 105, pipDef[f]);
      rom(f + '_dip', 'Tip joint', f, -10, 85, dipDef[f]);
    });
    rom('thumb_abd', 'Spread away from palm edge', 'thumb', -20, 40, 0);
    rom('thumb_opp', 'Swing across palm', 'thumb', -20, 45, 8);
    rom('thumb_mcp', 'Middle joint', 'thumb', -10, 60, 14);
    rom('thumb_ip', 'Tip joint', 'thumb', -15, 80, 20);
  })();

  function poseDefaults() {
    const o = {};
    Object.keys(HAND_ROM).forEach(function (k) { o[k] = HAND_ROM[k].def; });
    return o;
  }
  function preset(name) {
    const o = poseDefaults();
    const set = function (k, v) { o[k] = v; };
    if (name === 'open') {
      FINGERS.forEach(function (f) { set(f + '_mcp', 0); set(f + '_pip', 0); set(f + '_dip', 0); });
      set('thumb_abd', 25); set('thumb_opp', 0); set('thumb_mcp', 0); set('thumb_ip', 0);
    } else if (name === 'fist') {
      FINGERS.forEach(function (f) { set(f + '_mcp', 85); set(f + '_pip', 100); set(f + '_dip', 70); set(f + '_spread', 0); });
      set('thumb_abd', 0); set('thumb_opp', 35); set('thumb_mcp', 40); set('thumb_ip', 45);
    } else if (name === 'hook') {
      FINGERS.forEach(function (f) { set(f + '_mcp', 8); set(f + '_pip', 90); set(f + '_dip', 55); set(f + '_spread', 0); });
    }
    return o;
  }

  /* ---- 4x4 matrices, row-major ---- */
  const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  function m4mul(a, b) {
    const o = new Array(16);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 4; c++) {
        let v = 0;
        for (let k = 0; k < 4; k++) v += a[r * 4 + k] * b[k * 4 + c];
        o[r * 4 + c] = v;
      }
    return o;
  }
  function m4rotPivot(axis, ang, p) {             // rotation about an axis through point p
    const l = Math.hypot(axis[0], axis[1], axis[2]);
    const x = axis[0] / l, y = axis[1] / l, z = axis[2] / l;
    const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    const R = [t * x * x + c, t * x * y - s * z, t * x * z + s * y,
               t * x * y + s * z, t * y * y + c, t * y * z - s * x,
               t * x * z - s * y, t * y * z + s * x, t * z * z + c];
    const tx = p[0] - (R[0] * p[0] + R[1] * p[1] + R[2] * p[2]);
    const ty = p[1] - (R[3] * p[0] + R[4] * p[1] + R[5] * p[2]);
    const tz = p[2] - (R[6] * p[0] + R[7] * p[1] + R[8] * p[2]);
    return [R[0], R[1], R[2], tx, R[3], R[4], R[5], ty, R[6], R[7], R[8], tz, 0, 0, 0, 1];
  }
  function m4rotY(a) {                            // same sense as rotAxis()
    const c = Math.cos(a), s = Math.sin(a);
    return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  }
  function m4apply(tris, M) {
    const o = new Float32Array(tris.length);
    for (let i = 0; i < tris.length; i += 3) {
      const x = tris[i], y = tris[i + 1], z = tris[i + 2];
      o[i] = M[0] * x + M[1] * y + M[2] * z + M[3];
      o[i + 1] = M[4] * x + M[5] * y + M[6] * z + M[7];
      o[i + 2] = M[8] * x + M[9] * y + M[10] * z + M[11];
    }
    return o;
  }

  /* Pose of every segment in the hand frame. Segments are listed parent-first. */
  function handMatrices(hand, pose) {
    const P = [];
    hand.segments.forEach(function (sg, i) {
      let L = I4;
      sg.dofs.forEach(function (d) {
        const r = HAND_ROM[d.key];
        const v = pose && pose[d.key] !== undefined ? pose[d.key] : r.def;
        L = m4mul(L, m4rotPivot(d.axis, clamp(v, r.min, r.max) * DEG * d.sign, sg.pivot));
      });
      P[i] = sg.parent < 0 ? L : m4mul(P[sg.parent], L);
    });
    return P;
  }

  /* Hand shells in the part frame (turned for the arm), in a given pose. */
  function handShells(hand, pose) {
    const P = handMatrices(hand, pose), pre = m4rotY(hand.pre);
    const out = hand.base.slice();
    hand.segments.forEach(function (sg, i) {
      const M = m4mul(pre, P[i]);
      sg.shells.forEach(function (sh) { out.push(m4apply(sh, M)); });
    });
    return out;
  }

  function jointTable(hand) {
    return {
      note: 'Hand frame: palm faces +z, fingers point along -y, millimetres. Rotate each segment about its pivot along the axis; positive flexion bends toward the palm. Apply parents first.',
      segments: hand.segments.map(function (sg) {
        return {
          id: sg.id, parent: sg.parent < 0 ? null : hand.segments[sg.parent].id, pivot: sg.pivot,
          joints: sg.dofs.map(function (d) {
            const r = HAND_ROM[d.key];
            return { name: d.key, axis: d.axis, sign: d.sign, minDeg: r.min, maxDeg: r.max, relaxedDeg: r.def };
          })
        };
      })
    };
  }

  // A straight digit: tapered segments with a round knuckle at each joint and a round tip.
  function digitStraight(w, t, lens, tip) {
    const segs = [];
    const total = lens.reduce(function (a, b) { return a + b; }, 0);
    let y = 0, used = 0;
    for (let i = 0; i < lens.length; i++) {
      const s0 = 1 - (1 - tip) * used / total, s1 = 1 - (1 - tip) * (used + lens[i]) / total;
      const shells = [loft([
        { pts: superEllipse(w * s0, t * s0, 2.4, 20), y: y },
        { pts: superEllipse(w * s1, t * s1, 2.4, 20), y: y - lens[i] }
      ])];
      if (i === 0) shells.push(ellipsoid(w * s0 / 2, t * s0 / 2 * 1.05, t * s0 / 2 * 1.05, 0, y, 0));
      shells.push(ellipsoid(w * s1 / 2, t * s1 / 2 * 1.05, t * s1 / 2 * 1.05, 0, y - lens[i], 0));
      segs.push({ shells: shells, start: [0, y, 0] });
      y -= lens[i]; used += lens[i];
    }
    return segs;
  }

  function buildHand(p) {
    const thumbSign = p.side === 'right' ? -1 : 1;   // viewed from the front, palm forward
    const d0 = J.shoulder - 1;                       // geometry starts just inside the shoulder
    const pl = p.palmLength, pw = p.palmWidth, pt = p.palmThickness, ww = p.wristWidth, wt = p.wristThickness;
    const dK = d0 + pl, dW = d0 + 16;                // knuckle line and wrist pivot depths
    const ring = function (w, t, n, d) { return { pts: superEllipse(w, t, n, 28), y: -d }; };
    const Z = [0, 0, 1], FLEX0 = [-1, 0, 0];         // flexion axis of a digit pointing along -y
    const segments = [];
    const add = function (id, parent, pivot, dofs, shells) {
      segments.push({ id: id, parent: parent, pivot: pivot, dofs: dofs, shells: shells });
      return segments.length - 1;
    };

    const wristIdx = add('wrist', -1, null, [], [
      loft([ring(2 * J.Ro - 1, 2 * J.Ro - 1, 2, d0), ring(ww, wt, 2.4, dW)]),
      ellipsoid(ww / 2 * 0.97, wt * 0.35, wt / 2 * 0.97, 0, -dW, 0)
    ]);
    const palmIdx = add('palm', wristIdx, [0, -dW, 0],
      [{ key: 'wrist_dev', axis: Z, sign: thumbSign }, { key: 'wrist_flex', axis: FLEX0, sign: 1 }],
      [loft([
        ring(ww, wt, 2.4, dW),
        ring(ww + (pw - ww) * 0.8, pt * 1.2, 3, dW + 0.45 * (dK - dW)),
        ring(pw, pt, 3.6, dK - 7),
        ring(pw * 0.97, pt * 0.8, 3.8, dK + 1.8)
      ])]);

    const span = pw * 0.97, gap = 1.6, slotW = (span - 3 * gap) / 4, ft0 = 0.6 * pt;
    const offs = { index: 2.2, middle: 0, ring: 2.2, pinky: 7.2 };
    FINGERS.forEach(function (name, k) {
      const L = p['finger' + name.charAt(0).toUpperCase() + name.slice(1)];
      const r = L / DEFAULTS['finger' + name.charAt(0).toUpperCase() + name.slice(1)];
      const fw = slotW * clamp(0.5 + 0.5 * r, 0.7, 1.0), ft = ft0 * clamp(0.5 + 0.5 * r, 0.7, 1.25);
      const x = thumbSign * (span / 2 - slotW / 2) - thumbSign * k * (slotW + gap), y = -(dK - offs[name]);
      const segs = digitStraight(fw, ft, [0.47 * L, 0.28 * L, 0.25 * L], 0.78);
      const keys = [
        [{ key: name + '_spread', axis: Z, sign: thumbSign }, { key: name + '_mcp', axis: FLEX0, sign: 1 }],
        [{ key: name + '_pip', axis: FLEX0, sign: 1 }],
        [{ key: name + '_dip', axis: FLEX0, sign: 1 }]
      ];
      let parent = palmIdx;
      segs.forEach(function (sg, i) {
        parent = add(name + ['_prox', '_mid', '_dist'][i], parent, [x + sg.start[0], y + sg.start[1], 0], keys[i],
          sg.shells.map(function (sh) { return translate(sh, x, y, 0); }));
      });
    });

    // thumb: metacarpal and two bones, resting 32 degrees away from the palm edge
    {
      const L = p.fingerThumb, r = L / DEFAULTS.fingerThumb, phi = thumbSign * 32 * DEG;
      const tw = 0.215 * pw * clamp(0.5 + 0.5 * r, 0.7, 1.15), tt = 0.64 * pt * clamp(0.5 + 0.5 * r, 0.7, 1.25);
      const segs = digitStraight(tw, tt, [0.295 * L, 0.386 * L, 0.318 * L], 0.82);
      const bx = thumbSign * 0.39 * pw, by = -(d0 + 0.67 * pl), bz = 0.2 * pt;
      const FA = [-Math.cos(phi), -Math.sin(phi), 0];                  // flexion axis of the angled thumb
      const keys = [
        [{ key: 'thumb_abd', axis: Z, sign: thumbSign }, { key: 'thumb_opp', axis: FA, sign: 1 }],
        [{ key: 'thumb_mcp', axis: FA, sign: 1 }],
        [{ key: 'thumb_ip', axis: FA, sign: 1 }]
      ];
      let parent = palmIdx;
      segs.forEach(function (sg, i) {
        const c = Math.cos(phi), s = Math.sin(phi);
        const st = sg.start;                                           // rotate the start point about z, then move
        const pv = [st[0] * c - st[1] * s + bx, st[0] * s + st[1] * c + by, bz];
        parent = add('thumb' + ['_meta', '_prox', '_dist'][i], parent, pv, keys[i],
          sg.shells.map(function (sh) { return translate(rotZ(sh, phi), bx, by, bz); }));
      });
    }

    const base = [revolve([[J.Rmi, -J.stubLen], [J.Rm, -J.stubLen], [J.Rm, 0], [J.Ro, 0], [J.Ro, J.shoulder], [J.Rmi, J.shoulder]], 0, 2 * PI, 72)]
      .concat(lugShells());
    const hand = { segments: segments, base: base, pre: -3 * J.lock * DEG, thumbSign: thumbSign };
    const longest = Math.max(p.fingerIndex, p.fingerMiddle, p.fingerRing, p.fingerPinky);
    return { name: 'hand', shells: handShells(hand, poseDefaults()), length: d0 + pl + longest + 1, male: true, rimDepth: null, hand: hand };
  }

  /* ------------------------------------------------------------------ */
  /* Assembly                                                            */
  /* ------------------------------------------------------------------ */
  function build(params) {
    const p = Object.assign({}, DEFAULTS, params || {});
    const fit = fitModel(p);
    const socket = buildSocket(p, fit);
    const tube = buildTube('tube', p.tubeLength, p.tubeWall);
    const wrist = buildTube('wrist', p.wristLength, p.tubeWall);
    const hand = buildHand(p);
    const parts = [socket, tube, wrist, hand];
    let o = 0;
    parts.forEach(function (pt, i) { pt.origin = o; pt.index = i; o += pt.length; });
    const info = summarize(p, fit, parts);
    return { params: p, fit: fit, parts: parts, info: info, totalLength: o };
  }

  function summarize(p, fit, parts) {
    const L = p.limbLength;
    const dia = function (d) { return 2 * (fit.rIn(d)); };
    return {
      sockMm: fit.sockMm, layers: fit.layers, allowance: fit.allowance,
      limbDia: [p.circProx, p.circMid, p.circDist].map(function (c) { return c / PI; }),
      innerDia: { rim: dia(0) - 2 * fit.flare(0), mid: dia(L / 2), distal: dia(L) },
      outerDia: { rim: dia(0) - 2 * fit.flare(0) + 2 * p.wall, distal: dia(L) + 2 * p.wall },
      lengths: { socket: parts[0].length, tube: parts[1].length, wrist: parts[2].length, hand: parts[3].length },
      total: parts.reduce(function (a, b) { return a + b.length; }, 0),
      volumeCm3: parts.map(function (pt) { return pt.shells.reduce(function (a, s) { return a + volume(s); }, 0) / 1000; })
    };
  }

  function validate(params) {
    const p = Object.assign({}, DEFAULTS, params || {});
    const fit = fitModel(p);
    const errors = [], warnings = [];
    const L = p.limbLength;
    const rDist = fit.rIn(L);
    if (rDist < J.Ro + 3.5)
      errors.push('The distal end is too narrow for the joint collar. Inside diameter must be at least ' +
        (2 * (J.Ro + 3.5)).toFixed(0) + ' mm; it is ' + (2 * rDist).toFixed(0) + ' mm. Increase the distal circumference.');
    if (p.wall < 2.4) errors.push('Socket wall is under 2.4 mm. Raise it to at least 2.4 mm.');
    if (p.tubeWall < 2.4) errors.push('Tube wall is under 2.4 mm. Raise it to at least 2.4 mm.');
    if (p.tubeLength < 45) errors.push('Forearm tube is shorter than 45 mm.');
    if (p.wristLength < 30) errors.push('Wrist adapter is shorter than 30 mm.');
    if (p.wall >= 2.4 && p.wall < 3) warnings.push('Socket wall under 3 mm is thin for daily loads. 3.5 mm or more is recommended.');
    if (p.tubeWall >= 2.4 && p.tubeWall < 3) warnings.push('Tube wall under 3 mm is thin for daily loads.');
    if (p.circProx < p.circMid - 0.5)
      warnings.push('The rim is narrower than the middle of the socket. The limb may not pass through the opening.');
    if (p.circMid < p.circDist - 0.5)
      warnings.push('The distal end is wider than the middle. Check the three circumference measurements.');
    if (fit.layers > 8)
      warnings.push('Sock and liner add ' + fit.layers.toFixed(1) + ' mm on each side. That is a lot of volume change; confirm fit with a clinician.');
    if (p.sockPlies > 0 && p.clearance < 0.8)
      warnings.push('With a sock, a clearance under 0.8 mm can make the socket tight once the sock is wet or bunched.');
    if (p.wristWidth > p.palmWidth)
      warnings.push('The wrist is wider than the palm. Check the palm and wrist widths.');
    if (p.fingerMiddle < p.fingerIndex - 1 || p.fingerMiddle < p.fingerRing - 1)
      warnings.push('The middle finger is shorter than a neighbour, which is unusual.');
    if (p.limbLength > 200) warnings.push('A long residual limb makes a long, heavy socket. Check print time and bed size.');
    return { errors: errors, warnings: warnings };
  }

  /* Placed (preview/assembled) triangles for one part. explode in mm per joint. */
  function placed(build, part, explode, lockEase) {
    const e = lockEase === undefined ? 1 : lockEase;           // 1 = locked, 0 = insertion pose
    const angle = part.index * J.lock * DEG * e;
    let t = part.shells.length ? concat(part.shells) : new Float32Array(0);
    if (angle) t = rotAxis(t, angle);
    return translate(t, 0, -(part.origin + part.index * explode), 0);
  }

  /* Ghost layers for the preview: skin, liner and sock around the limb. */
  function ghosts(build) {
    const p = build.params, fit = build.fit, L = p.limbLength;
    function solid(offset) {
      const rfl = Math.min(12, fit.rLimb(L) - 6);
      const dArc = L - rfl, cR = fit.rLimb(dArc) - rfl;
      const prof = [[0, -30]];
      for (let i = 0; i <= 30; i++) {
        const d = -30 + (dArc + 30) * i / 30;
        prof.push([fit.rLimb(Math.max(0, d)) + offset, d]);
      }
      for (let s = 1; s <= 10; s++) {
        const ph = (90 * s / 10) * DEG;
        prof.push([cR + (rfl + offset) * Math.cos(ph), dArc + (rfl + offset) * Math.sin(ph)]);
      }
      return revolve(prof, 0, 2 * PI, 64);
    }
    const out = { skin: solid(0) };
    if (p.linerMm > 0) out.liner = solid(p.linerMm);
    if (fit.sockMm > 0) out.sock = solid(p.linerMm + fit.sockMm);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Analysis and export                                                 */
  /* ------------------------------------------------------------------ */
  function volume(tris) {
    let v = 0;
    for (let i = 0; i < tris.length; i += 9) {
      const ax = tris[i], ay = tris[i + 1], az = tris[i + 2];
      const bx = tris[i + 3], by = tris[i + 4], bz = tris[i + 5];
      const cx = tris[i + 6], cy = tris[i + 7], cz = tris[i + 8];
      v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
    }
    return v / 6;
  }

  // Every directed edge must be matched by exactly one opposite edge.
  function checkClosed(tris) {
    const key = function (x, y, z) { return Math.round(x * 1e3) + ',' + Math.round(y * 1e3) + ',' + Math.round(z * 1e3); };
    const edges = new Map();
    let bad = 0, used = 0;
    for (let i = 0; i < tris.length; i += 9) {
      const v = [0, 1, 2].map(function (k) { return key(tris[i + 3 * k], tris[i + 3 * k + 1], tris[i + 3 * k + 2]); });
      if (v[0] === v[1] || v[1] === v[2] || v[0] === v[2]) continue;   // collapsed triangle
      used++;
      for (let k = 0; k < 3; k++) {
        const a = v[k], b = v[(k + 1) % 3];
        edges.set(a + '>' + b, (edges.get(a + '>' + b) || 0) + 1);
      }
    }
    edges.forEach(function (n, k) {
      const parts = k.split('>');
      if (n !== (edges.get(parts[1] + '>' + parts[0]) || 0)) bad++;
    });
    return { closed: bad === 0, openEdges: bad, triangles: used };
  }

  function bounds(tris) {
    const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let i = 0; i < tris.length; i += 3)
      for (let k = 0; k < 3; k++) {
        b.min[k] = Math.min(b.min[k], tris[i + k]); b.max[k] = Math.max(b.max[k], tris[i + k]);
      }
    return b;
  }

  /* Binary STL, converted to the slicer convention (Z up) and dropped onto the bed. */
  function toSTL(tris, name) {
    const n = tris.length / 9;
    const b = bounds(tris);
    const zShift = -b.min[1];
    const buf = new ArrayBuffer(84 + 50 * n);
    const dv = new DataView(buf);
    const head = ('Open Prosthetic Builder ' + (name || '')).slice(0, 79);
    for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i));
    dv.setUint32(80, n, true);
    const V = function (i) { return [tris[i], -tris[i + 2], tris[i + 1] + zShift]; };   // (x, y, z) -> (x, -z, y)
    let o = 84;
    for (let i = 0; i < tris.length; i += 9) {
      const a = V(i), c = V(i + 3), d = V(i + 6);
      const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2];
      const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / len, true); dv.setFloat32(o + 4, ny / len, true); dv.setFloat32(o + 8, nz / len, true);
      [a, c, d].forEach(function (v, k) {
        dv.setFloat32(o + 12 + 12 * k, v[0], true);
        dv.setFloat32(o + 16 + 12 * k, v[1], true);
        dv.setFloat32(o + 20 + 12 * k, v[2], true);
      });
      dv.setUint16(o + 48, 0, true);
      o += 50;
    }
    return buf;
  }

  const PRINT_NOTES = {
    socket: 'Print collar-down (the flat joint face on the bed). Layer height 0.2 mm, 4+ perimeters, 40%+ gyroid infill. Check the inside surface: a smooth, seam-free finish matters under a prosthetic sock. Sand or vapor-smooth the rim and the inside before use.',
    tube: 'Print collar-down with the male stub pointing up. 4+ perimeters, 40%+ gyroid infill. The lug underside is a short 3 mm overhang; test with and without supports.',
    wrist: 'Same orientation as the forearm tube.',
    hand: 'Printed rigid in the relaxed pose. Lay it on its back in your slicer (lay-flat) with the stub sideways; supports are needed under the stub lugs, thumb and fingers. The hand-segments folder holds each bone straight, with hand-joints.json listing every pivot, axis and range, for building a hinged version.'
  };

  return {
    J: J, DEFAULTS: DEFAULTS, LIMITS: LIMITS, PRINT_NOTES: PRINT_NOTES,
    build: build, validate: validate, placed: placed, ghosts: ghosts, fitModel: fitModel,
    volume: volume, checkClosed: checkClosed, bounds: bounds, toSTL: toSTL, concat: concat,
    translate: translate,
    HAND_ROM: HAND_ROM, DIGITS: DIGITS, FINGERS: FINGERS, poseDefaults: poseDefaults, preset: preset,
    handMatrices: handMatrices, handShells: handShells, jointTable: jointTable
  };
});
