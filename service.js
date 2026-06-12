import db from './db.js';

// Custom error carrying an HTTP status so the router can translate cleanly.
export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- 1. CREATE EVENT ----------
export function createEvent({ name, totalSeats, eventDate }) {
  if (typeof name !== 'string' || !name.trim())
    throw new AppError(400, 'Event name is required.');
  if (!Number.isInteger(totalSeats) || totalSeats <= 0)
    throw new AppError(400, 'Total seats must be an integer greater than 0.');

  const date = new Date(eventDate);
  if (isNaN(date.getTime()))
    throw new AppError(400, 'Event date is invalid.');
  if (date.getTime() <= Date.now())
    throw new AppError(400, 'Event date must be in the future.');

  try {
    const info = db
      .prepare('INSERT INTO events (name, total_seats, event_date) VALUES (?, ?, ?)')
      .run(name.trim(), totalSeats, date.toISOString());
    return getEvent(info.lastInsertRowid);
  } catch (e) {
    // UNIQUE constraint on name -> uniqueness enforced at DB level (race-safe).
    if (String(e.message).includes('UNIQUE'))
      throw new AppError(409, 'An event with this name already exists.');
    throw e;
  }
}

// ---------- 2. REGISTER ----------
export function register({ eventId, userName }) {
  if (typeof userName !== 'string' || !userName.trim())
    throw new AppError(400, 'User name is required.');

  // BEGIN IMMEDIATE takes the write lock at the start of the transaction, so the
  // capacity check + insert run with no other writer interleaving. This is what
  // prevents overbooking under concurrent requests — the count we read cannot
  // change before we commit our insert.
  db.exec('BEGIN IMMEDIATE');
  try {
    const event = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
    if (!event) throw new AppError(404, 'Event not found.');

    const { taken } = db
      .prepare(`SELECT COUNT(*) AS taken FROM registrations
                WHERE event_id = ? AND status = 'active'`)
      .get(eventId);

    if (taken >= event.total_seats)
      throw new AppError(409, 'Event is full. No seats available.');

    const info = db
      .prepare('INSERT INTO registrations (event_id, user_name) VALUES (?, ?)')
      .run(eventId, userName.trim());

    db.exec('COMMIT');
    return { registrationId: info.lastInsertRowid, eventId, userName: userName.trim(), status: 'active' };
  } catch (e) {
    db.exec('ROLLBACK');
    // Partial unique index fires -> user already actively registered.
    // Also makes duplicate/double-click requests safe (cleanly rejected).
    if (String(e.message).includes('UNIQUE'))
      throw new AppError(409, 'User is already registered for this event.');
    throw e;
  }
}

// ---------- 3. VIEW EVENTS ----------
// upcomingOnly: filter to future events. sort: 'date' (default) sorts ascending.
export function listEvents({ upcomingOnly = false, sort = 'date' } = {}) {
  const where = upcomingOnly ? "WHERE event_date > datetime('now')" : '';
  const order = sort === 'date' ? 'ORDER BY event_date ASC' : 'ORDER BY id ASC';

  const rows = db.prepare(`
    SELECT e.id, e.name, e.total_seats, e.event_date, e.created_at,
           COALESCE(SUM(CASE WHEN r.status = 'active' THEN 1 ELSE 0 END), 0) AS active_count
    FROM events e
    LEFT JOIN registrations r ON r.event_id = e.id
    ${where}
    GROUP BY e.id
    ${order}
  `).all();

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    eventDate: r.event_date,
    totalSeats: r.total_seats,
    totalRegistrations: r.active_count,      // active registrations only
    availableSeats: r.total_seats - r.active_count,
    createdAt: r.created_at,
  }));
}

export function getEvent(id) {
  const list = listEvents();
  const found = list.find((e) => e.id === Number(id));
  if (!found) throw new AppError(404, 'Event not found.');
  return found;
}

// ---------- 4. CANCEL ----------
export function cancel({ eventId, userName }) {
  if (typeof userName !== 'string' || !userName.trim())
    throw new AppError(400, 'User name is required.');

  // Flip status to 'cancelled'. Because available-seats is COMPUTED from active
  // rows, the seat is freed automatically — no counter to drift out of sync.
  const info = db.prepare(`
    UPDATE registrations
    SET status = 'cancelled', cancelled_at = datetime('now')
    WHERE event_id = ? AND user_name = ? AND status = 'active'
  `).run(eventId, userName.trim());

  if (info.changes === 0)
    throw new AppError(404, 'No active registration found for this user/event.');

  return { eventId, userName: userName.trim(), status: 'cancelled' };
}

export function listRegistrations(eventId) {
  const event = db.prepare('SELECT id FROM events WHERE id = ?').get(eventId);
  if (!event) throw new AppError(404, 'Event not found.');
  return db.prepare(`
    SELECT id, user_name AS userName, status, created_at AS registeredAt
    FROM registrations
    WHERE event_id = ? AND status = 'active'
    ORDER BY created_at ASC
  `).all(eventId);
}
