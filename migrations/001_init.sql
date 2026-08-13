-- 001_init.sql
-- Schema for the Student Grievance & Facility Maintenance Tracker.
--
-- Three rules in this file are enforced by PostgreSQL itself rather than by
-- application code, because each of them is a rule that a check-then-write
-- implementation loses under concurrency:
--
--   G1  tickets_one_active_per_issue   one active ticket per facility+category
--   G2  maintenance_no_overlap         no overlapping maintenance on a facility
--   G3  the claim UPDATE               a ticket has at most one assignee
--
-- G1 and G2 are declarative constraints. G3 is a guarded single-statement
-- UPDATE (see src/data/ticketData.ts) -- there is no separate SELECT to race.

-- btree_gist lets a GiST index mix a plain equality column (facility_id, a uuid)
-- with a range overlap operator in the same exclusion constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ---------------------------------------------------------------------------
-- Enumerated types
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('student', 'staff', 'admin');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'issue_category') THEN
        CREATE TYPE issue_category AS ENUM (
            'hardware',     -- broken lab PCs, projectors, lab instruments
            'electrical',   -- power outages, faulty sockets, lighting
            'plumbing',     -- water supply, leaks, blocked drains
            'network',      -- Wi-Fi and wired connectivity
            'furniture',    -- desks, chairs, benches, doors
            'cleanliness',  -- sanitation of shared spaces
            'safety',       -- fire extinguishers, exposed wiring, hazards
            'other'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ticket_priority') THEN
        CREATE TYPE ticket_priority AS ENUM ('low', 'medium', 'high', 'critical');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ticket_status') THEN
        CREATE TYPE ticket_status AS ENUM (
            'open',         -- reported, nobody has picked it up
            'assigned',     -- a staff member has claimed it
            'in_progress',  -- work has started
            'resolved',     -- staff says it is fixed
            'closed',       -- confirmed fixed; terminal
            'rejected'      -- not a valid issue / duplicate / out of scope; terminal
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ticket_event_type') THEN
        CREATE TYPE ticket_event_type AS ENUM (
            'reported', 'claimed', 'status_changed', 'comment'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'maintenance_status') THEN
        CREATE TYPE maintenance_status AS ENUM ('scheduled', 'completed', 'cancelled');
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Core entities
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL CHECK (length(btrim(name)) > 0),
    email      TEXT NOT NULL UNIQUE CHECK (position('@' IN email) > 1),
    -- Students report and comment; staff and admins claim, schedule and resolve.
    role       user_role NOT NULL DEFAULT 'student',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A facility is anything on campus an issue can be reported against: a room, a
-- lab, a piece of equipment, a hostel block.
CREATE TABLE IF NOT EXISTS facilities (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT NOT NULL CHECK (length(btrim(name)) > 0),
    building   TEXT NOT NULL CHECK (length(btrim(building)) > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- "Room 101" may legitimately exist in more than one building, so the
    -- identity of a facility is the pair, not the name alone.
    CONSTRAINT facilities_unique_name_per_building UNIQUE (building, name)
);

CREATE TABLE IF NOT EXISTS tickets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    reported_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- NULL until a staff member claims the ticket.
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    category    issue_category NOT NULL,
    priority    ticket_priority NOT NULL DEFAULT 'medium',
    title       TEXT NOT NULL CHECK (length(btrim(title)) > 0),
    description TEXT NOT NULL CHECK (length(btrim(description)) > 0),
    status      ticket_status NOT NULL DEFAULT 'open',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ,

    -- An open ticket has nobody working on it, by definition.
    CONSTRAINT tickets_open_is_unassigned
        CHECK (status <> 'open' OR assigned_to IS NULL),

    -- Conversely, work cannot be under way without someone doing it.
    CONSTRAINT tickets_active_is_assigned
        CHECK (status NOT IN ('assigned', 'in_progress') OR assigned_to IS NOT NULL),

    -- resolved_at is set exactly when the ticket reaches a finished state, so
    -- "time to resolution" can never be computed from an inconsistent row.
    CONSTRAINT tickets_resolved_at_consistent
        CHECK ((status IN ('resolved', 'closed', 'rejected')) = (resolved_at IS NOT NULL))
);

-- GUARANTEE G1 -- DUPLICATE REPORT SUPPRESSION.
--
-- A grievance tracker's characteristic failure is forty students reporting one
-- broken projector and producing forty tickets. This partial unique index makes
-- that impossible: for a given facility and category at most one ticket may be
-- in an unfinished state at a time.
--
-- It is partial, so finished tickets ('resolved', 'closed', 'rejected') leave
-- the index and stop blocking. When the same projector breaks again next term,
-- a new ticket is allowed.
--
-- Like every rule here it is enforced by the index, not by a prior SELECT, so
-- two students pressing "report" at the same instant cannot both succeed.
CREATE UNIQUE INDEX IF NOT EXISTS tickets_one_active_per_issue
    ON tickets (facility_id, category)
    WHERE status IN ('open', 'assigned', 'in_progress');

-- Append-only audit trail: who did what to a ticket and when. Nothing in the
-- application ever updates or deletes a row here.
CREATE TABLE IF NOT EXISTS ticket_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    event_type  ticket_event_type NOT NULL,
    from_status ticket_status,
    to_status   ticket_status,
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- A comment carries text; a status change carries a destination status.
    CONSTRAINT ticket_events_comment_has_note
        CHECK (event_type <> 'comment' OR length(btrim(coalesce(note, ''))) > 0),
    CONSTRAINT ticket_events_transition_has_target
        CHECK (event_type NOT IN ('claimed', 'status_changed') OR to_status IS NOT NULL)
);

-- "This affects me too." Lets many students register against the single ticket
-- that G1 forces them to share, which is what makes G1 acceptable rather than
-- merely restrictive: the signal is kept, the duplicate rows are not.
CREATE TABLE IF NOT EXISTS ticket_affected_users (
    ticket_id  UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- One vote per person per ticket, enforced by the primary key.
    PRIMARY KEY (ticket_id, user_id)
);

CREATE TABLE IF NOT EXISTS maintenance_windows (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facility_id  UUID NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
    scheduled_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_time   TIMESTAMPTZ NOT NULL,
    end_time     TIMESTAMPTZ NOT NULL,
    note         TEXT,
    status       maintenance_status NOT NULL DEFAULT 'scheduled',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- A maintenance window must cover a positive amount of time.
    CONSTRAINT maintenance_time_order CHECK (start_time < end_time),

    -- GUARANTEE G2 -- NO OVERLAPPING MAINTENANCE.
    --
    -- Two crews must never be sent to take the same facility out of service at
    -- overlapping times. Two rows conflict when they name the same facility AND
    -- their [start_time, end_time) periods overlap AND both are still scheduled.
    --
    -- PostgreSQL enforces this with a GiST index at INSERT time, taking the
    -- necessary locks itself, so two concurrent transactions can never both
    -- succeed. The '[)' bound makes back-to-back windows legal: 09:00-10:00 and
    -- 10:00-11:00 do not overlap.
    CONSTRAINT maintenance_no_overlap EXCLUDE USING gist (
        facility_id WITH =,
        tstzrange(start_time, end_time, '[)') WITH &&
    ) WHERE (status = 'scheduled')
);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

-- Kept in the database rather than in the data layer for the same reason as
-- everything else in this file: a rule that lives in application code is a rule
-- some future code path can forget.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tickets_set_updated_at ON tickets;
CREATE TRIGGER tickets_set_updated_at
    BEFORE UPDATE ON tickets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Indexes supporting the list endpoints
-- ---------------------------------------------------------------------------

-- GET /facilities/:id/tickets
CREATE INDEX IF NOT EXISTS tickets_facility_created_idx
    ON tickets (facility_id, created_at DESC);

-- GET /tickets?status=&priority=
CREATE INDEX IF NOT EXISTS tickets_status_priority_idx
    ON tickets (status, priority);

-- "What is on my plate?" for a staff member.
CREATE INDEX IF NOT EXISTS tickets_assigned_to_idx
    ON tickets (assigned_to)
    WHERE assigned_to IS NOT NULL;

-- The timeline on GET /tickets/:id
CREATE INDEX IF NOT EXISTS ticket_events_ticket_created_idx
    ON ticket_events (ticket_id, created_at);

-- GET /facilities/:id/maintenance
CREATE INDEX IF NOT EXISTS maintenance_facility_start_idx
    ON maintenance_windows (facility_id, start_time);
