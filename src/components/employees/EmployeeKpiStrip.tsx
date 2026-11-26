'use client';

// E1 Employees-list KPI strip (deferred from W2-009, built in W2-007): Headcount · On probation · Notice period ·
// On leave today. Pastel strip (theme-tokens.md §8.5, max 4, one hue per tile); each tile applies its list filter.
// Headcount uses the same definition as the admin dashboard (On probation + Confirmed + Notice period).
import Box from '@mui/material/Box';
import type { EmployeeKpis } from '@/server/contracts/reports';
import KpiTile, { GRID_SX, PASTEL_ORDER } from '../dashboard/KpiTile';

export default function EmployeeKpiStrip({ kpis }: { kpis: EmployeeKpis }) {
  const tiles = [
    { label: 'Active headcount', value: kpis.headcount, href: kpis.links.headcount },
    { label: 'On probation', value: kpis.onProbation, href: kpis.links.onProbation },
    { label: 'Notice period', value: kpis.noticePeriod, href: kpis.links.noticePeriod },
    { label: 'On leave today', value: kpis.onLeaveToday, href: kpis.links.onLeaveToday },
  ];
  return (
    <Box sx={{ ...GRID_SX, mb: 2 }} component="section" aria-label="Employee figures">
      {tiles.map((t, i) => (
        <KpiTile key={t.label} variant="pastel" hue={PASTEL_ORDER[i]} label={t.label} value={t.value} href={t.href} minHeight={112} />
      ))}
    </Box>
  );
}
