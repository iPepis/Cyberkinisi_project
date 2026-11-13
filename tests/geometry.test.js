// Run with: node tests/geometry.test.js
const assert = require('assert');
const OPB = require('../tools/load-hand.js')(require('../web/src/geometry.js'));

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('ok   ', name); }
  catch (e) { failures++; console.log('FAIL ', name, '\n      ', e.message); }
}

const cases = {
  'default right arm': {},
  'left arm, long limb, thick sock': { side: 'left', limbLength: 200, sockPlies: 10, linerMm: 3 },
  'short limb, no sock, flat rim': { limbLength: 70, sockPlies: 0, flare: false, circProx: 220, circMid: 205, circDist: 175 },
  'extremes of the sliders': { limbLength: 300, circProx: 500, circMid: 500, circDist: 460, sockPlies: 30, linerMm: 6, clearance: 6, wall: 15, tubeLength: 600, tubeWall: 11, wristLength: 200 }
};

for (const [label, params] of Object.entries(cases)) {
  const b = OPB.build(params);
  b.parts.forEach(part => {
    check(label + ' / ' + part.name + ': every shell is closed and outward-facing', () => {
      part.shells.forEach((s, i) => {
        const c = OPB.checkClosed(s);
        assert.ok(c.closed, 'shell ' + i + ' has ' + c.openEdges + ' unmatched edges');
        assert.ok(OPB.volume(s) > 0, 'shell ' + i + ' has non-positive volume ' + OPB.volume(s));
      });
    });
  });
}

check('socket inner diameter = limb + 2 x (sock + liner + clearance)', () => {
  const p = { circMid: 225, sockPlies: 4, plyMm: 0.8, linerMm: 3, clearance: 1 };
  const b = OPB.build(p);
  const expected = 225 / Math.PI + 2 * (4 * 0.8 + 3 + 1);
  assert.ok(Math.abs(b.info.innerDia.mid - expected) < 1e-6, b.info.innerDia.mid + ' vs ' + expected);
});

check('more sock plies make the socket wider and longer', () => {
  const a = OPB.build({ sockPlies: 0 }), c = OPB.build({ sockPlies: 10 });
  assert.ok(c.info.innerDia.mid > a.info.innerDia.mid + 10);
  assert.ok(c.info.lengths.socket > a.info.lengths.socket);
});

check('each part length slider changes only its own part', () => {
  const a = OPB.build({ tubeLength: 150 }), c = OPB.build({ tubeLength: 200 });
  assert.strictEqual(c.info.lengths.tube - a.info.lengths.tube, 50);
  assert.strictEqual(c.info.lengths.socket, a.info.lengths.socket);
  assert.strictEqual(c.info.lengths.hand, a.info.lengths.hand);
  assert.strictEqual(c.info.total - a.info.total, 50);
});

check('male stub and female cavity share the same joint dimensions (lug fits gap, stub fits ledge)', () => {
  const J = OPB.J;
  assert.ok(J.Rl >= J.Rm + J.lugR + 0.4, 'cavity radius must clear the lugs');
  assert.ok(J.Rf > J.Rm, 'ledge opening must clear the stub');
  assert.ok(J.lugA1 - J.lugA0 < 60, 'lug must be narrower than the 60 degree gap');
  assert.ok(J.lugFromShoulder > J.ledgeT, 'lug must sit above the ledge');
  assert.ok(J.lugFromShoulder + J.lugH < J.cavity, 'lug must clear the cavity roof');
  assert.ok(J.stubLen < J.cavity, 'stub tip must not hit the roof');
  // after the quarter turn the lug sits under the ledge and stops before the stop block
  assert.ok(J.lugA1 + J.lock <= J.stopA0, 'lug must stop against the rotation stop');
  assert.ok(J.lugA0 + J.lock >= J.ledgeA0 && J.lugA1 + J.lock <= J.ledgeA1, 'locked lug lies under the ledge');
});

