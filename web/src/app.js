/* Open Prosthetic Builder: website prototype. UI, 3D preview and downloads. */
(function () {
  'use strict';
  var OPB = window.OPB, LIM = OPB.LIMITS, J = OPB.J;
  var KEY = 'opb.settings.v1';
  var PARTS = ['socket', 'tube', 'wrist', 'hand'];
  var PART_LABEL = { socket: 'Socket', tube: 'Forearm tube', wrist: 'Wrist adapter', hand: 'Hand' };

  /* ------------------------------ state ------------------------------ */
  var state = Object.assign({}, OPB.DEFAULTS, { explode: 0, showLimb: true, cutaway: true, pose: OPB.poseDefaults() });
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) Object.keys(state).forEach(function (k) { if (k in saved && typeof saved[k] === typeof state[k]) state[k] = saved[k]; });
  } catch (e) { /* storage unavailable: start from defaults */ }
  Object.keys(LIM).forEach(function (k) { state[k] = Math.min(LIM[k][1], Math.max(LIM[k][0], state[k])); });
  if (state.side !== 'left' && state.side !== 'right') state.side = 'right';
  if ([0, 3, 6].indexOf(state.linerMm) < 0) state.linerMm = 0;
  if (state.design !== 'honeycomb') state.design = 'basic';
  (function () {   // keep a remembered pose inside the real range of motion
    var def = OPB.poseDefaults(), clean = {};
    Object.keys(def).forEach(function (k) {
      var v = state.pose && Number(state.pose[k]), r = OPB.HAND_ROM[k];
      clean[k] = isFinite(v) ? Math.min(r.max, Math.max(r.min, Math.round(v))) : def[k];
    });
    state.pose = clean;
  })();
  var saveTimer = 0;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }, 300);
  }

  /* ------------------------------ DOM helpers ------------------------------ */
  function el(tag, props, kids) {
    var n = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'class') n.className = props[k];
      else if (k === 'text') n.textContent = props[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), props[k]);
      else n.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  var $ = function (id) { return document.getElementById(id); };
  var inputs = {};
  function stepOf(key) { return LIM[key][2]; }
  function decimals(key) { var s = String(stepOf(key)); return s.indexOf('.') < 0 ? 0 : s.length - s.indexOf('.') - 1; }
  function setValue(key, v) {
    v = Number(v);
    if (!isFinite(v)) return;
    v = Math.min(LIM[key][1], Math.max(LIM[key][0], v));
    var st = stepOf(key);
    v = Math.round(v / st) * st;
    state[key] = Number(v.toFixed(decimals(key)));
    syncInputs();
    schedule();
  }
  function slider(key, label, unit, help) {
    var id = 'f_' + key;
    var range = el('input', { type: 'range', id: id, min: LIM[key][0], max: LIM[key][1], step: stepOf(key) });
    var num = el('input', { type: 'number', id: id + '_n', min: LIM[key][0], max: LIM[key][1], step: stepOf(key), 'aria-label': label + ' in ' + unit });
    range.addEventListener('input', function () { setValue(key, range.value); });
    num.addEventListener('input', function () { if (num.value !== '') { var v = Number(num.value); if (v >= LIM[key][0] && v <= LIM[key][1]) setValue(key, v); } });
    num.addEventListener('change', function () { setValue(key, num.value === '' ? state[key] : num.value); });
    inputs[key] = { range: range, num: num };
    return el('div', { class: 'field' }, [
      el('label', { for: id, text: label }),
      el('div', { class: 'row' }, [range, el('div', { class: 'numwrap' }, [num, el('span', { class: 'u', text: unit })])]),
      help ? el('p', { class: 'help', text: help }) : null
    ]);
  }
  function syncInputs() {
    Object.keys(inputs).forEach(function (k) {
      var v = state[k].toFixed(decimals(k));
      if (document.activeElement !== inputs[k].num) inputs[k].num.value = v;
      inputs[k].range.value = state[k];
    });
    document.querySelectorAll('[data-seg]').forEach(function (g) {
      var key = g.getAttribute('data-seg');
      g.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === String(state[key]))); });
    });
    document.querySelectorAll('[data-plies]').forEach(function (b) { b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-plies')) === state.sockPlies)); });
    $('flare').checked = state.flare;
    DESIGNS.forEach(function (d) {
      var t = $('tab_' + d[0]), on = state.design === d[0];
      t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
      if (on) designNote.textContent = d[2];
    });
    $('hcCard').hidden = state.design !== 'honeycomb';
  }
  function segGroup(key, options, label) {
    var g = el('div', { class: 'seg-group', role: 'group', 'aria-label': label, 'data-seg': key });
    options.forEach(function (o) {
      g.appendChild(el('button', {
        type: 'button', 'data-v': String(o[0]), text: o[1],
        onclick: function () { state[key] = typeof state[key] === 'number' ? Number(o[0]) : o[0]; syncInputs(); schedule(); }
      }));
    });
    return g;
  }
  var folds = {};
  try { folds = JSON.parse(localStorage.getItem('opb.fold.v1') || '{}') || {}; } catch (e) { /* storage unavailable */ }
  function card(title, color, lede, kids) {
    var body = el('div', { class: 'card-body' }, [lede ? el('p', { class: 'lede', text: lede }) : null].concat(kids));
    var btn = el('button', { type: 'button', class: 'fold' });
    function show(open) {
      body.hidden = !open; btn.textContent = open ? '\u2013' : '+';
      btn.setAttribute('aria-expanded', String(open)); btn.setAttribute('aria-label', (open ? 'Minimize ' : 'Expand ') + title);
      btn.title = open ? 'Minimize' : 'Expand';
    }
    show(folds[title] !== true);
    btn.addEventListener('click', function () {
      var open = body.hidden; show(open); folds[title] = !open;
      try { localStorage.setItem('opb.fold.v1', JSON.stringify(folds)); } catch (e) { /* ignore */ }
    });
    return el('div', { class: 'card' }, [
      el('h2', {}, [btn, color ? el('span', { class: 'dot', style: 'background:var(' + color + ')' }) : null, title]), body
    ]);
  }

  /* ------------------------------ panel ------------------------------ */
  var panel = $('panel');
  var DESIGNS = [['basic', 'Basic Design', 'Smooth walls. The easiest to print and the strongest per millimetre of wall.'],
                 ['honeycomb', 'Honeycomb', 'Socket and forearm tube are perforated with one irregular web of cells that carries on across the joint. Air passes through the wall; the walls are made thicker to pay back the removed material.']];
  var designNote = el('p', { class: 'lede', id: 'designNote' });
  var tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Design' }, DESIGNS.map(function (d) {
    return el('button', { type: 'button', role: 'tab', id: 'tab_' + d[0], 'data-design': d[0], text: d[1],
      onclick: function () { state.design = d[0]; syncInputs(); schedule(); } });
  }));
  panel.appendChild(el('div', { class: 'card tabcard' }, [tabs, designNote]));
  var hcCard = card('Honeycomb', '--c-socket', 'Organic cells with rounded corners and an even strut. Small cells keep every roof short enough to bridge.', [
    slider('hcHole', 'Hole width', 'mm', 'Average cell width. Keep under 9 mm so the sock does not push through.'),
    slider('hcStrut', 'Strut width', 'mm', 'Material between two holes. 2.4 mm or more prints solid with a 0.4 mm nozzle.'),
    slider('hcExtra', 'Extra wall', 'mm', 'Added to the socket and tube wall to make up for the holes.')
  ]);
  hcCard.id = 'hcCard';
  panel.appendChild(hcCard);
  var flare = el('input', { type: 'checkbox', id: 'flare' });
  flare.addEventListener('change', function () { state.flare = flare.checked; schedule(); });
  panel.appendChild(card('Residual limb and socket', '--c-skin', 'Measure the bare limb. The sock and liner allowance is added for you below. The socket settings apply to both designs.', [
    slider('limbLength', 'Length', 'mm', 'Elbow crease to the end of the limb.'),
    slider('circProx', 'Circumference at the elbow end', 'mm'),
    slider('circMid', 'Circumference at the midpoint', 'mm'),
    slider('circDist', 'Circumference at the distal end', 'mm'),
    slider('wall', 'Socket wall thickness', 'mm', '3.5 mm or more is recommended for daily loads.'),
    el('label', { for: 'flare', class: 'viewopts', style: 'display:flex;gap:8px;align-items:center;cursor:pointer' }, [flare, 'Rolled, flared rim so the sock does not catch'])
  ]));

  var wallBar = el('div', { class: 'section-bar', id: 'wallBar', role: 'img' });
  var wallLegend = el('div', { class: 'section-legend', id: 'wallLegend' });
  var wallCap = el('div', { class: 'section-caption', id: 'wallCap' });
  panel.appendChild(card('Prosthetic sock and liner', '--c-sock',
    'A sock or silicone liner goes between your skin and the socket. The socket grows by its thickness on every side and gets longer at the end, so your limb sits where you measured it.', [
      el('div', { class: 'field' }, [
        el('span', { class: 'lbl', text: 'Sock plies' }),
        el('div', { class: 'chips' }, [0, 1, 2, 3, 5, 8].map(function (n) {
          return el('button', { type: 'button', 'data-plies': String(n), text: n === 0 ? 'No sock' : n + '-ply', onclick: function () { setValue('sockPlies', n); } });
        }))
      ]),
      slider('sockPlies', 'Number of plies', 'ply', 'Stack more than one sock by adding their plies together.'),
      el('div', { class: 'field' }, [
        el('span', { class: 'lbl', text: 'Silicone or gel liner' }),
        segGroup('linerMm', [[0, 'None'], [3, '3 mm'], [6, '6 mm']], 'Liner thickness')
      ]),
      slider('clearance', 'Extra clearance', 'mm', 'Room for print tolerance. Add more if the sock bunches.'),
      el('details', { class: 'adv' }, [
        el('summary', { text: 'Sock thickness per ply' }),
        slider('plyMm', 'Thickness of one ply', 'mm', 'Typical socks are about 0.8 mm per ply but vary by brand and compress with wear. Measure yours with calipers.')
      ]),
      el('div', { class: 'field' }, [
        el('span', { class: 'lbl', text: 'Section through the wall, to scale' }),
        wallBar, wallCap, wallLegend
      ])
    ]));

  panel.appendChild(card('Forearm tube', '--c-tube', null, [
    slider('tubeLength', 'Length', 'mm', 'Joint to joint, including both couplings.'),
    slider('tubeWall', 'Wall thickness', 'mm', 'Also used for the wrist adapter.')
  ]));
  panel.appendChild(card('Wrist adapter', '--c-wrist', null, [
    slider('wristLength', 'Length', 'mm', 'Adds length and lets you swap hands.')
  ]));
  panel.appendChild(card('Hand', '--c-hand', 'The palm, four fingers and thumb are the printed "Hand" by BQEducacion (CC BY-SA), used exactly as published. A new adapter joins the palm to the standard bayonet joint. The link bars are printed spare parts, not shown.', [
    el('div', { class: 'field' }, [el('span', { class: 'lbl', text: 'Arm side' }), segGroup('side', [['right', 'Right arm'], ['left', 'Left arm']], 'Arm side')])
  ]));

  /* hand pose: every joint limited to the range of a real hand */
  var poseInputs = {}, curlInputs = {};
  var DIGIT_LABEL = { thumb: 'Thumb', index: 'Index finger', middle: 'Middle finger', ring: 'Ring finger', pinky: 'Little finger' };
  function poseRow(k) {
    var r = OPB.HAND_ROM[k], id = 'p_' + k;
    var range = el('input', { type: 'range', id: id, min: r.min, max: r.max, step: 1 });
    var num = el('input', { type: 'number', id: id + '_n', min: r.min, max: r.max, step: 1, 'aria-label': DIGIT_LABEL[r.group] || 'Wrist' });
    range.addEventListener('input', function () { state.pose[k] = Number(range.value); afterPose(); });
    num.addEventListener('input', function () { if (num.value !== '') { state.pose[k] = Math.min(r.max, Math.max(r.min, Math.round(Number(num.value)))); afterPose(); } });
    poseInputs[k] = { range: range, num: num };
    return el('div', { class: 'field' }, [
      el('label', { for: id }, [r.label + ' ', el('span', { class: 'help', text: r.min + '° to ' + r.max + '°' })]),
      el('div', { class: 'row' }, [range, el('div', { class: 'numwrap' }, [num, el('span', { class: 'u', text: '°' })])])
    ]);
  }
  function curlKeys(d) { return OPB.CURL_KEYS[d]; }
  function curlRow(d) {
    var id = 'c_' + d, range = el('input', { type: 'range', id: id, min: 0, max: 100, step: 1 });
    var out = el('span', { class: 'mono' });
    range.addEventListener('input', function () {
      curlKeys(d).forEach(function (k) { state.pose[k] = Math.round(Number(range.value) / 100 * OPB.HAND_ROM[k].max); });
      afterPose();
    });
    curlInputs[d] = { range: range, out: out };
    return el('div', { class: 'field' }, [
      el('label', { for: id, text: 'Curl all joints together' }),
      el('div', { class: 'row' }, [range, el('div', { class: 'num', style: 'text-align:right' }, [out])])
    ]);
  }
  function syncPose() {
    Object.keys(poseInputs).forEach(function (k) {
      poseInputs[k].range.value = state.pose[k];
      if (document.activeElement !== poseInputs[k].num) poseInputs[k].num.value = state.pose[k];
    });
    Object.keys(curlInputs).forEach(function (d) {
      var ks = curlKeys(d), f = ks.reduce(function (a, k) { return a + Math.max(0, state.pose[k]) / OPB.HAND_ROM[k].max; }, 0) / ks.length;
      curlInputs[d].range.value = Math.round(f * 100); curlInputs[d].out.textContent = Math.round(f * 100) + '%';
    });
  }
  function afterPose() { syncPose(); applyPose(); invalidate(); persist(); }
  var poseKids = [
    el('div', { class: 'chips' }, [['relaxed', 'Relaxed'], ['open', 'Open'], ['fist', 'Fist'], ['hook', 'Hook grip']].map(function (n) {
      return el('button', { type: 'button', text: n[1], onclick: function () { state.pose = OPB.preset(n[0]); afterPose(); } });
    }))
  ];
  OPB.DIGITS.forEach(function (d) {
    var keys = Object.keys(OPB.HAND_ROM).filter(function (k) { return OPB.HAND_ROM[k].group === d; });
    poseKids.push(el('details', { class: 'adv' }, [el('summary', { text: DIGIT_LABEL[d] }), curlRow(d)].concat(keys.map(poseRow))));
  });
  panel.appendChild(card('Hand pose', '--c-hand', 'Preview only. Each finger and the thumb bend at the base and at the joint near the tip, as far as the printed parts allow. The fingers move freely once assembled; nothing is exported in a pose.', poseKids));

  var statsEl = el('dl', { class: 'stats', id: 'stats' });
  var issuesEl = el('ul', { class: 'issues', id: 'issues' });
  var toastEl = el('p', { class: 'toast', id: 'toast', role: 'status', 'aria-live': 'polite' });
  var dlButtons = {};
  function dlBtn(id, text, fn, primary) {
    var b = el('button', { type: 'button', class: 'btn' + (primary ? ' primary' : ''), text: text, onclick: fn });
    dlButtons[id] = b; return b;
  }
  // Fingers: one print button joined to a small arrow that opens the list of digits.
  var FINGER_OPTS = [['all', 'All'], ['thumb', 'Thumb'], ['index', 'Index'], ['middle', 'Middle'], ['ring', 'Ring'], ['pinky', 'Pinky']];
  var fingerKey = 'all', fingerPicked = false;   // until the user picks, the button reads Fingers and downloads all
  var fingerMenu = el('ul', { class: 'dl-menu', role: 'listbox', 'aria-label': 'Which fingers to print', hidden: '' });
  var fingerArrow = dlBtn('fingersMenu', '\u25BE', function (e) { e.stopPropagation(); fingerMenu.hidden = !fingerMenu.hidden; fingerArrow.setAttribute('aria-expanded', String(!fingerMenu.hidden)); });
  fingerArrow.className = 'btn dl-arrow'; fingerArrow.setAttribute('aria-label', 'Choose fingers'); fingerArrow.setAttribute('aria-haspopup', 'listbox'); fingerArrow.setAttribute('aria-expanded', 'false');
  function drawFingerMenu() {
    fingerMenu.textContent = '';
    dlButtons.fingers.textContent = (fingerPicked ? FINGER_OPTS.filter(function (o) { return o[0] === fingerKey; })[0][1] : 'Fingers') + ' (.stl)';
    FINGER_OPTS.forEach(function (o) {
      fingerMenu.appendChild(el('li', { role: 'option', tabindex: '0', 'aria-selected': String(fingerPicked && o[0] === fingerKey), text: o[1], onclick: function () { fingerKey = o[0]; fingerPicked = true; fingerMenu.hidden = true; fingerArrow.setAttribute('aria-expanded', 'false'); drawFingerMenu(); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.click(); } else if (e.key === 'Escape') { fingerMenu.hidden = true; fingerArrow.focus(); } } }));
    });
  }
  document.addEventListener('click', function () { fingerMenu.hidden = true; fingerArrow.setAttribute('aria-expanded', 'false'); });
  var grid = el('div', { class: 'dl-grid' }, [
    dlBtn('socket', 'Socket (.stl)', function () { exportOne('socket'); }),
    dlBtn('tube', 'Forearm tube (.stl)', function () { exportOne('tube'); }),
    dlBtn('wrist', 'Wrist adapter (.stl)', function () { exportOne('wrist'); }),
    dlBtn('hand', 'Palm (.stl)', function () { exportOne('hand'); }),
    el('div', { class: 'dl-split' }, [dlBtn('fingers', 'Fingers (.stl)', function () { exportFingers(); }), fingerArrow, fingerMenu])
  ]);
  drawFingerMenu();
  var exportCard = card('Summary and download', null, null, [
    statsEl, issuesEl,
    dlBtn('zip', 'Download everything (.zip)', function () { exportZip(); }, true),
    grid, toastEl,
    el('p', { class: 'safety', text: 'Every part prints on its own. The zip includes the socket, forearm tube, wrist adapter, palm, every finger with its connector, and print notes. Have a prosthetist check the socket fit before wearing it.' })
  ]);
  exportCard.id = 'export';
  panel.appendChild(exportCard);

  document.querySelectorAll('[data-plies]').forEach(function () {});
  $('explode').addEventListener('input', function () { state.explode = Number(this.value); applyTransforms(); if (!userZoomed) fitCamera(); invalidate(); });
  $('showLimb').addEventListener('change', function () { state.showLimb = this.checked; applyLook(); invalidate(); persist(); });
  $('cutaway').addEventListener('change', function () { state.cutaway = this.checked; applyLook(); invalidate(); persist(); });
  $('resetView').addEventListener('click', function () { userZoomed = false; cam.theta = 0.35; cam.phi = 1.38; cam.pan = 0; fitCamera(); invalidate(); });
  $('explode').value = state.explode; $('showLimb').checked = state.showLimb; $('cutaway').checked = state.cutaway;

  /* ------------------------------ 3D ------------------------------ */
  var canvas = $('view');
  var glOK = !!window.THREE;
  var renderer, scene, camera, rootGroup, clipPlane;
  var meshes = {}, ghostMeshes = {}, partKeys = {}, ghostKey = '';
  var cam = { theta: 0.35, phi: 1.38, dist: 1000, ty: -300, pan: 0 };
  var userZoomed = false, dirty = false;

  function token(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function mat(tokenName, opts) {
    return new THREE.MeshStandardMaterial(Object.assign({ color: token(tokenName, '#888888'), roughness: 0.62, metalness: 0.04, side: THREE.DoubleSide }, opts || {}));
  }
  var mats = {};
  if (glOK) {
    try {
      renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
    } catch (e) { glOK = false; }
  }
  if (glOK) {
    renderer.localClippingEnabled = true;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, 5, 8000);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7f88, 0.85));
    var key = new THREE.DirectionalLight(0xffffff, 0.85); key.position.set(300, 600, 800); scene.add(key);
    var fill = new THREE.DirectionalLight(0xffffff, 0.35); fill.position.set(-500, 100, -300); scene.add(fill);
    rootGroup = new THREE.Group(); scene.add(rootGroup);
    clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    mats.socket = mat('--c-socket'); mats.tube = mat('--c-tube'); mats.wrist = mat('--c-wrist'); mats.hand = mat('--c-hand');
    mats.skin = mat('--c-skin'); mats.liner = mat('--c-liner', { transparent: true, opacity: 0.55, depthWrite: false });
    mats.sock = mat('--c-sock', { transparent: true, opacity: 0.5, depthWrite: false });
  } else {
    $('noGL').hidden = false;
  }

  function geometryFromTris(tris) {
    var n = tris.length / 9;
    var fn = new Float32Array(n * 3), keys = new Array(n * 3), buckets = new Map();
    var q = function (x, y, z) { return Math.round(x * 100) + ',' + Math.round(y * 100) + ',' + Math.round(z * 100); };
    for (var t = 0; t < n; t++) {
      var o = t * 9;
      var ux = tris[o + 3] - tris[o], uy = tris[o + 4] - tris[o + 1], uz = tris[o + 5] - tris[o + 2];
      var vx = tris[o + 6] - tris[o], vy = tris[o + 7] - tris[o + 1], vz = tris[o + 8] - tris[o + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      var l = Math.hypot(nx, ny, nz);
      if (l > 1e-12) { fn[t * 3] = nx / l; fn[t * 3 + 1] = ny / l; fn[t * 3 + 2] = nz / l; }
      for (var c = 0; c < 3; c++) {
        var k = q(tris[o + 3 * c], tris[o + 3 * c + 1], tris[o + 3 * c + 2]);
        keys[t * 3 + c] = k;
        var b = buckets.get(k); if (!b) { b = []; buckets.set(k, b); } b.push(t);
      }
    }
    var nor = new Float32Array(tris.length), thr = 0.72;
    for (var t2 = 0; t2 < n; t2++) {
      var fx = fn[t2 * 3], fy = fn[t2 * 3 + 1], fz = fn[t2 * 3 + 2];
      for (var c2 = 0; c2 < 3; c2++) {
        var list = buckets.get(keys[t2 * 3 + c2]), sx = 0, sy = 0, sz = 0;
        for (var i = 0; i < list.length; i++) {
          var u = list[i], ax = fn[u * 3], ay = fn[u * 3 + 1], az = fn[u * 3 + 2];
          if (ax * fx + ay * fy + az * fz > thr) { sx += ax; sy += ay; sz += az; }
        }
        var sl = Math.hypot(sx, sy, sz) || 1, oo = t2 * 9 + c2 * 3;
        nor[oo] = sx / sl; nor[oo + 1] = sy / sl; nor[oo + 2] = sz / sl;
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(tris, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    return g;
  }

  function pick(obj, keys) { var o = {}; keys.forEach(function (k) { o[k] = obj[k]; }); return JSON.stringify(o); }
  // the socket, tube and wrist adapter share one outside contour, so any of these reshapes all three
  var LIMB = ['limbLength', 'circProx', 'circMid', 'circDist', 'sockPlies', 'plyMm', 'linerMm', 'clearance'];
  var FORE = LIMB.concat(['wall', 'flare', 'tubeLength', 'tubeWall', 'wristLength', 'design', 'hcHole', 'hcStrut', 'hcExtra']);
  var DEPS = {
    socket: FORE, tube: FORE, wrist: FORE,
    hand: ['side']
  };

  var handModel = null, handMeshes = [];
  function disposeTree(o) { o.traverse(function (n) { if (n.geometry) n.geometry.dispose(); }); }
  // The hand is one mesh per rigid segment, posed from the joint angles; the stub and lugs stay fixed.
  function makeHandGroup(part) {
    var g = new THREE.Group();
    g.add(new THREE.Mesh(geometryFromTris(OPB.concat(part.hand.base)), mats.hand));
    var body = new THREE.Group(); body.rotation.y = -part.hand.pre; g.add(body);
    handModel = part.hand;
    handMeshes = part.hand.segments.map(function (sg) {
      var m = new THREE.Mesh(geometryFromTris(OPB.concat(sg.shells)), mats.hand);
      m.matrixAutoUpdate = false; body.add(m); return m;
    });
    return g;
  }
  function applyPose() {
    if (!glOK || !handModel) return;
    var P = OPB.handMatrices(handModel, state.pose);
    handMeshes.forEach(function (m, i) { m.matrix.set.apply(m.matrix, P[i]); m.matrixWorldNeedsUpdate = true; });
  }

  var current = null;
  function rebuild() {
    var p = Object.assign({}, state);
    current = OPB.build(p);
    if (!glOK) return;
    current.parts.forEach(function (part) {
      var k = pick(p, DEPS[part.name]);
      if (partKeys[part.name] === k && meshes[part.name]) return;
      partKeys[part.name] = k;
      if (meshes[part.name]) { rootGroup.remove(meshes[part.name]); disposeTree(meshes[part.name]); }
      var m;
      if (part.name === 'hand') m = makeHandGroup(part);
      else { m = new THREE.Mesh(geometryFromTris(OPB.concat(part.shells)), mats[part.name]); m.renderOrder = part.name === 'socket' ? 5 : 0; }
      meshes[part.name] = m; rootGroup.add(m);
    });
    var gk = pick(p, LIMB);
    if (gk !== ghostKey) {
      ghostKey = gk;
      Object.keys(ghostMeshes).forEach(function (n) { rootGroup.remove(ghostMeshes[n]); ghostMeshes[n].geometry.dispose(); });
      ghostMeshes = {};
      var g = OPB.ghosts(current);
      Object.keys(g).forEach(function (n, i) {
        var m = new THREE.Mesh(geometryFromTris(g[n]), mats[n]);
        m.renderOrder = { skin: 1, liner: 2, sock: 3 }[n];
        ghostMeshes[n] = m; rootGroup.add(m);
      });
    }
  }

  function applyTransforms() {
    if (!glOK || !current) return;
    var ease = Math.max(0, Math.min(1, 1 - state.explode / 20));
    current.parts.forEach(function (part) {
      var m = meshes[part.name]; if (!m) return;
      m.position.y = -(part.origin + part.index * state.explode);
      m.rotation.y = -(part.index * J.lock * Math.PI / 180 * ease);
    });
  }

  function applyLook() {
    if (!glOK) return;
    var show = state.showLimb;
    Object.keys(ghostMeshes).forEach(function (n) { ghostMeshes[n].visible = show; });
    var cut = state.cutaway ? [clipPlane] : [];
    mats.socket.clippingPlanes = cut; mats.socket.needsUpdate = true;   // only the socket is cut open; the limb layers stay whole
    mats.socket.transparent = show; mats.socket.opacity = show ? 0.32 : 1; mats.socket.depthWrite = !show; mats.socket.needsUpdate = true;
  }
  function recolor() {
    if (!glOK) return;
    Object.keys(mats).forEach(function (n) { mats[n].color.set(token('--c-' + n, '#888')); });
    invalidate();
  }

  function fitCamera() {
    if (!glOK || !current) return;
    var H = current.totalLength + 3 * state.explode + J.stubLen + 40;
    cam.ty = -(current.totalLength + 3 * state.explode) / 2 + 10;
    var fov = camera.fov * Math.PI / 180;
    var byH = (H / 2) / Math.tan(fov / 2);
    var byW = (Math.max(180, current.params.circProx / Math.PI * 2 + 80) / 2) / (Math.tan(fov / 2) * camera.aspect);
    cam.dist = Math.max(byH, byW) * 1.1;
  }
  function placeCamera() {
    var ty = cam.ty + cam.pan;
    camera.position.set(cam.dist * Math.sin(cam.phi) * Math.sin(cam.theta), ty + cam.dist * Math.cos(cam.phi), cam.dist * Math.sin(cam.phi) * Math.cos(cam.theta));
    camera.lookAt(0, ty, 0);
  }
  function resize() {
    if (!glOK) return;
    var r = canvas.parentElement.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(Math.max(1, r.width), Math.max(1, r.height), false);
    camera.aspect = Math.max(0.2, r.width / Math.max(1, r.height));
    camera.updateProjectionMatrix();
    if (!userZoomed) fitCamera();
    invalidate();
  }
  function invalidate() { if (!dirty && glOK) { dirty = true; requestAnimationFrame(draw); } }
  function draw() { dirty = false; placeCamera(); renderer.render(scene, camera); }

  if (glOK) {
    var pointers = new Map(), lastPinch = 0;
    canvas.addEventListener('pointerdown', function (e) { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); lastPinch = 0; });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('pointerup', function (e) { pointers.delete(e.pointerId); });
    canvas.addEventListener('pointercancel', function (e) { pointers.delete(e.pointerId); });
    canvas.addEventListener('pointermove', function (e) {
      var p = pointers.get(e.pointerId); if (!p) return;
      if (pointers.size === 1) {
        var dx = e.clientX - p.x, dy = e.clientY - p.y;
        cam.theta -= dx * 0.008;
        if (e.shiftKey || (e.buttons & 2)) cam.phi = Math.min(Math.PI - 0.25, Math.max(0.25, cam.phi - dy * 0.008));   // tilt
        else {   // slide the model up or down: one screen pixel moves it one pixel at the arm's depth
          var span = cam.pan + dy * 2 * cam.dist * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, canvas.clientHeight);
          cam.pan = Math.max(-3000, Math.min(3000, span));
        }
      }
      p.x = e.clientX; p.y = e.clientY;
      if (pointers.size === 2) {
        var a = Array.from(pointers.values()), d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        if (lastPinch) { cam.dist = Math.min(4000, Math.max(150, cam.dist * lastPinch / d)); userZoomed = true; }
        lastPinch = d;
      }
      invalidate();
    });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault(); userZoomed = true;
      cam.dist = Math.min(4000, Math.max(150, cam.dist * Math.exp(e.deltaY * 0.0012)));
      invalidate();
    }, { passive: false });
    if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas.parentElement); else window.addEventListener('resize', resize);
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { setTimeout(recolor, 50); });
    new MutationObserver(function () { setTimeout(recolor, 50); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  /* ------------------------------ readouts ------------------------------ */
  var f1 = function (v) { return v.toFixed(1); };
  function renderReadouts(v) {
    var b = current, i = b.info, p = b.params;
    // length bar
    var bar = $('lenbar'); bar.textContent = '';
    PARTS.forEach(function (n) {
      bar.appendChild(el('div', { class: 'seg s-' + n, style: 'flex:' + i.lengths[n] + ' 1 0' }, [
        el('b', { text: { socket: 'Socket', tube: 'Tube', wrist: 'Wrist', hand: 'Hand' }[n] }), el('span', { text: Math.round(i.lengths[n]) + ' mm' })
      ]));
    });
    // wall section
    var segs = [];
    if (p.linerMm > 0) segs.push(['Liner', p.linerMm, '--c-liner']);
    if (i.sockMm > 0) segs.push(['Sock', i.sockMm, '--c-sock']);
    segs.push(['Clearance', p.clearance, '--c-clear']);
    segs.push(['Socket wall', p.wall, '--c-socket']);
    var wb = $('wallBar'); wb.textContent = '';
    wb.appendChild(el('div', { style: 'flex:0 0 12px;background:var(--c-skin)', title: 'Skin' }));
    segs.forEach(function (s) { wb.appendChild(el('div', { style: 'flex:' + s[1] + ' 0 0;background:var(' + s[2] + ')', text: s[1] >= 1.6 ? f1(s[1]) : '' })); });
    wb.setAttribute('aria-label', 'Wall section from skin outward: ' + segs.map(function (s) { return s[0] + ' ' + f1(s[1]) + ' millimetres'; }).join(', '));
    var lg = $('wallLegend'); lg.textContent = '';
    lg.appendChild(el('span', {}, [el('i', { style: 'background:var(--c-skin)' }), 'Skin']));
    segs.forEach(function (s) { lg.appendChild(el('span', {}, [el('i', { style: 'background:var(' + s[2] + ')' }), s[0] + ' ' + f1(s[1])])); });
    $('wallCap').textContent = '';
    $('wallCap').appendChild(el('span', { text: 'Skin to outside of socket' }));
    $('wallCap').appendChild(el('span', { class: 'mono', text: f1(i.allowance + p.wall) + ' mm' }));
    // stats
    var st = $('stats'); st.textContent = '';
    function stat(dt, dd, small) { st.appendChild(el('div', {}, [el('dt', { text: dt }), el('dd', {}, [dd, small ? el('small', { text: ' ' + small }) : null])])); }
    stat('Total length', Math.round(i.total) + '', 'mm');
    stat('Socket inside, rim', f1(i.innerDia.rim), 'mm');
    stat('Socket inside, mid', f1(i.innerDia.mid), 'mm');
    stat('Socket inside, end', f1(i.innerDia.distal), 'mm');
    stat('Limb, mid', f1(i.limbDia[1]), 'mm');
    if (i.honeycomb) stat('Open area, socket', Math.round(100 * i.honeycomb.socket) + '', '%');
    if (i.honeycomb) stat('Open area, tube', i.honeycomb.tube == null ? 'solid' : Math.round(100 * i.honeycomb.tube) + '', i.honeycomb.tube == null ? '' : '%');
    stat('Solid volume', f1(i.volumeCm3.reduce(function (a, c) { return a + c; }, 0)), 'cm³');
    // validation
    var chip = $('statusChip');
    var ul = $('issues'); ul.textContent = '';
    v.errors.forEach(function (m) { ul.appendChild(el('li', { class: 'err', text: m })); });
    v.warnings.forEach(function (m) { ul.appendChild(el('li', { class: 'warn', text: m })); });
    if (!v.errors.length && !v.warnings.length) ul.appendChild(el('li', { class: 'ok', text: 'All checks pass. The parts are ready to export.' }));
    if (v.errors.length) { chip.className = 'chip err'; chip.textContent = v.errors.length + (v.errors.length === 1 ? ' problem to fix' : ' problems to fix'); }
    else if (v.warnings.length) { chip.className = 'chip warn'; chip.textContent = 'Ready, ' + v.warnings.length + (v.warnings.length === 1 ? ' warning' : ' warnings'); }
    else { chip.className = 'chip ok'; chip.textContent = 'Ready to export'; }
    Object.keys(dlButtons).forEach(function (k) { dlButtons[k].disabled = v.errors.length > 0; });
  }

  /* ------------------------------ update loop ------------------------------ */
  var pending = false;
  function schedule() { if (!pending) { pending = true; requestAnimationFrame(update); } persist(); }
  function update() {
    pending = false;
    var v = OPB.validate(state);
    rebuild();
    applyTransforms();
    applyPose();
    applyLook();
    renderReadouts(v);
    if (!userZoomed) fitCamera();
    invalidate();
  }

  /* ------------------------------ export ------------------------------ */
  var dlCap = null;
  try {
    if (window.claude && typeof window.claude.use === 'function') {
      window.claude.use('downloads').then(function (d) { dlCap = d; }, function () {});
    }
  } catch (e) { /* not in a viewer */ }

  function say(msg) { $('toast').textContent = msg; }
  function saveFile(name, data) {
    if (dlCap) return dlCap.save({ filename: name, data: data });
    var blob = data instanceof Blob ? data : new Blob([data], { type: 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    return Promise.resolve({ status: 'saved' });
  }
  function done(name) { return function (r) { say(r && r.status === 'delivered' ? 'Sent ' + name : 'Saved ' + name); }; }
  function failed(name) { return function (e) { say(e && e.code === 'declined' ? 'Download cancelled.' : 'Could not save ' + name + '.'); }; }
  function slug() { return 'open-prosthetic-' + state.side + '-arm'; }

  var FILE = { socket: 'socket', tube: 'tube', wrist: 'wrist', hand: 'palm' };
  // The palm file is everything between the wrist adapter and the fingers: the new adapter (stub, neck, saddle) plus the published palm.
  function partSTL(name) {
    var part = current.parts[PARTS.indexOf(name)];
    if (name !== 'hand') return OPB.toSTL(OPB.concat(part.shells), name);
    return OPB.toSTL(OPB.concat(part.hand.base.concat(part.hand.segments[0].shells)), 'palm');
  }
  function readme() {
    var i = current.info, p = current.params;
    var L = [
      'OPEN PROSTHETIC BUILDER, below-elbow arm, prototype v0.0.4', '',
      'NOT A CERTIFIED MEDICAL DEVICE. Have a prosthetist or clinician review the socket fit and the load-bearing joints before anyone wears this.', '',
      'YOUR SETTINGS (mm)',
      '  Residual limb length: ' + p.limbLength,
      '  Limb circumference, elbow end / middle / distal end: ' + p.circProx + ' / ' + p.circMid + ' / ' + p.circDist,
      '  Sock: ' + p.sockPlies + ' ply at ' + p.plyMm + ' mm per ply (' + f1(i.sockMm) + ' mm)',
      '  Liner: ' + (p.linerMm ? p.linerMm + ' mm' : 'none'),
      '  Extra clearance: ' + p.clearance,
      '  Socket inside diameter, rim / middle / end: ' + f1(i.innerDia.rim) + ' / ' + f1(i.innerDia.mid) + ' / ' + f1(i.innerDia.distal),
      '  Part lengths: socket ' + Math.round(i.lengths.socket) + ', tube ' + Math.round(i.lengths.tube) + ', wrist adapter ' + Math.round(i.lengths.wrist) + ', hand ' + Math.round(i.lengths.hand),
      '  Arm side: ' + p.side,
      '  Design: ' + (p.design === 'honeycomb' ? 'Honeycomb, holes ' + p.hcHole + ' mm, struts ' + p.hcStrut + ' mm, extra wall ' + p.hcExtra + ' mm, open area socket ' + Math.round(100 * i.honeycomb.socket) + '%' + (i.honeycomb.tube == null ? '' : ', tube ' + Math.round(100 * i.honeycomb.tube) + '%') : 'Basic Design (smooth walls)'), '',
      'FILES',
      '  socket.stl, tube.stl, wrist.stl, palm.stl   one file per part, each already lying in its print orientation (palm.stl is the new hand adapter joined to the published palm)',
      '  fingers/all.stl                              all four fingers and the thumb, each with its link bar',
      '  fingers/<finger>.stl                         one finger (or the thumb): its two bones and its link bar, as published (see ATTRIBUTION.txt)', '',
      'PRINT NOTES'
    ];
    if (p.design === 'honeycomb') L.push('  Honeycomb: print upright as supplied. Cells are small enough to bridge, so supports should not be needed; check the preview in your slicer. Use at least 4 perimeters (walls) and 3 or more top layers so the struts print solid. Hole roofs are short bridges of different angles; slow the bridge speed and cool well. Files are large (up to a few hundred thousand triangles).');
    PARTS.forEach(function (n) { L.push('  ' + PART_LABEL[n] + ': ' + OPB.PRINT_NOTES[n]); });
    L.push('', 'Suggested material: PETG for most parts, nylon or carbon-fibre nylon for the joints. Use 0.2 mm layers.');
    L.push('Overlapping shells inside each STL are intentional; any slicer merges them.', '',
      'ASSEMBLY',
      '  Line the three lugs of the male stub up with the three gaps in the next part, push the stub in until the shoulder meets the rim,',
      '  then turn the distal part a quarter turn (60 degrees) clockwise as seen from the elbow end until it stops.', '',
      'KNOWN LIMITS OF THIS PROTOTYPE',
      '  The joint has no spring detent or safety pin yet, so it can turn back. Do not rely on it to carry load until the joint tests in docs/SPEC.md (milestone M0) pass.',
      '  Strap mounts and the suspension cuff are not modelled yet.',
      '  The palm, fingers, thumb and link bars are the unchanged Thingiverse files by BQEducacion (CC BY-SA). The fingers are driven by fishing line and returned by elastic cord, with 1.75 mm filament as hinge pins, as described by the author; that mechanism is not part of this tool.',
      '  The hand adapter (part of palm.stl) is new and untested: print it and check how the palm sits on it before relying on it. The palm is not changed to fit it.',
      '  The printed link bars are included as spare print files but are not placed in the preview.');
    return L.join('\n');
  }
  function makeZip() {
    if (!window.JSZip) return Promise.reject({ code: 'nozip' });
    var z = new JSZip(), dir = z.folder(slug());
    PARTS.forEach(function (n) { dir.file(FILE[n] + '.stl', partSTL(n)); });
    var ff = dir.folder('fingers'), files = OPB.fingerFiles();
    Object.keys(files).forEach(function (n) { ff.file(n + '.stl', files[n]); });
    dir.file('ATTRIBUTION.txt', OPB.HAND_ATTRIBUTION);
    dir.file('README.txt', readme());
    return z.generateAsync({ type: 'blob' });
  }
  function guard() { return current && OPB.validate(state).errors.length === 0; }
  function exportZip() {
    if (!guard()) return;
    var name = slug() + '.zip';
    makeZip().then(function (blob) { return saveFile(name, blob); }).then(done(name), failed(name));
  }
  // The viewer only saves a fixed list of formats, so there an STL is wrapped in a zip.
  function saveSTL(file, data) {
    if (!dlCap) return saveFile(file, data).then(done(file), failed(file));
    if (!window.JSZip) { say('Zip support did not load.'); return; }
    var zname = file.replace('.stl', '-stl.zip'), z = new JSZip(); z.file(file, data);
    z.generateAsync({ type: 'blob' }).then(function (b) { return saveFile(zname, b); }).then(done(zname), failed(zname));
  }
  function exportOne(n) { if (guard()) saveSTL(FILE[n] + '.stl', partSTL(n)); }
  function exportFingers() {
    if (!guard()) return;
    var k = fingerKey;
    saveSTL(k === 'all' ? 'fingers.stl' : k + '-finger.stl', OPB.fingerFiles()[k]);
  }

  /* ------------------------------ go ------------------------------ */
  syncInputs();
  syncPose();
  update();
  resize();
  window.OPBApp = { state: state, update: schedule, get build() { return current; } };
})();
