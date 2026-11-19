'use client';

// O10 Employee groups — Members field: multi employee picker with chips + ADD BY FILTER
// (department / work location). The filter dialog previews the matching active employees
// (searchEmployeeOptions with departmentIds / locationIds, up to 500 — Q-F3) and ADD merges them
// into the member list; saving the group replaces the membership (memberIds).
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import FilterListIcon from '@mui/icons-material/FilterList';
import type { EmployeeOption } from '@/server/contracts/employees';
import type { OrgOptions } from '@/server/contracts/org';
import { searchEmployeeOptions } from '@/server/actions/employees';
import ResponsiveDialog from '../dialogs/ResponsiveDialog';
import { MultiSelectInput } from '../forms/fields';
import { EmployeeMultiPicker, type PickedEmployee } from '../employees/EmployeePicker';
import { orgOptions } from './common';

export default function GroupMembersField({
  value,
  onChange,
  error,
  options,
}: {
  value: PickedEmployee[];
  onChange: (v: PickedEmployee[]) => void;
  error?: string;
  options: OrgOptions;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <Box>
      <EmployeeMultiPicker
        label="Members"
        value={value}
        onChange={onChange}
        error={error}
        helper={`${value.length} member${value.length === 1 ? '' : 's'}. Saving replaces the member list.`}
      />
      <Button size="small" variant="outlined" startIcon={<FilterListIcon />} onClick={() => setOpen(true)} sx={{ mt: 1 }}>
        Add by filter
      </Button>
      <AddByFilterDialog
        open={open}
        onClose={() => setOpen(false)}
        options={options}
        existing={value}
        onAdd={(rows) => {
          const have = new Set(value.map((m) => m.id));
          onChange([...value, ...rows.filter((r) => !have.has(r.id))]);
          setOpen(false);
        }}
      />
    </Box>
  );
}

function AddByFilterDialog({
  open,
  onClose,
  options,
  existing,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  options: OrgOptions;
  existing: PickedEmployee[];
  onAdd: (rows: PickedEmployee[]) => void;
}) {
  const [departmentIds, setDepartmentIds] = React.useState<string[]>([]);
  const [locationIds, setLocationIds] = React.useState<string[]>([]);
  const [rows, setRows] = React.useState<EmployeeOption[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setDepartmentIds([]);
      setLocationIds([]);
      setRows(null);
      setError(null);
    }
  }, [open]);

  const find = async () => {
    if (!departmentIds.length && !locationIds.length) {
      setError('Choose at least one department or work location.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await searchEmployeeOptions({ departmentIds, locationIds, activeOnly: true, limit: 500 });
      if (res.ok) setRows(res.rows);
      else setError(res.error);
    } catch {
      setError('Search failed. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const have = new Set(existing.map((m) => m.id));
  const fresh = (rows ?? []).filter((r) => !have.has(r.id));

  return (
    <ResponsiveDialog
      open={open}
      onClose={() => !busy && onClose()}
      title="Add members by filter"
      maxWidth="sm"
      actions={
        <>
          <Button variant="outlined" color="inherit" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {rows === null ? (
            <Button variant="contained" onClick={find} loading={busy}>
              Find employees
            </Button>
          ) : (
            <Button variant="contained" disabled={fresh.length === 0} onClick={() => onAdd(fresh.map((r) => ({ id: r.id, employeeNo: r.employeeNo, name: r.name, position: r.position })))}>
              Add {fresh.length}
            </Button>
          )}
        </>
      }
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        {error && <Alert severity="error">{error}</Alert>}
        <MultiSelectInput
          label="Department"
          value={departmentIds}
          onChange={(v) => {
            setDepartmentIds(v);
            setRows(null);
          }}
          options={orgOptions(options.departments)}
        />
        <MultiSelectInput
          label="Work location"
          value={locationIds}
          onChange={(v) => {
            setLocationIds(v);
            setRows(null);
          }}
          options={orgOptions(options.locations)}
        />
        <Typography variant="caption" color="text.secondary">
          Active employees (Pending Join, On Probation, Confirmed, Notice Period) in the selected departments and work locations.
        </Typography>
        {rows !== null && (
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              {rows.length} found · {fresh.length} not yet members
            </Typography>
            <List dense sx={{ maxHeight: 240, overflowY: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              {rows.map((r) => (
                <ListItem key={r.id}>
                  <ListItemText primary={`${r.name} (${r.employeeNo})`} secondary={[r.position, r.department, have.has(r.id) ? 'already a member' : null].filter(Boolean).join(' · ')} />
                </ListItem>
              ))}
            </List>
          </Box>
        )}
      </Stack>
    </ResponsiveDialog>
  );
}
