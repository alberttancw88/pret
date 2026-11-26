'use client';

// R2 · Reports catalogue — S-RP-02 · /reports (wireframes-reports.md §R2).
// Card grid grouped People · Leave · Claims · Payroll handover (· Payroll R1.1 note for admins). Each card: name ·
// one-line description · 🔒 badge where access is logged · "My team" for team-scoped (MGR) reports.
// Search box filters the cards by name. MGR sees only Probation due · Leave balances · Who's on leave · Leave report
// by individual; EMP only Leave report by individual (cards come filtered by role from getReportCatalogue).
import * as React from 'react';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardActionArea from '@mui/material/CardActionArea';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import Typography from '@mui/material/Typography';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import LockIcon from '@mui/icons-material/Lock';
import SearchIcon from '@mui/icons-material/Search';
import type { ReportCatalogue as Catalogue, ReportCatalogueCard } from '@/server/contracts/reports';
import EmptyState from '../EmptyState';
import { DashboardSection } from '../dashboard/KpiTile';

const GRID = {
  display: 'grid',
  gap: 2,
  alignItems: 'stretch',
  gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' },
} as const;

function ReportCard({ c }: { c: ReportCatalogueCard }) {
  return (
    <Card sx={{ height: '100%', transition: 'box-shadow 150ms', '&:hover': { boxShadow: 1 } }}>
      <CardActionArea component={NextLink} href={c.path} sx={{ height: '100%', p: { xs: 2, sm: 2.25 }, display: 'flex', alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="flex-start" justifyContent="space-between">
            <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>
              {c.name}
            </Typography>
            <ChevronRightIcon aria-hidden sx={{ color: 'primary.dark', flexShrink: 0 }} />
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {c.description}
          </Typography>
          {(c.sensitive || c.teamScope) && (
            <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
              {c.sensitive && <Chip size="small" color="warning" icon={<LockIcon />} label="Sensitive — access is logged" />}
              {c.teamScope && <Chip size="small" icon={<GroupsOutlinedIcon />} label="My team" />}
            </Stack>
          )}
        </Box>
      </CardActionArea>
    </Card>
  );
}

export default function ReportCatalogue({ catalogue, showPayrollNote }: { catalogue: Catalogue; showPayrollNote: boolean }) {
  const [q, setQ] = React.useState('');
  const needle = q.trim().toLowerCase();
  const groups = catalogue.groups
    .map((g) => ({ ...g, cards: g.cards.filter((c) => !needle || c.name.toLowerCase().includes(needle)) }))
    .filter((g) => g.cards.length > 0);

  return (
    <Stack spacing={3}>
      <Box sx={{ maxWidth: { sm: 420 } }}>
        <TextField
          label="Search reports"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          helperText="Filters the reports by name."
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" aria-hidden /></InputAdornment> } }}
        />
      </Box>
      {groups.length === 0 ? (
        <Card>
          <EmptyState kind={needle ? 'filtered' : 'none'} title={needle ? 'No reports match this search.' : 'No reports are available to you.'} />
        </Card>
      ) : (
        <Box>
          {groups.map((g) => (
            <DashboardSection key={g.group} title={g.label}>
              <Box sx={GRID}>
                {g.cards.map((c) => (
                  <ReportCard key={c.id} c={c} />
                ))}
              </Box>
            </DashboardSection>
          ))}
          {showPayrollNote && !needle && (
            <DashboardSection title="Payroll (R1.1)">
              <Card>
                <Box sx={{ p: 2.25 }}>
                  <Typography variant="body2" color="text.secondary">
                    Payroll reports arrive with Release 1.1. The monthly payroll-input pack above replaces them until the payroll cut-over.
                  </Typography>
                </Box>
              </Card>
            </DashboardSection>
          )}
        </Box>
      )}
    </Stack>
  );
}
