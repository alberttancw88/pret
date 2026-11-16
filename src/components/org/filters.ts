// List filter defaults (URL keys) for the organisation lists. Plain module (no 'use client')
// so Server Component pages and client lists share the same values.
export const DEPARTMENT_FILTERS = { q: '', active: '', parentId: '' };
export const POSITION_FILTERS = { q: '', departmentId: '', gradeId: '', active: '' };
export const GRADE_FILTERS = { q: '', active: '' };
export const COST_CENTRE_FILTERS = { q: '', active: '' };
export const GROUP_FILTERS = { q: '', active: '' };
export const LOCATION_FILTERS = { q: '', state: '', active: '' };
export const PATTERN_FILTERS = { q: '', active: '' };
/** Holidays: year is set by the page (current year when absent). */
export const HOLIDAY_FILTERS = { q: '', year: '', states: '', types: '', observed: '', view: 'list' };

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string | undefined | null): v is string => !!v && UUID_RE.test(v);
