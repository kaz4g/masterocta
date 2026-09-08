ALTER TABLE projects
ADD COLUMN has_saved_checkpoint INTEGER NOT NULL DEFAULT 0
CHECK (has_saved_checkpoint IN (0, 1));
