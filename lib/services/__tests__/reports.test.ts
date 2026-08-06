import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests der Stundenauswertung (Zeitkonten + Mitarbeiterstatistik).
 * Diese Zahlen gehen an die Einsatzplanung und in die Nachweise – sie müssen
 * je Mitarbeiter stimmen, auch ohne userId-Filter.
 */

vi.mock('@/lib/firebase', () => ({
  db: {},
  getDb: vi.fn(() => ({})),
  auth: { currentUser: { uid: 'admin1' } },
  storage: {},
}));

vi.mock('@/lib/utils/companyId', () => ({
  getCompanyIdFromAuth: vi.fn(() => Promise.resolve('company123')),
}));

const getTimesheetsByDateRange = vi.fn();
const getUserById = vi.fn();
const getAllUsers = vi.fn();
const getAllAssignments = vi.fn();
const getShiftById = vi.fn();
const getFacilityById = vi.fn();

vi.mock('../timesheets', () => ({
  timesheetService: {
    getTimesheetsByDateRange: (...a: unknown[]) => getTimesheetsByDateRange(...a),
  },
}));
vi.mock('../users', () => ({
  userService: {
    getById: (...a: unknown[]) => getUserById(...a),
    getAll: (...a: unknown[]) => getAllUsers(...a),
  },
}));
vi.mock('../assignments', () => ({
  assignmentService: { getAll: (...a: unknown[]) => getAllAssignments(...a) },
}));
vi.mock('../shifts', () => ({
  shiftService: { getById: (...a: unknown[]) => getShiftById(...a) },
}));
vi.mock('../facilities', () => ({
  facilityService: { getById: (...a: unknown[]) => getFacilityById(...a) },
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({})),
  doc: vi.fn(() => ({})),
  addDoc: vi.fn(),
  updateDoc: vi.fn(),
  deleteDoc: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(async () => ({ docs: [], empty: true })),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}));

const nachweis = (overrides: Record<string, unknown> = {}) => ({
  id: 't1',
  userId: 'u1',
  date: new Date(2026, 6, 20),
  totalHours: 8,
  regularHours: 8,
  overtimeHours: 0,
  nightHours: 0,
  weekendHours: 0,
  holidayHours: 0,
  ...overrides,
});

const lade = async () => (await import('../reports')).reportService;

describe('generateTimeAccountReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserById.mockResolvedValue({ displayName: 'Anna Muster' });
  });

  it('summiert alle Stundenarten', async () => {
    getTimesheetsByDateRange.mockResolvedValue([
      nachweis({ totalHours: 8, regularHours: 8 }),
      nachweis({ id: 't2', totalHours: 10, regularHours: 8, overtimeHours: 2, nightHours: 3 }),
      nachweis({ id: 't3', totalHours: 6, regularHours: 6, weekendHours: 6, holidayHours: 2 }),
    ]);
    const reportService = await lade();
    const [report] = await reportService.generateTimeAccountReport({
      startDate: new Date(2026, 6, 20),
      endDate: new Date(2026, 6, 26),
    });

    expect(report.totalHours).toBe(24);
    expect(report.regularHours).toBe(22);
    expect(report.overtimeHours).toBe(2);
    expect(report.nightHours).toBe(3);
    expect(report.weekendHours).toBe(6);
    expect(report.holidayHours).toBe(2);
  });

  it('aggregiert je Mitarbeiter, auch ohne userId-Filter', async () => {
    getTimesheetsByDateRange.mockResolvedValue([
      nachweis({ userId: 'u1', totalHours: 8, regularHours: 8 }),
      nachweis({ id: 't2', userId: 'u1', totalHours: 4, regularHours: 4 }),
      nachweis({ id: 't3', userId: 'u2', totalHours: 20, regularHours: 16, overtimeHours: 4 }),
    ]);
    getUserById.mockImplementation(async (id: string) =>
      id === 'u1' ? { displayName: 'Anna' } : { displayName: 'Bea' }
    );
    const reportService = await lade();
    const [report] = await reportService.generateTimeAccountReport({
      startDate: new Date(2026, 6, 20),
      endDate: new Date(2026, 6, 26),
    });

    expect(report.employees).toHaveLength(2);
    // absteigend nach Stunden sortiert
    expect(report.employees[0]).toMatchObject({ userId: 'u2', userName: 'Bea', totalHours: 20 });
    expect(report.employees[1]).toMatchObject({ userId: 'u1', userName: 'Anna', totalHours: 12 });
  });

  it('setzt "Unbekannt", wenn der Name nicht auflösbar ist', async () => {
    getTimesheetsByDateRange.mockResolvedValue([nachweis()]);
    getUserById.mockRejectedValue(new Error('kein Zugriff'));
    const reportService = await lade();
    const [report] = await reportService.generateTimeAccountReport({
      startDate: new Date(2026, 6, 20),
      endDate: new Date(2026, 6, 26),
    });
    expect(report.employees[0].userName).toBe('Unbekannt');
  });

  it('liefert eine Tagesreihe für die Auswertung', async () => {
    getTimesheetsByDateRange.mockResolvedValue([
      nachweis({ date: new Date(Date.UTC(2026, 6, 20, 12)), totalHours: 8 }),
      nachweis({ id: 't2', date: new Date(Date.UTC(2026, 6, 21, 12)), totalHours: 6 }),
    ]);
    const reportService = await lade();
    const [report] = await reportService.generateTimeAccountReport({
      startDate: new Date(2026, 6, 20),
      endDate: new Date(2026, 6, 26),
    });
    expect(report.hoursByDay).toEqual([
      { day: '2026-07-20', totalHours: 8, regularHours: 8, overtimeHours: 0 },
      { day: '2026-07-21', totalHours: 6, regularHours: 8, overtimeHours: 0 },
    ]);
  });

  it('berechnet Durchschnitte über den Zeitraum', async () => {
    getTimesheetsByDateRange.mockResolvedValue([nachweis({ totalHours: 14 })]);
    const reportService = await lade();
    const [report] = await reportService.generateTimeAccountReport({
      startDate: new Date(2026, 6, 20),
      endDate: new Date(2026, 6, 27), // 7 Tage
    });
    expect(report.workingDays).toBe(7);
    expect(report.averageHoursPerDay).toBeCloseTo(2);
    expect(report.averageHoursPerWeek).toBeCloseTo(14);
  });

  it('kommt mit einem leeren Zeitraum zurecht', async () => {
    getTimesheetsByDateRange.mockResolvedValue([]);
    const reportService = await lade();
    const [report] = await reportService.generateTimeAccountReport({
      startDate: new Date(2026, 6, 20),
      endDate: new Date(2026, 6, 26),
    });
    expect(report.totalHours).toBe(0);
    expect(report.employees).toEqual([]);
    expect(report.hoursByDay).toEqual([]);
  });

  it('reicht Fehler der Datenschicht weiter', async () => {
    getTimesheetsByDateRange.mockRejectedValue(new Error('Firestore weg'));
    const reportService = await lade();
    await expect(
      reportService.generateTimeAccountReport({
        startDate: new Date(2026, 6, 20),
        endDate: new Date(2026, 6, 26),
      })
    ).rejects.toThrow('Firestore weg');
  });
});

