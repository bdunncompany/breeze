// Map raw audit action codes (dotted, machine-shaped) to human-readable
// phrases. Falls back to a generic prettifier for unknown codes.

const ACTION_DISPLAY: Record<string, string> = {
  // Agent telemetry submissions (high volume)
  'agent.sessions.submit': 'Reported sessions',
  'agent.security_status.submit': 'Reported security status',
  'agent.management_posture.submit': 'Reported management posture',
  'agent.patches.submit': 'Reported patches',
  'agent.eventlogs.submit': 'Reported event logs',
  'agent.reliability.submit': 'Reported reliability',
  'agent.command.result.submit': 'Submitted command result',
  'agent.filesystem.threshold_scan.queued': 'Filesystem scan queued',
  'agent.enroll': 'Agent enrolled',

  // User/auth
  'user.login': 'Signed in',
  'user.logout': 'Signed out',
  'session_initiated': 'Session initiated',
  'session_offer_submitted': 'Session offer submitted',

  // Devices
  'device.wake_on_lan': 'Sent Wake-on-LAN',
  'device.create': 'Added device',
  'device.update': 'Updated device',
  'device.delete': 'Removed device',
  'device.archive': 'Archived device',

  // Orgs/sites
  'organization.create': 'Created organization',
  'organization.update': 'Updated organization',
  'organization.delete': 'Deleted organization',
  'site.create': 'Created site',
  'site.update': 'Updated site',
  'site.delete': 'Deleted site',

  // Alerts
  'alert.create': 'Raised alert',
  'alert.resolve': 'Resolved alert',
  'alert.acknowledge': 'Acknowledged alert',
  'alert.dismiss': 'Dismissed alert',

  // Enrollment
  'enrollment_key.create': 'Created enrollment key',
  'enrollment_key.revoke': 'Revoked enrollment key',

  // Partner
  'partner.settings.update': 'Updated partner settings',

  // AI / MCP
  'ai.message.send': 'Sent AI message',
  'ai.tool_approval.update': 'Updated AI tool approval',
  'mcp.initialize': 'MCP: initialize',
  'mcp.notifications.initialized': 'MCP: initialized notifications',
  'mcp.tools.list': 'MCP: list tools',
  'mcp.tools.call': 'MCP: call tool',
  'mcp.resources.list': 'MCP: list resources',

  // Remote sessions
  'terminal.session.summary': 'Terminal session summary',

  // Scripts / automation
  'script.run': 'Ran script',
  'script.create': 'Created script',
  'script.update': 'Updated script',
  'script.delete': 'Deleted script',
  'automation.create': 'Created automation',
  'automation.update': 'Updated automation',
  'automation.delete': 'Deleted automation',
};

// Generic prettifier for codes that aren't in the map.
// Examples:
//   "foo.bar_baz.update" -> "Foo bar baz update"
//   "api.post.events.ws-ticket" -> "Api post events ws-ticket"
function prettify(action: string): string {
  const cleaned = action
    .replace(/[._]/g, ' ')
    .trim()
    .toLowerCase();
  if (!cleaned) return action;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function formatAuditAction(action: string | null | undefined): string {
  if (!action) return '';
  return ACTION_DISPLAY[action] ?? prettify(action);
}
