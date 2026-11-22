import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/server/auth/current-user';
import { getCategory, getClaimSetupOptions } from '@/server/queries/claims';
import { CategoryForm } from '@/components/claims/Setup';
import PageTitle from '@/components/shell/PageTitle';

export const metadata: Metadata = { title: 'Claim category' };
export const dynamic = 'force-dynamic';

// C6 · S-CL-06 · /claims/setup/categories/{code} (and /new) — ADM / SA.
export default async function ClaimCategoryPage({ params }: { params: Promise<{ code: string }> }) {
  await requireUser(['ADM', 'SA']);
  const code = decodeURIComponent((await params).code);
  const isNew = code.toLowerCase() === 'new';
  const [detail, options] = await Promise.all([isNew ? Promise.resolve(null) : getCategory(code), getClaimSetupOptions()]);
  if (!isNew && !detail) notFound();
  const title = detail ? `${detail.values.code} · ${detail.values.name}` : 'New claim category';
  return (
    <>
      <PageTitle title={title} breadcrumbs={[{ label: 'Claim categories', href: '/claims/setup/categories' }, { label: detail?.values.code ?? 'New' }]} />
      <CategoryForm key={detail?.id ?? 'new'} detail={detail} options={options} />
    </>
  );
}
