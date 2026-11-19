'use client';

// O8 · Reporting lines — S-OR-08 · /organisation/reporting-lines · F-ORG-11 · US-ORG-009.
// Left: tree (Top of organisation → reportees), search, expand/collapse. Right: selected manager
// card — Name · Position · Reportees (direct n · indirect m) · Delegation · REASSIGN REPORTEES.
// Alert list "Reportees without an active manager" (N-49) with ASSIGN. Reassign dialog:
// Reportees * (multi, default all direct) · New manager * (loop check) · Effective date * · Remarks
// → job-history rows "Manager change" (pending approvals re-route). EXPORT .CSV (Employee · Manager · Since).
import * as React from 'react';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonGroup from '@mui/material/ButtonGroup';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Grid from '@mui/material/Grid';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import type { ReportingLineNode, ReportingLines, ReassignReporteesResult } from '@/server/contracts/org';
import { EMPLOYMENT_STATUS_LABELS } from '@/server/contracts/employees';
import { exportReportingLinesCsv, reassignReportees } from '@/server/actions/org';
import FormDialog from '../forms/FormDialog';
import { DateInput, KeyValue, TextInput } from '../forms/fields';
import { useActionRunner } from '../forms/useActionRunner';
import { downloadServerCsv } from '../list/useServerList';
import { useToast } from '../ToastProvider';
import EmptyState from '../EmptyState';
import EmployeePicker, { type PickedEmployee } from '../employees/EmployeePicker';
import OrgTree, { type OrgTreeHandle } from '../employees/OrgTree';
import { MiniTable } from '../employees/ui';
import { formatDate, todayMyt } from '@/lib/format';

export default function ReportingLinesView({ data }: { data: ReportingLines }) {
  const toast = useToast();
  const ref = React.useRef<OrgTreeHandle>(null);
  const [selected, setSelected] = React.useState<string | null>(data.roots[0] ?? null);
  const [dialog, setDialog] = React.useState<{ from: ReportingLineNode | null; preselect: string[] } | null>(null);
  const [exporting, setExporting] = React.useState(false);
  const byId = React.useMemo(() => new Map(data.nodes.map((n) => [n.employeeId, n])), [data.nodes]);
  const node = selected ? byId.get(selected) ?? null : null;
  const directOf = (id: string) => data.nodes.filter((n) => n.managerId === id);
  const people = data.nodes.map((n) => ({
    id: n.employeeId,
    managerId: n.managerId,
    name: `${n.name} (${n.employeeNo})`,
    subtitle: n.position,
    badge: n.directCount ? `${n.directCount} direct · ${n.indirectCount} indirect` : null,
  }));

  if (data.nodes.length === 0) {
    return (
      <Card>
        <CardContent>
          <EmptyState title="No employees yet." helper="Reporting lines appear once employee records exist." actions={<Button variant="contained" component={NextLink} href="/employees/new">Add new employee</Button>} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="flex-end">
        <Button
          variant="contained"
          color="success"
          startIcon={<FileDownloadOutlinedIcon />}
          loading={exporting}
          onClick={async () => {
            setExporting(true);
            try {
              const res = await exportReportingLinesCsv();
              if (res.ok) downloadServerCsv(res.filename || 'reporting-lines', res.content);
              else toast.info(res.error);
            } catch {
              toast.info('Export failed. Please try again.');
            } finally {
              setExporting(false);
            }
          }}
        >
          Export .CSV
        </Button>
      </Stack>
      {data.withoutActiveManager.length > 0 && (
        <Alert severity="warning" variant="outlined">
          <Typography variant="subtitle2" component="p" sx={{ mb: 1 }}>
            Reportees without an active manager ({data.withoutActiveManager.length})
          </Typography>
          <List dense disablePadding>
            {data.withoutActiveManager.map((w) => (
              <ListItem
                key={w.employeeId}
                disableGutters
                secondaryAction={
                  <Button size="small" variant="outlined" onClick={() => setDialog({ from: null, preselect: [w.employeeId] })}>
                    Assign
                  </Button>
                }
              >
                <ListItemText
                  primary={`${w.name} (${w.employeeNo})`}
                  secondary={w.managerName ? `Manager ${w.managerName}${w.managerStatus ? ` — ${EMPLOYMENT_STATUS_LABELS[w.managerStatus as 'separated'] ?? w.managerStatus}` : ''}` : 'No manager'}
                />
              </ListItem>
            ))}
          </List>
        </Alert>
      )}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card>
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 2 }}>
                <Autocomplete
                  sx={{ flexGrow: 1 }}
                  size="small"
                  options={data.nodes}
                  getOptionLabel={(n) => `${n.name} (${n.employeeNo}) — ${n.position}`}
                  onChange={(_e, n) => {
                    if (!n) return;
                    setSelected(n.employeeId);
                    ref.current?.reveal(n.employeeId);
                  }}
                  renderInput={(p) => <TextField {...p} label="Search" />}
                />
                <ButtonGroup size="small" variant="outlined">
                  <Button onClick={() => ref.current?.expandAll()}>Expand all</Button>
                  <Button onClick={() => ref.current?.collapseAll()}>Collapse all</Button>
                </ButtonGroup>
              </Stack>
              <Box sx={{ maxHeight: '65vh', overflowY: 'auto' }}>
                <OrgTree ref={ref} people={people} variant="list" selectedId={selected} onSelect={setSelected} label="Reporting lines" initialDepth={2} />
              </Box>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 5 }}>
          <Card sx={{ position: { md: 'sticky' }, top: { md: 88 } }}>
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              {!node ? (
                <Typography color="text.secondary">Select a person in the tree.</Typography>
              ) : (
                <Stack spacing={2}>
                  <Typography variant="h5" component="h2">
                    <Link component={NextLink} href={`/employees/${encodeURIComponent(node.employeeNo)}`}>
                      {node.name}
                    </Link>
                  </Typography>
                  <KeyValue label="Position" value={`${node.position} · ${node.department}`} />
                  <KeyValue label="Status" value={EMPLOYMENT_STATUS_LABELS[node.status]} />
                  <KeyValue label="Reports to" value={node.isTopOfOrg ? 'Top of organisation' : node.managerId ? `${byId.get(node.managerId)?.name ?? '—'}${node.managerSince ? ` since ${formatDate(node.managerSince)}` : ''}` : 'No manager'} />
                  <KeyValue label="Reportees" value={`${node.directCount} direct · ${node.indirectCount} indirect`} />
                  <KeyValue
                    label="Delegation"
                    value={node.delegation ? `${node.delegation.delegateName} (${node.delegation.scope}) ${formatDate(node.delegation.validFrom)} – ${formatDate(node.delegation.validTo)}` : 'None'}
                  />
                  {node.directCount > 0 && (
                    <>
                      <MiniTable
                        caption="Direct reportees"
                        rows={directOf(node.employeeId)}
                        getRowId={(x) => x.employeeId}
                        columns={[
                          { key: 'n', header: 'Direct reportee', render: (x) => `${x.name} (${x.employeeNo})` },
                          { key: 's', header: 'Since', render: (x) => formatDate(x.managerSince) || '—' },
                        ]}
                      />
                      <Button variant="contained" onClick={() => setDialog({ from: node, preselect: directOf(node.employeeId).map((x) => x.employeeId) })}>
                        Reassign reportees
                      </Button>
                    </>
                  )}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
      <ReassignDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        from={dialog?.from ?? null}
        candidates={dialog?.from ? directOf(dialog.from.employeeId) : data.nodes.filter((n) => dialog?.preselect.includes(n.employeeId))}
        preselect={dialog?.preselect ?? []}
      />
    </Stack>
  );
}

