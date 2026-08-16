# Concurrency Model — Seat Allocation

The defining constraint of Reserva is **never oversell a seat**. This document explains the
failure mode, why the obvious defenses are insufficient, and the layered strategy that makes
overselling impossible. It is the rationale behind the booking transaction and the `Event` /
`Booking` constraints.

Design summary lives in [`TECH_SPEC.md`](./TECH_SPEC.md); deferred scope in
[`TECH_DEBT.md`](./TECH_DEBT.md).

---

## 1. The invariant

`availableSeats` is a **stored counter** on `Event` — the single number every read trusts. The
invariant we must hold at all times is:

```
availableSeats == capacity − count(bookings WHERE status IN ('HELD', 'CONFIRMED'))
```

Everything below exists to keep that equation true under concurrent load.

## 2. The failure mode: a read-then-write race

The naive booking is two steps — check the counter, then act on it:

```
1. read availableSeats            -- say it's 1
2. if availableSeats > 0:
3.     INSERT booking
4.     availableSeats = availableSeats − 1
```

Correct for one request at a time. It breaks the moment two requests **interleave**, because
another request can slip between the check (step 1) and the act (step 4):

```
A: read availableSeats → 1   ("a seat is free")
B: read availableSeats → 1   ("a seat is free")   ← A has not decremented yet
A: INSERT booking; availableSeats = 0
B: INSERT booking; availableSeats = −1            ❌ OVERSOLD
```

Both requests read `1` before either wrote `0`. Each is individually correct; the bug is that
they **overlap**. This is why it is invisible in single-request testing and appears exactly when
a popular event's last seats sell.

## 3. Why a transaction alone does not fix it

The instinct is to wrap the steps in a transaction. Necessary, but **not sufficient**.

A transaction provides **atomicity** (all-or-nothing) and **isolation** — but isolation has
levels. PostgreSQL's default is **Read Committed**: a statement sees data committed by others,
but concurrent transactions are **not** serialized. Two transactions can both run the read at
step 1, both see `1` (neither has committed a write), and both proceed. The transaction boundary
controls _visibility_, not _mutual exclusion_.

To stop the race, the second request must **wait** until the first finishes touching the row.
That requires a **lock**.

## 4. The lost update — why the `CHECK` constraint is not enough on its own

`Event` carries `CHECK (availableSeats >= 0)`. It is tempting to conclude the database will
reject any oversell. It will not, in the most common coding pattern.

The naive code writes an **absolute** value computed in application memory:

```
read availableSeats → 1          (into a variable)
compute newValue = 1 − 1 = 0     (in the application, not the database)
UPDATE "Event" SET availableSeats = 0    ← writes the literal 0
```

Race two of these at capacity 1:

```
A: read → 1     (var = 1)
B: read → 1     (var = 1)
A: INSERT booking; UPDATE availableSeats = 0
B: INSERT booking; UPDATE availableSeats = 0    ← writes 0 again, never −1
```

