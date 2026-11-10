// Builds dist/questlog-demo.html: a single self-contained file (fonts, CSS, JS, seed data inlined)
// that runs the whole UI in "demo mode" without a server. Handy for previewing on any computer.
// Usage: node scripts/build-demo.js [path/to/calendar.md]
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..'), P = f => path.join(ROOT, f);
const { readCalendar } = require('../server/calendar.js');
const cal = process.argv[2] ? readCalendar(process.argv[2]) : { events: [], ok: true };
let css = fs.readFileSync(P('public/css/app.css'), 'utf8').replace(/url\(\.\.\/fonts\/([^)]+)\)/g, (_, f) => `url(data:font/woff2;base64,${fs.readFileSync(P('public/fonts/' + f)).toString('base64')})`);
const seed = n => JSON.parse(fs.readFileSync(P('seed/' + n + '.json'), 'utf8'));
const demo = { missions: seed('missions'), player: seed('player'), events: seed('events'), inbox: seed('inbox'), calendar: cal };
let html = fs.readFileSync(P('public/index.html'), 'utf8')
  .replace('<link rel="stylesheet" href="css/app.css">', `<style>${css}</style>`)
  .replace(/<script src="js\/(\w+)\.js"><\/script>/g, (_, f) => `<script>${fs.readFileSync(P('public/js/' + f + '.js'), 'utf8').replace(/<\/script/g, '<\\/script')}</script>`)
  .replace('<script>', `<script>window.QL_DEMO=${JSON.stringify(demo).replace(/</g, '\\u003c')};</script>\n<script>`);
fs.mkdirSync(P('dist'), { recursive: true });
fs.writeFileSync(P('dist/questlog-demo.html'), html);
console.log('wrote dist/questlog-demo.html', (html.length / 1024).toFixed(0) + ' KB');
