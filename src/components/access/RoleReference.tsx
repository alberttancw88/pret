'use client';

// A8 · Role permission reference — S-AC-04 · F-ADM-08 · US-ADMIN-008.
// Read-only PRD §16 matrix: rows = function groups, columns EMP · MGR · ADM · SA; legend;
// search box filters rows; PRINT and EXPORT .CSV. Role descriptions (PRD §3) on top.
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined';
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined';
import type { ROLE_DESCRIPTIONS, RolePermissionRow } from '@/server/contracts/users';
import { exportRolePermissionMatrixCsv } from '@/server/actions/users';
import { KeywordField } from '../list/FilterFields';
import { downloadServerCsv } from '../list/useServerList';
import EmptyState from '../EmptyState';
import { useToast } from '../ToastProvider';

const ROLES = ['EMP', 'MGR', 'ADM', 'SA'] as const;
const ROLE_NAME = { EMP: 'Employee', MGR: 'Manager', ADM: 'Admin', SA: 'Super Admin' } as const;

/** Legend entries parsed from the contract's one-line legend ("C create · R read · …"). */
const LEGEND: { code: string; meaning: string }[] = [
  { code: 'C', meaning: 'Create' },
  { code: 'R', meaning: 'Read' },
  { code: 'U', meaning: 'Update' },
  { code: 'A', meaning: 'Approve / decide' },
  { code: 'X', meaning: 'Export / download' },
  { code: '✗', meaning: 'No access' },
  { code: 'o', meaning: 'Scope: own' },
  { code: 't', meaning: 'Scope: team (reportees)' },
  { code: 'a', meaning: 'Scope: all' },
];

export default function RoleReference({
  roles,
  matrix,
  legend,
}: {
  roles: typeof ROLE_DESCRIPTIONS;
  matrix: RolePermissionRow[];
  legend: string;
}) {
  const toast = useToast();
  const [q, setQ] = React.useState('');
  const [exporting, setExporting] = React.useState(false);
  const term = q.trim().toLowerCase();
  const rows = term ? matrix.filter((r) => [r.group, r.EMP, r.MGR, r.ADM, r.SA].some((v) => v.toLowerCase().includes(term))) : matrix;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const res = await exportRolePermissionMatrixCsv();
      if (res.ok) downloadServerCsv(res.filename || 'role-reference', res.content);
      else toast.info(res.error);
    } catch {
      toast.info('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Alert severity="info" variant="outlined">
        Roles are fixed in Phase 1. Employee is automatic for employee users; Manager is derived from the reporting line; only a
        Super Admin assigns Admin or Super Admin.
      </Alert>

      <Grid container spacing={2}>
        {roles.map((r) => (
          <Grid key={r.role} size={{ xs: 12, sm: 6, lg: 3 }}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" component="h2">
                  {r.name} ({r.role})
                </Typography>
                <Typography variant="body2" sx={{ mt: 1 }}>
                  {r.description}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Card sx={{ p: 2, '@media print': { display: 'none' } }}>
        <Box sx={{ maxWidth: { sm: 400 } }}>
          <KeywordField value={q} onChange={setQ} hint="Searches function groups and permissions" />
        </Box>
      </Card>
      <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ '@media print': { display: 'none' } }}>
        <Button variant="contained" color="success" startIcon={<FileDownloadOutlinedIcon />} onClick={exportCsv} loading={exporting} loadingPosition="start">
          {exporting ? 'Preparing…' : 'Export .CSV'}
        </Button>
        <Button variant="outlined" color="inherit" startIcon={<PrintOutlinedIcon />} onClick={() => window.print()}>
          Print
        </Button>
      </Stack>

      <Card>
        {rows.length === 0 ? (
          <EmptyState kind="filtered" title="No function groups match this search." actions={<Button variant="outlined" color="inherit" onClick={() => setQ('')}>Clear</Button>} />
        ) : (
          <TableContainer>
            <Table aria-label="Role permission matrix" sx={{ minWidth: 720 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ minWidth: 240 }}>Function group</TableCell>
                  {ROLES.map((r) => (
                    <TableCell key={r} sx={{ minWidth: 140 }}>
                      {ROLE_NAME[r]} ({r})
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.group} hover>
                    <TableCell component="th" scope="row" sx={{ fontWeight: 600 }}>
                      {r.group}
                    </TableCell>
                    {ROLES.map((role) => (
                      <TableCell key={role} sx={{ color: r[role] === '✗' ? 'text.secondary' : 'text.primary' }}>
                        {r[role]}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" component="h2" sx={{ mb: 1 }}>
            Legend
          </Typography>
          <Box component="dl" sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 0.5, m: 0 }}>
            {LEGEND.map((l) => (
              <React.Fragment key={l.code}>
                <Typography component="dt" variant="body2" fontWeight={700}>
                  {l.code}
                </Typography>
                <Typography component="dd" variant="body2" sx={{ m: 0 }}>
                  {l.meaning}
                </Typography>
              </React.Fragment>
            ))}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {legend}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            A user&apos;s rights are the union of their roles. Nobody approves, adjusts or edits their own leave, claims or sensitive
            fields (FR-G-16). Every cell is enforced on the server, not only in the menu.
          </Typography>
        </CardContent>
      </Card>
    </Stack>
  );
}
