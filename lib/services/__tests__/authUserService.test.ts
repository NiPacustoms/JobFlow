import { beforeEach, describe, expect, it, vi } from 'vitest';
import { harness, firestoreModuleMock, ts } from './helpers/firestoreHarness';

/**
 * Auth-Nutzerdienst: Profil laden/anlegen und Rolle aus den Custom Claims.
 * Sicherheitsrelevant – die Rolle im Token schlägt das Feld im Dokument.
 */

vi.mock('@/lib/firebase', () => ({ db: {}, getDb: vi.fn(() => ({})) }));
vi.mock('firebase/firestore', () => firestoreModuleMock());

const lade = async () => await import('../authUserService');

const firebaseUser = (overrides: Record<string, unknown> = {}) =>
  ({
    uid: 'u1',
    email: 'anna@aufabruf.eu',
    displayName: 'Anna Muster',
    getIdTokenResult: vi.fn(async () => ({
      claims: { role: 'nurse', companyId: 'firmaA' },
      expirationTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })),
    getIdToken: vi.fn(async () => 'token'),
    ...overrides,
  }) as never;

const nutzerDoc = (daten: Record<string, unknown> = {}) => ({
  id: 'u1',
  data: {
    email: 'anna@aufabruf.eu',
    displayName: 'Anna Muster',
    role: 'nurse',
    companyId: 'firmaA',
    active: true,
    qualifications: [],
    documents: [],
    createdAt: ts(new Date(2026, 0, 1)),
    updatedAt: ts(new Date(2026, 6, 1)),
    ...daten,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  harness.reset();
});

describe('buildFallbackUserWithClaims', () => {
  it('übernimmt Rolle und Firma aus den Claims', async () => {
    const { buildFallbackUserWithClaims } = await lade();
    const user = await buildFallbackUserWithClaims(
      firebaseUser({
        getIdTokenResult: vi.fn(async () => ({ claims: { role: 'admin', companyId: 'firmaB' } })),
      })
    );
    expect(user).toMatchObject({ id: 'u1', role: 'admin', companyId: 'firmaB', active: true });
  });

  it('fällt bei unbekannter Rolle auf "nurse" zurück', async () => {
    const { buildFallbackUserWithClaims } = await lade();
    const user = await buildFallbackUserWithClaims(
      firebaseUser({
        getIdTokenResult: vi.fn(async () => ({ claims: { role: 'superuser' } })),
      })
    );
    expect(user.role).toBe('nurse');
  });

  it('kommt ohne lesbare Claims aus', async () => {
    const { buildFallbackUserWithClaims } = await lade();
    const user = await buildFallbackUserWithClaims(
      firebaseUser({
        getIdTokenResult: vi.fn(async () => {
          throw new Error('Token abgelaufen');
        }),
      })
    );
    expect(user.role).toBe('nurse');
    expect(user.id).toBe('u1');
  });

  it('leitet den Anzeigenamen aus der E-Mail ab', async () => {
    const { buildFallbackUserWithClaims } = await lade();
    const user = await buildFallbackUserWithClaims(
      firebaseUser({ displayName: null, email: 'bea@aufabruf.eu' })
    );
    expect(user.displayName).toBe('bea');
  });

  it('nutzt einen Platzhalter ohne Name und E-Mail', async () => {
    const { buildFallbackUserWithClaims } = await lade();
    const user = await buildFallbackUserWithClaims(firebaseUser({ displayName: null, email: null }));
    expect(user.displayName).toBe('Unbekannter Benutzer');
    expect(user.email).toBe('');
  });
});

describe('getOrCreateAuthUser', () => {
  it('liest ein vorhandenes Nutzerdokument', async () => {
    harness.setDoc(nutzerDoc());
    const { getOrCreateAuthUser } = await lade();
    const user = await getOrCreateAuthUser(firebaseUser());
    expect(user).toMatchObject({ id: 'u1', email: 'anna@aufabruf.eu', role: 'nurse' });
  });

  it('legt ein Dokument an, wenn keines existiert', async () => {
    harness.setDoc(null);
    const { getOrCreateAuthUser } = await lade();
    await getOrCreateAuthUser(firebaseUser());
    expect(harness.writes.some(w => w.art === 'set' || w.art === 'add')).toBe(true);
  });
});

describe('applyClaimsToUser', () => {
  const basisUser = {
    id: 'u1',
    email: 'anna@aufabruf.eu',
    displayName: 'Anna',
    role: 'nurse' as const,
    companyId: 'firmaA',
    active: true,
    qualifications: [],
    documents: [],
    notificationSettings: {
      emailNotifications: true,
      pushNotifications: true,
      shiftReminders: true,
      documentExpiry: true,
      systemAnnouncements: true,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('übernimmt die Rolle aus dem Token', async () => {
    const { applyClaimsToUser } = await lade();
    const user = await applyClaimsToUser(
      firebaseUser({
        getIdTokenResult: vi.fn(async () => ({
          claims: { role: 'admin' },
          expirationTime: new Date(Date.now() + 3600_000).toISOString(),
        })),
      }),
      basisUser as never
    );
    expect(user.role).toBe('admin');
  });

  it('behält die Dokumentrolle, wenn das Token keine Rolle nennt', async () => {
    const { applyClaimsToUser } = await lade();
    const user = await applyClaimsToUser(
      firebaseUser({
        getIdTokenResult: vi.fn(async () => ({
          claims: {},
          expirationTime: new Date(Date.now() + 3600_000).toISOString(),
        })),
      }),
      basisUser as never
    );
    expect(user.role).toBe('nurse');
  });

  it('korrigiert eine unzulässige Dokumentrolle auf "nurse"', async () => {
    const { applyClaimsToUser } = await lade();
    const user = await applyClaimsToUser(
      firebaseUser({
        getIdTokenResult: vi.fn(async () => ({
          claims: {},
          expirationTime: new Date(Date.now() + 3600_000).toISOString(),
        })),
      }),
      { ...basisUser, role: 'superuser' } as never
    );
    expect(user.role).toBe('nurse');
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({ role: 'nurse' });
  });

  it('erneuert einen bald ablaufenden Token', async () => {
    const getIdToken = vi.fn(async () => 'neu');
    const { applyClaimsToUser } = await lade();
    await applyClaimsToUser(
      firebaseUser({
        getIdToken,
        getIdTokenResult: vi.fn(async () => ({
          claims: { role: 'nurse' },
          expirationTime: new Date(Date.now() + 60_000).toISOString(),
        })),
      }),
      basisUser as never
    );
    expect(getIdToken).toHaveBeenCalledWith(true);
  });

  it('arbeitet weiter, wenn der Token nicht lesbar ist', async () => {
    const { applyClaimsToUser } = await lade();
    const user = await applyClaimsToUser(
      firebaseUser({
        getIdTokenResult: vi.fn(async () => {
          throw new Error('400 Bad Request');
        }),
      }),
      basisUser as never
    );
    expect(user.role).toBe('nurse');
  });
});

describe('loadUserForAuth', () => {
  it('liefert das Profil inklusive Claims', async () => {
    harness.setDoc(nutzerDoc());
    const { loadUserForAuth } = await lade();
    const user = await loadUserForAuth(firebaseUser());
    expect(user).toMatchObject({ id: 'u1', role: 'nurse' });
  });
});

describe('updateAuthUserProfile', () => {
  it('schreibt die Profiländerung', async () => {
    const { updateAuthUserProfile } = await lade();
    await updateAuthUserProfile('u1', { displayName: 'Anna Neu' } as never);
    expect(harness.writes.find(w => w.art === 'update')?.daten).toMatchObject({
      displayName: 'Anna Neu',
    });
  });
});

describe('getOrCreateAuthUser – Sonderfälle', () => {
  it('ergänzt eine fehlende companyId mit der Einzelfirma', async () => {
    harness.setDoc(nutzerDoc({ companyId: undefined }));
    const { getOrCreateAuthUser } = await lade();

    const user = await getOrCreateAuthUser(firebaseUser());
    expect(user?.companyId).toBeTruthy();
    // Nachtrag wird ins Dokument geschrieben
    expect(
      harness.writes.some(
        w => w.art === 'update' && (w.daten as Record<string, unknown>).companyId !== undefined
      )
    ).toBe(true);
  });

  it('korrigiert eine unzulässige Rolle im Dokument', async () => {
    harness.setDoc(nutzerDoc({ role: 'superuser' }));
    const { getOrCreateAuthUser } = await lade();

    const user = await getOrCreateAuthUser(firebaseUser());
    expect(user?.role).toBe('admin');
    expect(
      harness.writes.some(w => (w.daten as Record<string, unknown>)?.role === 'admin')
    ).toBe(true);
  });

  it('übernimmt eine benutzerdefinierte Rollen-ID', async () => {
    harness.setDoc(nutzerDoc({ customRoleId: 'rolle-disponent' }));
    const { getOrCreateAuthUser } = await lade();

    const user = await getOrCreateAuthUser(firebaseUser());
    expect(user?.customRoleId).toBe('rolle-disponent');
  });

  it('setzt Vorgabewerte für fehlende Profilfelder', async () => {
    harness.setDoc({ id: 'u1', data: { role: 'nurse', companyId: 'firmaA' } });
    const { getOrCreateAuthUser } = await lade();

    const user = await getOrCreateAuthUser(firebaseUser());
    expect(user).toMatchObject({
      email: '',
      displayName: '',
      qualifications: [],
      documents: [],
      active: true,
    });
    expect(user?.notificationSettings).toBeTruthy();
    expect(user?.createdAt).toBeInstanceOf(Date);
  });

  it('behandelt active=false korrekt', async () => {
    harness.setDoc(nutzerDoc({ active: false }));
    const { getOrCreateAuthUser } = await lade();

    const user = await getOrCreateAuthUser(firebaseUser());
    expect(user?.active).toBe(false);
  });

  it('liefert null, wenn das Dokument nach der Anlage weiterhin fehlt', async () => {
    harness.setDoc(null);
    const { getOrCreateAuthUser } = await lade();

    await expect(getOrCreateAuthUser(firebaseUser())).resolves.toBeNull();
  });
});
