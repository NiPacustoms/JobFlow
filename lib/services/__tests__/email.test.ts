import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * E-Mail-Adapter: HTML-Vorlagen für Einladung, Einsatzformular und
 * Stundennachweis sowie der Versand über die Cloud Functions mit
 * Protokoll-Fallback, wenn keine Function erreichbar ist.
 */

const httpsCallableMock = vi.fn();
const callMock = vi.fn();
vi.mock('firebase/functions', () => ({
  httpsCallable: (...a: unknown[]) => {
    httpsCallableMock(...a);
    return callMock;
  },
}));

const firebaseZustand = vi.hoisted(() => ({ functions: {} as unknown }));
vi.mock('@/lib/firebase', () => ({
  get functions() {
    return firebaseZustand.functions;
  },
}));

const loggerWarn = vi.fn();
const loggerInfo = vi.fn();
vi.mock('@/lib/logging', () => ({
  logger: {
    warn: (...a: unknown[]) => loggerWarn(...a),
    info: (...a: unknown[]) => loggerInfo(...a),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  renderInviteEmailHtml,
  sendInvitationEmail,
  renderAssignmentFormEmailHtml,
  sendAssignmentFormEmail,
  renderAssignmentSignatureEmailHtml,
  sendAssignmentSignatureEmail,
} from '../email';

beforeEach(() => {
  vi.clearAllMocks();
  firebaseZustand.functions = {};
  callMock.mockResolvedValue({ data: { success: true } });
});

describe('renderInviteEmailHtml', () => {
  it('enthält Firmenname und den Annahme-Link zweifach (Button und Klartext)', () => {
    const html = renderInviteEmailHtml({
      to: 'anna@aufabruf.eu',
      companyName: 'AufAbruf GmbH',
      acceptLink: 'https://schichtklar.example/invite/abc',
    });

    expect(html).toContain('AufAbruf GmbH');
    expect(html).toContain('Einladung annehmen');
    expect(html.match(/https:\/\/schichtklar\.example\/invite\/abc/g)).toHaveLength(3);
    expect(html).toContain('24 Stunden');
  });
});

describe('sendInvitationEmail', () => {
  const einladung = {
    to: 'anna@aufabruf.eu',
    companyName: 'AufAbruf GmbH',
    acceptLink: 'https://schichtklar.example/invite/abc',
  };

  it('ruft die Cloud Function auf', async () => {
    await sendInvitationEmail(einladung);
    expect(httpsCallableMock).toHaveBeenCalledWith(expect.anything(), 'sendInvitationEmailCF');
    expect(callMock).toHaveBeenCalledWith(einladung);
  });

  it('protokolliert als Fallback, wenn Functions fehlen', async () => {
    firebaseZustand.functions = null;
    await expect(sendInvitationEmail(einladung)).resolves.toBeUndefined();
    expect(loggerWarn).toHaveBeenCalledWith(
      '[Email:FALLBACK] Invitation',
      {},
      expect.objectContaining({ html: expect.stringContaining('AufAbruf GmbH') })
    );
  });

  it('protokolliert als Fallback, wenn der Aufruf scheitert', async () => {
    callMock.mockRejectedValue(new Error('CF nicht erreichbar'));
    await expect(sendInvitationEmail(einladung)).resolves.toBeUndefined();
    expect(loggerWarn).toHaveBeenCalledWith(
      '[Email:FALLBACK] Invitation',
      {},
      expect.anything()
    );
  });
});

describe('renderAssignmentFormEmailHtml', () => {
  it('grüßt mit Namen und nennt die Schichtinfo', () => {
    const html = renderAssignmentFormEmailHtml({
      to: 'anna@aufabruf.eu',
      employeeName: 'Anna Muster',
      formLink: 'https://schichtklar.example/form/1',
      shiftInfo: 'Frühdienst 20.07.2026',
    });

    expect(html).toContain('Hallo Anna Muster,');
    expect(html).toContain('Frühdienst 20.07.2026');
    expect(html).toContain('Formular öffnen');
  });

  it('nutzt ohne Namen und ohne Schichtinfo eine neutrale Anrede', () => {
    const html = renderAssignmentFormEmailHtml({
      to: 'anna@aufabruf.eu',
      formLink: 'https://schichtklar.example/form/1',
    });

    expect(html).toContain('Guten Tag,');
    expect(html).not.toContain('<strong>');
  });
});

describe('sendAssignmentFormEmail', () => {
  const formular = {
    to: 'anna@aufabruf.eu',
    formLink: 'https://schichtklar.example/form/1',
  };

  it('ruft die Cloud Function auf', async () => {
    await sendAssignmentFormEmail(formular);
    expect(httpsCallableMock).toHaveBeenCalledWith(expect.anything(), 'sendAssignmentFormEmailCF');
    expect(callMock).toHaveBeenCalledWith(formular);
  });

  it('protokolliert als Fallback, wenn Functions fehlen', async () => {
    firebaseZustand.functions = null;
    await expect(sendAssignmentFormEmail(formular)).resolves.toBeUndefined();
    expect(loggerWarn).toHaveBeenCalledWith(
      '[Email:FALLBACK] Assignment Form',
      {},
      expect.objectContaining({ html: expect.stringContaining('Formular öffnen') })
    );
  });

  it('protokolliert als Fallback, wenn der Aufruf scheitert', async () => {
    callMock.mockRejectedValue(new Error('CF nicht erreichbar'));
    await expect(sendAssignmentFormEmail(formular)).resolves.toBeUndefined();
    expect(loggerWarn).toHaveBeenCalledWith('[Email:FALLBACK] Assignment Form', {}, expect.anything());
  });
});

describe('renderAssignmentSignatureEmailHtml', () => {
  const basis = {
    to: 'anna@aufabruf.eu',
    employeeName: 'Anna Muster',
    assignmentId: 'a1',
    pdfUrl: 'https://storage.example/nachweis.pdf',
  };

  it('formuliert für Mitarbeiter in der Ich-Perspektive', () => {
    const html = renderAssignmentSignatureEmailHtml({ ...basis, recipientType: 'employee' });
    expect(html).toContain('Ihre Zeiterfassung mit allen Unterschriften');
    expect(html).toContain('PDF herunterladen');
  });

  it('nennt Admins den Mitarbeitenden', () => {
    const html = renderAssignmentSignatureEmailHtml({ ...basis, recipientType: 'admin' });
    expect(html).toContain('Die Zeiterfassung für Anna Muster');
  });

  it('meldet der Einrichtung den Abschluss', () => {
    const html = renderAssignmentSignatureEmailHtml({ ...basis, recipientType: 'facility' });
    expect(html).toContain('erfolgreich abgeschlossen');
  });

  it('führt Einrichtung und Datum nur bei Angabe auf', () => {
    const ohne = renderAssignmentSignatureEmailHtml({ ...basis, recipientType: 'employee' });
    expect(ohne).not.toContain('Einrichtung:');
    expect(ohne).not.toContain('Datum:');

    const mit = renderAssignmentSignatureEmailHtml({
      ...basis,
      recipientType: 'employee',
      facilityName: 'Haus Sonnenschein',
      shiftDate: '20.07.2026',
    });
    expect(mit).toContain('Haus Sonnenschein');
    expect(mit).toContain('20.07.2026');
  });

  it('nutzt ohne Namen eine neutrale Anrede', () => {
    const html = renderAssignmentSignatureEmailHtml({
      ...basis,
      employeeName: '',
      recipientType: 'facility',
    });
    expect(html).toContain('Guten Tag,');
  });
});

describe('sendAssignmentSignatureEmail', () => {
  const nachweisMail = {
    to: 'anna@aufabruf.eu',
    employeeName: 'Anna Muster',
    assignmentId: 'a1',
    pdfUrl: 'https://storage.example/nachweis.pdf',
    recipientType: 'employee' as const,
  };

  it('ruft die Cloud Function auf', async () => {
    await sendAssignmentSignatureEmail(nachweisMail);
    expect(httpsCallableMock).toHaveBeenCalledWith(
      expect.anything(),
      'sendAssignmentSignatureEmailCF'
    );
    expect(callMock).toHaveBeenCalledWith(nachweisMail);
  });

  it('protokolliert als Fallback bei fehlenden Functions', async () => {
    firebaseZustand.functions = null;
    await expect(sendAssignmentSignatureEmail(nachweisMail)).resolves.toBeUndefined();
    expect(loggerWarn).toHaveBeenCalledWith(
      '[Email:FALLBACK] Assignment Signature',
      {},
      expect.objectContaining({ html: expect.stringContaining('PDF herunterladen') })
    );
  });

  it('protokolliert als Fallback bei Aufruffehlern', async () => {
    callMock.mockRejectedValue(new Error('CF nicht erreichbar'));
    await expect(sendAssignmentSignatureEmail(nachweisMail)).resolves.toBeUndefined();
    expect(loggerWarn).toHaveBeenCalled();
  });
});
