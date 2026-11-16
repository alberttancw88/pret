import type { ReactNode } from 'react';
import AuthSplitLayout from '@/components/auth/AuthSplitLayout';

// Signed-out screens: split panel, no app shell, no bottom bar.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthSplitLayout>{children}</AuthSplitLayout>;
}
