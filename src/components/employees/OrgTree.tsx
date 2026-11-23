'use client';

// Generic reporting-line tree used by G11 · S-GL-13 Org chart and O8 · S-OR-08 Reporting
// lines. Builds the hierarchy from a flat list (id + managerId). Two renderings:
//   * 'chart' — top-down boxes with connectors, zoom +/− and FIT (desktop org chart);
//   * 'list'  — indented collapsible list (phone org chart, O8 left pane).
// Expand/collapse per node, EXPAND ALL / COLLAPSE ALL, highlight of a found person.
import * as React from 'react';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { surface } from '@/theme/palette';

export type TreePerson = {
  id: string;
  managerId: string | null;
  name: string;
  subtitle?: string | null;
  photoUrl?: string | null;
  /** Small badge text (e.g. "3 direct"). */
  badge?: string | null;
};

export type TreeNode = TreePerson & { children: TreeNode[]; depth: number };

export function buildTree(people: TreePerson[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const p of people) byId.set(p.id, { ...p, children: [], depth: 0 });
  const roots: TreeNode[] = [];
  for (const n of byId.values()) {
    const parent = n.managerId ? byId.get(n.managerId) : undefined;
    if (parent && parent !== n) parent.children.push(n);
    else roots.push(n);
  }
  const sortRec = (list: TreeNode[], depth: number, seen: Set<string>) => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    for (const n of list) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      n.depth = depth;
      sortRec(n.children, depth + 1, seen);
    }
  };
  sortRec(roots, 0, new Set());
  return roots;
}

/** ids of every ancestor of `id` (to expand the path to a found person). */
export function ancestorsOf(people: TreePerson[], id: string): string[] {
  const byId = new Map(people.map((p) => [p.id, p]));
  const out: string[] = [];
  let cur = byId.get(id);
  const guard = new Set<string>();
  while (cur?.managerId && !guard.has(cur.managerId)) {
    guard.add(cur.managerId);
    out.push(cur.managerId);
    cur = byId.get(cur.managerId);
  }
  return out;
}

export function countDescendants(node: TreeNode): number {
  return node.children.reduce((s, c) => s + 1 + countDescendants(c), 0);
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

function PersonBox({ node, selected, highlighted, onClick }: { node: TreeNode; selected: boolean; highlighted: boolean; onClick?: () => void }) {
  return (
    <ButtonBase
      onClick={onClick}
      data-person-id={node.id}
      aria-current={selected ? 'true' : undefined}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        textAlign: 'left',
        px: 1.5,
        py: 1,
        width: 200,
        borderRadius: 1,
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: highlighted || selected ? 'primary.main' : 'divider',
        boxShadow: highlighted ? '0 0 0 3px rgba(90,95,242,0.25)' : undefined,
      }}
    >
      <Avatar src={node.photoUrl ?? undefined} alt="" sx={{ width: 36, height: 36, fontSize: 14 }}>
        {initials(node.name)}
      </Avatar>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" noWrap title={node.name}>
          {node.name}
        </Typography>
        {node.subtitle && (
          <Typography variant="caption" color="text.secondary" noWrap component="p" title={node.subtitle}>
            {node.subtitle}
          </Typography>
        )}
        {node.badge && (
          <Typography variant="caption" color="text.secondary" component="p">
            {node.badge}
          </Typography>
        )}
      </Box>
    </ButtonBase>
  );
}