describe('generateEmployeeStatistics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllUsers.mockResolvedValue({
      data: [
        { id: 'u1', active: true },
        { id: 'u2', active: true },
        { id: 'u3', active: false },
      ],
    });
    getAllAssignments.mockResolvedValue({ data: [] });
    getTimesheetsByDateRange.mockResolvedValue([]);
  });

  it('zählt Gesamt- und aktive Mitarbeiter', async () => {
    const reportService = await lade();
    const [stats] = await reportService.generateEmployeeStatistics({});
    expect(stats.totalEmployees).toBe(3);
    expect(stats.activeEmployees).toBe(2);
  });

  it('berechnet Durchschnittseinsätze und -stunden je Mitarbeiter', async () => {
    getAllAssignments.mockResolvedValue({
      data: [
        { id: 'a1', userId: 'u1', shiftId: 's1' },
        { id: 'a2', userId: 'u1', shiftId: 's1' },
        { id: 'a3', userId: 'u2', shiftId: 's1' },
      ],
    });
    getTimesheetsByDateRange.mockResolvedValue([
      nachweis({ userId: 'u1', totalHours: 30 }),
      nachweis({ id: 't2', userId: 'u2', totalHours: 10 }),
    ]);
    getShiftById.mockResolvedValue(null);
    const reportService = await lade();
    const [stats] = await reportService.generateEmployeeStatistics({});
    expect(stats.averageShiftsPerEmployee).toBe(2); // (2+1)/2 = 1,5 → gerundet 2
    expect(stats.averageHoursPerEmployee).toBe(20);
  });

  it('gruppiert Mitarbeiter nach Einrichtung', async () => {
    getAllAssignments.mockResolvedValue({
      data: [
        { id: 'a1', userId: 'u1', shiftId: 's1' },
        { id: 'a2', userId: 'u2', shiftId: 's1' },
        { id: 'a3', userId: 'u1', shiftId: 's2' },
      ],
    });
    getShiftById.mockImplementation(async (id: string) =>
      id === 's1' ? { id: 's1', facilityId: 'f1' } : { id: 's2', facilityId: 'f2' }
    );
    getFacilityById.mockImplementation(async (id: string) =>
      id === 'f1' ? { id: 'f1', name: 'Haus Sonnenschein' } : { id: 'f2', name: 'Seniorenstift' }
    );
    const reportService = await lade();
    const [stats] = await reportService.generateEmployeeStatistics({});
    expect(stats.employeesByFacility).toEqual([
      { facility: 'Haus Sonnenschein', count: 2 },
      { facility: 'Seniorenstift', count: 1 },
    ]);
  });

  it('überspringt Einsätze mit nicht ladbarer Einrichtung', async () => {
    getAllAssignments.mockResolvedValue({ data: [{ id: 'a1', userId: 'u1', shiftId: 's1' }] });
    getShiftById.mockRejectedValue(new Error('Schicht weg'));
    const reportService = await lade();
    const [stats] = await reportService.generateEmployeeStatistics({});
    expect(stats.employeesByFacility).toEqual([]);
  });

  it('kommt ohne Einsätze und Nachweise zurecht', async () => {
    const reportService = await lade();
    const [stats] = await reportService.generateEmployeeStatistics({});
    expect(stats.averageShiftsPerEmployee).toBe(0);
    expect(stats.averageHoursPerEmployee).toBe(0);
    expect(stats.topPerformers).toBe(0);
  });

  it('reicht Fehler weiter', async () => {
    getAllUsers.mockRejectedValue(new Error('kein Zugriff'));
    const reportService = await lade();
    await expect(reportService.generateEmployeeStatistics({})).rejects.toThrow('kein Zugriff');
  });
});
