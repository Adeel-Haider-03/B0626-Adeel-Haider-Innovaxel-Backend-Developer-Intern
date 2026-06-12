# Event Registration System API

A small, dependency-free Event Registration API in Node.js. Persistence via SQLite
(`node:sqlite`, built into Node 22+). HTTP via `node:http`. **No `npm install` needed.**

## Run

```bash
node server.js        # starts API on http://localhost:3000
node test.js          # runs the full test suite (16 checks incl. race condition)
```

Data persists in `events.db` between runs.

## Architecture

Three layers, deliberately separated so logic is testable without the network:

| File         | Responsibility                                             |
|--------------|------------------------------------------------------------|
| `db.js`      | Schema, constraints, indexes (the source of truth)         |
| `service.js` | Business rules, validation, transactions                   |
| `server.js`  | HTTP routing + JSON I/O only                               |
| `test.js`    | Unit + concurrency tests against the service layer         |

## API

| Method | Path                          | Body                                    | Notes |
|--------|-------------------------------|-----------------------------------------|-------|
| POST   | `/events`                     | `{name, totalSeats, eventDate}`         | eventDate = ISO, must be future |
| GET    | `/events`                     | —                                       | `?upcoming=true&sort=date` |
| GET    | `/events/:id/registrations`   | —                                       | active only |
| POST   | `/events/:id/register`        | `{userName}`                            | |
| POST   | `/events/:id/cancel`          | `{userName}`                            | |

## Key design decisions

- **Available seats are computed, never stored.** `availableSeats = total_seats - COUNT(active registrations)`.
  A stored counter can drift out of sync; a derived value is always correct. Cancelling
  simply flips a row to `cancelled`, which frees the seat for free.

- **Overbooking prevented with `BEGIN IMMEDIATE`.** Registration reads the seat count and
  inserts inside one transaction that grabs the write lock upfront. Concurrent requests
  serialize, so the count can't be read stale. The test fires 50 concurrent requests at 5
  seats and exactly 5 succeed.

- **Duplicate registration / double-click safety** is enforced by a *partial* unique index
  on `(event_id, user_name) WHERE status='active'`. The database rejects a second active
  row, so the guarantee holds even under concurrency. Because it ignores cancelled rows,
  a user can re-register after cancelling.

- **Unique event names** enforced by a DB `UNIQUE` constraint (race-safe), not an
  app-level check.

- **Every edge case returns a proper status + message:** 400 (validation), 404 (missing),
  409 (full / duplicate), 500 (unexpected).
