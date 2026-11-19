'use client';

// E1 · Employee list — S-EM-01 · /employees · F-EMP-01, F-EMP-24 · US-EMP-003, 021.
// Search: employee no., full name, preferred name, work email, MyKad last 4 digits.
// Filters: Department · Position · Grade · Work location · Status (default Active) · Reporting
// manager · Join from–to · More: Work state · LWD from–to · Probation ending within ·
// Data completeness · Portal account.
// Columns: Employee no. › · Full name · Preferred name · Department · Position · Grade ·
// Reporting manager · Work location (state) · Join date · Years of service · Status ● ·
// Work email · Mobile · Completeness % (tooltip lists missing) · 👁.
// EXPORT .CSV (server: no NRIC/bank/religion/OKU/family; logged) · IMPORT → /imports/new?template=T2 ·
// ADD NEW EMPLOYEE · bulk CHANGE MANAGER / SEND INVITES (E15).
import * as React from 'react';
import NextLink from 'next/link';
import Button from '@mui/material/Button';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import {
  EMPLOYMENT_STATUSES,
  EMPLOYMENT_STATUS_LABELS,
  MY_STATES,
  MY_STATE_LABELS,
  PORTAL_ACCOUNT_STATES,
  PORTAL_ACCOUNT_STATE_LABELS,
  lengthOfServiceShort,
  type EmployeeListParams,
  type EmployeeRow,
} from '@/server/contracts/employees';
import type { OrgOptions } from '@/server/contracts/org';
import { exportEmployeesCsv } from '@/server/actions/employees';
import ListPage, { type ListColumn } from '../list/ListPage';
import { DateFilter, KeywordField, MultiSelectFilter, SelectFilter } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import DateText from '../DateText';
import { useToast } from '../ToastProvider';
import { orgFilterOptions } from '../org/common';
import EmployeePicker from './EmployeePicker';
import { ChangeManagerDialog, SendInvitesDialog } from './BulkActionDialogs';
import { CompletenessBadge, EmploymentStatusChip, phone, stateLabel } from './labels';
import { EMPLOYEE_FILTERS } from './filters';
import { formatDate } from '@/lib/format';

