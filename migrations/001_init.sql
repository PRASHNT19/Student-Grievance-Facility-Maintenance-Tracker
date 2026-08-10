-- ============================================================================
-- Student Grievance & Facility Maintenance Tracker
-- Migration 001
-- ============================================================================

-- Required for gen_random_uuid() and the GiST exclusion constraint.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;


-- ============================================================================
-- ENUM TYPES
-- ============================================================================

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'user_role'
    ) THEN
        CREATE TYPE user_role AS ENUM (
            'student',
            'staff',
            'admin'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'issue_category'
    ) THEN
        CREATE TYPE issue_category AS ENUM (
            'hardware',
            'electrical',
            'plumbing',
            'network',
            'furniture',
            'cleanliness',
            'safety',
            'other'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'ticket_priority'
    ) THEN
        CREATE TYPE ticket_priority AS ENUM (
            'low',
            'medium',
            'high',
            'critical'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'ticket_status'
    ) THEN
        CREATE TYPE ticket_status AS ENUM (
            'open',
            'assigned',
            'in_progress',
            'resolved',
            'closed',
            'rejected'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'ticket_event_type'
    ) THEN
        CREATE TYPE ticket_event_type AS ENUM (
            'reported',
            'claimed',
            'status_changed',
            'comment'
        );
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_type WHERE typname = 'maintenance_status'
    ) THEN
        CREATE TYPE maintenance_status AS ENUM (
            'scheduled',
            'completed',
            'cancelled'
        );
    END IF;
END
$$;


-- ============================================================================
-- USERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name TEXT NOT NULL
        CHECK (length(btrim(name)) > 0),

    email TEXT NOT NULL UNIQUE
        CHECK (position('@' IN email) > 1),

    role user_role NOT NULL DEFAULT 'student',

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================================
-- FACILITIES
-- ============================================================================

CREATE TABLE IF NOT EXISTS facilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name TEXT NOT NULL
        CHECK (length(btrim(name)) > 0),

    building TEXT NOT NULL
        CHECK (length(btrim(building)) > 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT facilities_unique_name_per_building
        UNIQUE (building, name)
);


-- ============================================================================
-- TICKETS
-- ============================================================================

CREATE TABLE IF NOT EXISTS tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    facility_id UUID NOT NULL
        REFERENCES facilities(id)
        ON DELETE CASCADE,

    reported_by UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    assigned_to UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    category issue_category NOT NULL,

    priority ticket_priority NOT NULL DEFAULT 'medium',

    title TEXT NOT NULL
        CHECK (length(btrim(title)) > 0),

    description TEXT NOT NULL
        CHECK (length(btrim(description)) > 0),

    status ticket_status NOT NULL DEFAULT 'open',

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    resolved_at TIMESTAMPTZ,

    CONSTRAINT tickets_open_is_unassigned
        CHECK (
            status <> 'open'
            OR assigned_to IS NULL
        ),

    CONSTRAINT tickets_active_is_assigned
        CHECK (
            status NOT IN ('assigned', 'in_progress')
            OR assigned_to IS NOT NULL
        ),

    CONSTRAINT tickets_resolved_at_consistent
        CHECK (
            (status IN ('resolved', 'closed', 'rejected'))
            =
            (resolved_at IS NOT NULL)
        )
);


-- ============================================================================
-- GUARANTEE 1
-- One active ticket per facility/category
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS tickets_one_active_per_issue
    ON tickets (facility_id, category)
    WHERE status IN (
        'open',
        'assigned',
        'in_progress'
    );


-- ============================================================================
-- TICKET EVENTS / AUDIT TRAIL
-- ============================================================================

CREATE TABLE IF NOT EXISTS ticket_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    ticket_id UUID NOT NULL
        REFERENCES tickets(id)
        ON DELETE CASCADE,

    actor_id UUID
        REFERENCES users(id)
        ON DELETE SET NULL,

    event_type ticket_event_type NOT NULL,

    from_status ticket_status,

    to_status ticket_status,

    note TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT ticket_events_comment_has_note
        CHECK (
            event_type <> 'comment'
            OR length(btrim(coalesce(note, ''))) > 0
        ),

    CONSTRAINT ticket_events_transition_has_target
        CHECK (
            event_type NOT IN ('claimed', 'status_changed')
            OR to_status IS NOT NULL
        )
);


-- ============================================================================
-- AFFECTED USERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS ticket_affected_users (
    ticket_id UUID NOT NULL
        REFERENCES tickets(id)
        ON DELETE CASCADE,

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    PRIMARY KEY (ticket_id, user_id)
);


-- ============================================================================
-- MAINTENANCE WINDOWS
-- ============================================================================

CREATE TABLE IF NOT EXISTS maintenance_windows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    facility_id UUID NOT NULL
        REFERENCES facilities(id)
        ON DELETE CASCADE,

    scheduled_by UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    start_time TIMESTAMPTZ NOT NULL,

    end_time TIMESTAMPTZ NOT NULL,

    note TEXT,

    status maintenance_status NOT NULL DEFAULT 'scheduled',

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT maintenance_time_order
        CHECK (start_time < end_time),

    CONSTRAINT maintenance_no_overlap
        EXCLUDE USING gist (
            facility_id WITH =,
            tstzrange(
                start_time,
                end_time,
                '[)'
            ) WITH &&
        )
        WHERE (status = 'scheduled')
);


-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


DROP TRIGGER IF EXISTS tickets_set_updated_at
ON tickets;


CREATE TRIGGER tickets_set_updated_at
    BEFORE UPDATE ON tickets
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();


-- ============================================================================
-- SUPPORTING INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS tickets_facility_created_idx
    ON tickets (facility_id, created_at DESC);


CREATE INDEX IF NOT EXISTS tickets_status_priority_idx
    ON tickets (status, priority);


CREATE INDEX IF NOT EXISTS tickets_assigned_to_idx
    ON tickets (assigned_to)
    WHERE assigned_to IS NOT NULL;


CREATE INDEX IF NOT EXISTS ticket_events_ticket_created_idx
    ON ticket_events (ticket_id, created_at);


CREATE INDEX IF NOT EXISTS maintenance_facility_start_idx
    ON maintenance_windows (facility_id, start_time);