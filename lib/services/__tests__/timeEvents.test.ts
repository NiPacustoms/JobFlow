import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Stempel-Ereignisse: revisionssicherer Audit-Trail der Zeiterfassung (GoBD).
 * Wichtigste Eigenschaft: Der Haupt-Workflow darf niemals an einem fehl-
 * geschlagenen Protokolleintrag scheitern – und Offline-IDs dürfen gar nicht
 * erst geschrieben werden.
 */

vi.mock('@/lib/firebase', () => ({
  db: {},
  getDb: vi.fn(() => ({})),
}));

const addDoc = vi.fn();
let snapshotCallback: ((snap: unknown) => void) | null = null;
let errorCallback: ((err: { message: string }) => void) | null = null;

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((_db: unknown, ...pfad: string[]) => ({ pfad })),
  addDoc: (...a: unknown[]) => addDoc(...a),
  onSnapshot: vi.fn((_q: unknown, onNext: (s: unknown) => void, onError: (e: { message: string }) => void) => {
    snapshotCallback = onNext;
    errorCallback = onError;
    return () => undefined;
  }),
  orderBy: vi.fn(() => ({})),
  query: vi.fn(() => ({})),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}));

const lade = async () => await import('../timeEvents');

beforeEach(() => {
  vi.clearAllMocks();
  addDoc.mockResolvedValue({ id: 'e1' });
  snapshotCallback = null;
  errorCallback = null;
});

describe('timeEventLabel', () => {
  it('liefert deutsche Bezeichnungen für alle Ereignisarten', async () => {
    const { timeEventLabel } = await lade();
    expect(timeEventLabel('clockIn')).toBe('Eingestempelt');
    expect(timeEventLabel('pauseStart')).toBe('Pause gestartet');
    expect(timeEventLabel('pauseEnd')).toBe('Pause beendet');
    expect(timeEventLabel('clockOut')).toBe('Ausgestempelt');
    expect(timeEventLabel('correction')).toBe('Korrektur');
  });

  it('fällt bei unbekannter Art auf den Rohwert zurück', async () => {
    const { timeEventLabel } = await lade();
    expect(timeEventLabel('unbekannt' as never)).toBe('unbekannt');
  });
});

describe('recordTimeEvent', () => {
  it('schreibt ein Ereignis in die events-Unterkollektion', async () => {
    const { recordTimeEvent } = await lade();
    await recordTimeEvent('ts1', { type: 'clockIn', by: 'u1', at: '06:00' });

    expect(addDoc).toHaveBeenCalledTimes(1);
    expect((addDoc.mock.calls[0][0] as { pfad: string[] }).pfad).toEqual(['timesheets', 'ts1', 'events']);
    expect(addDoc.mock.calls[0][1]).toMatchObject({ type: 'clockIn', by: 'u1', at: '06:00' });
  });

  it('setzt die Uhrzeit automatisch, wenn keine angegeben ist', async () => {
    const { recordTimeEvent } = await lade();
    await recordTimeEvent('ts1', { type: 'clockOut', by: 'u1' });
    const daten = addDoc.mock.calls[0][1] as { at: string };
    expect(daten.at).toMatch(/^\d{2}:\d{2}$/);
  });

  it('schreibt KEIN Ereignis für Offline-IDs', async () => {
    const { recordTimeEvent } = await lade();
    await recordTimeEvent('offline_123_abc', { type: 'clockIn', by: 'u1' });
    expect(addDoc).not.toHaveBeenCalled();
  });

  it('schreibt KEIN Ereignis ohne Timesheet-ID', async () => {
    const { recordTimeEvent } = await lade();
    await recordTimeEvent('', { type: 'clockIn', by: 'u1' });
    expect(addDoc).not.toHaveBeenCalled();
  });

  it('lässt Notiz und Korrekturen weg, wenn sie leer sind', async () => {
    const { recordTimeEvent } = await lade();
    await recordTimeEvent('ts1', { type: 'clockIn', by: 'u1', corrections: [] });
    const daten = addDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(daten).not.toHaveProperty('note');
    expect(daten).not.toHaveProperty('corrections');
  });

  it('übernimmt Notiz und Korrekturen, wenn vorhanden', async () => {
    const { recordTimeEvent } = await lade();
    await recordTimeEvent('ts1', {
      type: 'correction',
      by: 'u1',
      note: 'Nachträglich korrigiert',
      corrections: [{ field: 'endTime', from: '14:00', to: '15:00' }],
    });
    const daten = addDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(daten.note).toBe('Nachträglich korrigiert');
    expect(daten.corrections).toHaveLength(1);
  });

  it('wirft nicht, wenn das Protokollieren scheitert', async () => {
    addDoc.mockRejectedValue(new Error('Rules verweigern'));
    const { recordTimeEvent } = await lade();
    await expect(recordTimeEvent('ts1', { type: 'clockIn', by: 'u1' })).resolves.toBeUndefined();
  });
});

