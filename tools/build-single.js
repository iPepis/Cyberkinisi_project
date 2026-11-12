// Inlines web/ into one self-contained HTML page: node tools/build-single.js [out]
// The output is a page fragment (title, style, body, scripts) with CDN libraries pinned.
const fs = require('fs');
const path = require('path');
const web = path.join(__dirname, '..', 'web');
const out = process.argv[2] || path.join(__dirname, '..', 'dist', 'index.html');
const read = f => fs.readFileSync(path.join(web, f), 'utf8');

const html = read('index.html');
const body = html.split('<!--body-start-->')[1].split('<!--body-end-->')[0];
const fonts = html.match(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]+>/)[0];
const scripts = [...html.matchAll(/<script src="(https:[^"]+)"><\/script>/g)].map(m => m[0]).join('\n');

const page = [
  '<title>Open Prosthetic Builder</title>',
  '<meta name="claude:viewport-fit-sides" content="cover">',
  fonts,
  '<style>\n' + read('style.css') + '\n</style>',
  body,
  scripts,
  '<script>\n' + read('src/geometry.js') + '\n</script>',
  '<script>\n' + read('src/app.js') + '\n</script>'
].join('\n');

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log('wrote', out, (page.length / 1024).toFixed(0) + ' KB');