function ReassignDialog({ open, onClose, from, candidates, preselect }: { open: boolean; onClose: () => void; from: ReportingLineNode | null; candidates: ReportingLineNode[]; preselect: string[] }) {
  const r = useActionRunner();
  const [ids, setIds] = React.useState<string[]>([]);
  const [manager, setManager] = React.useState<PickedEmployee | null>(null);
  const [date, setDate] = React.useState(todayMyt());
  const [remarks, setRemarks] = React.useState('');
  const [result, setResult] = React.useState<ReassignReporteesResult | null>(null);
  React.useEffect(() => {
    if (!open) return;
    r.reset();
    setIds(preselect);
    setManager(null);
    setDate(todayMyt());
    setRemarks('');
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <FormDialog
      open={open}
      title={result ? 'Reassign reportees — result' : from ? `Reassign reportees of ${from.name}` : 'Assign a manager'}
      onClose={onClose}
      submitLabel="Reassign"
      readOnly={Boolean(result)}
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
      dirty={!result}
      onSubmit={async () => {
        const fe: Record<string, string> = {};
        if (!ids.length) fe.employeeIds = 'Select the reportees to move.';
        if (!manager) fe.newManagerId = 'Select the new manager.';
        if (!date) fe.effectiveDate = 'Enter the effective date.';
        if (Object.keys(fe).length) {
          r.setFieldErrors(fe);
          return;
        }
        const res = await r.run(() => reassignReportees({ fromManagerId: from?.employeeId ?? null, employeeIds: ids, newManagerId: manager!.id, effectiveDate: date, remarks }), {
          success: (x) => `${(x as unknown as ReassignReporteesResult).moved} reportee(s) moved to ${manager!.name}.`,
        });
        if (res?.ok) setResult(res as unknown as ReassignReporteesResult);
      }}
    >
      {result ? (
        <MiniTable
          caption="Result"
          rows={result.rows}
          getRowId={(x) => x.employeeId}
          columns={[
            { key: 'n', header: 'Employee no.', render: (x) => x.employeeNo },
            { key: 'r', header: 'Result', render: (x) => (x.ok ? '✓ Moved' : '✕ Skipped') },
            { key: 'm', header: 'Note', render: (x) => x.message ?? '' },
          ]}
        />
      ) : (
        <Stack spacing={2}>
          <Box>
            <Typography variant="caption" color={r.fieldErrors.employeeIds ? 'error' : 'text.secondary'} component="p">
              Reportees *{r.fieldErrors.employeeIds ? ` — ${r.fieldErrors.employeeIds}` : ''}
            </Typography>
            {candidates.map((c) => (
              <FormControlLabel
                key={c.employeeId}
                sx={{ display: 'flex' }}
                control={<Checkbox checked={ids.includes(c.employeeId)} onChange={(e) => setIds((l) => (e.target.checked ? [...l, c.employeeId] : l.filter((x) => x !== c.employeeId)))} />}
                label={`${c.name} (${c.employeeNo}) · ${c.position}`}
              />
            ))}
          </Box>
          <EmployeePicker label="New manager" required value={manager} onChange={setManager} excludeEmployeeId={from?.employeeId ?? null} error={r.fieldErrors.newManagerId} helper="Checked for reporting-line loops." />
          <DateInput label="Effective date" required value={date} onChange={setDate} error={r.fieldErrors.effectiveDate} helper="Creates “Manager change” job-history rows; pending approvals re-route." />
          <TextInput label="Remarks" value={remarks} onChange={setRemarks} maxLength={500} multiline minRows={2} />
        </Stack>
      )}
    </FormDialog>
  );
}