check('validation blocks a distal end too narrow for the joint', () => {
  const v = OPB.validate({ circDist: 140, circMid: 140, circProx: 140, sockPlies: 0, clearance: 0.5 });
  assert.ok(v.errors.length > 0);
  // the smallest value the sliders allow must still build a valid socket
  const lo = OPB.LIMITS;
  const ok = OPB.validate({ circProx: lo.circProx[0], circMid: lo.circMid[0], circDist: lo.circDist[0], sockPlies: 0, clearance: lo.clearance[0] });
  assert.deepStrictEqual(ok.errors, []);
});

check('default design validates with no errors', () => {
  const v = OPB.validate({});
  assert.deepStrictEqual(v.errors, []);
});

check('STL export has the right triangle count and starts on the bed', () => {
  const b = OPB.build({});
  const t = OPB.concat(b.parts[1].shells);
  const buf = OPB.toSTL(t, 'tube');
  const dv = new DataView(buf);
  assert.strictEqual(dv.getUint32(80, true), t.length / 9);
  assert.strictEqual(buf.byteLength, 84 + 50 * (t.length / 9));
  let minZ = Infinity;
  for (let i = 0; i < t.length / 9; i++) for (let k = 0; k < 3; k++) minZ = Math.min(minZ, dv.getFloat32(84 + 50 * i + 12 + 12 * k + 8, true));
  assert.ok(Math.abs(minZ) < 1e-4, 'min z is ' + minZ);
});

check('forearm: one contour, seamless at every joint and ending on the hand collar', () => {
  [{}, { limbLength: 200, sockPlies: 10, linerMm: 6 }, { tubeLength: 300, wristLength: 80 }].forEach(params => {
    const b = OPB.build(params), R = b.forearm, J = OPB.J;
    assert.ok(Math.abs(R(b.parts[3].origin) - J.Ro) < 1e-6, 'must meet the hand collar radius');
    const maxR = part => { const bb = OPB.bounds(OPB.concat(part.shells)); return Math.max(bb.max[0], bb.max[2], -bb.min[0], -bb.min[2]); };
    assert.ok(Math.abs(maxR(b.parts[1]) - R(b.parts[1].origin)) < 0.05, 'tube starts at the socket end radius');
    assert.ok(Math.abs(maxR(b.parts[2]) - R(b.parts[2].origin)) < 0.05, 'wrist adapter starts at the tube end radius');
    let prev = R(b.parts[0].length);
    for (let d = b.parts[0].length; d <= b.parts[3].origin; d += 2) {
      const r = R(d);
      assert.ok(r <= prev + 1e-9, 'the forearm must only narrow below the socket (d=' + d + ')');
      assert.ok(Math.abs(r - prev) < 3, 'no steps in the outline');
      prev = r;
    }
    // wall under the socket: contour never closer to the limb than the wall setting
    for (let d = 0; d <= params.limbLength || d <= 140; d += 5) {
      const inner = b.fit.rIn(Math.min(d, b.params.limbLength));
      assert.ok(Math.max(R(d), inner + b.params.wall) - inner >= b.params.wall - 1e-9);
    }
  });
});

check('forearm: sharp taper to the wrist is flagged', () => {
  assert.ok(OPB.validate({ circProx: 500, circMid: 500, circDist: 460, tubeLength: 45, wristLength: 30 }).warnings.some(w => /narrows sharply/.test(w)));
  assert.ok(!OPB.validate({}).warnings.some(w => /narrows sharply/.test(w)));
});

