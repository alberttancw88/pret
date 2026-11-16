'use client';

// Shared shell for the organisation master lists (O2–O6, O9, O10): canonical ListPage
// (search, filters, sortable columns, pagination 25, EXPORT .CSV, ADD NEW …, CLEAR, SEARCH)
// + add/edit FormDialog (with record footer) + Deactivate/Reactivate confirm.
//
// Data is server-rendered: the page reads the URL (useServerList) and the query returns
// rows. Opening a record adds `?edit=<id>` to the URL so the page also loads its detail
// (description/address/stamps live on the detail type); the dialog fills from that detail.
import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Box from '@mui/material/Box';
import LinearProgress from '@mui/material/LinearProgress';
import Link from '@mui/material/Link';
import ListPage, { type ListColumn, type RowAction, type SortState } from '../list/ListPage';
import { useServerList, downloadServerCsv } from '../list/useServerList';
import FormDialog from '../forms/FormDialog';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import ErrorSummary from '../forms/ErrorSummary';
import { useActionRunner, type AnyActionResult } from '../forms/useActionRunner';
import type { RecordMeta } from '../forms/RecordFooter';
import { useToast } from '../ToastProvider';

export type FormApi<V> = {
  value: V;
  set: <K extends keyof V>(key: K, v: V[K]) => void;
  setAll: (v: V) => void;
  errors: Record<string, string>;
  editing: boolean;
};

/** Export actions return ActionResult<CsvFile>. */
export type CsvExportResult = { ok: true; content: string; filename: string } | { ok: false; error: string };

export type MasterListProps<R, D, V, F extends Record<string, string>> = {
  itemName: { singular: string; plural: string };
  /** CSV file stem used when the server gives no filename, e.g. "departments". */
  csvName: string;
  rows: R[];
  total: number;
  getRowId: (r: R) => string;
  /** Detail of the record named by `?edit=` (loaded by the page), or null. */
  detail: D | null;
  getDetailId: (d: D) => string;
  defaults: { filters: F; sort?: SortState };
  renderFilters: (draft: F, set: (k: keyof F, v: string) => void) => React.ReactNode[];
  columns: ListColumn<R>[];
  canEdit: boolean;
  addLabel: string;
  formTitle: (d: D | null) => string;
  emptyForm: () => V;
  toForm: (d: D) => V;
  renderForm: (api: FormApi<V>, d: D | null) => React.ReactNode;
  fieldLabels?: Record<string, string>;
  /** Client-side checks before calling the server (the server re-validates). */
  validate?: (v: V) => Record<string, string>;
  onSave: (v: V, d: D | null) => Promise<AnyActionResult>;
  savedMessage?: (v: V, d: D | null) => string;
  /** Called with the successful save result (e.g. recount warnings). */
  afterSave?: (result: AnyActionResult & Record<string, unknown>, v: V, d: D | null) => void;
  isActive?: (r: R) => boolean;
  onSetActive?: (r: R, active: boolean) => Promise<AnyActionResult>;
  deactivateBody?: (r: R) => React.ReactNode;
  rowLabel: (r: R) => string;
  meta?: (d: D) => RecordMeta | null;
  onExport: () => Promise<CsvExportResult>;
  extraRowActions?: (r: R) => RowAction[];
  extraActions?: React.ReactNode;
  empty?: { title?: string; helper?: string };
  formMaxWidth?: 'xs' | 'sm' | 'md';
  formNotice?: (v: V, d: D | null) => React.ReactNode;
  /** Replace the whole dialog (e.g. working patterns with versions). */
  customDialog?: (args: { open: boolean; detail: D | null; loading: boolean; creating: boolean; onClose: () => void }) => React.ReactNode;
};

