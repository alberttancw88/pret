// Roles column (A5) and header chips (A7): Employee (automatic for employee users),
// Manager derived "Manager (n reportees)", Admin / Admin · External, Super Admin.
import * as React from 'react';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import StatusChip from '../StatusChip';
import type { PrivilegedRole, UserType } from '@/server/contracts/users';

export function roleText(u: { userType: UserType; roles: PrivilegedRole[]; directReportees: number }): string {
  const r: string[] = [];
  if (u.userType === 'employee') r.push('Employee');
  if (u.userType === 'employee' && u.directReportees > 0) r.push(`Manager (${u.directReportees} reportees)`);
  if (u.roles.includes('ADM')) r.push(u.userType === 'external' ? 'Admin · External' : 'Admin');
  if (u.roles.includes('SA')) r.push('Super Admin');
  return r.join(', ');
}

export default function UserRoleChips({ userType, roles, directReportees }: { userType: UserType; roles: PrivilegedRole[]; directReportees: number }) {
  const chips: React.ReactNode[] = [];
  if (userType === 'employee') chips.push(<StatusChip key="emp" set="role" value="Employee" />);
  if (userType === 'employee' && directReportees > 0)
    chips.push(<StatusChip key="mgr" set="role" value="Manager" label={`Manager (${directReportees} reportees)`} />);
  if (roles.includes('ADM')) chips.push(<StatusChip key="adm" set="role" value={userType === 'external' ? 'Admin · External' : 'Admin'} />);
  if (roles.includes('SA')) chips.push(<StatusChip key="sa" set="role" value="Super Admin" />);
  if (!chips.length)
    return (
      <Typography variant="body2" color="text.secondary">
        —
      </Typography>
    );
  return (
    <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
      {chips}
    </Stack>
  );
}