const hcCases = { 'honeycomb default': {}, 'honeycomb long, thick sock, left': { side: 'left', limbLength: 200, sockPlies: 8, tubeLength: 300 }, 'honeycomb short and fine': { limbLength: 70, tubeLength: 60, hcHole: 4, hcStrut: 1.6 }, 'honeycomb coarse': { hcHole: 12, hcStrut: 6, hcExtra: 4 } };
for (const [label, params] of Object.entries(hcCases)) {
  const b = OPB.build(Object.assign({ design: 'honeycomb' }, params));
  b.parts.forEach(part => check(label + ' / ' + part.name + ': every shell is closed and outward-facing', () => {
    part.shells.forEach((s, i) => {
      const c = OPB.checkClosed(s);
      assert.ok(c.closed, 'shell ' + i + ' has ' + c.openEdges + ' unmatched edges');
      assert.ok(OPB.volume(s) > 0, 'shell ' + i + ' has non-positive volume');
    });
  }));
}

check('honeycomb: holes open the wall, the walls get thicker, and the basic design is untouched', () => {
  const hc = OPB.build({ design: 'honeycomb' }), bs = OPB.build({});
  assert.ok(hc.info.honeycomb.socket > 0.3 && hc.info.honeycomb.socket < 0.6, 'socket open area ' + hc.info.honeycomb.socket);
  assert.ok(hc.info.honeycomb.tube > 0.3 && hc.info.honeycomb.tube < 0.6, 'tube open area ' + hc.info.honeycomb.tube);
  assert.strictEqual(bs.info.honeycomb, null);
  assert.ok(hc.info.lengths.socket > bs.info.lengths.socket, 'socket floor wall grows with hcExtra');
  const solid = OPB.build({ design: 'honeycomb', hcHole: 4, hcStrut: 6 });
  assert.ok(OPB.validate({ design: 'honeycomb', hcHole: 11, hcStrut: 1.8 }).warnings.length >= 2);
  assert.ok(solid.info.honeycomb.socket < hc.info.honeycomb.socket, 'smaller holes, less open area');
  // the basic parts must not change
  assert.deepStrictEqual(OPB.build({ design: 'basic', hcHole: 12 }).info.volumeCm3, bs.info.volumeCm3);
});

check('honeycomb: one pattern runs across socket and tube once the tube is locked on', () => {
  const b = OPB.build({ design: 'honeycomb' });
  const tube = b.parts[1], t = OPB.placed(b, tube, 0, 1);
  let on = 0, tot = 0;
  for (let i = 0; i < t.length; i += 3) {
    const D = -t[i + 1], d = D - tube.origin;
    if (d < 40 || d > tube.length - 25) continue;           // inside the pattern zone only
    tot++;
    if (Math.abs(b.lattice.field(Math.atan2(t[i + 2], t[i]), D)) < 0.03) on++;
  }
  assert.ok(on > 200 && on / tot > 0.1, on + ' of ' + tot + ' tube vertices lie on the shared pattern');
});

// Published figures of the imported meshes (triangle counts and sizes of the files on Thingiverse).
const PUBLISHED = { 'palm.stl': 278278, 'finger_middle_prox.stl': 17680, 'finger_index_prox.stl': 17680, 'finger_ring_prox.stl': 17680,
  'finger_pinky_prox.stl': 17680, 'finger_middle_dist.stl': 17850, 'finger_index_dist.stl': 17552, 'finger_ring_dist.stl': 17552,
  'finger_pinky_dist.stl': 17338, 'thumb_prox.stl': 17072, 'thumb_dist.stl': 13124, 'links.stl': 2868 };

check('hand: the imported palm and finger meshes are unchanged (triangle counts, size, volume)', () => {
  Object.entries(PUBLISHED).forEach(([name, n]) => assert.strictEqual(OPB.parseSTL(OPB.handFile(name)).length / 9, n, name));
  const raw = OPB.parseSTL(OPB.handFile('palm.stl')), bb = OPB.bounds(raw);
  const size = bb.max.map((v, i) => v - bb.min[i]);
  [98.3, 90.6, 116.6].forEach((v, i) => assert.ok(Math.abs(size[i] - v) < 0.2, 'palm size ' + size));
  ['right', 'left'].forEach(side => {
    const b = OPB.build({ side });
    const sg = b.parts[3].hand.segments;
    const vol = id => OPB.volume(OPB.concat(sg.find(s => s.id === id).shells));
    assert.ok(Math.abs(vol('palm') / OPB.volume(raw) - 1) < 1e-4, side + ' palm volume changed');
    ['index', 'middle', 'ring', 'pinky', 'thumb'].forEach(f => ['prox', 'dist'].forEach(k => {
      const r = OPB.volume(OPB.parseSTL(OPB.handFile((f === 'thumb' ? 'thumb_' : 'finger_' + f + '_') + k + '.stl')));
      assert.ok(Math.abs(vol(f + '_' + k) / r - 1) < 1e-4, side + ' ' + f + ' ' + k + ' volume changed');
    }));
  });
});