export default function MasterList<R, D, V, F extends Record<string, string>>(props: MasterListProps<R, D, V, F>) {
  const {
    itemName,
    csvName,
    rows,
    total,
    getRowId,
    detail,
    getDetailId,
    defaults,
    renderFilters,
    columns,
    canEdit,
    addLabel,
    formTitle,
    emptyForm,
    toForm,
    renderForm,
    fieldLabels,
    validate,
    onSave,
    savedMessage,
    afterSave,
    isActive,
    onSetActive,
    deactivateBody,
    rowLabel,
    meta,
    onExport,
    extraRowActions,
    extraActions,
    empty,
    formMaxWidth,
    formNotice,
    customDialog,
  } = props;
  const list = useServerList(defaults);
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const search = useSearchParams();
  const toast = useToast();
  const runner = useActionRunner();
  const toggleRunner = useActionRunner();
  const [loadingDetail, startDetail] = React.useTransition();

  // dialog: null closed · { id: null } new · { id } edit (value filled once the detail arrives)
  const [dialog, setDialog] = React.useState<{ id: string | null } | null>(() => (detail ? { id: getDetailId(detail) } : null));
  const [value, setValue] = React.useState<V | null>(() => (detail ? toForm(detail) : null));
  const [initial, setInitial] = React.useState<string>(() => (detail ? JSON.stringify(toForm(detail)) : ''));
  const [localErrors, setLocalErrors] = React.useState<Record<string, string>>({});
  const [toggle, setToggle] = React.useState<{ row: R; active: boolean } | null>(null);
  const loadedFor = React.useRef<string | null>(detail ? getDetailId(detail) : null);

  const setEditParam = React.useCallback(
    (id: string | null) => {
      const sp = new URLSearchParams(search?.toString() ?? '');
      if (id) sp.set('edit', id);
      else sp.delete('edit');
      const qs = sp.toString();
      startDetail(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [router, pathname, search],
  );

  // Fill the form when the requested detail arrives (or a deep link ?edit= is opened).
  React.useEffect(() => {
    if (!detail) return;
    const id = getDetailId(detail);
    if (dialog?.id === id && loadedFor.current !== id) {
      const v = toForm(detail);
      setValue(v);
      setInitial(JSON.stringify(v));
      loadedFor.current = id;
    } else if (!dialog && loadedFor.current !== id) {
      const v = toForm(detail);
      setDialog({ id });
      setValue(v);
      setInitial(JSON.stringify(v));
      loadedFor.current = id;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail]);

  const openNew = () => {
    const v = emptyForm();
    runner.reset();
    setLocalErrors({});
    setValue(v);
    setInitial(JSON.stringify(v));
    setDialog({ id: null });
  };
  const openRow = (r: R) => {
    const id = getRowId(r);
    runner.reset();
    setLocalErrors({});
    setDialog({ id });
    if (detail && getDetailId(detail) === id) {
      const v = toForm(detail);
      setValue(v);
      setInitial(JSON.stringify(v));
      loadedFor.current = id;
    } else {
      setValue(null);
      loadedFor.current = null;
      setEditParam(id);
    }
  };
  const close = () => {
    setDialog(null);
    setValue(null);
    loadedFor.current = null;
    if (search?.get('edit')) setEditParam(null);
  };

  const currentDetail = dialog?.id && detail && getDetailId(detail) === dialog.id ? detail : null;

  const submit = async () => {
    if (!value) return;
    const errs = validate?.(value) ?? {};
    setLocalErrors(errs);
    if (Object.keys(errs).length) return;
    const res = await runner.run(() => onSave(value, currentDetail), {
      success: savedMessage ? savedMessage(value, currentDetail) : `${itemName.singular[0].toUpperCase()}${itemName.singular.slice(1)} saved.`,
    });
    if (res?.ok) {
      afterSave?.(res as AnyActionResult & Record<string, unknown>, value, currentDetail);
      close();
    }
  };

  const exportCsv = async () => {
    try {
      const res = await onExport();
      if (!res.ok) {
        toast.info(res.error);
        return;
      }
      downloadServerCsv(res.filename || csvName, res.content);
    } catch {
      toast.info('Export failed. Please try again.');
    }
  };

  const cols: ListColumn<R>[] = columns.map((c, i) =>
    i === 0
      ? {
          ...c,
          render: (r: R) => (
            <Link component="button" type="button" onClick={() => openRow(r)} sx={{ fontWeight: 600, textAlign: 'left' }} className="pret-tnum">
              {c.render ? c.render(r) : c.value?.(r) ?? '—'}
            </Link>
          ),
        }
      : c,
  );

  const rowActions = (r: R): RowAction[] => {
    const a: RowAction[] = [{ label: canEdit ? 'Edit' : 'View', onClick: () => openRow(r) }];
    if (canEdit && onSetActive && isActive) {
      a.push(
        isActive(r)
          ? { label: 'Deactivate', danger: true, onClick: () => setToggle({ row: r, active: false }) }
          : { label: 'Reactivate', onClick: () => setToggle({ row: r, active: true }) },
      );
    }
    return [...a, ...(extraRowActions?.(r) ?? [])];
  };

  const errors = { ...runner.fieldErrors, ...localErrors };
  const editing = Boolean(dialog?.id);
  const waiting = editing && !value;

  return (
    <>
      <ListPage<R>
        itemName={itemName}
        filters={renderFilters(list.draft, list.setDraftField)}
        {...list.listProps}
        onExport={exportCsv}
        addNew={canEdit ? { label: addLabel, onClick: openNew } : undefined}
        extraActions={extraActions}
        columns={cols}
        rows={rows}
        total={total}
        getRowId={getRowId}
        getRowRef={rowLabel}
        rowActions={rowActions}
        empty={{ title: empty?.title, helper: empty?.helper }}
      />

      {customDialog ? (
        customDialog({ open: Boolean(dialog), detail: currentDetail, loading: waiting || loadingDetail, creating: dialog?.id === null, onClose: close })
      ) : (
        <FormDialog
          open={Boolean(dialog)}
          title={dialog ? (currentDetail ? formTitle(currentDetail) : editing ? `${canEdit ? 'Edit' : 'View'} ${itemName.singular}` : formTitle(null)) : ''}
          onClose={close}
          onSubmit={submit}
          saving={runner.saving}
          error={runner.error}
          fieldErrors={errors}
          fieldLabels={fieldLabels}
          dirty={value ? JSON.stringify(value) !== initial : false}
          meta={currentDetail && meta ? meta(currentDetail) : null}
          readOnly={!canEdit || waiting}
          maxWidth={formMaxWidth}
        >
          {waiting ? (
            <Box sx={{ py: 4 }} aria-busy="true">
              <LinearProgress aria-label="Loading record" />
            </Box>
          ) : (
            value && (
              <>
                {formNotice?.(value, currentDetail)}
                {renderForm(
                  {
                    value,
                    set: (k, v) => setValue((prev) => (prev ? { ...prev, [k]: v } : prev)),
                    setAll: setValue as (v: V) => void,
                    errors,
                    editing,
                  },
                  currentDetail,
                )}
              </>
            )
          )}
        </FormDialog>
      )}

      <ConfirmDialog
        open={Boolean(toggle)}
        title={toggle ? `${toggle.active ? 'Reactivate' : 'Deactivate'} ${rowLabel(toggle.row)}?` : ''}
        body={
          toggle ? (
            <>
              {toggleRunner.error && <ErrorSummary error={toggleRunner.error} title="Can't change status" />}
              {toggle.active
                ? `${rowLabel(toggle.row)} will be available for selection again.`
                : deactivateBody?.(toggle.row) ?? `${rowLabel(toggle.row)} will no longer be offered for new records. Existing records keep it.`}
            </>
          ) : null
        }
        confirmLabel={toggle?.active ? 'Reactivate' : 'Deactivate'}
        destructive={toggle ? !toggle.active : false}
        onClose={() => {
          toggleRunner.reset();
          setToggle(null);
        }}
        onConfirm={async () => {
          if (!toggle || !onSetActive) return;
          const res = await toggleRunner.run(() => onSetActive(toggle.row, toggle.active), {
            success: `${rowLabel(toggle.row)} ${toggle.active ? 'reactivated' : 'deactivated'}.`,
          });
          if (res?.ok) setToggle(null);
        }}
      />
    </>
  );
}

/** Adapts ActionResult<CsvFile> from an export Server Action. */
export function csvResult(res: { ok: true; filename: string; content: string } | { ok: false; error: string }): CsvExportResult {
  return res.ok ? { ok: true, content: res.content, filename: res.filename } : { ok: false, error: res.error };
}