function ChartNode({
  node,
  expanded,
  toggle,
  selectedId,
  highlightId,
  onSelect,
}: {
  node: TreeNode;
  expanded: Set<string>;
  toggle: (id: string) => void;
  selectedId?: string | null;
  highlightId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const open = expanded.has(node.id);
  const line = surface.handle;
  return (
    <Box component="li" sx={{ listStyle: 'none', display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', px: 1, pt: 2 }}>
      <Stack alignItems="center" spacing={0.5}>
        <PersonBox node={node} selected={selectedId === node.id} highlighted={highlightId === node.id} onClick={() => onSelect?.(node.id)} />
        {node.children.length > 0 && (
          <IconButton size="small" onClick={() => toggle(node.id)} aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} reportees of ${node.name}`}>
            {open ? <ExpandMoreIcon fontSize="small" /> : <Typography variant="caption">+{node.children.length}</Typography>}
          </IconButton>
        )}
      </Stack>
      {open && node.children.length > 0 && (
        <Box
          component="ul"
          sx={{
            display: 'flex',
            p: 0,
            m: 0,
            position: 'relative',
            '&::before': { content: '""', position: 'absolute', top: 0, left: '50%', height: 16, borderLeft: `1px solid ${line}` },
            '& > li::before': { content: '""', position: 'absolute', top: 0, left: 0, right: 0, borderTop: `1px solid ${line}` },
            '& > li:first-of-type::before': { left: '50%' },
            '& > li:last-of-type::before': { right: '50%' },
            '& > li:only-of-type::before': { display: 'none' },
            '& > li::after': { content: '""', position: 'absolute', top: 0, left: '50%', height: 16, borderLeft: `1px solid ${line}` },
          }}
        >
          {node.children.map((c) => (
            <ChartNode key={c.id} node={c} expanded={expanded} toggle={toggle} selectedId={selectedId} highlightId={highlightId} onSelect={onSelect} />
          ))}
        </Box>
      )}
    </Box>
  );
}

function ListNode({
  node,
  expanded,
  toggle,
  selectedId,
  highlightId,
  onSelect,
}: {
  node: TreeNode;
  expanded: Set<string>;
  toggle: (id: string) => void;
  selectedId?: string | null;
  highlightId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const open = expanded.has(node.id);
  const active = selectedId === node.id || highlightId === node.id;
  return (
    <Box component="li" role="treeitem" aria-expanded={node.children.length ? open : undefined} aria-selected={selectedId === node.id} sx={{ listStyle: 'none' }}>
      <Stack direction="row" alignItems="center" sx={{ pl: node.depth * 2, minHeight: 44, borderRadius: 1, bgcolor: active ? 'tone.violet.bg' : undefined }}>
        <Box sx={{ width: 36, flexShrink: 0 }}>
          {node.children.length > 0 && (
            <IconButton size="small" onClick={() => toggle(node.id)} aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`}>
              {open ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
            </IconButton>
          )}
        </Box>
        <ButtonBase onClick={() => onSelect?.(node.id)} data-person-id={node.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexGrow: 1, justifyContent: 'flex-start', textAlign: 'left', py: 0.5, borderRadius: 1, minWidth: 0 }}>
          <Avatar src={node.photoUrl ?? undefined} alt="" sx={{ width: 28, height: 28, fontSize: 12 }}>
            {initials(node.name)}
          </Avatar>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {node.name}
            </Typography>
            {(node.subtitle || node.badge) && (
              <Typography variant="caption" color="text.secondary" noWrap component="p">
                {[node.subtitle, node.badge].filter(Boolean).join(' · ')}
              </Typography>
            )}
          </Box>
        </ButtonBase>
      </Stack>
      {open && node.children.length > 0 && (
        <Box component="ul" role="group" sx={{ p: 0, m: 0 }}>
          {node.children.map((c) => (
            <ListNode key={c.id} node={c} expanded={expanded} toggle={toggle} selectedId={selectedId} highlightId={highlightId} onSelect={onSelect} />
          ))}
        </Box>
      )}
    </Box>
  );
}

export type OrgTreeHandle = { expandAll: () => void; collapseAll: () => void; reveal: (id: string) => void };

const OrgTree = React.forwardRef<
  OrgTreeHandle,
  {
    people: TreePerson[];
    variant: 'chart' | 'list';
    selectedId?: string | null;
    highlightId?: string | null;
    onSelect?: (id: string) => void;
    /** Chart zoom (1 = 100 %). */
    zoom?: number;
    /** Levels expanded at first render. */
    initialDepth?: number;
    label?: string;
  }
>(function OrgTree({ people, variant, selectedId, highlightId, onSelect, zoom = 1, initialDepth = 2, label = 'Reporting lines' }, ref) {
  const roots = React.useMemo(() => buildTree(people), [people]);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => {
    const s = new Set<string>();
    const walk = (list: TreeNode[]) =>
      list.forEach((n) => {
        if (n.depth < initialDepth - 1 || (n.depth < initialDepth && n.children.length)) s.add(n.id);
        if (n.depth < initialDepth) walk(n.children);
      });
    walk(roots);
    return s;
  });
  const containerRef = React.useRef<HTMLDivElement>(null);

  const toggle = React.useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  React.useImperativeHandle(
    ref,
    () => ({
      expandAll: () => setExpanded(new Set(people.map((p) => p.id))),
      collapseAll: () => setExpanded(new Set()),
      reveal: (id: string) => {
        setExpanded((prev) => new Set([...prev, ...ancestorsOf(people, id)]));
        window.setTimeout(() => {
          const el = containerRef.current?.querySelector(`[data-person-id="${id}"]`);
          (el as HTMLElement | null)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
          (el as HTMLElement | null)?.focus();
        }, 50);
      },
    }),
    [people],
  );

  if (variant === 'list') {
    return (
      <Box ref={containerRef}>
        <Box component="ul" role="tree" aria-label={label} sx={{ p: 0, m: 0 }}>
          {roots.map((r) => (
            <ListNode key={r.id} node={r} expanded={expanded} toggle={toggle} selectedId={selectedId} highlightId={highlightId} onSelect={onSelect} />
          ))}
        </Box>
      </Box>
    );
  }
  return (
    <Box ref={containerRef} sx={{ overflow: 'auto', maxHeight: '70vh', bgcolor: 'grey.50', borderRadius: 1, p: 2 }} aria-label={label} role="region">
      <Box sx={{ transform: `scale(${zoom})`, transformOrigin: 'top left', width: 'max-content' }}>
        <Box component="ul" sx={{ display: 'flex', p: 0, m: 0 }}>
          {roots.map((r) => (
            <ChartNode key={r.id} node={r} expanded={expanded} toggle={toggle} selectedId={selectedId} highlightId={highlightId} onSelect={onSelect} />
          ))}
        </Box>
      </Box>
    </Box>
  );
});

export default OrgTree;
