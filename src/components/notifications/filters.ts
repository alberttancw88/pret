// URL filter defaults for the W2-007 notification screens (plain module: shared by pages and client lists).
export const NOTIFICATION_LOG_FILTERS = { q: '', eventCodes: '', channels: '', statuses: '', from: '', to: '' };
export const NOTIFICATION_LOG_SORTS = ['at', 'event', 'recipient', 'status'] as const;
export const TEMPLATE_FILTERS = { q: '', overriddenOnly: '' };
