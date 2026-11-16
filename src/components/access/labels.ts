// UI helpers for users & access (values/labels from src/server/contracts/users.ts).
import { USER_STATUS_LABELS, type UserStatus } from '@/server/contracts/users';

export const userStatusLabel = (s: UserStatus) => USER_STATUS_LABELS[s] as 'Invited' | 'Active' | 'Locked' | 'Disabled' | 'Expired';
