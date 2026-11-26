// Unit tests — W2-007 M8 notifications: PDPA-safe templates (F-NTF-08), the template registry covers every outbox template the
// database writes, safe delivery rules (brief rule 6: example / test addresses never emailed, restricted delivery), back-off,
// A16 placeholder guard, and the contract catalogue.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); } catch (e) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw e;
    }
  },
});
const t = await import('../../src/server/lib/email-templates.ts');
const c = await import('../../src/server/contracts/notifications.ts');
const portal = await import('../../src/server/contracts/portal.ts');

// Every template_code written by app.notify / outbox inserts in supabase/migrations (W2-003 … W2-007) and src/server/actions.
const DB_TEMPLATES = [
  'leave_submitted', 'leave_cancellation_requested', 'credit_submitted', 'leave_approved', 'leave_rejected', 'leave_cancelled', 'leave_recounted',
  'leave_cancellation_rejected', 'leave_admin_action', 'leave_on_behalf', 'leave_balance_adjusted', 'credit_decided', 'leave_expiring',
  'leave_attachment_pending', 'leave_mc_invalid', 'approvals_digest', 'approval_escalated', 'delegation_changed', 'claim_submitted', 'claim_approved',
  'claim_rejected', 'claim_disbursed', 'batch_pending_approval', 'claim_disbursement_undone', 'claim_cancelled', 'bank_details_changed',
  'bank_details_changed_sa', 'change_request_decided', 'change_request_submitted', 'probation_ending', 'passport_expiring', 'document_expiring',
  'employee_confirmed', 'separation_recorded', 'role_changed', 'role_changed_admin', 'account_locked', 'account_locked_admin',
  'external_access_ending', 'ph_calendar_unpublished',
];
const base = { origin: 'https://pret.example.invalid', companyName: 'Interact Technology Sdn Bhd', recipientName: 'Sample Person', link: null };

test('registry: every template the database writes has a fixed template, each tied to a catalogue event that sends email', () => {
  for (const code of DB_TEMPLATES) assert.ok(t.TEMPLATE_BY_CODE[code], `missing template ${code}`);
  const events = new Map(c.NOTIFICATION_EVENTS.map((e) => [e.code, e]));
  for (const def of t.EMAIL_TEMPLATES) {
    assert.ok(events.get(def.eventCode)?.email, `${def.code}: ${def.eventCode} is not an email event`);
    assert.match(def.defaultLink, /^\/(?!\/)/, `${def.code}: default link must be a relative path`);
  }
  assert.equal(new Set(t.EMAIL_TEMPLATES.map((x) => x.code)).size, t.EMAIL_TEMPLATES.length, 'duplicate template codes');
});

test('F-NTF-08: no template offers a placeholder for NRIC, bank account, salary, diagnosis, religion or family; free-text reasons are never placeholders', () => {
  for (const def of t.EMAIL_TEMPLATES) {
    for (const p of t.allowedPlaceholders(def)) {
      assert.ok(!t.FORBIDDEN_KEYS.includes(p), `${def.code} exposes ${p}`);
      assert.ok(t.PLACEHOLDER_INFO[p], `${def.code}: undocumented placeholder ${p}`);
      assert.ok(!['reason', 'comment', 'remarks', 'note'].includes(p), `${def.code}: free text ${p}`);
    }
    for (const p of t.placeholdersIn(def.subject + ' ' + def.body)) assert.ok(t.allowedPlaceholders(def).includes(p), `${def.code}: uses ${p} without whitelisting it`);
  }
});

