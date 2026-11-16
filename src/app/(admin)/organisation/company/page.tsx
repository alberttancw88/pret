import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getCompanyLogoUrl, getCompanyProfile, getOrgOptions } from '@/server/queries/org';
import CompanyProfile from '@/components/org/CompanyProfile';

export const metadata: Metadata = { title: 'Company profile' };
export const dynamic = 'force-dynamic';

// O1 · S-OR-01 · /organisation/company — Admin (view + contact/GL edit) and Super Admin (F-ORG-01).
export default async function CompanyProfilePage() {
  const user = await requireUser(['ADM', 'SA']);
  const [view, logoUrl, options] = await Promise.all([getCompanyProfile(), getCompanyLogoUrl(), getOrgOptions()]);
  return <CompanyProfile view={view} logoUrl={logoUrl} zakatBodies={options.zakatBodies} isSuperAdmin={user.roles.includes('SA')} />;
}
