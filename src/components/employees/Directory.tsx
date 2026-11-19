'use client';

// G10 · Staff directory — S-GL-12 · /directory · F-EMP-23 · US-EMP-020.
//   Search name, preferred name, position, department · Filters Department, Work location ·
//   Columns (exactly FR-EMP-14): Photo · Name (preferred) · Position · Department · Work location ·
//   Work email (mailto) · Work phone (tel). Active employees only. EXPORT .CSV (same 7 columns).
//   Phone: cards with photo. ADM/SA: name links to the profile (S-EM-03).
// G11 · Org chart — S-GL-13 · /org-chart · F-EMP-22 (Could) · US-EMP-025.
//   Top-down tree from Top of organisation; node = photo · name · position. Controls: Find person
//   (centres + highlights), Department filter, expand/collapse, zoom +/−, FIT. Phone: indented
//   collapsible list. Click node → directory entry (ADM/SA: profile).
import * as React from 'react';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import Autocomplete from '@mui/material/Autocomplete';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonGroup from '@mui/material/ButtonGroup';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { type DirectoryFilterOptions, type DirectoryParams, type DirectoryRow, type OrgChart } from '@/server/contracts/employees';
import { exportDirectoryCsv } from '@/server/actions/employees';
import ListPage, { type ListColumn } from '../list/ListPage';
import { KeywordField, MultiSelectFilter, SelectFilter } from '../list/FilterFields';
import { downloadServerCsv, useServerList } from '../list/useServerList';
import { useToast } from '../ToastProvider';
import EmptyState from '../EmptyState';
import OrgTree, { type OrgTreeHandle, type TreePerson } from './OrgTree';
import { DIRECTORY_FILTERS } from './filters';

export function StaffDirectory({ rows, total, params, options }: { rows: DirectoryRow[]; total: number; params: DirectoryParams; options: DirectoryFilterOptions }) {
  const list = useServerList({ filters: DIRECTORY_FILTERS, sort: { key: 'name', direction: 'asc' } });
  const toast = useToast();
  const d = list.draft;
  const set = list.setDraftField;
  const columns: ListColumn<DirectoryRow>[] = [
    {
      key: 'photo',
      header: 'Photo',
      sortable: false,
      render: (x) => (
        <Avatar src={x.photoUrl ?? undefined} alt="" sx={{ width: 36, height: 36 }}>
          {x.name.charAt(0)}
        </Avatar>
      ),
    },
    {
      key: 'name',
      header: 'Name',
      value: (x) => `${x.name}${x.preferredName ? ` (${x.preferredName})` : ''}`,
      render: (x) => {
        const t = `${x.name}${x.preferredName ? ` (${x.preferredName})` : ''}`;
        return x.profileHref ? (
          <Link component={NextLink} href={x.profileHref}>
            {t}
          </Link>
        ) : (
          t
        );
      },
      minWidth: 180,
    },
    { key: 'position', header: 'Position', value: (x) => x.position },
    { key: 'department', header: 'Department', value: (x) => x.department },
    { key: 'location', header: 'Work location', value: (x) => x.location },
    { key: 'email', header: 'Work email', sortable: false, value: (x) => x.workEmail, render: (x) => <Link href={`mailto:${x.workEmail}`}>{x.workEmail}</Link> },
    { key: 'phone', header: 'Work phone', sortable: false, value: (x) => x.workPhone, render: (x) => (x.workPhone ? <Link href={`tel:${x.workPhone.replace(/\s/g, '')}`}>{x.workPhone}</Link> : '—') },
  ];
  return (
    <ListPage<DirectoryRow>
      itemName={{ singular: 'colleague', plural: 'colleagues' }}
      filters={[
        <KeywordField key="q" value={d.q} onChange={(v) => set('q', v)} hint="Searches name, preferred name, position and department." />,
        <MultiSelectFilter key="d" label="Department" value={d.departmentIds} onChange={(v) => set('departmentIds', v)} options={options.departments.map((x) => ({ value: x.id, label: x.label }))} />,
        <MultiSelectFilter key="l" label="Work location" value={d.locationIds} onChange={(v) => set('locationIds', v)} options={options.locations.map((x) => ({ value: x.id, label: x.label }))} />,
      ]}
      {...list.listProps}
      onExport={async () => {
        try {
          const res = await exportDirectoryCsv(params);
          if (res.ok) downloadServerCsv(res.filename || 'staff-directory', res.content);
          else toast.info(res.error);
        } catch {
          toast.info('Export failed. Please try again.');
        }
      }}
      columns={columns}
      rows={rows}
      total={total}
      getRowId={(x) => x.employeeId}
      getRowRef={(x) => x.name}
      empty={{ title: 'No colleagues match.' }}
    />
  );
}

