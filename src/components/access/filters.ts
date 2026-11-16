// List filter defaults (URL keys) for the users & audit screens. Plain module so Server
// Component pages and client lists share the same values.
export const USER_FILTERS = { q: '', userType: '', role: '', status: '', lastLoginFrom: '', lastLoginTo: '', mfa: '' };
export const LOGIN_HISTORY_FILTERS = { outcome: '', from: '', to: '' };
/** from/to empty = last 7 days (set by the page). */
export const AUDIT_FILTERS = { q: '', from: '', to: '', actorUserId: '', externalOnly: '', actions: '', entityType: '', categories: '' };
