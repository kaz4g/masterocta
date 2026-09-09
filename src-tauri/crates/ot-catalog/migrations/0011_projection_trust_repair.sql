CREATE TABLE IF NOT EXISTS catalog_meta (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);

INSERT INTO catalog_meta (key, value)
VALUES ('observational_projection_repair_applied', '0');
