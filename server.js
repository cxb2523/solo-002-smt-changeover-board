// 纯 Node 20 静态服务，无第三方依赖：node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = Number(process.env.PORT || 8080);
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const file = path.resolve(root, '.' + rel);
  if (!file.startsWith(root)) {
    res.writeHead(403); return res.end('forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': (mime[path.extname(file)] || 'application/octet-stream') + ';charset=utf-8',
    });
    res.end(data);
  });
}).listen(port, () => console.log(`SMT 换线看板：http://localhost:${port}`));
