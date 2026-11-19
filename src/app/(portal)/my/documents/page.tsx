import type { Metadata } from 'next';
import { requireUser } from '@/server/auth/current-user';
import { getMyProfile, listMyDocuments } from '@/server/queries/employees';
import { DOCUMENT_CATEGORIES, type MyDocumentListParams } from '@/server/contracts/employees';
import { MyDocumentsList } from '@/components/employees/portal/MyLists';
import { NoEmployeeRecord } from '@/components/employees/portal/MyProfileView';
import { MY_DOCUMENT_FILTERS, MY_DOCUMENT_SORTS, pickList } from '@/components/employees/filters';
import { readListParams, toPageParams, type SearchParamsRecord } from '@/lib/list-params';

export const metadata: Metadata = { title: 'My documents' };
export const dynamic = 'force-dynamic';

// P19 · S-PT-19 · /my/documents — documents HR made visible to me (K5), own only.
export default async function MyDocumentsPage({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  await requireUser(['EMP', 'MGR', 'ADM', 'SA']);
  if (!(await getMyProfile())) return <NoEmployeeRecord />;
  const lp = readListParams(await searchParams, { filters: MY_DOCUMENT_FILTERS, sort: { key: 'uploadedAt', direction: 'desc' } });
  const pp = toPageParams(lp, MY_DOCUMENT_SORTS);
  const params: MyDocumentListParams = { ...pp, dir: pp.sort ? pp.dir : 'desc', categories: pickList(lp.filters.categories, DOCUMENT_CATEGORIES) };
  const list = await listMyDocuments(params);
  return <MyDocumentsList rows={list.rows} total={list.total} params={params} />;
}
