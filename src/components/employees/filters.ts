// URL filter defaults for the employee lists (plain module: shared by Server Component pages
// and client lists). Multi-selects are comma lists; '' = not filtered.

/** E1 — default status = Active (On Probation + Confirmed + Notice Period, BR-EMP-31). */
export const ACTIVE_STATUS_VALUE = 'on_probation,confirmed,notice_period';
export const EMPLOYEE_FILTERS = {
  q: '',
  departmentIds: '',
  positionIds: '',
  gradeIds: '',
  locationIds: '',
  states: '',
  statuses: ACTIVE_STATUS_VALUE,
  managerId: '',
  managerName: '',
  joinFrom: '',
  joinTo: '',
  lwdFrom: '',
  lwdTo: '',
  probationEndingWithin: '',
  completeness: '',
  portalAccount: '',
};
export const EMPLOYEE_SORTS = ['employeeNo', 'fullName', 'department', 'position', 'grade', 'manager', 'location', 'joinDate', 'status', 'completeness'] as const;

/** E12 — default status Submitted. */
export const CR_FILTERS = { q: '', statuses: 'submitted', categories: '', submittedFrom: '', submittedTo: '', employeeId: '', employeeName: '' };
export const CR_SORTS = ['crNo', 'employee', 'category', 'submittedAt', 'effectiveDate', 'status'] as const;
/** P18 — all statuses by default. */
export const MY_CR_FILTERS = { q: '', statuses: '', categories: '', submittedFrom: '', submittedTo: '' };

/** E3 Documents tab. */
export const DOCUMENT_FILTERS = { q: '', categories: '', visible: '', active: 'active' };
export const DOCUMENT_SORTS = ['title', 'category', 'documentDate', 'expiryDate', 'uploadedAt'] as const;
/** P19. */
export const MY_DOCUMENT_FILTERS = { q: '', categories: '' };
export const MY_DOCUMENT_SORTS = ['title', 'category', 'documentDate', 'uploadedAt'] as const;

/** E3 Activity tab. */
export const ACTIVITY_FILTERS = { view: 'events', eventTypes: '', from: '', to: '' };

/** G10 staff directory. */
export const DIRECTORY_FILTERS = { q: '', departmentIds: '', locationIds: '' };
export const DIRECTORY_SORTS = ['name', 'position', 'department', 'location'] as const;

/** P31 my team. */
export const TEAM_FILTERS = { q: '', departmentIds: '', scope: 'all' };
export const TEAM_SORTS = ['name', 'employeeNo', 'position', 'department'] as const;

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isoOrUndef = (v: string) => (ISO_DATE.test(v) ? v : undefined);
export function pickList<T extends string>(v: string, allowed: readonly T[]): T[] | undefined {
  const list = v
    .split(',')
    .filter(Boolean)
    .filter((x): x is T => (allowed as readonly string[]).includes(x));
  return list.length ? list : undefined;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuidList = (v: string) => {
  const l = v.split(',').filter((x) => UUID_RE.test(x));
  return l.length ? l : undefined;
};
export const uuidOrUndef = (v: string) => (UUID_RE.test(v) ? v : undefined);
