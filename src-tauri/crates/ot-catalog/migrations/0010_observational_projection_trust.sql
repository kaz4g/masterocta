ALTER TABLE roots
ADD COLUMN observational_projection_untrusted INTEGER NOT NULL DEFAULT 0
CHECK (observational_projection_untrusted IN (0, 1));
