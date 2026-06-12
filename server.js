import http from 'node:http';
import { URL } from 'node:url';
import * as svc from './service.js';
import { AppError } from './service.js';

const PORT = process.env.PORT || 3000;

// Helper: read and JSON-parse the request body.
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch { reject(new AppError(400, 'Request body is not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

function send(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload, null, 2));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method;

  try {
    // POST /events  -> create event
    if (method === 'POST' && path === '/events') {
      const b = await readBody(req);
      return send(res, 201, svc.createEvent({
        name: b.name,
        totalSeats: b.totalSeats,
        eventDate: b.eventDate,
      }));
    }

    // GET /events?upcoming=true&sort=date  -> list events
    if (method === 'GET' && path === '/events') {
      return send(res, 200, svc.listEvents({
        upcomingOnly: url.searchParams.get('upcoming') === 'true',
        sort: url.searchParams.get('sort') || 'date',
      }));
    }

    // GET /events/:id/registrations  -> active registrations
    let m = path.match(/^\/events\/(\d+)\/registrations$/);
    if (method === 'GET' && m) {
      return send(res, 200, svc.listRegistrations(Number(m[1])));
    }

    // POST /events/:id/register  { userName }
    m = path.match(/^\/events\/(\d+)\/register$/);
    if (method === 'POST' && m) {
      const b = await readBody(req);
      return send(res, 201, svc.register({ eventId: Number(m[1]), userName: b.userName }));
    }

    // POST /events/:id/cancel  { userName }
    m = path.match(/^\/events\/(\d+)\/cancel$/);
    if (method === 'POST' && m) {
      const b = await readBody(req);
      return send(res, 200, svc.cancel({ eventId: Number(m[1]), userName: b.userName }));
    }

    return send(res, 404, { error: 'Route not found.' });
  } catch (e) {
    if (e instanceof AppError) return send(res, e.status, { error: e.message });
    console.error(e);
    return send(res, 500, { error: 'Internal server error.' });
  }
});

// Only listen when run directly (so tests can import without binding a port).
if (process.argv[1]?.endsWith('server.js')) {
  server.listen(PORT, () => console.log(`Event API listening on http://localhost:${PORT}`));
}

export default server;
