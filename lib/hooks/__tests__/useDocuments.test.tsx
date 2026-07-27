import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Dokumenten-Hook des Mitarbeiters: Upload in den Storage, Prüfung/Ablehnung
 * durch die Verwaltung sowie die Ablauf-Logik (30-Tage-Vorwarnung).
 */

const mockUser = { id: 'u1', companyId: 'firmaA', role: 'nurse' };
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }));

const getByUserId = vi.fn();
const createDocument = vi.fn();
const updateDocument = vi.fn();
const deleteDocument = vi.fn();
const verifyDocument = vi.fn();
vi.mock('@/lib/services', () => ({
  documentService: {
    getByUserId: (...a: unknown[]) => getByUserId(...a),
    create: (...a: unknown[]) => createDocument(...a),
    update: (...a: unknown[]) => updateDocument(...a),
    delete: (...a: unknown[]) => deleteDocument(...a),
    verify: (...a: unknown[]) => verifyDocument(...a),
  },
}));

const uploadFile = vi.fn();
vi.mock('@/lib/services/firebaseStorage', () => ({
  firebaseStorageService: {
    uploadFile: (...a: unknown[]) => uploadFile(...a),
    generateFileName: vi.fn((name: string, prefix: string) => `${prefix}_${name}`),
  },
}));

import { useDocuments } from '../useDocuments';

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(QueryClientProvider, { client }, children);

const dokument = (overrides: Record<string, unknown> = {}) => ({
  id: 'd1',
  userId: 'u1',
  type: 'certificate',
  name: 'Führungszeugnis',
  url: 'https://storage.example/d1.pdf',
  ...overrides,
});

/** Datumshelfer relativ zu heute – echte Timer, damit React Query lädt. */
const inTagen = (tage: number) => {
  const d = new Date();
  d.setDate(d.getDate() + tage);
  return d;
};

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  getByUserId.mockResolvedValue([]);
  uploadFile.mockResolvedValue({
    url: 'https://storage.example/neu.pdf',
    size: 2048,
    contentType: 'application/pdf',
  });
  createDocument.mockResolvedValue('d9');
  updateDocument.mockResolvedValue(undefined);
  deleteDocument.mockResolvedValue(undefined);
  verifyDocument.mockResolvedValue(undefined);
});

