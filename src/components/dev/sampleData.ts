// SYNTHETIC sample data for the dev component gallery (/dev/components, 404 in production).
// No real people or amounts. Shapes follow src/server/contracts/reports.ts so the previews render the live components.
import type { AdminDashboard, PayrollInputPack, ReportFilterOptions, ReportResult } from '@/server/contracts/reports';
import { PAYROLL_INPUT_NO_CLAIMS_NOTE } from '@/server/contracts/reports';

export const SAMPLE_ADMIN_DASHBOARD: AdminDashboard = {
  asAt: '2026-11-26T01:30:00Z',
  today: '2026-11-26',
  hr: {
    headcount: 42,
    onLeaveToday: 3,
    pendingLeave: 5,
    pendingLeaveAdmin: 2,
    probationDue: 1,
    missingPayroll: null, // shows the per-tile "Couldn't load — RETRY" state
    changeRequests: 2,
    phYear: 2027,
    phStatus: 'Draft',
    phPublishBy: '2026-12-31',
  },
  alerts: [
    { code: 'N-49', message: '2 reportees without an active manager', href: '/organisation/reporting-lines', tone: 'warning' },
    { code: 'email', message: 'Email is not configured — 12 emails are queued.', href: '/notifications/log', tone: 'info' },
  ],
  claims: {
    period: 'this',
    periodFrom: '2026-11-01',
    periodTo: '2026-11-30',
    submitted: 6,
    approvedNotDisbursed: 11,
    disbursed: 24,
    rejected: 1,
    exclSst: '18204.11',
    sst: '612.40',
    total: '18816.51',
    awaiting: { count: 6, amount: '1204.10' },
    approvedNd: { count: 11, amount: '2140.60', agedOver30: 2 },
    batch: { batchNo: 'PB-2026-011', href: '/claims/batches/PB-2026-011', status: 'exported', statusLabel: 'Exported', outOfDate: true, nextStep: 'Mark disbursed' },
  },
};

export const SAMPLE_REPORT_OPTIONS: ReportFilterOptions = {
  reportId: 'leave-balances',
  departments: [
    { id: '00000000-0000-4000-8000-000000000001', label: 'Sample Department A' },
    { id: '00000000-0000-4000-8000-000000000002', label: 'Sample Department B' },
  ],
  locations: [{ id: '00000000-0000-4000-8000-000000000011', label: 'Sample Office (Selangor)' }],
  leaveTypes: [
    { id: '00000000-0000-4000-8000-000000000021', label: 'Annual' },
    { id: '00000000-0000-4000-8000-000000000022', label: 'Sick' },
  ],
  claimCategories: [],
  batches: [],
  separationTypes: [],
  employees: [],
  employeeLocked: false,
  defaults: { asAt: '2026-11-26', employmentStatus: 'active' },
  employeeMasterFields: [],
};

const cols: ReportResult['columns'] = [
  { key: 'employee', label: 'Employee', format: 'text', sortable: true },
  { key: 'months', label: 'Months of service', format: 'int', sortable: true },
  { key: 'al_ent', label: 'Entitled', format: 'days', group: 'Annual', sortable: false },
  { key: 'al_taken', label: 'Taken', format: 'days', group: 'Annual', sortable: false },
  { key: 'al_avail', label: 'Available', format: 'days', group: 'Annual', sortable: false },
  { key: 'sl_ent', label: 'Entitled', format: 'days', group: 'Sick', sortable: false },
  { key: 'sl_taken', label: 'Taken', format: 'days', group: 'Sick', sortable: false },
  { key: 'sl_avail', label: 'Available', format: 'days', group: 'Sick', sortable: false },
];
const row = (id: string, group: string, employee: string, months: number, al: [string, string, string], sl: [string, string, string], kind: 'row' | 'subtotal' | 'total' = 'row') => ({
  id,
  group,
  kind,
  href: kind === 'row' ? '/reports/leave-individual' : null,
  cells: { employee, months: kind === 'row' ? months : null, al_ent: al[0], al_taken: al[1], al_avail: al[2], sl_ent: sl[0], sl_taken: sl[1], sl_avail: sl[2] },
});

export const SAMPLE_REPORT_RESULT: ReportResult = {
  reportId: 'leave-balances',
  title: 'Leave balances',
  searched: true,
  columns: cols,
  rows: [
    row('r1', 'Sample Department A', 'Sample Employee A (EMP-901)', 26, ['14.0', '4.5', '9.5'], ['14.0', '2.0', '12.0']),
    row('r2', 'Sample Department A', 'Sample Employee B (EMP-902)', 8, ['8.0', '1.0', '7.0'], ['14.0', '0.0', '14.0']),
    row('s1', 'Sample Department A', 'Subtotal — Sample Department A', 0, ['22.0', '5.5', '16.5'], ['28.0', '2.0', '26.0'], 'subtotal'),
    row('r3', 'Sample Department B', 'Sample Employee C (EMP-903)', 61, ['16.0', '10.0', '6.0'], ['18.0', '3.5', '14.5']),
    row('s2', 'Sample Department B', 'Subtotal — Sample Department B', 0, ['16.0', '10.0', '6.0'], ['18.0', '3.5', '14.5'], 'subtotal'),
    row('t', '', 'Total', 0, ['38.0', '15.5', '22.5'], ['46.0', '5.5', '40.5'], 'total'),
  ],
  total: 3,
  page: 1,
  pageSize: 25,
  summary: [
    { label: 'Employees', value: '3', format: 'int' },
    { label: 'Annual available', value: '22.5', format: 'days' },
    { label: 'Sick available', value: '40.5', format: 'days' },
  ],
  tables: [],
  meta: {
    generatedAt: '2026-11-26T01:30:00Z',
    generatedBy: 'Sample Admin',
    asAt: '2026-11-26',
    scope: 'all',
    sensitive: false,
    viewLogged: false,
    notes: [],
  },
};

export const SAMPLE_PAYROLL_PACK: PayrollInputPack = {
  month: '2026-11',
  monthLabel: 'November 2026',
  periodFrom: '2026-11-01',
  periodTo: '2026-11-30',
  tabs: [
    {
      key: 'unpaid_leave',
      sheet: 'unpaid_leave',
      title: 'Unpaid leave days',
      count: 2,
      columns: [
        { key: 'employeeNo', label: 'Employee no.', format: 'text', sortable: false },
        { key: 'name', label: 'Name', format: 'text', sortable: false },
        { key: 'dates', label: 'Dates', format: 'text', sortable: false },
        { key: 'days', label: 'Days', format: 'days', sortable: false },
      ],
      rows: [
        { id: 'u1', href: null, cells: { employeeNo: 'EMP-901', name: 'Sample Employee A', dates: '10/11/2026 – 11/11/2026', days: '2.0' } },
        { id: 'u2', href: null, badge: 'Reversal', cells: { employeeNo: 'EMP-902', name: 'Sample Employee B', dates: '03/10/2026', days: '-1.0' } },
      ],
    },
  ],
  lastExport: null,
  noClaimsNote: PAYROLL_INPUT_NO_CLAIMS_NOTE,
  retired: null,
  meta: { generatedAt: '2026-11-26T01:30:00Z', generatedBy: 'Sample Admin', asAt: null, scope: 'all', sensitive: true, viewLogged: true, notes: [] },
};
