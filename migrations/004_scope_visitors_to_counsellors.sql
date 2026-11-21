ALTER TABLE leads ADD COLUMN created_by_user_id TEXT REFERENCES users(id);

UPDATE leads
SET created_by_user_id = (
    SELECT audio_recordings.created_by_user_id
    FROM audio_recordings
    WHERE audio_recordings.lead_id = leads.id
)
WHERE created_by_user_id IS NULL
  AND EXISTS (
      SELECT 1
      FROM audio_recordings
      WHERE audio_recordings.lead_id = leads.id
        AND audio_recordings.created_by_user_id IS NOT NULL
  );
