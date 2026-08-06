import { describe, it, expect } from 'vitest';
import { categoryItemSchema, groupNameSchema } from '../categories';
import { sendPushNotificationSchema } from '../push';
import { createShiftSchema, updateShiftSchema, shiftsQuerySchema } from '../admin';
import {
  createTemplateSchema,
  updateTemplateSchema,
  templateQuerySchema,
  templateChannelSchema,
  templateStatusSchema,
} from '../templates';

describe('Kategorie-Schemas', () => {
  it('akzeptiert einen Wert und schneidet Leerzeichen ab', () => {
    const result = categoryItemSchema.safeParse('  Pflegefachkraft  ');
    expect(result.success).toBe(true);
    expect(result.data).toBe('Pflegefachkraft');
  });

  it('lehnt leere Werte ab', () => {
    expect(categoryItemSchema.safeParse('   ').success).toBe(false);
    expect(groupNameSchema.safeParse('').success).toBe(false);
  });

  it('akzeptiert einen Gruppennamen', () => {
    expect(groupNameSchema.safeParse('Nachtdienst').success).toBe(true);
  });
});

describe('sendPushNotificationSchema', () => {
  it('akzeptiert eine vollständige Nachricht', () => {
    expect(
      sendPushNotificationSchema.safeParse({
        userId: 'u1',
        notification: { title: 'Neuer Einsatz', body: 'Morgen 06:00' },
      }).success
    ).toBe(true);
  });

  it('akzeptiert optionale Nutzdaten', () => {
    const result = sendPushNotificationSchema.safeParse({
      userId: 'u1',
      notification: { title: 'T', body: 'B' },
      data: { assignmentId: 'a1' },
    });
    expect(result.success).toBe(true);
  });

  it('verlangt userId, Titel und Text', () => {
    expect(
      sendPushNotificationSchema.safeParse({ userId: '', notification: { title: '', body: '' } })
        .success
    ).toBe(false);
  });

  it('lehnt eine fehlende Notification ab', () => {
    expect(sendPushNotificationSchema.safeParse({ userId: 'u1' }).success).toBe(false);
  });
});

describe('createShiftSchema', () => {
  const gueltig = {
    facilityId: 'f1',
    date: '2026-07-20',
    startTime: '06:00',
    endTime: '14:00',
  };

  it('akzeptiert die Pflichtfelder', () => {
    expect(createShiftSchema.safeParse(gueltig).success).toBe(true);
  });

  it('akzeptiert optionale Angaben', () => {
    expect(
      createShiftSchema.safeParse({
        ...gueltig,
        capacity: 3,
        requiredQualifications: ['Examiniert'],
        notes: ' Frühdienst ',
        stationId: 'st1',
      }).success
    ).toBe(true);
  });

  it('verlangt Einrichtung, Datum und Uhrzeiten', () => {
    for (const feld of ['facilityId', 'date', 'startTime', 'endTime'] as const) {
      const kopie: Record<string, string> = { ...gueltig };
      kopie[feld] = '';
      expect(createShiftSchema.safeParse(kopie).success).toBe(false);
    }
  });

  it('lehnt eine Kapazität kleiner 1 oder mit Nachkommastellen ab', () => {
    expect(createShiftSchema.safeParse({ ...gueltig, capacity: 0 }).success).toBe(false);
    expect(createShiftSchema.safeParse({ ...gueltig, capacity: 1.5 }).success).toBe(false);
  });
});

describe('updateShiftSchema', () => {
  it('akzeptiert Teilaktualisierungen', () => {
    expect(updateShiftSchema.safeParse({ notes: 'Geändert' }).success).toBe(true);
    expect(updateShiftSchema.safeParse({}).success).toBe(true);
  });

  it('akzeptiert nur bekannte Statuswerte', () => {
    expect(updateShiftSchema.safeParse({ status: 'published' }).success).toBe(true);
    expect(updateShiftSchema.safeParse({ status: 'irgendwas' }).success).toBe(false);
  });

  it('akzeptiert Zeitangaben als ISO-String oder Date', () => {
    expect(updateShiftSchema.safeParse({ startTime: '2026-07-20T06:00:00.000Z' }).success).toBe(true);
    expect(updateShiftSchema.safeParse({ startTime: new Date() }).success).toBe(true);
    expect(updateShiftSchema.safeParse({ startTime: '06:00' }).success).toBe(false);
  });
});

