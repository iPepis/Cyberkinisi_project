/*
 * Open Prosthetic Builder: parametric geometry engine (prototype v0.0.4)
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
    design: 'basic',   // 'basic' = smooth walls, 'honeycomb' = perforated socket and forearm tube
    hcHole: 7,         // honeycomb: average hole width (mm)
    hcStrut: 2.6,      // honeycomb: material between two holes (mm)
    hcExtra: 1.5,      // honeycomb: extra wall thickness that pays back the removed material (mm)
    wristLength: 40
  };

  const LIMITS = {
    limbLength: [60, 300, 1],
    circProx: [160, 500, 1],
    circMid: [160, 500, 1],
    circDist: [160, 460, 1],
    sockPlies: [0, 30, 1],
    plyMm: [0.4, 2, 0.05],
    clearance: [0.5, 6, 0.1],
    wall: [2.4, 15, 0.1],
    tubeLength: [45, 600, 1],
    hcHole: [4, 12, 0.5],
    hcStrut: [1.6, 6, 0.2],
    hcExtra: [0, 4, 0.1],
    tubeWall: [2.4, 11, 0.1],      // above 11 the bore would close on the male stub
    wristLength: [30, 200, 1]
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

  /* ---- transforms (return new arrays) ---- */
  function rotAxis(tris, a) {       // add `a` radians to the revolve angle
    const c = Math.cos(a), s = Math.sin(a), o = new Float32Array(tris.length);
    for (let i = 0; i < tris.length; i += 3) {
      const x = tris[i], z = tris[i + 2];
      o[i] = x * c - z * s; o[i + 1] = tris[i + 1]; o[i + 2] = x * s + z * c;
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

  /* ---- Forearm contour: one outside surface shared by socket, tube and wrist adapter ---- */
  // Monotone cubic through the points (no overshoot), with a chosen slope at the last point.
  function pchip(xs, ys, endSlope) {
    const n = xs.length, h = [], dl = [], m = new Array(n);
    for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; dl[i] = (ys[i + 1] - ys[i]) / h[i]; }
    m[0] = dl[0]; m[n - 1] = endSlope;
    for (let i = 1; i < n - 1; i++) m[i] = dl[i - 1] * dl[i] <= 0 ? 0 : 2 * dl[i - 1] * dl[i] / (dl[i - 1] + dl[i]);
    return function (x) {
      let i = 0;
      while (i < n - 2 && x > xs[i + 1]) i++;
      const t = clamp((x - xs[i]) / h[i], 0, 1), t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
    };
  }

  // Outside radius at depth d (mm from the socket rim). It follows the limb inside the socket with a
  // muscle swell, carries on below the socket, and narrows with a gentle concave curve to the wrist,
  // where it meets the hand's joint collar exactly. dS = socket length, T = depth of the wrist joint.
  function forearmProfile(p, fit, dS, T) {
    const L = p.limbLength, w = p.wall;
    const base = function (d) { return fit.rIn(d) - fit.flare(d) + w; };       // socket outside without the rim flare
    const r0 = base(0), r1 = base(L / 2) * 1.05, r2 = base(L) * 1.02;           // elbow end, muscle swell, end of the limb
    const rS = Math.max(J.Ro + 3, fit.rIn(L) + 0.95 * w, r2 + Math.min(0, (r2 - r1) / (L / 2)) * (dS - L));
    const mS = Math.min(0, (rS - r2) / (dS - L));
    const upper = pchip([0, L / 2, L, dS], [r0, r1, r2, rS], mS);
    return function (d) {
      if (d <= dS) return upper(Math.max(0, d)) + fit.flare(d);
      const span = T - dS, t = clamp((d - dS) / span, 0, 1), t2 = t * t, t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * rS + (t3 - 2 * t2 + t) * span * mS + (-2 * t3 + 3 * t2) * J.Ro;   // ends level at the wrist
    };
  }

  /* ---- Honeycomb: one irregular cell pattern (a Voronoi web) laid over the whole forearm ---- */
  // Seed points sit in rows around the arm, each row holding as many seeds as fit its own radius, and every
  // seed is nudged by a fixed pseudo-random amount. The wall is material wherever two seeds are almost
  // equally near, so the cells come out as irregular polygons with rounded corners and an even strut width,
  // and the cell size stays the same while the arm tapers. Depth D is measured from the socket rim and is
  // shared by every part, so the pattern carries on across the joints.
  function makeLattice(p, R, totalLen) {
    const a = p.hcHole, t = p.hcStrut, pitch = a + t;
    const rs = pitch * 0.866, nRows = Math.ceil(totalLen / rs) + 3, n = [];
    for (let k = 0; k < nRows; k++) n.push(Math.max(6, Math.round(2 * PI * R(Math.min(k * rs, totalLen)) / pitch)));
    const rnd = function (k, j, salt) {                          // fixed value in [-0.5, 0.5) for a seed
      let x = (Math.imul(k + 1, 374761393) ^ Math.imul(j + 7, 668265263) ^ Math.imul(salt, 2147483647)) >>> 0;
      x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0;
      return ((x ^ (x >>> 16)) >>> 0) / 4294967296 - 0.5;
    };
    const jit = 0.7;                                             // how far a seed may wander, in pitches
    return {
      // > 0 inside a hole, < 0 in material, 0 on the edge (a little under the mm from the edge). The strut
      // is at least hcStrut wide everywhere and a little wider where three cells meet.
      field: function (phi, D) {
        const k0 = Math.round(D / rs), Rl = R(D);
        let d1 = 1e9, d2 = 1e9;
        for (let k = Math.max(0, k0 - 2); k <= Math.min(nRows - 1, k0 + 2); k++) {
          const nk = n[k], dth = 2 * PI / nk, off = (k & 1) ? 0.5 : 0, j0 = Math.round(phi / dth - off);
          for (let j = j0 - 1; j <= j0 + 1; j++) {
            const jw = ((j % nk) + nk) % nk;
            let dphi = phi - (j + off + jit * rnd(k, jw, 1)) * dth;
            dphi -= 2 * PI * Math.round(dphi / (2 * PI));
            const dx = dphi * Rl, dy = D - (k + jit * rnd(k, jw, 2)) * rs;
            const dd = Math.sqrt(dx * dx + dy * dy);
            if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd;
          }
        }
        return (d2 - d1 - t) / 2;
      }
    };
  }

  // Perforated wall between inner(d) and outer(d) for depths d0..d1. The wall is sampled on a grid of
  // about 1 mm in (angle, depth) and the hole outlines are interpolated between grid points (marching squares),
  // so the holes come out smooth. Every face is shared with its neighbour, so the shell is closed.
  // z = { d0, d1, inner, outer, origin (global depth of the part), phase (angle the part is turned when locked) }
  function honeycombShell(lat, z) {
    const m = Math.max(4, Math.round((z.d1 - z.d0) / 1.0)), h = (z.d1 - z.d0) / m;
    let rmax = 0;
    for (let j = 0; j <= m; j++) rmax = Math.max(rmax, z.outer(z.d0 + j * h));
    const nt = Math.max(48, Math.round(2 * PI * rmax / 1.1 / 8) * 8), dth = 2 * PI / nt;
    const margin = 1.5;                                        // solid ring where the zone meets a solid band
    const g = new Float64Array(nt * (m + 1));
    let holes = 0;
    for (let j = 0; j <= m; j++) {
      const d = z.d0 + j * h, ramp = Math.min(d - z.d0 - margin, z.d1 - margin - d);
      for (let i = 0; i < nt; i++) {
        const v = Math.min(lat.field(i * dth + z.phase, z.origin + d), ramp);
        g[j * nt + i] = v; if (v > 0) holes++;
      }
    }
    const pt = function (r, th, d) { return [r * Math.cos(th), -d, r * Math.sin(th)]; };
    const out = [];
    const tri = function (a, b, c) { out.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); };
    const quad = function (a, b, c, d) { tri(a, b, c); tri(a, c, d); };
    const node = function (i, j) { return j * nt + (i % nt); };
    const solid = function (i, j) { return g[node(i, j)] <= 0; };
    // vertex pairs { i: inside point, o: outside point } at grid nodes and at hole outlines on grid edges
    const corner = {}, hEdge = {}, vEdge = {};
    const cornerAt = function (i, j) {
      const k = node(i, j); if (corner[k]) return corner[k];
      const d = z.d0 + j * h, th = (i % nt) * dth;
      return (corner[k] = { i: pt(z.inner(d), th, d), o: pt(z.outer(d), th, d), iso: false });
    };
    const cross = function (ga, gb) { return clamp(ga / (ga - gb), 1e-3, 1 - 1e-3); };
    const hAt = function (i, j) {                              // between node (i,j) and (i+1,j)
      const k = node(i, j); if (hEdge[k]) return hEdge[k];
      const d = z.d0 + j * h, th = ((i % nt) + cross(g[k], g[node(i + 1, j)])) * dth;
      return (hEdge[k] = { i: pt(z.inner(d), th, d), o: pt(z.outer(d), th, d), iso: true });
    };
    const vAt = function (i, j) {                              // between node (i,j) and (i,j+1)
      const k = node(i, j); if (vEdge[k]) return vEdge[k];
      const d = z.d0 + (j + cross(g[k], g[node(i, j + 1)])) * h, th = (i % nt) * dth;
      return (vEdge[k] = { i: pt(z.inner(d), th, d), o: pt(z.outer(d), th, d), iso: true });
    };
    for (let j = 0; j < m; j++) for (let i = 0; i < nt; i++) {
      const s = [solid(i, j), solid(i + 1, j), solid(i + 1, j + 1), solid(i, j + 1)];
      const c = [cornerAt(i, j), cornerAt(i + 1, j), cornerAt(i + 1, j + 1), cornerAt(i, j + 1)];
      const e = [function () { return hAt(i, j); }, function () { return vAt(i + 1, j); }, function () { return hAt(i, j + 1); }, function () { return vAt(i, j); }];
      const poly = [];
      for (let k = 0; k < 4; k++) {
        if (s[k]) poly.push(c[k]);
        if (s[k] !== s[(k + 1) % 4]) poly.push(e[k]());
      }
      const n = poly.length;
      if (n < 3) continue;
      let cen = null;
      if (n > 4) {                                             // centre point for the five or six sided pieces
        const ci = [0, 0, 0], co = [0, 0, 0];
        poly.forEach(function (q) { for (let a = 0; a < 3; a++) { ci[a] += q.i[a] / n; co[a] += q.o[a] / n; } });
        cen = { i: ci, o: co };
      }
      for (let k = 1; k < (cen ? n + 1 : n - 1); k++) {
        const A = cen || poly[0], B = cen ? poly[k - 1] : poly[k], C = cen ? poly[k % n] : poly[k + 1];
        tri(A.o, B.o, C.o);                                    // outside face
        tri(A.i, C.i, B.i);                                    // inside face
      }
      for (let k = 0; k < n; k++) {                            // wall of the hole
        const P = poly[k], Q = poly[(k + 1) % n];
        if (P.iso && Q.iso) quad(P.i, Q.i, Q.o, P.o);
      }
    }
    for (let i = 0; i < nt; i++) {                             // flat end faces, where the zone meets the solid bands
      const A = cornerAt(i, 0), B = cornerAt(i + 1, 0), C = cornerAt(i + 1, m), D = cornerAt(i, m);
      quad(A.i, B.i, B.o, A.o);
      quad(D.i, D.o, C.o, C.i);
    }
    return { shell: new Float32Array(out), open: holes / (nt * (m + 1)) };
  }

  function buildSocket(p, fit, R, dS, lat) {
    const w = p.wall, L = p.limbLength;
    const yf = L + fit.distalGap;                   // inner floor depth
    const rd = fit.rIn(L);
    const rf = clamp(rd - (J.Ro + 1.5), 2, 10);
    const dArc = yf - rf;                           // where the distal fillet starts
    const rArc = fit.rIn(dArc);
    const cR = rArc - rf, cD = dArc;                // fillet centre
    const N = 56;
    const outer = function (d) { return Math.max(R(d), d <= L ? fit.rIn(d) + w : 0); };   // never thinner than the wall
    const innerTo = function (d0, d1, n) { const a = []; for (let i = 0; i <= n; i++) { const d = d0 + (d1 - d0) * i / n; a.push([fit.rIn(d), d]); } return a; };
    const outerUp = function (dFrom, dTo, n) { const a = []; for (let i = 0; i <= n; i++) { const d = dFrom + (dTo - dFrom) * i / n; a.push([outer(d), d]); } return a; };
    const fillet = [];
    for (let s = 1; s <= 10; s++) {                 // inner fillet, 0..90 degrees
      const ph = (90 * s / 10) * DEG;
      fillet.push([cR + rf * Math.cos(ph), cD + rf * Math.sin(ph)]);
    }
    const tail = [[0, yf], [0, dS - J.cavity], [J.Rl, dS - J.cavity], [J.Rl, dS]];   // solid below the floor, joint cavity opens at the end face
    const hw = (outer(0) - fit.rIn(0)) / 2, rcRim = fit.rIn(0) + hw;
    const roll = [];
    for (let s = 1; s < 12; s++) { const ph = PI * s / 12; roll.push([rcRim + hw * Math.cos(ph), -hw * Math.sin(ph)]); }   // rolled rim over the top
    const Da = 14, Db = dArc - 3;                   // honeycomb zone: below the rim band, above the floor fillet
    let shells, open = null;
    if (lat && Db - Da >= 12) {
      const hc = honeycombShell(lat, { d0: Da, d1: Db, inner: fit.rIn, outer: outer, origin: 0, phase: 0 });
      open = hc.open;
      shells = [
        revolve(innerTo(0, Da, 12).concat(outerUp(Da, 0, 12), roll), 0, 2 * PI, 96),
        hc.shell,
        revolve(innerTo(Db, dArc, 12).concat(fillet, tail, outerUp(dS, Db, N)), 0, 2 * PI, 96)
      ];
    } else {
      shells = [revolve(innerTo(0, dArc, N).concat(fillet, tail, outerUp(dS, 0, N), roll), 0, 2 * PI, 96)];
    }
    shells = shells.concat(ledgeShells(dS));
    return { name: 'socket', shells: shells, length: dS, male: false, rimDepth: dS, hcOpen: open };
  }

  // Forearm tube and wrist adapter share one design: male stub on the proximal end, female collar on the
  // distal end, outside following the shared forearm contour, hollow in between.
  function buildTube(name, L, wall, origin, R, lat, index) {
    const out = function (d) { return R(origin + d); };
    // the inside opens at 45 degrees from the stub so the roof prints without supports
    const bore = function (d) { return Math.min(out(d) - wall, J.Rmi + (d - J.shoulder)); };
    const N = 40, d0 = L - J.collarH;
    const outerRun = function (dFrom, dTo, n) { const a = []; for (let i = 0; i <= n; i++) { const d = dFrom + (dTo - dFrom) * i / n; a.push([out(d), d]); } return a; };
    const boreRun = function (dFrom, dTo, n) { const a = []; for (let i = 0; i <= n; i++) { const d = dFrom + (dTo - dFrom) * i / n; a.push([bore(d), d]); } return a; };
    const stub = [[J.Rmi, -J.stubLen], [J.Rm, -J.stubLen], [J.Rm, 0]];
    const collar = [[J.Rl, L], [J.Rl, L - J.cavity], [0, L - J.cavity], [0, d0]];
    let Da = 12;                                    // honeycomb starts once the 45 degree funnel has met the wall
    while (Da < L && J.Rmi + (Da - J.shoulder) < out(Da) - wall) Da++;
    Da += 2;
    const Db = d0 - 4;
    let shells, open = null;
    if (lat && Db - Da >= 12) {
      const hc = honeycombShell(lat, { d0: Da, d1: Db, inner: bore, outer: out, origin: origin, phase: index * J.lock * DEG });
      open = hc.open;
      shells = [
        revolve(stub.concat(outerRun(0, Da, 12), boreRun(Da, J.shoulder, N)), 0, 2 * PI, 96),
        hc.shell,
        revolve(outerRun(Db, L, N).concat(collar, boreRun(d0, Db, N)), 0, 2 * PI, 96)
      ];
    } else {
      shells = [revolve(stub.concat(outerRun(0, L, N), collar, boreRun(d0, J.shoulder, N)), 0, 2 * PI, 96)];
    }
    shells = shells.concat(lugShells(), ledgeShells(L));
    return { name: name, shells: shells, length: L, male: true, rimDepth: L, hcOpen: open };
  }

  /* ------------------------------------------------------------------ */
  /* Hand: imported palm and fingers, joined at their hinge pins         */
  /* ------------------------------------------------------------------ */
  // The palm (a hollow gauntlet) and the finger bones come from "Hand" by BQEducacion
  // (Thingiverse thing:1095104, CC BY-SA). Their triangles are used exactly as published: this file
  // only moves them. tools/import_hand.py finds the hinge-pin holes and writes web/assets/hand/hand-rig.json,
  // which holds the rigid transform of every part and the pivot of every joint.
  //
  // Hand frame (before the part is turned for the arm): wrist opening at depth HAND_RIM, fingers point
  // along -y (world y = -depth), +z is the palm side, millimetres. Positive flexion bends a finger toward +z.
  // Each finger and the thumb have two joints, as printed: the knuckle (proximal bone about the palm pin)
  // and the tip joint (distal bone about the pin at the end of the proximal bone). The thumb sits on the
  // opposite wall of the palm and bends toward the fingers (-z). The printed link bars are not placed;
  // see README.md.
  const FINGERS = ['index', 'middle', 'ring', 'pinky'];
  const DIGITS = FINGERS.concat(['thumb']);
  const HAND_ROM = {};
  function rom(key, label, group, min, max, def) { HAND_ROM[key] = { label: label, group: group, min: min, max: max, def: def }; }
  FINGERS.forEach(function (f) {
    rom(f + '_mcp', 'Knuckle', f, 0, 90, 12);
    rom(f + '_pip', 'Fingertip joint', f, 0, 100, 10);   // the parts touch at about 104 degrees
  });
  rom('thumb_mcp', 'Thumb base joint', 'thumb', 0, 90, 10);
  rom('thumb_pip', 'Thumb tip joint', 'thumb', 0, 100, 10);
  const CURL_KEYS = {};
  DIGITS.forEach(function (f) { CURL_KEYS[f] = [f + '_mcp', f + '_pip']; });

  function poseDefaults() {
    const o = {};
    Object.keys(HAND_ROM).forEach(function (k) { o[k] = HAND_ROM[k].def; });
    return o;
  }
  function preset(name) {
    const o = poseDefaults();
    const set = function (k, v) { o[k] = v; };
    if (name === 'open') {
      DIGITS.forEach(function (f) { set(f + '_mcp', 0); set(f + '_pip', 0); });
    } else if (name === 'fist') {
      FINGERS.forEach(function (f) { set(f + '_mcp', 85); set(f + '_pip', 95); });
      set('thumb_mcp', 0); set('thumb_pip', 0);      // a bent thumb would hit the curled fingers
    } else if (name === 'hook') {
      FINGERS.forEach(function (f) { set(f + '_mcp', 8); set(f + '_pip', 85); });
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
  function m4det3(M) {
    return M[0] * (M[5] * M[10] - M[6] * M[9]) - M[1] * (M[4] * M[10] - M[6] * M[8]) + M[2] * (M[4] * M[9] - M[5] * M[8]);
  }
  // Applies a rigid transform. A mirroring transform would turn the surface inside out, so its
  // triangles get their winding reversed.
  function m4apply(tris, M) {
    const o = new Float32Array(tris.length);
    for (let i = 0; i < tris.length; i += 3) {
      const x = tris[i], y = tris[i + 1], z = tris[i + 2];
      o[i] = M[0] * x + M[1] * y + M[2] * z + M[3];
      o[i + 1] = M[4] * x + M[5] * y + M[6] * z + M[7];
      o[i + 2] = M[8] * x + M[9] * y + M[10] * z + M[11];
    }
    if (m4det3(M) < 0) {
      for (let i = 0; i < o.length; i += 9)
        for (let k = 0; k < 3; k++) { const t = o[i + 3 + k]; o[i + 3 + k] = o[i + 6 + k]; o[i + 6 + k] = t; }
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
    const out = hand.base.map(function (sh) { return sh; });
    hand.segments.forEach(function (sg, i) {
      const M = m4mul(pre, P[i]);
      sg.shells.forEach(function (sh) { out.push(m4apply(sh, M)); });
    });
    return out;
  }

  function jointTable(hand) {
    return {
      note: 'Hand frame: palm side is +z, fingers point along -y, millimetres, wrist opening at y = ' + (-hand.rim).toFixed(2) + '. Rotate each segment about its pivot along the axis; positive flexion bends toward the palm. Apply parents first. The imported palm and finger bones are the unchanged Thingiverse meshes.',
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

  /* ---- imported meshes ---- */
  const ASSET_FILES = ['palm.stl', 'links.stl', 'thumb_prox.stl', 'thumb_dist.stl'];
  FINGERS.forEach(function (f) { ASSET_FILES.push('finger_' + f + '_prox.stl', 'finger_' + f + '_dist.stl'); });
  let HAND_ASSETS = null;           // { rig, bytes: {file: Uint8Array}, tris: {file: Float32Array} }
  const handCache = {};

  // Binary STL to a list of triangles (9 floats each). The normals in the file are not used.
  function parseSTL(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const n = dv.getUint32(80, true);
    if (84 + 50 * n !== u8.byteLength) throw new Error('not a binary STL');
    const o = new Float32Array(n * 9);
    for (let i = 0; i < n; i++)
      for (let k = 0; k < 9; k++) o[i * 9 + k] = dv.getFloat32(84 + 50 * i + 12 + 4 * k, true);
    return o;
  }

  // rig: the parsed hand-rig.json. files: { 'palm.stl': ArrayBuffer | Uint8Array, ... } (see ASSET_FILES).
  function setHandAssets(rig, files) {
    const bytes = {}, tris = {};
    ASSET_FILES.forEach(function (name) {
      if (!files[name]) throw new Error('missing hand file ' + name);
      bytes[name] = files[name] instanceof Uint8Array ? files[name] : new Uint8Array(files[name]);
    });
    HAND_ASSETS = { rig: rig, bytes: bytes, tris: tris };
    Object.keys(handCache).forEach(function (k) { delete handCache[k]; });
  }
  function handReady() { return !!HAND_ASSETS; }
  function handFile(name) {         // the original file bytes, for the download
    if (!HAND_ASSETS) throw new Error('hand files are not loaded');
    return HAND_ASSETS.bytes[name];
  }
  function handTris(name) {
    if (!HAND_ASSETS) throw new Error('hand files are not loaded');
    if (!HAND_ASSETS.tris[name]) HAND_ASSETS.tris[name] = parseSTL(HAND_ASSETS.bytes[name]);
    return HAND_ASSETS.tris[name];
  }

  // The same triangles reflected across x = cx (for the left hand). Winding is reversed to keep the surface outward.
  function mirrorSTL(bytes, cx) {
    const out = new Uint8Array(bytes), dv = new DataView(out.buffer);
    const n = dv.getUint32(80, true);
    for (let i = 0; i < n; i++) {
      const o = 84 + 50 * i;
      dv.setFloat32(o, -dv.getFloat32(o, true), true);                       // normal x
      for (let v = 0; v < 3; v++) dv.setFloat32(o + 12 + 12 * v, cx - dv.getFloat32(o + 12 + 12 * v, true), true);
      for (let k = 0; k < 12; k++) {                                          // swap vertex 1 and 2
        const t = out[o + 24 + k]; out[o + 24 + k] = out[o + 36 + k]; out[o + 36 + k] = t;
      }
    }
    return out;
  }
  // The published parts exactly as they were imported: file name to bytes. The left palm is the mirror of the right.
  function handPrintFiles(side) {
    if (!HAND_ASSETS) throw new Error('hand files are not loaded');
    const out = {};
    ASSET_FILES.forEach(function (n) {
      out[n] = n === 'palm.stl' && side === 'left' ? mirrorSTL(HAND_ASSETS.bytes[n], HAND_ASSETS.rig.mirrorX) : HAND_ASSETS.bytes[n];
    });
    return out;
  }
  const HAND_ATTRIBUTION = [
    'Palm, finger bones, link bars and thumb bones in this folder',
    '',
    '  "Hand" by BQEducacion (author page: http://www.soniaverdu.es/)',
    '  https://www.thingiverse.com/thing:1095104',
    '  Licence: Creative Commons Attribution-ShareAlike (CC BY-SA), as listed on the Thingiverse page.',
    '',
    'The triangles are the author\'s, split into separate files and nothing else. The left palm is the right palm reflected.',
    'Anything you build from them must keep this credit and be shared under the same licence.',
    'Original parts list and assembly notes: the Thingiverse page above.'
  ].join('\n');

  // Wrist adapter plate: a neck from the standard collar flares into a saddle that sits under the
  // palm's wrist opening. Radius of a convex outline (centre at the origin) along each angle.
  const ADAPTER = { neck: 22, plate: 5, margin: 2.5, ring: 48 };
  function outlineAtAngles(hull, n, margin) {
    const out = [];
    for (let k = 0; k < n; k++) {
      const a = 2 * PI * k / n, dx = Math.cos(a), dz = Math.sin(a);
      let best = 0;
      for (let i = 0; i < hull.length; i++) {            // ray from the origin against each hull edge
        const p = hull[i], q = hull[(i + 1) % hull.length];
        const ex = q[0] - p[0], ez = q[1] - p[1];
        const den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-12) continue;
        const t = (p[0] * ez - p[1] * ex) / den, u = (p[0] * dz - p[1] * dx) / den;
        if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.max(best, t);
      }
      out.push([dx * (best + margin), dz * (best + margin)]);
    }
    return out;
  }

  function buildHand(p) {
    if (!HAND_ASSETS) throw new Error('The hand files are not loaded. Call OPB.setHandAssets() first.');
    if (handCache[p.side]) return handCache[p.side];
    const side = HAND_ASSETS.rig.sides[p.side];
    // the rig is centred on the wrist opening; hull points are (x, z) about its centre
    const hull = side.rimHull;
    let cx = 0, cz = 0;
    hull.forEach(function (h) { cx += h[0]; cz += h[1]; });
    cx /= hull.length; cz /= hull.length;
    const centred = hull.map(function (h) { return [h[0] - cx, h[1] - cz]; });
    const d0 = J.shoulder - 1;
    const rim = J.shoulder + ADAPTER.neck + ADAPTER.plate;        // depth of the palm's wrist opening
    const toPart = function (M) { const o = M.slice(); o[7] -= rim; return o; };   // y = -depth
    const pivot = function (v) { return [v[0], v[1] - rim, v[2]]; };

    const outline = outlineAtAngles(centred, ADAPTER.ring, ADAPTER.margin);
    const circle = outline.map(function (q, k) {
      const a = 2 * PI * k / ADAPTER.ring;
      return [(J.Ro - 0.6) * Math.cos(a), (J.Ro - 0.6) * Math.sin(a)];
    });
    const shift = function (pts) { return pts.map(function (q) { return [q[0] + cx, q[1] + cz]; }); };
    const plate = loft([
      { pts: circle, y: -d0 },
      { pts: shift(outline), y: -(J.shoulder + ADAPTER.neck) },
      { pts: shift(outline), y: -rim }
    ]);
    const base = [revolve([[J.Rmi, -J.stubLen], [J.Rm, -J.stubLen], [J.Rm, 0], [J.Ro, 0], [J.Ro, J.shoulder], [J.Rmi, J.shoulder]], 0, 2 * PI, 72), plate]
      .concat(lugShells());

    const segments = [];
    const add = function (id, parent, pv, dofs, shells) {
      segments.push({ id: id, parent: parent, pivot: pv, dofs: dofs, shells: shells });
      return segments.length - 1;
    };
    const palmIdx = add('palm', -1, null, [], [m4apply(handTris('palm.stl'), toPart(side.palm.matrix))]);
    const FLEX = [-1, 0, 0];                                      // bends a finger pointing along -y toward +z
    FINGERS.forEach(function (f) {
      const e = side.fingers[f];
      const prox = add(f + '_prox', palmIdx, pivot(e.prox.pivot), [{ key: f + '_mcp', axis: FLEX, sign: 1 }],
        [m4apply(handTris(e.prox.file), toPart(e.prox.matrix))]);
      add(f + '_dist', prox, pivot(e.dist.pivot), [{ key: f + '_pip', axis: FLEX, sign: 1 }],
        [m4apply(handTris(e.dist.file), toPart(e.dist.matrix))]);
    });
    const th = side.thumb, TFLEX = [1, 0, 0];                      // the thumb bends toward the fingers (-z)
    const tprox = add('thumb_prox', palmIdx, pivot(th.prox.pivot), [{ key: 'thumb_mcp', axis: TFLEX, sign: 1 }],
      [m4apply(handTris(th.prox.file), toPart(th.prox.matrix))]);
    add('thumb_dist', tprox, pivot(th.dist.pivot), [{ key: 'thumb_pip', axis: TFLEX, sign: 1 }],
      [m4apply(handTris(th.dist.file), toPart(th.dist.matrix))]);

    const hand = { segments: segments, base: base, pre: -3 * J.lock * DEG, rim: rim };
    // length: down to the farthest fingertip with every finger open
    const open = handShells({ segments: segments, base: [], pre: 0 }, preset('open'));
    const bb = bounds(concat(open));
    const res = { name: 'hand', shells: handShells(hand, poseDefaults()), length: -bb.min[1] + 1, male: true, rimDepth: null, hand: hand };
    handCache[p.side] = res;
    return res;
  }

  /* ------------------------------------------------------------------ */
  /* Assembly                                                            */
  /* ------------------------------------------------------------------ */
  function build(params) {
    const p = Object.assign({}, DEFAULTS, params || {});
    const fit = fitModel(p);
    const hc = p.design === 'honeycomb';
    // Honeycomb makes every wall thicker by hcExtra so the removed material is paid back.
    const pe = hc ? Object.assign({}, p, { wall: p.wall + p.hcExtra, tubeWall: Math.min(11, p.tubeWall + p.hcExtra) }) : p;
    const dS = p.limbLength + fit.distalGap + pe.wall + J.collarH;      // socket length, known before it is built
    const total = dS + p.tubeLength + p.wristLength;
    const R = forearmProfile(pe, fit, dS, total);
    const lat = hc ? makeLattice(p, R, total + 200) : null;
    const socket = buildSocket(pe, fit, R, dS, lat);
    const tube = buildTube('tube', p.tubeLength, pe.tubeWall, dS, R, lat, 1);
    const wrist = buildTube('wrist', p.wristLength, pe.tubeWall, dS + p.tubeLength, R, null, 2);   // shorter than the pattern needs, stays solid
    const hand = buildHand(p);
    const parts = [socket, tube, wrist, hand];
    let o = 0;
    parts.forEach(function (pt, i) { pt.origin = o; pt.index = i; o += pt.length; });
    const info = summarize(p, fit, parts, R);
    return { params: p, fit: fit, parts: parts, info: info, totalLength: o, forearm: R, lattice: lat };
  }

  function summarize(p, fit, parts, R) {
    const L = p.limbLength;
    const dia = function (d) { return 2 * (fit.rIn(d)); };
    return {
      sockMm: fit.sockMm, layers: fit.layers, allowance: fit.allowance,
      limbDia: [p.circProx, p.circMid, p.circDist].map(function (c) { return c / PI; }),
      innerDia: { rim: dia(0) - 2 * fit.flare(0), mid: dia(L / 2), distal: dia(L) },
      outerDia: { rim: 2 * (R(0) - fit.flare(0)), distal: 2 * R(parts[0].length) },
      lengths: { socket: parts[0].length, tube: parts[1].length, wrist: parts[2].length, hand: parts[3].length },
      total: parts.reduce(function (a, b) { return a + b.length; }, 0),
      honeycomb: p.design === 'honeycomb' ? { socket: parts[0].hcOpen, tube: parts[1].hcOpen } : null,
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
    const dS = L + fit.distalGap + p.wall + J.collarH;
    const taper = (forearmProfile(p, fit, dS, dS + p.tubeLength + p.wristLength)(dS) - J.Ro) / (p.tubeLength + p.wristLength);
    if (taper > 0.45)
      warnings.push('The forearm narrows sharply from the socket to the wrist. Lengthen the tube or wrist adapter for a natural shape.');
    if (p.design === 'honeycomb') {
      if (p.hcHole > 9) warnings.push('Honeycomb cells over 9 mm let the sock or skin push through. Use smaller holes against the skin.');
      if (p.hcStrut < 2.4) warnings.push('Honeycomb struts under 2.4 mm are thin for a 0.4 mm nozzle and for daily loads.');
      if (p.hcHole / (p.hcHole + p.hcStrut) > 0.78) warnings.push('More than half of the wall is open. Add strut width or extra wall.');
    }
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
    hand: 'hand.stl is only the new adapter that joins the palm to the standard joint; print it collar-down like the other joint parts. The palm, fingers, link bars and thumb are the published files in the hand folder, already lying as the author printed them. Their pins are 1.75 mm filament, the fingers are pulled by fishing line and returned by elastic cord, and a fabric strap with velcro holds the palm on, as described on the Thingiverse page.'
  };

  return {
    J: J, DEFAULTS: DEFAULTS, LIMITS: LIMITS, PRINT_NOTES: PRINT_NOTES,
    build: build, validate: validate, placed: placed, ghosts: ghosts, fitModel: fitModel,
    volume: volume, checkClosed: checkClosed, bounds: bounds, toSTL: toSTL, concat: concat,
    translate: translate,
    HAND_ROM: HAND_ROM, DIGITS: DIGITS, FINGERS: FINGERS, CURL_KEYS: CURL_KEYS, poseDefaults: poseDefaults, preset: preset,
    handMatrices: handMatrices, handShells: handShells, jointTable: jointTable,
    ASSET_FILES: ASSET_FILES, setHandAssets: setHandAssets, handReady: handReady, handFile: handFile, handPrintFiles: handPrintFiles,
    HAND_ATTRIBUTION: HAND_ATTRIBUTION, parseSTL: parseSTL
  };
});