export default function EmployeesList({ rows, total, params, options }: { rows: EmployeeRow[]; total: number; params: EmployeeListParams; options: OrgOptions }) {
  const list = useServerList({ filters: EMPLOYEE_FILTERS, sort: { key: 'employeeNo', direction: 'asc' } });
  const toast = useToast();
  const d = list.draft;
  const set = list.setDraftField;
  const moreActive = ['states', 'lwdFrom', 'lwdTo', 'probationEndingWithin', 'completeness', 'portalAccount'].some((k) => d[k as keyof typeof d]);
  const [more, setMore] = React.useState(moreActive);
  const [selected, setSelected] = React.useState<string[]>([]);
  const seen = React.useRef(new Map<string, EmployeeRow>());
  rows.forEach((r) => seen.current.set(r.id, r));
  const selectedRows = selected.map((id) => seen.current.get(id)).filter((r): r is EmployeeRow => Boolean(r));
  const [dialog, setDialog] = React.useState<'manager' | 'invites' | null>(null);

  const columns: ListColumn<EmployeeRow>[] = [
    { key: 'employeeNo', header: 'Employee no.', value: (r) => r.employeeNo },
    { key: 'fullName', header: 'Full name', value: (r) => r.fullName, minWidth: 160 },
    { key: 'preferredName', header: 'Preferred name', sortable: false, priority: 'low', value: (r) => r.preferredName },
    { key: 'department', header: 'Department', value: (r) => r.department.label },
    { key: 'position', header: 'Position', value: (r) => r.position.label },
    { key: 'grade', header: 'Grade', priority: 'low', value: (r) => r.grade.label },
    { key: 'manager', header: 'Reporting manager', value: (r) => r.manager?.name ?? '' },
    { key: 'location', header: 'Work location (state)', value: (r) => `${r.workLocation.label} (${stateLabel(r.workState)})`, minWidth: 160 },
    { key: 'joinDate', header: 'Join date', kind: 'date', value: (r) => formatDate(r.joinDate), render: (r) => <DateText value={r.joinDate} /> },
    { key: 'service', header: 'Years of service', sortable: false, priority: 'low', value: (r) => lengthOfServiceShort(r.lengthOfService) },
    { key: 'status', header: 'Status', kind: 'status', value: (r) => EMPLOYMENT_STATUS_LABELS[r.status], render: (r) => <EmploymentStatusChip status={r.status} /> },
    { key: 'workEmail', header: 'Work email', sortable: false, priority: 'low', value: (r) => r.workEmail },
    { key: 'mobile', header: 'Mobile', sortable: false, priority: 'low', value: (r) => phone(r.mobilePhone) },
    {
      key: 'completeness',
      header: 'Compl.',
      align: 'right',
      value: (r) => `${r.completeness.pct}%`,
      render: (r) => <CompletenessBadge c={r.completeness} />,
    },
  ];

  const filters: React.ReactNode[] = [
    <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Searches employee no., name, preferred name, work email and MyKad last 4 digits." />,
    <MultiSelectFilter key="dept" label="Department" value={d.departmentIds} onChange={(v) => set('departmentIds', v)} options={orgFilterOptions(options.departments)} />,
    <MultiSelectFilter key="pos" label="Position" value={d.positionIds} onChange={(v) => set('positionIds', v)} options={orgFilterOptions(options.positions)} />,
    <MultiSelectFilter key="grade" label="Grade" value={d.gradeIds} onChange={(v) => set('gradeIds', v)} options={orgFilterOptions(options.grades)} />,
    <MultiSelectFilter
      key="loc"
      label="Work location"
      value={d.locationIds}
      onChange={(v) => set('locationIds', v)}
      options={options.locations.map((l) => ({ value: l.id, label: `${l.label} (${MY_STATE_LABELS[l.state]})${l.isActive ? '' : ' (inactive)'}` }))}
    />,
    <MultiSelectFilter key="status" label="Status" value={d.statuses} onChange={(v) => set('statuses', v)} options={EMPLOYMENT_STATUSES.map((s) => ({ value: s, label: EMPLOYMENT_STATUS_LABELS[s] }))} />,
    <EmployeePicker
      key="mgr"
      label="Reporting manager"
      activeOnly={false}
      value={d.managerId ? { id: d.managerId, employeeNo: '', name: d.managerName || 'Selected manager' } : null}
      onChange={(v) => {
        set('managerId', v?.id ?? '');
        set('managerName', v ? `${v.name}${v.employeeNo ? ` (${v.employeeNo})` : ''}` : '');
      }}
    />,
    <DateFilter key="jf" label="Join from" value={d.joinFrom} onChange={(v) => set('joinFrom', v)} />,
    <DateFilter key="jt" label="Join to" value={d.joinTo} onChange={(v) => set('joinTo', v)} />,
    <Button
      key="more"
      variant="text"
      onClick={() => setMore((m) => !m)}
      endIcon={more ? <ExpandLessIcon /> : <ExpandMoreIcon />}
      aria-expanded={more}
      sx={{ height: 40, justifyContent: 'flex-start' }}
    >
      {more ? 'Fewer filters' : 'More filters'}
    </Button>,
    ...(more
      ? [
          <MultiSelectFilter key="state" label="Work state" value={d.states} onChange={(v) => set('states', v)} options={MY_STATES.map((s) => ({ value: s, label: MY_STATE_LABELS[s] }))} />,
          <DateFilter key="lf" label="LWD from" value={d.lwdFrom} onChange={(v) => set('lwdFrom', v)} />,
          <DateFilter key="lt" label="LWD to" value={d.lwdTo} onChange={(v) => set('lwdTo', v)} />,
          <SelectFilter
            key="prob"
            label="Probation ending within"
            value={d.probationEndingWithin}
            onChange={(v) => set('probationEndingWithin', v)}
            options={['7', '14', '30', '60'].map((n) => ({ value: n, label: `${n} days` }))}
          />,
          <SelectFilter
            key="compl"
            label="Data completeness"
            value={d.completeness}
            onChange={(v) => set('completeness', v)}
            options={[
              { value: 'complete', label: 'Complete' },
              { value: 'incomplete', label: 'Incomplete' },
              { value: 'missing_payroll', label: 'Missing payroll fields' },
            ]}
          />,
          <MultiSelectFilter key="portal" label="Portal account" value={d.portalAccount} onChange={(v) => set('portalAccount', v)} options={PORTAL_ACCOUNT_STATES.map((s) => ({ value: s, label: PORTAL_ACCOUNT_STATE_LABELS[s] }))} />,
        ]
      : []),
  ];

  return (
    <>
      <ListPage<EmployeeRow>
        itemName={{ singular: 'employee', plural: 'employees' }}
        filters={filters}
        {...list.listProps}
        onExport={async () => {
          try {
            const res = await exportEmployeesCsv(params);
            if (res.ok) downloadServerCsv(res.filename || 'employees', res.content);
            else toast.info(res.error);
          } catch {
            toast.info('Export failed. Please try again.');
          }
        }}
        exportSensitive
        extraActions={
          <Button variant="outlined" startIcon={<UploadFileOutlinedIcon />} component={NextLink} href="/imports/new?template=T2">
            Import
          </Button>
        }
        addNew={{ label: 'Add new employee', href: '/employees/new' }}
        columns={columns}
        rows={rows}
        total={total}
        getRowId={(r) => r.id}
        getRowHref={(r) => `/employees/${encodeURIComponent(r.employeeNo)}`}
        getRowRef={(r) => `${r.employeeNo} ${r.fullName}`}
        empty={{
          title: 'No employees yet.',
          helper: 'Import from Kakitangan or add one.',
          action: (
            <>
              <Button variant="outlined" component={NextLink} href="/imports/new?template=T2">
                Import
              </Button>
              <Button variant="contained" component={NextLink} href="/employees/new">
                Add new employee
              </Button>
            </>
          ),
        }}
        selectable
        selected={selected}
        onSelectedChange={setSelected}
        bulkActions={
          <>
            <Button size="small" variant="outlined" onClick={() => setDialog('manager')}>
              Change manager
            </Button>
            <Button size="small" variant="outlined" onClick={() => setDialog('invites')}>
              Send invites
            </Button>
          </>
        }
      />
      <ChangeManagerDialog open={dialog === 'manager'} rows={selectedRows} onClose={() => setDialog(null)} onDone={() => setSelected([])} />
      <SendInvitesDialog open={dialog === 'invites'} rows={selectedRows} onClose={() => setDialog(null)} onDone={() => setSelected([])} />
    </>
  );
}
