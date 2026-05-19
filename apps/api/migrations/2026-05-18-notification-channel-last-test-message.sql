-- #728: persist the vendor error/success message from the last channel test so
-- the detail-card tooltip can surface why a test passed or failed. Sits
-- alongside last_tested_at + last_test_status added by
-- 2026-05-15-notification-channels-test-status-fields.sql.
ALTER TABLE notification_channels
  ADD COLUMN IF NOT EXISTS last_test_message text;
