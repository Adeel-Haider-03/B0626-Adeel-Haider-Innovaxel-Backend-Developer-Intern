import { rmSync } from 'node:fs';
// Fresh DB each run for deterministic tests.
try { rmSync('events.db'); rmSync('events.db-wal'); rmSync('events.db-shm'); } catch {}

const svc = await import('./service.js');
const { AppError } = svc;

let pass = 0, fail = 0;
function ok(name, cond) { cond ? (pass++, console.log('PASS', name)) : (fail++, console.log('FAIL', name)); }
function throws(name, fn, msgPart) {
  try { fn(); fail++; console.log('FAIL', name, '(no throw)'); }
  catch (e) { (e instanceof AppError && e.message.includes(msgPart))
    ? (pass++, console.log('PASS', name))
    : (fail++, console.log('FAIL', name, '->', e.message)); }
}

const future = new Date(Date.now() + 86400000).toISOString();
const past   = new Date(Date.now() - 86400000).toISOString();

// 1. Create event
const ev = svc.createEvent({ name: 'Conf', totalSeats: 2, eventDate: future });
ok('create event', ev.id === 1 && ev.availableSeats === 2);
throws('reject duplicate name', () => svc.createEvent({ name: 'Conf', totalSeats: 5, eventDate: future }), 'already exists');
throws('reject zero seats', () => svc.createEvent({ name: 'X', totalSeats: 0, eventDate: future }), 'greater than 0');
throws('reject past date', () => svc.createEvent({ name: 'Y', totalSeats: 5, eventDate: past }), 'future');

// 2. Register
svc.register({ eventId: 1, userName: 'alice' });
ok('register alice', svc.getEvent(1).availableSeats === 1);
throws('no double register', () => svc.register({ eventId: 1, userName: 'alice' }), 'already registered');
svc.register({ eventId: 1, userName: 'bob' });
ok('event now full', svc.getEvent(1).availableSeats === 0);
throws('reject when full', () => svc.register({ eventId: 1, userName: 'carol' }), 'full');
throws('register unknown event', () => svc.register({ eventId: 99, userName: 'z' }), 'not found');

// 4. Cancel frees a seat
svc.cancel({ eventId: 1, userName: 'alice' });
ok('cancel frees seat', svc.getEvent(1).availableSeats === 1);
ok('cancelled not in active list', !svc.listRegistrations(1).some(r => r.userName === 'alice'));
throws('cancel twice fails', () => svc.cancel({ eventId: 1, userName: 'alice' }), 'No active registration');
ok('can re-register after cancel', !!svc.register({ eventId: 1, userName: 'alice' }).registrationId);

// 3. View: sorting + upcoming filter
svc.createEvent({ name: 'Past-ish soon', totalSeats: 1, eventDate: new Date(Date.now()+10000).toISOString() });
const sorted = svc.listEvents({ sort: 'date' });
ok('sorted by date asc', sorted[0].eventDate <= sorted[1].eventDate);
ok('totals reported', svc.getEvent(1).totalRegistrations === 2);

// Overbooking / race condition: fire 50 concurrent registrations at 5 seats.
const ev2 = svc.createEvent({ name: 'Race', totalSeats: 5, eventDate: future });
let success = 0, rejected = 0;
await Promise.all([...Array(50)].map((_, i) => Promise.resolve().then(() => {
  try { svc.register({ eventId: ev2.id, userName: 'user' + i }); success++; }
  catch { rejected++; }
})));
ok('no overbooking under load', success === 5 && rejected === 45 && svc.getEvent(ev2.id).availableSeats === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
