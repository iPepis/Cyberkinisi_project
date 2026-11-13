// Inlines web/ into one self-contained HTML page: node tools/build-single.js [out]
// The output is a page fragment (title, style, body, scripts) with CDN libraries pinned.
// The palm and finger meshes (web/assets/hand) are embedded, so the page is about 25 MB.
const fs = require('fs');
const path = require('path');
const web = path.join(__dirname, '..', 'web');
const out = process.argv[2] || path.join(__dirname, '..', 'dist', 'index.html');
const read = f => fs.readFileSync(path.join(web, f), 'utf8');

const html = read('index.html');
const body = html.split('<!--body-start-->')[1].split('<!--body-end-->')[0];
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]+>/)[0];
const scripts = [...html.matchAll(/<script src="(https:[^"]+)"><\/script>/g)].map(m => m[0]).join('\n');

// the imported hand meshes travel inside the page as base64 (large: about 25 MB)
const hand = path.join(web, 'assets', 'hand');
const inline = {};
fs.readdirSync(hand).filter(f => f.endsWith('.stl') || f === 'hand-rig.json').forEach(f => {
  inline[f] = f.endsWith('.json') ? fs.readFileSync(path.join(hand, f), 'utf8') : fs.readFileSync(path.join(hand, f)).toString('base64');
});

const page = [
  '<title>Open Prosthetic Builder</title>',
  '<meta name="claude:viewport-fit-sides" content="cover">',
  fonts,
  '<style>\n' + read('style.css') + '\n</style>',
  body,
  scripts,
  '<script>window.OPB_HAND_INLINE = ' + JSON.stringify(inline) + ';</script>',
  '<script>\n' + read('src/geometry.js') + '\n</script>',
  '<script type="text/plain" id="opb-app">\n' + read('src/app.js').replace(/<\/script>/g, '<\\/script>') + '\n</script>',
  '<script>\n' + read('src/load-hand.js') + '\n</script>'
].join('\n');

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log('wrote', out, (page.length / 1024).toFixed(0) + ' KB');
