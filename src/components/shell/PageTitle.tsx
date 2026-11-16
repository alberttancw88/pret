'use client';

// Lets a page override the shell's single <h1> title and breadcrumb (default comes from
// the nav config). Render <PageTitle title="PB-2027-011" breadcrumbs={[...]} /> anywhere
// in the page.
import * as React from 'react';
import { usePathname } from 'next/navigation';

export type Crumb = { label: string; href?: string };
type Override = { pathname: string; title: string; breadcrumbs?: Crumb[] };

type Ctx = { override: Override | null; setOverride: (o: Override | null) => void };
const PageTitleContext = React.createContext<Ctx | null>(null);

export function PageTitleProvider({ children }: { children: React.ReactNode }) {
  const [override, setOverride] = React.useState<Override | null>(null);
  const value = React.useMemo(() => ({ override, setOverride }), [override]);
  return <PageTitleContext.Provider value={value}>{children}</PageTitleContext.Provider>;
}

/** Shell-side reader; ignores overrides left over from a previous route. */
export function usePageTitleOverride(): Override | null {
  const ctx = React.useContext(PageTitleContext);
  const pathname = usePathname() ?? '';
  return ctx?.override && ctx.override.pathname === pathname ? ctx.override : null;
}

export default function PageTitle({ title, breadcrumbs }: { title: string; breadcrumbs?: Crumb[] }) {
  const ctx = React.useContext(PageTitleContext);
  const pathname = usePathname() ?? '';
  const key = JSON.stringify(breadcrumbs ?? null);
  React.useEffect(() => {
    ctx?.setOverride({ pathname, title, breadcrumbs: key === 'null' ? undefined : (JSON.parse(key) as Crumb[]) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, title, key]);
  return null;
}