test('F-NTF-08: every template renders its synthetic sample and passes the PDPA check (subject, text and HTML)', () => {
  for (const def of t.EMAIL_TEMPLATES) {
    const e = t.renderEmail({ ...base, templateCode: def.code, title: 'Sample event title', payload: t.samplePayload(def.code) });
    assert.deepEqual(t.pdpaIssues(e, t.samplePayload(def.code)), [], `${def.code}: ${t.pdpaIssues(e).join('; ')}`);
    assert.ok(e.subject.length > 0 && e.subject.length <= 150);
    assert.match(e.text, /Open in PRET: https:\/\/pret\.example\.invalid\//);
    assert.match(e.html, /^<!doctype html><html lang="en">/);
    assert.doesNotMatch(e.html, /\{[a-z_]+\}/, `${def.code}: unfilled placeholder`);
  }
});

test('sensitive payload values that are not placeholders never reach the email; forbidden payload keys block sending', () => {
  const payload = { reference: 'LV-2027-00031', comment: 'MC from Klinik — diagnosis: gastritis', reason: 'NRIC 900101-14-5678', account_no: '1234567890123' };
  const e = t.renderEmail({ ...base, templateCode: 'leave_rejected', title: 'Leave rejected: LV-2027-00031', payload });
  for (const s of [e.subject, e.text, e.html]) {
    assert.doesNotMatch(s, /gastritis|900101|1234567890123|diagnosis/);
  }
  assert.match(e.text, /LV-2027-00031/);
  assert.ok(t.pdpaIssues(e, payload).some((i) => i.includes('forbidden payload keys: account_no')));
});

test('PDPA check catches NRIC, long account-style numbers, sensitive wording and attachments; links are not scanned', () => {
  const ok = { subject: 'Claim approved: CL-2027-00102', text: 'RM 1,245.60 paid 30/11/2027 https://x.example.invalid/my/claims/123456789012', html: '<p>ok</p>' };
  assert.deepEqual(t.pdpaIssues(ok), []);
  assert.ok(t.pdpaIssues({ ...ok, text: 'IC 900101145678' }).length > 0);
  assert.ok(t.pdpaIssues({ ...ok, subject: 'IC 900101-14-5678' }).some((i) => i.includes('NRIC')));
  assert.ok(t.pdpaIssues({ ...ok, text: 'Account 1234567890' }).some((i) => i.includes('long number')));
  assert.ok(t.pdpaIssues({ ...ok, text: 'Your salary is ready' }).some((i) => i.includes('sensitive wording')));
  assert.ok(t.pdpaIssues({ ...ok, html: '<img src="x">' }).some((i) => i.includes('attachments')));
});

test('rendering: values are HTML-escaped, newlines flattened, long values cut; [EMERGENCY] kept even with an SA override (BR-NTF-03)', () => {
  const e = t.renderEmail({ ...base, templateCode: 'leave_submitted', title: '[EMERGENCY] Leave to approve: LV-1 · <b>X</b>',
    payload: { employee: '<script>alert(1)</script>', type: 'Annual\nLeave', reference: 'LV-1', level: 1, emergency: true } });
  assert.doesNotMatch(e.html, /<script>/);
  assert.match(e.html, /&lt;script&gt;/);
  assert.match(e.text, /Annual Leave/);
  assert.ok(e.subject.startsWith('[EMERGENCY]'));
  const o = t.renderEmail({ ...base, templateCode: 'leave_submitted', title: 'x', payload: { reference: 'LV-2', emergency: true }, override: { subject: 'Please decide {reference}', body: 'Body {reference}' } });
  assert.equal(o.subject, '[EMERGENCY] Please decide LV-2');
  assert.match(o.text, /Body LV-2/);
  const long = t.renderEmail({ ...base, templateCode: 'leave_approved', title: 'x', payload: { reference: 'R'.repeat(500), type: 'AL' } });
  assert.ok(!long.text.includes('R'.repeat(121)));
});

test('unknown template codes fall back to a generic title + link email (still PDPA-safe)', () => {
  const e = t.renderEmail({ ...base, templateCode: 'not_in_registry', title: 'Something happened', payload: { nric: '900101145678' } });
  assert.equal(e.subject, 'Something happened');
  assert.doesNotMatch(e.text, /900101145678/);
});

test('A16 guard: forbidden and unknown placeholders are reported per template', () => {
  assert.deepEqual(t.validateTemplateText('leave_approved', 'Hi {recipient_name}, {reference} ({type}) {link}'), { unknown: [], forbidden: [] });
  assert.deepEqual(t.validateTemplateText('leave_approved', 'Your NRIC {nric} and { salary }'), { unknown: [], forbidden: ['nric', 'salary'] });
  assert.deepEqual(t.validateTemplateText('leave_approved', 'Total {total}'), { unknown: ['total'], forbidden: [] });
});

test('brief rule 6: example / test addresses are never emailed; restricted delivery only to allowed domains or test recipients', () => {
  const restricted = { mode: 'restricted', allowedDomains: ['interact.com.my'], testRecipients: ['qa.person@gmail.com'] };
  for (const a of ['a@example.com', 'b@example.invalid', 'c@mail.example.org', 'd@x.test', 'e@localhost', 'f@example.my']) {
    const d = t.deliveryDecision(a, { ...restricted, mode: 'live' });
    assert.equal(d.send, false, a);
  }
  assert.deepEqual(t.deliveryDecision('Aina@Interact.com.my', restricted), { send: true });
  assert.equal(t.deliveryDecision('someone@gmail.com', restricted).send, false);
  assert.match(t.deliveryDecision('someone@gmail.com', restricted).reason, /Restricted delivery/);
  assert.deepEqual(t.deliveryDecision('QA.Person@gmail.com', restricted), { send: true });
  assert.deepEqual(t.deliveryDecision('someone@gmail.com', { ...restricted, mode: 'live' }), { send: true });
  assert.equal(t.deliveryDecision('not-an-address', restricted).send, false);
});

test('retry back-off 5 min → 30 min → 2 h → 12 h (contract constants match)', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(t.backoffMinutes), [5, 30, 120, 720, 720, 720]);
  assert.deepEqual([...c.EMAIL_BACKOFF_MINUTES], [5, 30, 120, 720]);
  assert.equal(c.EMAIL_MAX_ATTEMPTS, 5);
  assert.equal(c.EMAIL_STALE_HOURS, 72);
});

test('contract: catalogue, statuses and log params', () => {
  const codes = c.NOTIFICATION_EVENTS.map((e) => e.code);
  assert.equal(new Set(codes).size, codes.length);
  for (const m of portal.MANDATORY_EMAIL_EVENT_CODES) assert.ok(codes.includes(m), `mandatory ${m} not in catalogue`);
  assert.ok(c.NOTIFICATION_EVENTS.find((e) => e.code === 'N-54').email && c.NOTIFICATION_EVENTS.find((e) => e.code === 'N-58').email);
  assert.deepEqual(Object.keys(c.DELIVERY_STATUS_LABELS), [...c.DELIVERY_STATUSES]);
  const p = c.notificationLogParamsSchema.parse({ eventCodes: 'N-01,N-41', channels: ['email'], page: '2' });
  assert.deepEqual(p.eventCodes, ['N-01', 'N-41']);
  assert.equal(p.page, 2); assert.equal(p.sort, 'at'); assert.equal(p.dir, 'desc');
  assert.equal(c.notificationLogParamsSchema.safeParse({ eventCodes: ['X-1'] }).success, false);
  assert.equal(c.saveNotificationTemplateSchema.safeParse({ templateCode: 'leave_approved', subject: 'ok subject', body: 'short' }).success, false);
});