check('hand: the palm file for the left hand is the right palm reflected, with outward-facing triangles', () => {
  const l = OPB.parseSTL(OPB.handPrintFiles('left')['palm.stl']), r = OPB.parseSTL(OPB.handPrintFiles('right')['palm.stl']);
  assert.strictEqual(l.length, r.length);
  assert.ok(Math.abs(OPB.volume(l) - OPB.volume(r)) < 1e-3 * OPB.volume(r));
  assert.ok(OPB.volume(l) > 0);
  const lb = OPB.bounds(l), rb = OPB.bounds(r);
  assert.ok(Math.abs((lb.max[0] - lb.min[0]) - (rb.max[0] - rb.min[0])) < 1e-3);
  assert.ok(Math.abs(lb.min[0] - 464.3) < 0.1 && Math.abs(lb.max[0] - 562.6) < 0.1, 'left palm must sit where the published left file does');
});

check('hand: hinge pins of each finger keep the published distances', () => {
  // proximal bone knuckle pin to distal pin: 44.25 mm on the middle bone, 38.3 mm on the others (hole centres in the STL files)
  const b = OPB.build({}), sg = id => b.parts[3].hand.segments.find(s => s.id === id);
  const dist = (a, c) => Math.hypot(a[0] - c[0], a[1] - c[1], a[2] - c[2]);
  const want = { middle: 44.25, index: 38.32, ring: 38.32, pinky: 38.32, thumb: 30.05 };
  Object.entries(want).forEach(([f, d]) => {
    const A = sg(f + '_prox').pivot, B = sg(f + '_dist').pivot;
    assert.ok(Math.abs(dist(A, B) - d) < 0.35, f + ' pin distance ' + dist(A, B));
  });
  // the four knuckle pins sit side by side across the palm, 22 to 24 mm apart
  const xs = ['index', 'middle', 'ring', 'pinky'].map(f => sg(f + '_prox').pivot[0]);
  for (let i = 1; i < 4; i++) assert.ok(Math.abs(xs[i] - xs[i - 1]) > 20 && Math.abs(xs[i] - xs[i - 1]) < 26, 'knuckle spacing ' + (xs[i] - xs[i - 1]));
});

check('hand: every pose keeps every segment outward-facing and finite', () => {
  const b = OPB.build({});
  const hand = b.parts[3].hand;
  const ok = (shells, label) => shells.forEach((s, i) => {
    assert.ok(OPB.volume(s) > 0, label + ' shell ' + i + ' has non-positive volume');
    assert.ok(s.every(Number.isFinite), label + ' shell ' + i + ' has a non-finite coordinate');
  });
  ['relaxed', 'open', 'fist', 'hook'].forEach(name => ok(OPB.handShells(hand, OPB.preset(name)), name));
  Object.keys(OPB.HAND_ROM).forEach(k => ['min', 'max'].forEach(e => {
    const pose = OPB.poseDefaults(); pose[k] = OPB.HAND_ROM[k][e];
    ok(OPB.handShells(hand, pose), k + ' ' + e);
  }));
});