export function OrgChartView({ chart, departments }: { chart: OrgChart; departments: { id: string; label: string }[] }) {
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down('md'));
  const router = useRouter();
  const ref = React.useRef<OrgTreeHandle>(null);
  const [zoom, setZoom] = React.useState(1);
  const [dept, setDept] = React.useState('');
  const [found, setFound] = React.useState<string | null>(null);

  const nodes = React.useMemo(() => {
    if (!dept) return chart.nodes;
    // keep the department's people plus their chain of managers so the tree stays connected
    const byId = new Map(chart.nodes.map((n) => [n.employeeId, n]));
    const keep = new Set<string>();
    for (const n of chart.nodes) {
      if (n.departmentId !== dept) continue;
      let cur: typeof n | undefined = n;
      const guard = new Set<string>();
      while (cur && !guard.has(cur.employeeId)) {
        guard.add(cur.employeeId);
        keep.add(cur.employeeId);
        cur = cur.managerId ? byId.get(cur.managerId) : undefined;
      }
    }
    return chart.nodes.filter((n) => keep.has(n.employeeId));
  }, [chart.nodes, dept]);

  const people: TreePerson[] = nodes.map((n) => ({
    id: n.employeeId,
    managerId: n.managerId,
    name: n.preferredName ? `${n.name} (${n.preferredName})` : n.name,
    subtitle: n.position,
    photoUrl: n.photoUrl,
  }));
  const byId = new Map(chart.nodes.map((n) => [n.employeeId, n]));
  const open = (id: string) => {
    const n = byId.get(id);
    if (!n) return;
    router.push(n.profileHref ?? `/directory?q=${encodeURIComponent(n.name)}`);
  };

  if (chart.nodes.length === 0) {
    return (
      <Card>
        <CardContent>
          <EmptyState title="No reporting lines yet." helper="The org chart appears once employee records exist." />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} sx={{ mb: 2 }}>
          <Autocomplete
            sx={{ minWidth: 260 }}
            size="small"
            options={nodes}
            getOptionLabel={(n) => `${n.name} — ${n.position}`}
            onChange={(_e, n) => {
              setFound(n?.employeeId ?? null);
              if (n) ref.current?.reveal(n.employeeId);
            }}
            renderInput={(p) => <TextField {...p} label="Find person" />}
          />
          <Box sx={{ minWidth: 220 }}>
            <SelectFilter label="Department" value={dept} onChange={setDept} options={departments.map((x) => ({ value: x.id, label: x.label }))} />
          </Box>
          <Box sx={{ flexGrow: 1 }} />
          <ButtonGroup variant="outlined" size="small" aria-label="Expand or collapse">
            <Button onClick={() => ref.current?.expandAll()}>Expand all</Button>
            <Button onClick={() => ref.current?.collapseAll()}>Collapse all</Button>
          </ButtonGroup>
          {!phone && (
            <ButtonGroup variant="outlined" size="small" aria-label="Zoom">
              <Button onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(1)))} aria-label="Zoom out">
                −
              </Button>
              <Button disabled sx={{ minWidth: 64 }}>
                {Math.round(zoom * 100)}%
              </Button>
              <Button onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.1).toFixed(1)))} aria-label="Zoom in">
                +
              </Button>
              <Button onClick={() => setZoom(nodes.length > 30 ? 0.6 : nodes.length > 15 ? 0.8 : 1)}>Fit</Button>
            </ButtonGroup>
          )}
        </Stack>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
          Names and positions only. Select a person to open their directory entry.
        </Typography>
        <OrgTree key={dept} ref={ref} people={people} variant={phone ? 'list' : 'chart'} highlightId={found} onSelect={open} zoom={zoom} label="Org chart" />
      </CardContent>
    </Card>
  );
}
