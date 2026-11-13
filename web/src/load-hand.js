/* Loads the imported hand meshes, then starts the app. Files come from web/assets/hand, or from
   window.OPB_HAND_INLINE ({ 'hand-rig.json': text, 'palm.stl': base64, ... }) in the one-file build. */
(function () {
  'use strict';
  function fail(msg) {
    var box = document.getElementById('noGL');
    if (box) { box.hidden = false; box.textContent = msg; }
  }
  function b64(s) {
    var bin = atob(s), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  function fetchAll() {
    var inline = window.OPB_HAND_INLINE;
    if (inline) {
      var files = {};
      window.OPB.ASSET_FILES.forEach(function (n) { files[n] = b64(inline[n]); });
      return Promise.resolve({ rig: JSON.parse(inline['hand-rig.json']), files: files });
    }
    var base = 'assets/hand/';
    var rig = fetch(base + 'hand-rig.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
    var names = window.OPB.ASSET_FILES;
    var all = names.map(function (n) {
      return fetch(base + n).then(function (r) { if (!r.ok) throw new Error(n + ' ' + r.status); return r.arrayBuffer(); });
    });
    return Promise.all([rig, Promise.all(all)]).then(function (res) {
      var files = {};
      names.forEach(function (n, i) { files[n] = res[1][i]; });
      return { rig: res[0], files: files };
    });
  }
  fetchAll().then(function (a) {
    window.OPB.setHandAssets(a.rig, a.files);
    var s = document.createElement('script');
    var inlineApp = document.getElementById('opb-app');          // one-file build: the app code travels in the page
    if (inlineApp) s.text = inlineApp.textContent; else s.src = 'src/app.js';
    document.body.appendChild(s);
  }).catch(function (e) {
    fail('The hand files did not load (' + (e && e.message || e) + '). Serve the web folder over http, for example with npm run serve.');
  });
})();