Final state: `availableSeats = 0`, but **two** booking rows exist against a capacity of 1. The
`CHECK (availableSeats >= 0)` **never fires**, because the column never went negative. This is a
**lost update** (B overwrote A's result).

The lesson: the `CHECK` guards _one column's value_; the real rule is the _relationship between
the counter and the number of booking rows in another table_. No single-column constraint can
observe that relationship. Correctness must be enforced where both are written together — under
a lock.

## 5. The primary mechanism: `SELECT … FOR UPDATE` (pessimistic row lock)

Acquire a row-level lock at read time:

```sql
SELECT * FROM "Event" WHERE id = $1 FOR UPDATE;
```

`FOR UPDATE` locks that event row: any other transaction that tries to `SELECT … FOR UPDATE` the
**same** row **blocks** until this transaction commits or rolls back. Replaying the race:

```
A: BEGIN
A: SELECT … FOR UPDATE   → locks the row, reads availableSeats = 1
B: BEGIN
B: SELECT … FOR UPDATE   → row locked by A → B WAITS
A: INSERT booking; UPDATE availableSeats = 0
A: COMMIT                → lock released
B: (unblocks) reads availableSeats = 0 → roll back → 409 SOLD_OUT   ✅
```

The lock **serializes the critical section**: B cannot even read the seat count until A is done,
so check-then-act is effectively atomic for that row.

Properties worth noting:

- **Per-row, not per-table.** Bookings for different events never block each other; only
  contenders for the same event serialize. Correctness without sacrificing throughput.
- **Held only for the transaction's duration.** Commit/rollback releases it, so the critical
  section must be short — lock, check, insert, decrement, commit. No slow work (network, email)
  while holding it.
- Requires an **interactive transaction** (`prisma.$transaction(async (tx) => { … })`) so the
  locking `SELECT`, the `INSERT`, and the `UPDATE` run on one connection in one transaction. The
  locking read is raw SQL (`tx.$queryRaw`) — Prisma's schema language cannot express `FOR UPDATE`.

## 6. The alternative: atomic conditional `UPDATE` (optimistic)

A single guarded statement achieves the same guarantee for the pure counter case:

```sql
UPDATE "Event"
SET "availableSeats" = "availableSeats" − 1
WHERE id = $1 AND "availableSeats" > 0;    -- then assert rows-affected == 1
```

One `UPDATE` is atomic, and the `WHERE … > 0` guard is evaluated at write time against the
current row. Concurrent writers are serialized by the database; the first drops the counter to 0,
the second's `WHERE` no longer matches → **0 rows affected** → known sold out. No explicit lock.

**Trade-off.** The conditional `UPDATE` is simpler and faster, but it only guards that one
column. `FOR UPDATE` locks the whole row, so additional logic — the "one active booking per user"
check, reading other fields, inserting the booking — runs inside the protected window. Reserva's
booking flow needs that extra logic, so `FOR UPDATE` is the primary approach; the conditional
`UPDATE` is the instructive contrast and doubles as a backstop.

## 7. Why a stored counter (not `COUNT(*)`)

`SELECT COUNT(*) FROM bookings WHERE eventId = …` on every booking has the same race (two
requests both count N, both insert) and is slower. The stored counter is the number reads trust;
the lock keeps it consistent, and `CHECK (availableSeats >= 0)` refuses to let it go negative if
application logic is ever wrong.

## 8. The booking lifecycle — `HELD`, and `holdExpiresAt`

Booking is not a single step. A reservation is first a **hold** (seat reserved briefly while the
user completes checkout), then confirmed:

```
POST /events/:id/bookings   → HELD        seat −1, holdExpiresAt = now + hold window
POST /bookings/:id/confirm  → CONFIRMED   no seat change; must be within the hold window
DELETE /bookings/:id        → CANCELLED   seat +1
```

A `HELD` seat counts as taken (it is decremented). An abandoned hold would waste a seat forever,
so a scheduled sweeper (M5) cancels expired holds and returns their seats. `confirm` must verify
the hold has not already expired (409 if it has). Hence `Booking` needs both a `status` enum and
`holdExpiresAt`.

## 9. One active booking per user per event

v1 is one seat per booking; a user may hold/confirm **at most one** seat for a given event.
Enforced twice:

- **Primary:** a service check inside the locked transaction ("does this user already have a
  `HELD`/`CONFIRMED` booking for this event?").
- **Backstop:** a **partial unique index** on `(userId, eventId)` `WHERE status IN ('HELD',
'CONFIRMED')`. The partial (`WHERE`) clause is essential — it lets a user re-book after a
  cancel/expire, because cancelled rows do not count toward uniqueness. Prisma cannot express
  partial unique indexes, so it is raw SQL in the migration.

## 10. Defense in depth — coordinator plus floor

The layers do **different jobs**; they are not redundant:

| Layer       | Mechanism                                     | Job                                                                                                   |
| ----------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Application | `SELECT … FOR UPDATE` + in-transaction checks | Make the flow behave correctly: serialize, return a clean `409`, keep the counter/rows invariant true |
| Database    | `CHECK (availableSeats >= 0)`                 | Last-resort floor: catch an oversell if application logic is ever wrong                               |
| Database    | partial unique `(userId, eventId)`            | Catch a double-booking if the service check is bypassed                                               |

The application layer is where correctness _should_ happen. The constraints are the floor that
_cannot_ be crossed regardless of application bugs, bad migrations, or manual SQL. A constraint
can only **reject**, never **coordinate** — so it is a safety net, not a substitute for the lock.

## 11. Build order (M4)

The strategy is to build it wrong, prove it wrong, then fix it:

1. `Booking` model + migration (`status` enum, `holdExpiresAt`, partial unique index via raw SQL).
2. Naive booking implementation (the read-then-write above).
3. A concurrency test that fires `K` simultaneous bookings at an event with capacity `C < K`, and
   asserts the oversell is reproduced.
4. The fix: interactive transaction + `SELECT … FOR UPDATE`.
5. Backstops: `CHECK (availableSeats >= 0)` (already in place) + the partial unique index.

Test assertions: no booking is rejected for the wrong reason; final `availableSeats == 0`; active
booking count `== C`; the counter never goes negative.
