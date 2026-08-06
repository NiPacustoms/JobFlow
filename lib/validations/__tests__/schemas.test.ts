import { describe, it, expect } from 'vitest';
import {
  loginSchema,
  registerSchema,
  passwordResetSchema,
  changePasswordSchema,
  validateEmail,
  validatePassword,
  firebaseAuthErrorMessages,
} from '../authForms';
import { registerAdminSchema, acceptInviteSchema } from '../auth';
import { createInvitationSchema, invitationsQuerySchema } from '../invitations';
import { createReminderSchema } from '../forms';
import { staffCreateSchema } from '../staff';

const fehlermeldungen = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.success ? [] : (result.error?.issues.map(i => i.message) ?? []);

describe('loginSchema', () => {
  it('akzeptiert gültige Zugangsdaten', () => {
    expect(loginSchema.safeParse({ email: 'anna@aufabruf.eu', password: 'geheim123' }).success).toBe(
      true
    );
  });

  it('lehnt ungültige E-Mail und zu kurzes Passwort ab', () => {
    const result = loginSchema.safeParse({ email: 'keine-mail', password: '123' });
    expect(result.success).toBe(false);
    expect(fehlermeldungen(result)).toContain('Ungültige E-Mail-Adresse');
    expect(fehlermeldungen(result)).toContain('Passwort muss mindestens 6 Zeichen lang sein');
  });

  it('verlangt Pflichtangaben', () => {
    const result = loginSchema.safeParse({ email: '', password: '' });
    expect(fehlermeldungen(result)).toContain('E-Mail ist erforderlich');
    expect(fehlermeldungen(result)).toContain('Passwort ist erforderlich');
  });

  it('begrenzt die Länge der E-Mail', () => {
    const lang = `${'a'.repeat(250)}@b.de`;
    expect(loginSchema.safeParse({ email: lang, password: 'geheim123' }).success).toBe(false);
  });
});

describe('registerSchema', () => {
  const gueltig = {
    name: 'Anna Muster',
    email: 'anna@aufabruf.eu',
    password: 'Geheim123',
    confirmPassword: 'Geheim123',
  };

  it('akzeptiert eine vollständige Registrierung', () => {
    expect(registerSchema.safeParse(gueltig).success).toBe(true);
  });

  it('akzeptiert deutsche Umlaute und Bindestriche im Namen', () => {
    expect(registerSchema.safeParse({ ...gueltig, name: 'Jörg Müller-Straß' }).success).toBe(true);
  });

  it('lehnt Ziffern und Sonderzeichen im Namen ab', () => {
    const result = registerSchema.safeParse({ ...gueltig, name: 'Anna 123' });
    expect(fehlermeldungen(result)).toContain('Name enthält ungültige Zeichen');
  });

  it('erzwingt Passwortkomplexität', () => {
    const result = registerSchema.safeParse({
      ...gueltig,
      password: 'nurklein',
      confirmPassword: 'nurklein',
    });
    expect(fehlermeldungen(result)).toContain(
      'Passwort muss mindestens einen Kleinbuchstaben, einen Großbuchstaben und eine Zahl enthalten'
    );
  });

  it('meldet abweichende Passwortbestätigung am richtigen Feld', () => {
    const result = registerSchema.safeParse({ ...gueltig, confirmPassword: 'Anders123' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(['confirmPassword']);
  });
});

describe('passwordResetSchema / changePasswordSchema', () => {
  it('validiert die Reset-E-Mail', () => {
    expect(passwordResetSchema.safeParse({ email: 'a@b.de' }).success).toBe(true);
    expect(passwordResetSchema.safeParse({ email: 'kaputt' }).success).toBe(false);
  });

  it('validiert die Passwortänderung inklusive Bestätigung', () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: 'alt',
        newPassword: 'Geheim123',
        confirmNewPassword: 'Geheim123',
      }).success
    ).toBe(true);

    const result = changePasswordSchema.safeParse({
      currentPassword: 'alt',
      newPassword: 'Geheim123',
      confirmNewPassword: 'Anders123',
    });
    expect(fehlermeldungen(result)).toContain('Neue Passwörter stimmen nicht überein');
  });
});

describe('Auth-Hilfsfunktionen', () => {
  it('validateEmail / validatePassword prüfen Einzelfelder', () => {
    expect(validateEmail('a@b.de')).toBe(true);
    expect(validateEmail('kaputt')).toBe(false);
    expect(validatePassword('geheim')).toBe(true);
    expect(validatePassword('123')).toBe(false);
  });

  it('liefert deutsche Meldungen zu Firebase-Fehlercodes', () => {
    expect(firebaseAuthErrorMessages['auth/wrong-password']).toBe('Falsches Passwort');
    expect(firebaseAuthErrorMessages['auth/user-disabled']).toBe('Benutzerkonto wurde deaktiviert');
    expect(firebaseAuthErrorMessages['auth/invalid-credential']).toBe('Ungültige Anmeldedaten');
  });
});

describe('registerAdminSchema', () => {
  it('akzeptiert Anzeigename oder Vor-/Nachname oder E-Mail', () => {
    expect(registerAdminSchema.safeParse({ companyName: 'AufAbruf', displayName: 'Chef' }).success).toBe(true);
    expect(
      registerAdminSchema.safeParse({ companyName: 'AufAbruf', firstName: 'A', lastName: 'B' }).success
    ).toBe(true);
    expect(registerAdminSchema.safeParse({ companyName: 'AufAbruf', email: 'a@b.de' }).success).toBe(true);
  });

  it('verlangt einen Firmennamen', () => {
    const result = registerAdminSchema.safeParse({ companyName: '', displayName: 'Chef' });
    expect(result.success).toBe(false);
  });

  it('lehnt eine Anfrage ohne jede Namensangabe ab', () => {
    const result = registerAdminSchema.safeParse({ companyName: 'AufAbruf' });
    expect(fehlermeldungen(result)).toContain(
      'displayName oder firstName/lastName oder email ist erforderlich'
    );
  });
});