describe('Laden und Mutationen', () => {
  it('lädt die Dokumente des Mitarbeiters', async () => {
    getByUserId.mockResolvedValue([dokument()]);
    const { result } = renderHook(() => useDocuments(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.documents).toHaveLength(1);
    expect(getByUserId).toHaveBeenCalledWith('u1');
  });

  it('lädt eine Datei hoch und legt das Dokument an', async () => {
    const { result } = renderHook(() => useDocuments(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const datei = new File(['x'], 'zeugnis.pdf', { type: 'application/pdf' });
    await act(async () => {
      await result.current.uploadDocument.mutateAsync({
        type: 'Qualifikation',
        name: 'Fachweiterbildung',
        expiresAt: inTagen(365),
        file: datei,
      } as never);
    });

    expect(uploadFile).toHaveBeenCalledWith(datei, 'documents/u1/doc_zeugnis.pdf');
    expect(createDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        type: 'certificate',
        name: 'Fachweiterbildung',
        url: 'https://storage.example/neu.pdf',
        fileSize: 2048,
        mimeType: 'application/pdf',
      })
    );
  });

  it('bildet die Formulartypen auf die Service-Typen ab', async () => {
    const { result } = renderHook(() => useDocuments(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const datei = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    for (const [formular, erwartet] of [
      ['Impfung', 'vaccination'],
      ['Gesundheit', 'certificate'],
      ['Sonstiges', 'other'],
    ] as const) {
      createDocument.mockClear();
      await act(async () => {
        await result.current.uploadDocument.mutateAsync({
          type: formular,
          name: 'x',
          file: datei,
        } as never);
      });
      expect(createDocument).toHaveBeenCalledWith(expect.objectContaining({ type: erwartet }));
    }
  });

  it('aktualisiert und löscht Dokumente', async () => {
    const { result } = renderHook(() => useDocuments(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateDocument.mutateAsync({
        id: 'd1',
        data: { name: 'Neuer Name', type: 'Impfung' } as never,
      });
      await result.current.deleteDocument.mutateAsync('d1');
    });

    expect(updateDocument).toHaveBeenCalledWith(
      'd1',
      expect.objectContaining({ name: 'Neuer Name', type: 'vaccination' })
    );
    expect(deleteDocument).toHaveBeenCalledWith('d1');
  });

  it('prüft und lehnt Dokumente ab', async () => {
    const { result } = renderHook(() => useDocuments(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.verifyDocument.mutateAsync({ id: 'd1', verifiedBy: 'admin1' });
      await result.current.rejectDocument.mutateAsync({
        id: 'd1',
        rejectionReason: 'unleserlich',
      });
    });

    expect(verifyDocument).toHaveBeenNthCalledWith(1, 'd1', 'admin1');
    expect(verifyDocument).toHaveBeenNthCalledWith(2, 'd1', 'u1', 'unleserlich');
  });
});

describe('Ablauf-Logik', () => {
  it('bewertet gültig, ablaufend und abgelaufen', async () => {
    const { result } = renderHook(() => useDocuments(), { wrapper });

    expect(result.current.getDocumentStatus(dokument() as never)).toBe('valid');
    expect(
      result.current.getDocumentStatus(dokument({ expiryDate: inTagen(365) }) as never)
    ).toBe('valid');
    // innerhalb der 30-Tage-Vorwarnung
    expect(
      result.current.getDocumentStatus(dokument({ expiryDate: inTagen(10) }) as never)
    ).toBe('expiring');
    expect(
      result.current.getDocumentStatus(dokument({ expiryDate: inTagen(-30) }) as never)
    ).toBe('expired');
  });

  it('filtert nach Status und liefert die bald ablaufenden Dokumente', async () => {
    getByUserId.mockResolvedValue([
      dokument({ id: 'gueltig' }),
      dokument({ id: 'bald', expiryDate: inTagen(10) }),
      dokument({ id: 'weg', expiryDate: inTagen(-30) }),
    ]);
    const { result } = renderHook(() => useDocuments(), { wrapper });
    await waitFor(() => expect(result.current.documents).toHaveLength(3));

    expect(result.current.getDocumentsByStatus('valid').map(d => d.id)).toEqual(['gueltig']);
    expect(result.current.getExpiringDocuments().map(d => d.id)).toEqual(['bald', 'weg']);
  });

  it('liefert Farben und Beschriftungen für Status und Typen', async () => {
    const { result } = renderHook(() => useDocuments(), { wrapper });

    expect(result.current.getStatusColor('valid')).toBe('success');
    expect(result.current.getStatusColor('expiring')).toBe('warning');
    expect(result.current.getStatusColor('expired')).toBe('error');
    expect(result.current.getStatusColor('x')).toBe('default');

    expect(result.current.getStatusLabel('valid')).toBe('Gültig');
    expect(result.current.getStatusLabel('expiring')).toBe('Läuft bald ab');
    expect(result.current.getStatusLabel('expired')).toBe('Abgelaufen');
    expect(result.current.getStatusLabel('x')).toBe('Unbekannt');

    expect(result.current.getDocumentTypeColor('Impfpass')).toBe('#4CAF50');
    expect(result.current.getDocumentTypeColor('Arbeitszeugnis')).toBe('#2196F3');
    expect(result.current.getDocumentTypeColor('Qualifikation')).toBe('#FF9800');
    expect(result.current.getDocumentTypeColor('Zertifikat')).toBe('#9C27B0');
    expect(result.current.getDocumentTypeColor('Sonstiges')).toBe('#607D8B');
    expect(result.current.getDocumentTypeColor('unbekannt')).toBe('#666');
  });

  it('formatiert Dateigrößen lesbar', async () => {
    const { result } = renderHook(() => useDocuments(), { wrapper });

    expect(result.current.formatFileSize(0)).toBe('0 Bytes');
    expect(result.current.formatFileSize(512)).toBe('512 Bytes');
    expect(result.current.formatFileSize(2048)).toBe('2 KB');
    expect(result.current.formatFileSize(1048576)).toBe('1 MB');
  });
});
