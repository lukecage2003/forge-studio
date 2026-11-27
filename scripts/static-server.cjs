// Minimal static server for tests: serves <root> under the URL prefix (like GitHub Pages does for /forge-studio/).
//   node scripts/static-server.cjs <root> <port> [prefix]
const http = require('http'), fs = require('fs'), path = require('path');
const [root, port, prefix = '/forge-studio/'] = process.argv.slice(2);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.onnx': 'application/octet-stream', '.txt': 'text/plain', '.wasm': 'application/wasm' };
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (!url.startsWith(prefix)) { res.writeHead(404); return res.end('hors du site'); }
  let file = path.join(root, url.slice(prefix.length));
  if (file.endsWith(path.sep) || !path.extname(file)) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('404'); }
    // same cache rule as GitHub Pages: 10 minutes for everything
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'max-age=600' });
    res.end(data);
  });
}).listen(+port, () => console.log(`site de test : http://localhost:${port}${prefix}`));