check('hand: ranges of motion are sane and the relaxed pose is inside them', () => {
  Object.entries(OPB.HAND_ROM).forEach(([k, r]) => {
    assert.ok(r.min <= r.def && r.def <= r.max, k + ' default outside its range');
    assert.ok(r.max - r.min >= 20, k + ' has almost no travel');
    assert.ok(r.min >= 0, k + ': the printed fingers stop at straight');
  });
  assert.strictEqual(Object.keys(OPB.HAND_ROM).length, 10);
  assert.ok(OPB.HAND_ROM.index_mcp.max >= 85 && OPB.HAND_ROM.index_pip.max >= 95, 'a fist must be reachable');
});

check('hand: a fist is shorter than an open hand and the fingers curl toward the palm side', () => {
  const b = OPB.build({}), hand = { segments: b.parts[3].hand.segments, base: [], pre: 0 };
  const box = (pose, id) => OPB.bounds(OPB.concat(OPB.handShells(hand, pose).filter((s, i) => id === undefined || i === id)));
  const ext = pose => { const bb = box(pose); return bb.max[1] - bb.min[1]; };
  assert.ok(ext(OPB.preset('fist')) < ext(OPB.preset('open')) - 40);
  // middle fingertip bone: segment 4 (palm, index x2, middle prox, middle dist)
  const idx = hand.segments.findIndex(s => s.id === 'middle_dist');
  const cz = pose => { const bb = box(pose, idx); return (bb.min[2] + bb.max[2]) / 2; };
  assert.ok(cz(OPB.preset('fist')) > cz(OPB.preset('open')) + 40, 'fingertip must move toward +z, the palm side');
});

check('hand: the thumb sits on the opposite wall of the palm and bends toward the fingers', () => {
  const b = OPB.build({}), hand = { segments: b.parts[3].hand.segments, base: [], pre: 0 };
  const sg = id => hand.segments.find(s => s.id === id);
  assert.ok(sg('thumb_prox').pivot[2] * sg('middle_prox').pivot[2] < 0, 'thumb and fingers hinge on opposite walls');
  const idx = hand.segments.findIndex(s => s.id === 'thumb_dist');
  const cz = pose => { const bb = OPB.bounds(OPB.concat(OPB.handShells(hand, pose).filter((s, i) => i === idx))); return (bb.min[2] + bb.max[2]) / 2; };
  const bent = OPB.preset('open'); bent.thumb_mcp = 60; bent.thumb_pip = 60;
  const toward = Math.sign(sg('middle_prox').pivot[2]);
  assert.ok((cz(bent) - cz(OPB.preset('open'))) * toward > 20, 'thumb tip must move toward the fingers');
});

check('hand: the left hand mirrors the right hand', () => {
  const r = OPB.build({}), l = OPB.build({ side: 'left' });
  const bb = b => OPB.bounds(OPB.concat(b.parts[3].shells));
  const R = bb(r), L = bb(l);
  [1, 2].forEach(k => { assert.ok(Math.abs(R.min[k] - L.min[k]) < 1e-3 && Math.abs(R.max[k] - L.max[k]) < 1e-3); });
  assert.ok(Math.abs(R.min[0] + L.max[0]) < 1e-3 && Math.abs(R.max[0] + L.min[0]) < 1e-3);
  assert.strictEqual(r.parts[3].length, l.parts[3].length);
});

check('hand adapter: the print files are the published ones, byte for byte, and attributed', () => {
  const f = OPB.handPrintFiles('right');
  assert.strictEqual(Object.keys(f).length, OPB.ASSET_FILES.length);
  OPB.ASSET_FILES.forEach(n => assert.strictEqual(f[n], OPB.handFile(n)));
  assert.ok(/BQEducacion/.test(OPB.HAND_ATTRIBUTION) && /1095104/.test(OPB.HAND_ATTRIBUTION) && /ShareAlike/.test(OPB.HAND_ATTRIBUTION));
});

if (failures) { console.log('\n' + failures + ' test(s) failed'); process.exit(1); }
console.log('\nall tests passed');
