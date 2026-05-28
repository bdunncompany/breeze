-- GIN trigram index on software_inventory.name so the picker's substring
-- search (`?search=...` in /devices/software/distinct) stops sequential-
-- scanning the table on every keystroke. Verified live on bdunn prod:
-- EXPLAIN ANALYZE of `WHERE name ILIKE '%firefox%'` showed Seq Scan over
-- 36,931 rows, ~60ms, growing linearly with row count. A GIN trigram
-- index converts that to a bitmap index scan, sub-ms regardless of fleet
-- size. pg_trgm is already installed (verified on prod 2026-05-28,
-- version 1.6) and the rest of the codebase already depends on it
-- (search-by-name patterns elsewhere — keep this idempotent so a future
-- consolidation does not double-create).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS software_inventory_name_trgm_idx
  ON software_inventory USING gin (name gin_trgm_ops);
