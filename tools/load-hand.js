// Loads the imported hand meshes from web/assets/hand into the geometry engine (Node only).
//   const OPB = require('../web/src/geometry.js'); require('./load-hand.js')(OPB);
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'web', 'assets', 'hand');

module.exports = function loadHand(OPB) {
  const rig = JSON.parse(fs.readFileSync(path.join(dir, 'hand-rig.json'), 'utf8'));
  const files = {};
  OPB.ASSET_FILES.forEach(n => { files[n] = new Uint8Array(fs.readFileSync(path.join(dir, n))); });
  OPB.setHandAssets(rig, files);
  return OPB;
};
