// Writes the STL files for a design without a browser:
//   node tools/export-sample.js [out-dir] [json-with-parameter-overrides]
const fs = require('fs');
const path = require('path');
const OPB = require('../web/src/geometry.js');

const dir = process.argv[2] || path.join(__dirname, '..', 'samples');
const params = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const v = OPB.validate(params);
if (v.errors.length) { console.error(v.errors.join('\n')); process.exit(1); }
v.warnings.forEach(w => console.warn('warning:', w));

const b = OPB.build(params);
fs.mkdirSync(dir, { recursive: true });
b.parts.forEach(p => fs.writeFileSync(path.join(dir, p.name + '.stl'), Buffer.from(OPB.toSTL(OPB.concat(p.shells), p.name))));
const all = b.parts.map(p => OPB.placed(b, p, 0, 1));
fs.writeFileSync(path.join(dir, 'assembled.stl'), Buffer.from(OPB.toSTL(OPB.concat(all), 'assembled')));
fs.writeFileSync(path.join(dir, 'parameters.json'), JSON.stringify({ tool: 'Open Prosthetic Builder', version: '0.0.1', units: 'mm', parameters: b.params }, null, 2));
console.log('wrote 4 parts + assembled.stl to', dir, '| total length', b.info.total.toFixed(0), 'mm');
