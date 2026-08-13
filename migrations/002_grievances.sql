CREATE TABLE IF NOT EXISTS grievances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    student_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    title VARCHAR(150) NOT NULL,

    description TEXT NOT NULL,

    category VARCHAR(50) NOT NULL,

    location VARCHAR(150),

    status VARCHAR(30) NOT NULL DEFAULT 'OPEN',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT grievances_status_check
        CHECK (
            status IN (
                'OPEN',
                'IN_PROGRESS',
                'RESOLVED',
                'REJECTED'
            )
        )
);

CREATE INDEX IF NOT EXISTS idx_grievances_student_id
    ON grievances(student_id);

CREATE INDEX IF NOT EXISTS idx_grievances_status
    ON grievances(status);

CREATE INDEX IF NOT EXISTS idx_grievances_created_at
    ON grievances(created_at DESC);