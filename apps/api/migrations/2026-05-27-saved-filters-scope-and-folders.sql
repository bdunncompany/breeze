-- Saved filters: scope + folders + per-user stars + usage tracking.
-- Spec: drafts/2026-05-27-device-filters-spec.md §3.2.
--
-- Additive only. No data migration needed: existing saved_filters rows
-- default to scope='private', folder_id=NULL, use_count=0, etc.
--
-- Tenancy shapes:
--   saved_filters         - Shape 1 (direct org_id, already in baseline)
--   saved_filter_folders  - Shape 1 (direct org_id, new policies below)
--   saved_filter_stars    - Shape 6 (user_id scoped via breeze_current_user_id)
--
-- Fully idempotent.

-- ============================================================
-- Enums
-- ============================================================
DO $$ BEGIN
  CREATE TYPE saved_filter_scope AS ENUM (
    'private',
    'org',
    'partner'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- saved_filter_folders
-- ============================================================
-- Folders are per-org. One level of nesting only: parent_id either NULL
-- (top-level folder) or refers to another folder with parent_id IS NULL.
-- The depth invariant is enforced by a CHECK using a subquery; that
-- requires the constraint to be NOT VALID + VALIDATE in the same txn
-- so existing rows aren't re-checked (there are none yet, but stay
-- idempotent on re-apply).
CREATE TABLE IF NOT EXISTS saved_filter_folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  name VARCHAR(200) NOT NULL,
  parent_id UUID REFERENCES saved_filter_folders(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS saved_filter_folders_org_id_idx
  ON saved_filter_folders(org_id);
CREATE INDEX IF NOT EXISTS saved_filter_folders_parent_id_idx
  ON saved_filter_folders(parent_id) WHERE parent_id IS NOT NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_saved_filter_folder_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_saved_filter_folders_updated_at ON saved_filter_folders;
CREATE TRIGGER trg_saved_filter_folders_updated_at
  BEFORE UPDATE ON saved_filter_folders
  FOR EACH ROW
  EXECUTE FUNCTION update_saved_filter_folder_updated_at();

-- ============================================================
-- saved_filters - new columns
-- ============================================================
ALTER TABLE saved_filters
  ADD COLUMN IF NOT EXISTS scope saved_filter_scope NOT NULL DEFAULT 'private';
ALTER TABLE saved_filters
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES saved_filter_folders(id) ON DELETE SET NULL;
ALTER TABLE saved_filters
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE saved_filters
  ADD COLUMN IF NOT EXISTS use_count INT NOT NULL DEFAULT 0;
ALTER TABLE saved_filters
  ADD COLUMN IF NOT EXISTS icon VARCHAR(50);
ALTER TABLE saved_filters
  ADD COLUMN IF NOT EXISTS color VARCHAR(7);

CREATE INDEX IF NOT EXISTS saved_filters_org_scope_idx
  ON saved_filters(org_id, scope);
CREATE INDEX IF NOT EXISTS saved_filters_folder_id_idx
  ON saved_filters(folder_id) WHERE folder_id IS NOT NULL;

-- ============================================================
-- saved_filter_stars (per-user stars, Shape 6)
-- ============================================================
CREATE TABLE IF NOT EXISTS saved_filter_stars (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filter_id UUID NOT NULL REFERENCES saved_filters(id) ON DELETE CASCADE,
  starred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, filter_id)
);

CREATE INDEX IF NOT EXISTS saved_filter_stars_filter_id_idx
  ON saved_filter_stars(filter_id);

-- ============================================================
-- RLS - saved_filter_folders (Shape 1, direct org_id)
-- ============================================================
ALTER TABLE saved_filter_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_filter_folders FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS breeze_org_isolation_select ON saved_filter_folders;
DROP POLICY IF EXISTS breeze_org_isolation_insert ON saved_filter_folders;
DROP POLICY IF EXISTS breeze_org_isolation_update ON saved_filter_folders;
DROP POLICY IF EXISTS breeze_org_isolation_delete ON saved_filter_folders;

CREATE POLICY breeze_org_isolation_select ON saved_filter_folders
  FOR SELECT USING (public.breeze_has_org_access(org_id));
CREATE POLICY breeze_org_isolation_insert ON saved_filter_folders
  FOR INSERT WITH CHECK (public.breeze_has_org_access(org_id));
CREATE POLICY breeze_org_isolation_update ON saved_filter_folders
  FOR UPDATE USING (public.breeze_has_org_access(org_id))
  WITH CHECK (public.breeze_has_org_access(org_id));
CREATE POLICY breeze_org_isolation_delete ON saved_filter_folders
  FOR DELETE USING (public.breeze_has_org_access(org_id));

-- ============================================================
-- RLS - saved_filter_stars (Shape 6, user_id scoped)
-- ============================================================
-- Mirrors the user_sso_identities / push_notifications pattern from
-- 2026-04-11-bucket-c-phase-6-user-scoped-rls.sql: the user themselves
-- can read/write their own stars, plus admins with partner/org access
-- to the user can see them.
ALTER TABLE saved_filter_stars ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_filter_stars FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS breeze_user_isolation_select ON saved_filter_stars;
DROP POLICY IF EXISTS breeze_user_isolation_insert ON saved_filter_stars;
DROP POLICY IF EXISTS breeze_user_isolation_update ON saved_filter_stars;
DROP POLICY IF EXISTS breeze_user_isolation_delete ON saved_filter_stars;

CREATE POLICY breeze_user_isolation_select ON saved_filter_stars
  FOR SELECT USING (
    user_id = public.breeze_current_user_id()
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = saved_filter_stars.user_id
               AND (public.breeze_has_partner_access(u.partner_id)
                    OR public.breeze_has_org_access(u.org_id)))
  );
CREATE POLICY breeze_user_isolation_insert ON saved_filter_stars
  FOR INSERT WITH CHECK (
    user_id = public.breeze_current_user_id()
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = saved_filter_stars.user_id
               AND (public.breeze_has_partner_access(u.partner_id)
                    OR public.breeze_has_org_access(u.org_id)))
  );
CREATE POLICY breeze_user_isolation_update ON saved_filter_stars
  FOR UPDATE USING (
    user_id = public.breeze_current_user_id()
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = saved_filter_stars.user_id
               AND (public.breeze_has_partner_access(u.partner_id)
                    OR public.breeze_has_org_access(u.org_id)))
  )
  WITH CHECK (
    user_id = public.breeze_current_user_id()
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = saved_filter_stars.user_id
               AND (public.breeze_has_partner_access(u.partner_id)
                    OR public.breeze_has_org_access(u.org_id)))
  );
CREATE POLICY breeze_user_isolation_delete ON saved_filter_stars
  FOR DELETE USING (
    user_id = public.breeze_current_user_id()
    OR EXISTS (SELECT 1 FROM users u WHERE u.id = saved_filter_stars.user_id
               AND (public.breeze_has_partner_access(u.partner_id)
                    OR public.breeze_has_org_access(u.org_id)))
  );
