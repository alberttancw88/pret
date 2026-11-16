// UI labels for the organisation enums — values and labels come from the contract
// (src/server/contracts/org.ts); this file only adds UI conveniences. Client- and server-safe.
import {
  COMPULSORY_HOLIDAY_LABELS,
  DAY_TYPE_LABELS,
  DAY_TYPE_SHORT,
  DAY_TYPES,
  HOLIDAY_TYPE_LABELS,
  MONTH_DAY_BASIS_LABELS,
  MY_STATE_LABELS,
  MY_STATES,
  type DayType,
  type MonthDayBasis,
  type MyState,
  type Weekday,
} from '@/server/contracts/org';

export { COMPULSORY_HOLIDAY_LABELS, DAY_TYPE_LABELS, DAY_TYPE_SHORT, DAY_TYPES, HOLIDAY_TYPE_LABELS, MONTH_DAY_BASIS_LABELS, MY_STATE_LABELS };
export type { DayType, MonthDayBasis, MyState, Weekday };

export const STATE_OPTIONS = MY_STATES.map((v) => ({ value: v, label: MY_STATE_LABELS[v] }));
export const stateLabel = (s: string | null | undefined) => (s ? (MY_STATE_LABELS as Record<string, string>)[s] ?? s : '');

export const WEEKDAY_INFO: { key: Weekday; label: string; short: string }[] = [
  { key: 'mon', label: 'Monday', short: 'Mon' },
  { key: 'tue', label: 'Tuesday', short: 'Tue' },
  { key: 'wed', label: 'Wednesday', short: 'Wed' },
  { key: 'thu', label: 'Thursday', short: 'Thu' },
  { key: 'fri', label: 'Friday', short: 'Fri' },
  { key: 'sat', label: 'Saturday', short: 'Sat' },
  { key: 'sun', label: 'Sunday', short: 'Sun' },
];

export const optionsOf = <K extends string>(labels: Record<K, string>) =>
  (Object.keys(labels) as K[]).map((value) => ({ value, label: labels[value] }));

export const yesNo = (b: boolean | null | undefined) => (b ? 'Yes' : 'No');