describe('listenToTimeEvents', () => {
  const snapshotMit = (docs: Array<{ id: string; data: Record<string, unknown> }>) => ({
    forEach(cb: (d: { id: string; data: () => Record<string, unknown> }) => void) {
      docs.forEach(d => cb({ id: d.id, data: () => d.data }));
    },
  });

  it('liefert die Ereignisse chronologisch an den Callback', async () => {
    const { listenToTimeEvents } = await lade();
    const empfangen = vi.fn();
    listenToTimeEvents('ts1', empfangen);

    snapshotCallback?.(
      snapshotMit([
        { id: 'e1', data: { type: 'clockIn', at: '06:00', by: 'u1', createdAt: { toDate: () => new Date(2026, 6, 20, 6) } } },
        { id: 'e2', data: { type: 'clockOut', at: '14:00', by: 'u1' } },
      ])
    );

    const events = empfangen.mock.calls[0][0];
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ id: 'e1', type: 'clockIn', at: '06:00' });
    expect(events[1].createdAt).toBeInstanceOf(Date);
  });

  it('liefert bei einem Fehler eine leere Liste statt zu werfen', async () => {
    const { listenToTimeEvents } = await lade();
    const empfangen = vi.fn();
    listenToTimeEvents('ts1', empfangen);

    errorCallback?.({ message: 'keine Berechtigung' });
    expect(empfangen).toHaveBeenCalledWith([]);
  });

  it('gibt eine Abmeldefunktion zurück', async () => {
    const { listenToTimeEvents } = await lade();
    expect(typeof listenToTimeEvents('ts1', vi.fn())).toBe('function');
  });
});

describe('buildCorrections', () => {
  it('erkennt eine geänderte Endzeit', async () => {
    const { buildCorrections } = await lade();
    const diff = buildCorrections(
      { startTime: '06:00', endTime: '14:00', breakMinutes: 30 },
      { startTime: '06:00', endTime: '15:00', breakMinutes: 30 }
    );
    expect(diff).toEqual([{ field: 'endTime', from: '14:00', to: '15:00' }]);
  });

  it('erkennt mehrere Änderungen gleichzeitig', async () => {
    const { buildCorrections } = await lade();
    const diff = buildCorrections(
      { startTime: '06:00', endTime: '14:00', breakMinutes: 30 },
      { startTime: '07:00', endTime: '15:00', breakMinutes: 45 }
    );
    expect(diff).toHaveLength(3);
  });

  it('liefert bei unveränderten Werten eine leere Liste', async () => {
    const { buildCorrections } = await lade();
    expect(
      buildCorrections(
        { startTime: '06:00', endTime: '14:00', breakMinutes: 30 },
        { startTime: '06:00', endTime: '14:00', breakMinutes: 30 }
      )
    ).toEqual([]);
  });
});
