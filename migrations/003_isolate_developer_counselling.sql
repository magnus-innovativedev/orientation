UPDATE audio_recordings
SET branch_id = NULL
WHERE created_by_user_id IN (
    SELECT users.id
    FROM users
    JOIN roles ON roles.id = users.role_id
    WHERE roles.key = 'developer'
);

UPDATE leads
SET branch_id = NULL
WHERE id IN (
    SELECT lead_id
    FROM audio_recordings
    WHERE created_by_user_id IN (
        SELECT users.id
        FROM users
        JOIN roles ON roles.id = users.role_id
        WHERE roles.key = 'developer'
    )
);
