const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const STATUS_FILE = path.join(__dirname, 'status.json');

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.url === '/status.json') {
    fs.readFile(STATUS_FILE, 'utf8', (err, data) => {
      if (err) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'status not ready yet' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`worksly-checker HTTP server listening on :${PORT}`);
});
