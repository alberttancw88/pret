'use client';

// A5 · Users — S-AC-01 · /users · F-ADM-01 · US-ADMIN-001.
// Search email, display name, employee no. · Filters User type, Role (Admin / Super Admin / none),
// Status (multi), Last login from/to, MFA · Columns Display name › · Login email · User type ·
// Linked employee · Roles (chips; Manager derived) · Status ● · Last login · MFA · Access end ·
// INVITE USER (SA) · EXPORT .CSV. ADM scope: employee users without privileged roles only
// (filtered by the server — the "Role" filter is hidden for ADM).
import * as React from 'react';
import Typography from '@mui/material/Typography';
import {
  USER_STATUSES,
  USER_STATUS_LABELS,
  USER_TYPE_LABELS,
  type UserListParams,
  type UserRow,
} from '@/server/contracts/users';
import { exportUsersCsv } from '@/server/actions/users';
import ListPage, { type ListColumn } from '../list/ListPage';
import { DateFilter, KeywordField, MultiSelectFilter, SelectFilter } from '../list/FilterFields';
import { useServerList, downloadServerCsv } from '../list/useServerList';
import StatusChip from '../StatusChip';
import DateText from '../DateText';
import { useToast } from '../ToastProvider';
import UserRoleChips, { roleText } from './UserRoleChips';
import { USER_FILTERS } from './filters';
import { userStatusLabel } from './labels';
import { formatDate, formatDateTime } from '@/lib/format';

export default function UsersList({
  rows,
  total,
  params,
  isSuperAdmin,
}: {
  rows: UserRow[];
  total: number;
  params: UserListParams;
  isSuperAdmin: boolean;
}) {
  const list = useServerList({ filters: USER_FILTERS, sort: { key: 'displayName', direction: 'asc' } });
  const toast = useToast();
  const d = list.draft;
  const set = list.setDraftField;

  const columns: ListColumn<UserRow>[] = [
    { key: 'displayName', header: 'Display name', value: (r) => r.displayName, minWidth: 160 },
    { key: 'loginEmail', header: 'Login email', value: (r) => r.loginEmail, minWidth: 200 },
    { key: 'userType', header: 'User type', value: (r) => USER_TYPE_LABELS[r.userType] },
    {
      key: 'employee',
      header: 'Linked employee',
      sortable: false,
      priority: 'low',
      value: (r) => (r.employeeNo ? `${r.employeeNo}${r.employeeName ? ` · ${r.employeeName}` : ''}` : r.userType === 'external' ? r.serviceProvider ?? '' : ''),
    },
    { key: 'roles', header: 'Roles', sortable: false, minWidth: 140, value: (r) => roleText(r), render: (r) => <UserRoleChips userType={r.userType} roles={r.roles} directReportees={r.directReportees} /> },
    { key: 'status', header: 'Status', kind: 'status', value: (r) => USER_STATUS_LABELS[r.status], render: (r) => <StatusChip set="user" value={userStatusLabel(r.status)} /> },
    { key: 'lastLogin', header: 'Last login', kind: 'date', value: (r) => formatDateTime(r.lastLoginAt), render: (r) => <DateText value={r.lastLoginAt} mode="datetime" empty="Never" /> },
    { key: 'mfa', header: 'MFA', sortable: false, value: (r) => (r.mfaEnrolled ? 'Enrolled' : 'Not enrolled') },
    {
      key: 'accessEnd',
      header: 'Access end',
      kind: 'date',
      value: (r) => formatDate(r.accessEndDate),
      render: (r) => <DateText value={r.accessEndDate} />,
    },
  ];

  const filters = [
    <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Searches email, display name and employee no." />,
    <SelectFilter
      key="type"
      label="User type"
      value={d.userType}
      onChange={(v) => set('userType', v)}
      options={[
        { value: 'employee', label: USER_TYPE_LABELS.employee },
        { value: 'external', label: USER_TYPE_LABELS.external },
      ]}
    />,
    ...(isSuperAdmin
      ? [
          <SelectFilter
            key="role"
            label="Role"
            value={d.role}
            onChange={(v) => set('role', v)}
            options={[
              { value: 'ADM', label: 'Admin' },
              { value: 'SA', label: 'Super Admin' },
              { value: 'none', label: 'None (Employee / Manager only)' },
            ]}
          />,
        ]
      : []),
    <MultiSelectFilter key="status" label="Status" value={d.status} onChange={(v) => set('status', v)} options={USER_STATUSES.map((s) => ({ value: s, label: USER_STATUS_LABELS[s] }))} />,
    <DateFilter key="from" label="Last login from" value={d.lastLoginFrom} onChange={(v) => set('lastLoginFrom', v)} />,
    <DateFilter key="to" label="Last login to" value={d.lastLoginTo} onChange={(v) => set('lastLoginTo', v)} />,
    <SelectFilter
      key="mfa"
      label="MFA"
      value={d.mfa}
      onChange={(v) => set('mfa', v)}
      options={[
        { value: 'enrolled', label: 'Enrolled' },
        { value: 'not_enrolled', label: 'Not enrolled' },
      ]}
    />,
  ];

  return (
    <>
      {!isSuperAdmin && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          You see employee users without Admin or Super Admin roles. Privileged and external users are managed by a Super Admin.
        </Typography>
      )}
      <ListPage<UserRow>
        itemName={{ singular: 'user', plural: 'users' }}
        filters={filters}
        {...list.listProps}
        onExport={async () => {
          try {
            const res = await exportUsersCsv(params);
            if (res.ok) downloadServerCsv(res.filename || 'users', res.content);
            else toast.info(res.error);
          } catch {
            toast.info('Export failed. Please try again.');
          }
        }}
        exportSensitive
        addNew={isSuperAdmin ? { label: 'Invite user', href: '/users/new' } : undefined}
        columns={columns}
        rows={rows}
        total={total}
        getRowId={(r) => r.id}
        getRowHref={(r) => `/users/${r.id}`}
        getRowRef={(r) => r.displayName}
        empty={{ title: 'No users yet.' }}
      />
    </>
  );
}
