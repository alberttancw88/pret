import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import {
  getEmployeeFormOptions,
  getEmployeeProfile,
  getEmployeeSensitive,
  listChangeRequests,
  listEmployeeActivity,
  listEmployeeDocuments,
  listEmployeeFieldChanges,
  listHrNotes,
} from '@/server/queries/employees';
import { getOrgOptions } from '@/server/queries/org';
import {
  ACTIVITY_EVENT_TYPES,
  CR_STATUSES,
  DOCUMENT_CATEGORIES,
  type ActivityParams,
  type DocumentListParams,
} from '@/server/contracts/employees';
import EmployeeProfileView, { type ProfileTabData } from '@/components/employees/profile/EmployeeProfileView';
import { ACTIVITY_FILTERS, DOCUMENT_FILTERS, DOCUMENT_SORTS, isoOrUndef, pickList } from '@/components/employees/filters';
import { readListParams, spValue, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'Employee' };
export const dynamic = 'force-dynamic';

// E3 · S-EM-03 · /employees/{employeeNo} — Admin and Super Admin only. Managers use
// /team/{employeeNo} (P32) and employees /my/profile (P16); getEmployeeProfile returns null
// outside ADM/SA scope → "Not found or no access". Tab data loads only for the open tab;
// religion/OKU (T4) only after "Show sensitive details" (?sensitive=1 — logged read).
export default async function EmployeeProfilePage({ params, searchParams }: { params: Promise<{ employeeNo: string }>; searchParams: Promise<SearchParamsRecord> }) {
  const user = await requireUser(['ADM', 'SA']);
  const { employeeNo } = await params;
  const sp = await searchParams;
  const profile = await getEmployeeProfile(decodeURIComponent(employeeNo));
  if (!profile) notFound();
  const tab = spValue(sp, 'tab') ?? 'overview';
  const [org, formOptions] = await Promise.all([getOrgOptions(), getEmployeeFormOptions()]);

  const data: ProfileTabData = { sensitive: null, documents: null, notes: null, activity: null, changeRequests: null };
  if ((tab === 'personal' || tab === 'statutory') && (spValue(sp, 'sensitive') === '1' || profile.isOwnRecord)) {
    data.sensitive = await getEmployeeSensitive(profile.id);
  }
  if (tab === 'documents') {
    const lp = readListParams(sp, { filters: DOCUMENT_FILTERS, sort: { key: 'uploadedAt', direction: 'desc' } });
    const f = lp.filters;
    const p: DocumentListParams = {
      ...toPageParams(lp, DOCUMENT_SORTS),
      employeeId: profile.id,
      categories: pickList(f.categories, DOCUMENT_CATEGORIES),
      visible: f.visible === 'visible' || f.visible === 'hidden' ? f.visible : 'all',
      active: f.active === 'inactive' || f.active === 'all' ? f.active : 'active',
    };
    if (!lp.sort) p.dir = 'desc';
    const res = await listEmployeeDocuments(p);
    data.documents = { rows: res.rows, total: res.total, params: p };
  }
  if (tab === 'employment') {
    // reference-document picker in E5 (active documents of this employee)
    const res = await listEmployeeDocuments({ employeeId: profile.id, page: 1, pageSize: 100, active: 'active', sort: 'uploadedAt', dir: 'desc' });
    data.documents = { rows: res.rows, total: res.total, params: { employeeId: profile.id } };
  }
  if (tab === 'notes') data.notes = await listHrNotes(profile.id);
  if (tab === 'change_requests') {
    const res = await listChangeRequests({ employeeId: profile.id, statuses: [...CR_STATUSES], page: 1, pageSize: 100, sort: 'submittedAt', dir: 'desc' });
    data.changeRequests = { rows: res.rows, total: res.total };
  }
  if (tab === 'activity' && profile.can.viewActivity) {
    const lp = readListParams(sp, { filters: ACTIVITY_FILTERS });
    const f = lp.filters;
    const view = f.view === 'fields' ? 'fields' : 'events';
    const p: ActivityParams = {
      employeeId: profile.id,
      view,
      page: lp.page + 1,
      pageSize: lp.rowsPerPage,
      dir: 'desc',
      eventTypes: pickList(f.eventTypes, ACTIVITY_EVENT_TYPES),
      from: isoOrUndef(f.from),
      to: isoOrUndef(f.to),
    };
    const res = view === 'fields' ? await listEmployeeFieldChanges(p) : await listEmployeeActivity(p);
    data.activity = { view, rows: res.rows, total: res.total, params: p };
  }

  const isSuperAdmin = user.roles.includes('SA');
  return <EmployeeProfileView ctx={{ profile, org, formOptions, isSuperAdmin, revealMode: isSuperAdmin ? 'sa' : 'adm' }} data={data} />;
}
