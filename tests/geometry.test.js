// Run with: node tests/geometry.test.js
const assert = require('assert');
const OPB = require('../web/src/geometry.js');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('ok   ', name); }
  catch (e) { failures++; console.log('FAIL ', name, '\n      ', e.message); }
}

const cases = {
  'default right arm': {},
  'left arm, long limb, thick sock': { side: 'left', limbLength: 200, sockPlies: 10, linerMm: 3 },
  'short limb, no sock, flat rim': { limbLength: 70, sockPlies: 0, flare: false, circProx: 220, circMid: 205, circDist: 175 },
  'extremes of the sliders': { tubeLength: 320, wristLength: 90, palmLength: 120, palmWidth: 110, palmThickness: 40, wristWidth: 75, wristThickness: 50, fingerThumb: 100, fingerIndex: 100, fingerMiddle: 105, fingerRing: 100, fingerPinky: 85, wall: 8, tubeWall: 8 }
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

check('forearm tube fits the standard 40.4 mm joint envelope', () => {
  const b = OPB.build({});
  const bb = OPB.bounds(OPB.concat(b.parts[1].shells));
  assert.ok(Math.abs(bb.max[0] - 20.2) < 0.05 && Math.abs(bb.min[0] + 20.2) < 0.05);
});

check('hand: every pose in the range of motion keeps every shell closed', () => {
  const b = OPB.build({});
  const hand = b.parts[3].hand;
  ['relaxed', 'open', 'fist', 'hook'].forEach(name => {
    OPB.handShells(hand, OPB.preset(name)).forEach((s, i) => {
      assert.ok(OPB.checkClosed(s).closed, name + ' shell ' + i + ' is open');
      assert.ok(OPB.volume(s) > 0, name + ' shell ' + i + ' has non-positive volume');
    });
  });
  // extremes of every single joint
  Object.keys(OPB.HAND_ROM).forEach(k => ['min', 'max'].forEach(e => {
    const pose = OPB.poseDefaults(); pose[k] = OPB.HAND_ROM[k][e];
    OPB.handShells(hand, pose).forEach(s => assert.ok(OPB.checkClosed(s).closed, k + ' ' + e));
  }));
});

check('hand: ranges of motion are sane and the relaxed pose is inside them', () => {
  Object.entries(OPB.HAND_ROM).forEach(([k, r]) => {
    assert.ok(r.min <= r.def && r.def <= r.max, k + ' default outside its range');
    assert.ok(r.max - r.min >= 20, k + ' has almost no travel');
  });
  assert.ok(OPB.HAND_ROM.index_pip.min >= 0, 'fingers do not bend backward at the middle joint');
  assert.ok(OPB.HAND_ROM.index_mcp.max >= 85 && OPB.HAND_ROM.index_pip.max >= 100, 'a fist must be reachable');
});

check('hand: a fist is shorter than an open hand and the wrist moves the whole hand', () => {
  const b = OPB.build({});
  const ext = pose => { const bb = OPB.bounds(OPB.concat(OPB.handShells(b.parts[3].hand, pose))); return bb.max[1] - bb.min[1]; };
  assert.ok(ext(OPB.preset('fist')) < ext(OPB.preset('open')) - 25);
  const flexed = OPB.poseDefaults(); flexed.wrist_flex = 60;
  const bb0 = OPB.bounds(OPB.concat(OPB.handShells(b.parts[3].hand, OPB.preset('open'))));
  const open60 = OPB.preset('open'); open60.wrist_flex = 60;
  const bb1 = OPB.bounds(OPB.concat(OPB.handShells(b.parts[3].hand, open60)));
  // in the part frame the palm side is -z (the hand is turned 180 degrees until it is locked onto the arm)
  assert.ok(bb0.min[2] - bb1.min[2] > 20, 'bending the wrist should swing the hand toward the palm side');
});

check('hand: each finger length slider changes only that finger', () => {
  const ext = (b, prefix) => {
    const sh = [];
    b.parts[3].hand.segments.filter(s => s.id.indexOf(prefix) === 0).forEach(s => s.shells.forEach(x => sh.push(x)));
    const bb = OPB.bounds(OPB.concat(sh)); return bb.max[1] - bb.min[1];
  };
  const a = OPB.build({}), c = OPB.build({ fingerRing: 95 });
  assert.ok(ext(c, 'ring') > ext(a, 'ring') + 10);
  ['index', 'middle', 'pinky', 'thumb'].forEach(n => assert.ok(Math.abs(ext(c, n) - ext(a, n)) < 1e-3, n + ' changed'));
});

check('hand: palm sliders change the palm and nothing else', () => {
  const a = OPB.build({}), c = OPB.build({ palmWidth: 100 });
  const bb = b => OPB.bounds(OPB.concat(b.parts[3].hand.segments.find(s => s.id === 'palm').shells));
  assert.ok(bb(c).max[0] - bb(c).min[0] > bb(a).max[0] - bb(a).min[0] + 10);
  assert.strictEqual(c.info.lengths.socket, a.info.lengths.socket);
});

if (failures) { console.log('\n' + failures + ' test(s) failed'); process.exit(1); }
console.log('\nall tests passed');
