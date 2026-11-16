'use client';

// A7 Roles card — S-AC-03 · F-ADM-03 · US-ADMIN-004. SA only: toggles Admin / Super Admin
// with SAVE ROLES. Employee is automatic for employee users and Manager is derived from the
// reporting line (shown, not editable). Guards (also enforced in the database):
//  - own account: "You can't change your own roles" (BR-ADM-03)
//  - External users: Admin only (BR-ADM-04)
//  - removing the last active Super Admin is blocked (EC-ADM-01) — server message shown
// Assigning Super Admin asks: "Assigning Super Admin gives full access including audit logs".
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import FormHelperText from '@mui/material/FormHelperText';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import StatusChip from '../StatusChip';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import ErrorSummary from '../forms/ErrorSummary';

export type PrivilegedRole = 'ADM' | 'SA';

export type RoleAssignmentPanelProps = {
  current: PrivilegedRole[];
  isExternal: boolean;
  isOwnAccount: boolean;
  /** Viewer is a Super Admin (only SA assigns roles). */
  canAssign: boolean;
  /** Derived roles to show read-only. */
  isEmployeeUser: boolean;
  managerReportees?: number | null;
  saving?: boolean;
  error?: string | null;
  onSave: (roles: PrivilegedRole[]) => void | Promise<void>;
};

export default function RoleAssignmentPanel({
  current,
  isExternal,
  isOwnAccount,
  canAssign,
  isEmployeeUser,
  managerReportees,
  saving,
  error,
  onSave,
}: RoleAssignmentPanelProps) {
  const [roles, setRoles] = React.useState<PrivilegedRole[]>(current);
  const [confirmSa, setConfirmSa] = React.useState(false);
  React.useEffect(() => setRoles(current), [current]);

  const has = (r: PrivilegedRole) => roles.includes(r);
  const toggle = (r: PrivilegedRole, on: boolean) => setRoles((prev) => (on ? Array.from(new Set([...prev, r])) : prev.filter((x) => x !== r)));
  const dirty = [...roles].sort().join() !== [...current].sort().join();
  const addingSa = has('SA') && !current.includes('SA');
  const editable = canAssign && !isOwnAccount;
  const lockReason = !canAssign
    ? 'Only a Super Admin can assign roles.'
    : isOwnAccount
      ? "You can't change your own roles."
      : null;

  const save = () => (addingSa ? setConfirmSa(true) : void onSave(roles));

  const switchRow = (r: PrivilegedRole, label: string, disabledReason?: string) => {
    const disabled = !editable || Boolean(disabledReason) || saving;
    const control = (
      <FormControlLabel
        control={<Switch checked={has(r)} onChange={(e) => toggle(r, e.target.checked)} disabled={disabled} />}
        label={label}
      />
    );
    return disabledReason && editable ? (
      <Tooltip title={disabledReason}>
        <span>{control}</span>
      </Tooltip>
    ) : (
      control
    );
  };

  return (
    <Box>
      <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mb: 2 }} aria-label="Current roles">
        {isEmployeeUser && <StatusChip set="role" value="Employee" />}
        {isEmployeeUser && managerReportees ? <StatusChip set="role" value="Manager" label={`Manager (${managerReportees} reportees)`} /> : null}
        {current.includes('ADM') && <StatusChip set="role" value={isExternal ? 'Admin · External' : 'Admin'} />}
        {current.includes('SA') && <StatusChip set="role" value="Super Admin" />}
        {!isEmployeeUser && current.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No roles
          </Typography>
        )}
      </Stack>

      {lockReason && (
        <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
          {lockReason}
        </Alert>
      )}
      {error && <ErrorSummary error={error} title="Roles not saved" />}

      <FormGroup>
        {switchRow('ADM', 'Admin')}
        {switchRow('SA', 'Super Admin', isExternal ? 'External administrators can hold Admin only.' : undefined)}
      </FormGroup>
      <FormHelperText sx={{ mb: 1 }}>
        Employee is automatic for employee users; Manager comes from the reporting line. External administrators hold Admin
        only.
      </FormHelperText>

      {editable && (
        <Stack direction="row" justifyContent="flex-end">
          <Button variant="contained" onClick={save} disabled={!dirty} loading={saving}>
            {saving ? 'Saving…' : 'Save roles'}
          </Button>
        </Stack>
      )}

      <ConfirmDialog
        open={confirmSa}
        title="Assign Super Admin?"
        body="Assigning Super Admin gives full access including audit logs. The user and all Super Admins are notified."
        confirmLabel="Assign Super Admin"
        tone="warning"
        onClose={() => setConfirmSa(false)}
        onConfirm={async () => {
          setConfirmSa(false);
          await onSave(roles);
        }}
      />
    </Box>
  );
}