describe('shiftsQuerySchema', () => {
  it('setzt Standardwerte für limit und offset', () => {
    const result = shiftsQuerySchema.safeParse({});
    expect(result.data).toMatchObject({ limit: 50, offset: 0 });
  });

  it('wandelt numerische Strings um', () => {
    const result = shiftsQuerySchema.safeParse({ limit: '10', offset: '5' });
    expect(result.data).toMatchObject({ limit: 10, offset: 5 });
  });

  it('begrenzt limit auf 200', () => {
    expect(shiftsQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });

  it('akzeptiert ISO-Zeiträume', () => {
    expect(
      shiftsQuerySchema.safeParse({
        startDate: '2026-07-01T00:00:00.000Z',
        endDate: '2026-07-31T00:00:00.000Z',
      }).success
    ).toBe(true);
    expect(shiftsQuerySchema.safeParse({ startDate: '2026-07-01' }).success).toBe(false);
  });
});

describe('Template-Schemas', () => {
  const appTemplate = {
    key: 'einsatz.neu',
    channel: 'app' as const,
    name: 'Neuer Einsatz',
    title: 'Neuer Einsatz',
    message: 'Es liegt ein neuer Einsatz vor.',
  };

  const mailTemplate = {
    key: 'nachweis.versand',
    channel: 'email' as const,
    name: 'Stundennachweis',
    subject: 'Ihr Stundennachweis',
    bodyHtml: '<p>Anbei der Nachweis.</p>',
  };

  it('kennt die erlaubten Kanäle und Status', () => {
    expect(templateChannelSchema.safeParse('app').success).toBe(true);
    expect(templateChannelSchema.safeParse('sms').success).toBe(false);
    expect(templateStatusSchema.safeParse('published').success).toBe(true);
    expect(templateStatusSchema.safeParse('archiviert').success).toBe(false);
  });

  it('setzt Standardwerte für Sprache, Status und Tags', () => {
    const result = createTemplateSchema.safeParse(appTemplate);
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ locale: 'de', status: 'draft', tags: [] });
  });

  it('verlangt bei App-Vorlagen Titel und Text', () => {
    const result = createTemplateSchema.safeParse({ ...appTemplate, title: '', message: '' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['title']);
  });

  it('verlangt bei E-Mail-Vorlagen Betreff und Inhalt', () => {
    const result = createTemplateSchema.safeParse({ ...mailTemplate, subject: '', bodyHtml: '' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['subject']);
  });

  it('akzeptiert eine vollständige E-Mail-Vorlage', () => {
    expect(createTemplateSchema.safeParse(mailTemplate).success).toBe(true);
  });

  it('verlangt einen Schlüssel und einen Namen', () => {
    expect(createTemplateSchema.safeParse({ ...appTemplate, key: '' }).success).toBe(false);
    expect(createTemplateSchema.safeParse({ ...appTemplate, name: '' }).success).toBe(false);
  });

  it('erlaubt Teilaktualisierungen ohne Kanalprüfung', () => {
    expect(updateTemplateSchema.safeParse({ name: 'Neuer Name' }).success).toBe(true);
    expect(updateTemplateSchema.safeParse({ title: null }).success).toBe(true);
    expect(updateTemplateSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('validiert die Suchparameter', () => {
    expect(templateQuerySchema.safeParse({ channel: 'email', status: 'draft' }).success).toBe(true);
    expect(templateQuerySchema.safeParse({ channel: 'fax' }).success).toBe(false);
    expect(templateQuerySchema.safeParse({}).success).toBe(true);
  });
});
