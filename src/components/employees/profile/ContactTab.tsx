'use client';

// E3 tab 3 · Contact & emergency (groups B, C) + E4 inline edit. B1 change warns
// "This changes the user's sign-in email". Emergency contacts: ADD CONTACT (max 3),
// reorder priority, delete while ≥ 1 remains.
import * as React from 'react';
import Stack from '@mui/material/Stack';
import { CONTACT_RELATIONSHIP_LABELS, type ContactView, type EmergencyContactView } from '@/server/contracts/employees';
import { saveEmergencyContacts, saveMyEmergencyContacts, updateContact } from '@/server/actions/employees';
import { useActionRunner } from '../../forms/useActionRunner';
import { ContactFields, EmergencyContactsEditor, contactPayload, contactToForm, emergencyPayload, emergencyToForm, type ContactForm, type EmergencyForm } from '../fieldGroups';
import { KVGrid, MiniTable, SectionCard } from '../ui';
import { addressText, phone, yesNo } from '../labels';

export function ContactReadOnly({ c }: { c: ContactView }) {
  return (
    <KVGrid
      items={[
        { label: 'Work email', value: c.workEmail },
        { label: 'Personal email', value: c.personalEmail },
        { label: 'Mobile phone', value: phone(c.mobilePhone) },
        { label: 'Work phone / extension', value: c.workPhone },
        { label: 'Residential address', value: addressText(c.residentialAddress), full: true },
        { label: 'Mailing address', value: c.mailingSameAsResidential ? 'Same as residential' : addressText(c.mailingAddress), full: true },
      ]}
    />
  );
}

export function EmergencyTable({ rows, limited }: { rows: EmergencyContactView[]; limited?: boolean }) {
  return (
    <MiniTable
      caption="Emergency contacts"
      rows={[...rows].sort((a, b) => a.priority - b.priority)}
      getRowId={(r) => r.id}
      empty="No emergency contact recorded."
      columns={[
        { key: 'p', header: 'Priority', render: (r) => r.priority },
        { key: 'n', header: 'Name', render: (r) => r.name },
        { key: 'r', header: 'Relationship', render: (r) => CONTACT_RELATIONSHIP_LABELS[r.relationship] },
        { key: 'm', header: 'Mobile', render: (r) => phone(r.mobilePhone) },
        { key: 'a', header: 'Alternate', render: (r) => phone(r.altPhone) || '—' },
        ...(limited
          ? []
          : [
              { key: 'e', header: 'Email', render: (r: EmergencyContactView) => r.email || '—' },
              { key: 'k', header: 'Next of kin', render: (r: EmergencyContactView) => yesNo(r.isNextOfKin) },
            ]),
      ]}
    />
  );
}

/** Emergency contacts card — `self` uses saveMyEmergencyContacts (P16, N-40). */
export function EmergencyCard({ employeeId, rows, canEdit, self }: { employeeId: string; rows: EmergencyContactView[]; canEdit: boolean; self?: boolean }) {
  const r = useActionRunner();
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState<EmergencyForm[]>([]);
  return (
    <SectionCard
      title="Emergency contacts"
      canEdit={canEdit}
      editing={editing}
      onEdit={() => {
        setForm(emergencyToForm(rows));
        r.reset();
        setEditing(true);
      }}
      onCancel={() => setEditing(false)}
      onSave={async () => {
        const contacts = emergencyPayload(form);
        const res = await r.run(() => (self ? saveMyEmergencyContacts({ contacts }) : saveEmergencyContacts({ employeeId, contacts })), {
          success: self ? 'Saved. HR has been notified.' : 'Emergency contacts saved.',
        });
        if (res?.ok) setEditing(false);
      }}
      saving={r.saving}
      error={r.error}
      fieldErrors={r.fieldErrors}
    >
      {editing ? <EmergencyContactsEditor rows={form} onChange={setForm} errors={r.fieldErrors} /> : <EmergencyTable rows={rows} />}
    </SectionCard>
  );
}

export default function ContactTab({ employeeId, contact, emergency, canEdit, hasPortalAccount }: { employeeId: string; contact: ContactView; emergency: EmergencyContactView[]; canEdit: boolean; hasPortalAccount: boolean }) {
  const r = useActionRunner();
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState<ContactForm>(() => contactToForm(contact));
  const emailChanged = editing && form.workEmail.trim().toLowerCase() !== contact.workEmail.toLowerCase();
  return (
    <Stack spacing={2}>
      <SectionCard
        title="Contact & address"
        canEdit={canEdit}
        editing={editing}
        onEdit={() => {
          setForm(contactToForm(contact));
          r.reset();
          setEditing(true);
        }}
        onCancel={() => setEditing(false)}
        onSave={async () => {
          const res = await r.run(() => updateContact({ employeeId, ...contactPayload(form) }), { success: 'Contact details saved.' });
          if (res?.ok) setEditing(false);
        }}
        saving={r.saving}
        error={r.error}
        fieldErrors={r.fieldErrors}
      >
        {editing ? (
          <ContactFields
            value={form}
            onChange={(p) => setForm((v) => ({ ...v, ...p }))}
            errors={r.fieldErrors}
            workEmailWarning={emailChanged && hasPortalAccount ? "This changes the user's sign-in email." : undefined}
          />
        ) : (
          <ContactReadOnly c={contact} />
        )}
      </SectionCard>
      <EmergencyCard employeeId={employeeId} rows={emergency} canEdit={canEdit} />
    </Stack>
  );
}
