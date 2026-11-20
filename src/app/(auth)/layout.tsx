import type { ReactNode } from 'react';
import AuthSplitLayout from '@/components/auth/AuthSplitLayout';
import pkg from '../../../package.json';

// Signed-out screens: split panel, no app shell, no bottom bar.
// The version is read here on the server and passed down as a string, so package.json is not
// bundled into the client.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthSplitLayout version={pkg.version}>{children}</AuthSplitLayout>;
}
