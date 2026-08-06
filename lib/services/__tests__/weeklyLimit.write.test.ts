import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Wochenstunden-Limit (§ Arbeitszeitrecht/Vertrag): Admin setzt das Limit,
 * genehmigt Erhöhungen. Der Limit-Status wird immer aus der aktuellen Woche
 * neu berechnet – sonst blockiert oder erlaubt die App falsch.
 */

const getDocMock = vi.fn();
const updateDocMock = vi.fn(async () => undefined);
vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, sammlung: string, id: string) => ({ pfad: `${sammlung}/${id}` })),
  getDoc: (...a: unknown[]) => getDocMock(...a),
  updateDoc: (...a: unknown[]) => updateDocMock(...a),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}));

const getDbMock = vi.fn(() => ({}));
vi.mock('@/lib/firebase', () => ({ getDb: () => getDbMock() }));

const calculateWeeklyHours = vi.fn();
vi.mock('@/lib/services/timesheets/calculateWeeklyHours', () => ({
  calculateWeeklyHours: (...a: unknown[]) => calculateWeeklyHours(...a),
  getStartOfWeek: vi.fn((d: Date) => d),
}));

vi.mock('@/lib/logging', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { writeWeeklyLimit, addLimitGenehmigung } from '../employees/writeWeeklyLimit';

beforeEach(() => {
  vi.clearAllMocks();
  getDbMock.mockReturnValue({});
  getDocMock.mockResolvedValue({ exists: () => true, data: () => ({}) });
  calculateWeeklyHours.mockResolvedValue({ wochenstunden: 32.005 });
});

describe('writeWeeklyLimit', () => {
  it('setzt das Limit und berechnet den Status aus der aktuellen Woche', async () => {
    await writeWeeklyLimit('u1', 40);

    expect(updateDocMock).toHaveBeenCalledWith(
      expect.objectContaining({ pfad: 'users/u1' }),
      expect.objectContaining({
        wochenstundenLimit: 40,
        aktuelleWochenstunden: 32.01, // auf zwei Stellen gerundet
        limitStatus: 'normal',
        updatedAt: 'SERVER_TIMESTAMP',
      })
    );
  });

  it('warnt, wenn die Woche nahe am Limit liegt', async () => {
    calculateWeeklyHours.mockResolvedValue({ wochenstunden: 38 });
    await writeWeeklyLimit('u1', 40);

    const daten = updateDocMock.mock.calls[0][1] as { limitStatus: string };
    expect(daten.limitStatus).toBe('warning');
  });

  it('blockiert bei erreichtem Limit', async () => {
    calculateWeeklyHours.mockResolvedValue({ wochenstunden: 41 });
    await writeWeeklyLimit('u1', 40);

    const daten = updateDocMock.mock.calls[0][1] as { limitStatus: string };
    expect(daten.limitStatus).toBe('blocked');
  });

  it.each([19, 81, 0, -5])('lehnt das unzulässige Limit %i ab', async limit => {
    await expect(writeWeeklyLimit('u1', limit)).rejects.toThrow('zwischen 20 und 80');
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it.each([20, 80])('akzeptiert den Randwert %i', async limit => {
    await expect(writeWeeklyLimit('u1', limit)).resolves.toBeUndefined();
  });

  it('wirft ohne Firestore oder ohne Mitarbeiter', async () => {
    getDbMock.mockReturnValue(null as never);
    await expect(writeWeeklyLimit('u1', 40)).rejects.toThrow('Firebase nicht initialisiert');

    getDbMock.mockReturnValue({});
    getDocMock.mockResolvedValue({ exists: () => false });
    await expect(writeWeeklyLimit('u1', 40)).rejects.toThrow('Mitarbeiter nicht gefunden');
  });
});

describe('addLimitGenehmigung', () => {
  it('hängt eine Genehmigung an und setzt das neue Limit', async () => {
    await addLimitGenehmigung('u1', 'admin1', 48);

    const daten = updateDocMock.mock.calls[0][1] as {
      wochenstundenLimit: number;
      limitGenehmigungen: Array<{ adminId: string; neuesLimit: number; datum: Date }>;
    };
    expect(daten.wochenstundenLimit).toBe(48);
    expect(daten.limitGenehmigungen).toHaveLength(1);
    expect(daten.limitGenehmigungen[0]).toMatchObject({ adminId: 'admin1', neuesLimit: 48 });
    expect(daten.limitGenehmigungen[0].datum).toBeInstanceOf(Date);
  });

  it('behält bestehende Genehmigungen und wandelt Firestore-Zeitstempel um', async () => {
    const frueher = new Date(2026, 5, 1);
    getDocMock.mockResolvedValue({
      exists: () => true,
      data: () => ({
        limitGenehmigungen: [
          { adminId: 'admin0', neuesLimit: 44, datum: { toDate: () => frueher } },
          { adminId: 'admin0', neuesLimit: 42 }, // ohne Datum → jetzt
        ],
      }),
    });

    await addLimitGenehmigung('u1', 'admin1', 48);

    const daten = updateDocMock.mock.calls[0][1] as {
      limitGenehmigungen: Array<{ adminId: string; neuesLimit: number; datum: Date }>;
    };
    expect(daten.limitGenehmigungen).toHaveLength(3);
    expect(daten.limitGenehmigungen[0].datum).toEqual(frueher);
    expect(daten.limitGenehmigungen[1].datum).toBeInstanceOf(Date);
    expect(daten.limitGenehmigungen[2].adminId).toBe('admin1');
  });

  it('lehnt unzulässige neue Limits ab', async () => {
    await expect(addLimitGenehmigung('u1', 'admin1', 90)).rejects.toThrow('zwischen 20 und 80');
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('wirft ohne Firestore oder ohne Mitarbeiter', async () => {
    getDbMock.mockReturnValue(null as never);
    await expect(addLimitGenehmigung('u1', 'admin1', 48)).rejects.toThrow(
      'Firebase nicht initialisiert'
    );

    getDbMock.mockReturnValue({});
    getDocMock.mockResolvedValue({ exists: () => false });
    await expect(addLimitGenehmigung('u1', 'admin1', 48)).rejects.toThrow(
      'Mitarbeiter nicht gefunden'
    );
  });
});