describe('acceptInviteSchema', () => {
  it('akzeptiert Token und ausreichend langes Passwort', () => {
    expect(acceptInviteSchema.safeParse({ token: 'abc', password: 'Geheim12' }).success).toBe(true);
  });

  it('lehnt fehlenden Token und zu kurzes Passwort ab', () => {
    const result = acceptInviteSchema.safeParse({ token: '', password: 'kurz' });
    expect(fehlermeldungen(result)).toContain('Token ist erforderlich');
    expect(fehlermeldungen(result)).toContain('Passwort muss mindestens 8 Zeichen lang sein');
  });
});

describe('Einladungs-Schemas', () => {
  it('setzt die Standard-Gültigkeit auf 7 Tage', () => {
    const result = createInvitationSchema.safeParse({ email: 'a@b.de', role: 'employee' });
    expect(result.success).toBe(true);
    expect(result.data?.expiresInDays).toBe(7);
  });

  it('begrenzt die Gültigkeit auf 30 Tage', () => {
    expect(
      createInvitationSchema.safeParse({ email: 'a@b.de', role: 'admin', expiresInDays: 31 }).success
    ).toBe(false);
  });

  it('lehnt unbekannte Rollen ab', () => {
    expect(createInvitationSchema.safeParse({ email: 'a@b.de', role: 'nurse' }).success).toBe(false);
  });

  it('wandelt Query-Parameter in Zahlen und setzt Standardwerte', () => {
    const result = invitationsQuerySchema.safeParse({ limit: '10', offset: '20' });
    expect(result.data).toMatchObject({ limit: 10, offset: 20 });
    const standard = invitationsQuerySchema.safeParse({});
    expect(standard.data).toMatchObject({ limit: 50, offset: 0 });
  });

  it('lehnt nicht-numerische Query-Parameter ab', () => {
    expect(invitationsQuerySchema.safeParse({ limit: 'viele' }).success).toBe(false);
  });
});

describe('createReminderSchema', () => {
  it('akzeptiert ISO-Datum und Date-Objekt', () => {
    expect(
      createReminderSchema.safeParse({
        employeeId: 'u1',
        formType: 'einsatzmitteilung',
        dueDate: '2026-08-01T10:00:00.000Z',
      }).success
    ).toBe(true);
    expect(
      createReminderSchema.safeParse({ employeeId: 'u1', formType: 'x', dueDate: new Date() }).success
    ).toBe(true);
  });

  it('setzt die Priorität standardmäßig auf medium', () => {
    const result = createReminderSchema.safeParse({
      employeeId: 'u1',
      formType: 'x',
      dueDate: new Date(),
    });
    expect(result.data?.priority).toBe('medium');
  });

  it('verlangt employeeId und formType', () => {
    const result = createReminderSchema.safeParse({ employeeId: '', formType: '', dueDate: new Date() });
    expect(fehlermeldungen(result)).toContain('employeeId ist erforderlich');
  });
});

describe('staffCreateSchema', () => {
  const gueltig = {
    displayName: 'Anna Muster',
    email: 'anna@aufabruf.eu',
    phone: '+49 170 1234567',
    role: 'nurse' as const,
    qualifications: ['Examinierte Pflegefachkraft'],
  };

  it('akzeptiert einen vollständigen Mitarbeiter', () => {
    const result = staffCreateSchema.safeParse(gueltig);
    expect(result.success).toBe(true);
    expect(result.data?.active).toBe(true);
    expect(result.data?.group).toBe('');
  });

  it('verlangt mindestens eine Qualifikation', () => {
    const result = staffCreateSchema.safeParse({ ...gueltig, qualifications: [] });
    expect(fehlermeldungen(result)).toContain('Mindestens eine Qualifikation ist erforderlich');
  });

  it('prüft das Telefonformat', () => {
    const result = staffCreateSchema.safeParse({ ...gueltig, phone: '123' });
    expect(fehlermeldungen(result)).toContain('Ungültige Telefonnummer');
  });

  it('begrenzt die Wochenstunden auf 80', () => {
    expect(staffCreateSchema.safeParse({ ...gueltig, workingHoursPerWeek: 80 }).success).toBe(true);
    expect(staffCreateSchema.safeParse({ ...gueltig, workingHoursPerWeek: 81 }).success).toBe(false);
    expect(staffCreateSchema.safeParse({ ...gueltig, workingHoursPerWeek: 0 }).success).toBe(false);
  });

  it('lehnt unbekannte Rollen ab', () => {
    expect(staffCreateSchema.safeParse({ ...gueltig, role: 'chef' }).success).toBe(false);
  });

  it('prüft die private E-Mail im Kontaktblock', () => {
    expect(
      staffCreateSchema.safeParse({ ...gueltig, contact: { emailPrivate: 'kaputt' } }).success
    ).toBe(false);
    expect(
      staffCreateSchema.safeParse({ ...gueltig, contact: { emailPrivate: 'a@b.de' } }).success
    ).toBe(true);
  });
});
