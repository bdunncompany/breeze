-- Add Huntress organization scope to huntress_integrations.
--
-- Background: Breeze's huntress sync was fetching the entire Huntress account
-- fleet and dumping it into the integration's Breeze org. That made every
-- per-client integration ingest ALL agents. Huntress's /v1/agents and
-- /v1/incident_reports endpoints accept ?organization_id=<id> for server-side
-- filtering (verified live 2026-05-18). This column lets each integration
-- scope to one Huntress organization.
--
-- NULL preserves legacy behavior (no filter, returns full account fleet) so
-- existing rows are unaffected.

ALTER TABLE huntress_integrations
  ADD COLUMN huntress_organization_id varchar(64);

COMMENT ON COLUMN huntress_integrations.huntress_organization_id IS
  'When set, list calls send ?organization_id=<id>. NULL means full-account sync.';
