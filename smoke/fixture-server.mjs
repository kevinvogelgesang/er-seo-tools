// smoke/fixture-server.mjs — a tiny loopback static page for the single-page
// ADA audit target. NEVER a third-party site. Port from FIXTURE_PORT.
import { createServer } from 'node:http'
const port = Number(process.env.FIXTURE_PORT || 41234)
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Smoke Fixture</title></head><body>
<h1>Smoke audit target</h1>
<img src="/logo.png">
<a href="#main">skip</a>
<p>Content for the accessibility audit.</p>
</body></html>`
createServer((_req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(html)
}).listen(port, '127.0.0.1', () => console.log(`[fixture] http://127.0.0.1:${port}`))
