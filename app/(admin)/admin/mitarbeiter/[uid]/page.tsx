'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorDisplay } from '@/components/ui/ErrorBoundary';
import { PageContainer } from '@/components/layout/PageContainer';
import { userService } from '@/lib/services/users';
import { timesheetService } from '@/lib/services/timesheets';
import { assignmentService } from '@/lib/services/assignments';
import { documentService } from '@/lib/services/documents';
import type { Document as ServiceDocument } from '@/lib/services/documents';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/contexts/PermissionsContext';
import { EncryptionService } from '@/lib/services/encryption';
import { firebaseStorageService } from '@/lib/services/firebaseStorage';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Tabs,
  Tab,
  Chip,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Paper,
} from '@mui/material';
import { Button } from '@mui/material';
import { Upload, Edit, Download } from '@mui/icons-material';
import { format } from 'date-fns';
import { StaffEditDialog } from '@/components/admin/StaffEditDialog';
import { WeeklyLimitKpi } from '@/components/admin/WeeklyLimitKpi';
import { WeeklyLimitSetter } from '@/components/admin/WeeklyLimitSetter';
import type { User } from '@/lib/types';
import { roleLabelMap } from '@/lib/validations/staff';
import { de } from 'date-fns/locale';
import { DocumentUpload } from '@/components/documents/DocumentUpload';
import type { DocumentUploadForm } from '@/lib/types';
import { toast } from '@/lib/utils/toast';

export default function AdminEmployeeDetailPage() {
  const params = useParams<{ uid: string }>();
  const uid = params?.uid;
  const [tab, setTab] = useState(0);
  const [showIban, setShowIban] = useState(false);
  const [showDocumentUpload, setShowDocumentUpload] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const exportUserData = async () => {
    if (!uid) return;
    setIsExporting(true);
    try {
      const { getAuth } = await import('firebase/auth');
      const currentUser = getAuth().currentUser;
      if (!currentUser) throw new Error('Nicht angemeldet');
      const token = await currentUser.getIdToken();
      const response = await fetch(`/api/admin/user/${uid}/data-export`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(
          (error as { message?: string }).message || 'Fehler beim Exportieren'
        );
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `schichtklar-data-export-${uid}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success('Datenexport heruntergeladen (DSGVO Art. 15).');
    } catch (error) {
      toast.error(
        `Datenexport fehlgeschlagen: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`
      );
    } finally {
      setIsExporting(false);
    }
  };
  const { user: authUser } = useAuth();
  const { hasPermission } = usePermissions();
  const queryClient = useQueryClient();

  const updateStaffMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<User> }) => {
      await userService.update(id, data as Parameters<typeof userService.update>[1]);
    },
    onSuccess: () => {
      if (uid) queryClient.invalidateQueries({ queryKey: ['admin-employee', uid] });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('Mitarbeiter aktualisiert');
      setEditDialogOpen(false);
    },
    onError: (error: unknown) => {
      const msg = error instanceof Error ? error.message : 'Unbekannter Fehler';
      toast.error(`Fehler beim Speichern: ${msg}`);
    },
  });

  const handleEditStaff = (staffData: Partial<User>) => {
    if (!uid) return;
    const processedData = { ...staffData };
    if (
      processedData.bankAccount?.iban &&
      typeof processedData.bankAccount.iban === 'string' &&
      processedData.bankAccount.iban.length <= 30
    ) {
      processedData.bankAccount = {
        ...processedData.bankAccount,
        iban: processedData.bankAccount.iban.replace(/\s+/g, '').toUpperCase(),
      };
    }
    updateStaffMutation.mutate({ id: uid, data: processedData });
  };

  const userQuery = useQuery({
    queryKey: ['admin-employee', uid],
    queryFn: async () => (uid ? await userService.getById(uid) : null),
    enabled: !!uid,
  });

  const timesheetsQuery = useQuery({
    queryKey: ['admin-employee-timesheets', uid],
    queryFn: async () => (uid ? await timesheetService.getByUserId(uid) : []),
    enabled: !!uid,
  });

  const assignmentsQuery = useQuery({
    queryKey: ['admin-employee-assignments', uid],
    queryFn: async () => (uid ? await assignmentService.getByUserId(uid) : []),
    enabled: !!uid,
  });

  const documentsQuery = useQuery({
    queryKey: ['admin-employee-documents', uid],
    queryFn: async () => (uid ? await documentService.getByUserId(uid) : []),
    enabled: !!uid,
  });

  const mapFormTypeToServiceType = (type: string): ServiceDocument['type'] => {
    switch (type) {
      case 'Impfung':
        return 'vaccination';
      case 'Qualifikation':
      case 'Gesundheit':
        return 'certificate';
      case 'Vertrag':
        return 'contract';
      case 'Ausweis':
      case 'ID':
        return 'id_card';
      default: {
        const allowed: ServiceDocument['type'][] = [
          'certificate',
          'id_card',
          'vaccination',
          'contract',
          'other',
        ];
        return allowed.includes(type as ServiceDocument['type'])
          ? (type as ServiceDocument['type'])
          : 'other';
      }
    }
  };

  const uploadDocumentMutation = useMutation({
    mutationFn: async (data: DocumentUploadForm) => {
      if (!uid) {
        throw new Error('Kein Mitarbeiter ausgewählt');
      }

      const upload = await firebaseStorageService.uploadFile(
        data.file,
        `documents/${uid}/${firebaseStorageService.generateFileName(data.file.name, 'doc')}`
      );

      return await documentService.create({
        userId: uid,
        type: mapFormTypeToServiceType(data.type),
        name: data.name,
        url: upload.url,
        fileSize: upload.size,
        mimeType: upload.contentType,
        expiryDate: data.expiresAt,
      });
    },
    onSuccess: async () => {
      if (uid) {
        await queryClient.invalidateQueries({ queryKey: ['admin-employee-documents', uid] });
      }
      toast.success('Dokument erfolgreich hochgeladen');
      setShowDocumentUpload(false);
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
      toast.error(`Fehler beim Hochladen: ${message}`);
    },
  });

  const handleDocumentUpload = (data: DocumentUploadForm) => {
    uploadDocumentMutation.mutate(data);
  };

  const loading =
    userQuery.isLoading ||
    timesheetsQuery.isLoading ||
    assignmentsQuery.isLoading ||
    documentsQuery.isLoading;
  const error =
    userQuery.error || timesheetsQuery.error || assignmentsQuery.error || documentsQuery.error;

  const monthlyHours = useMemo(() => {
    const map: Record<string, number> = {};
    (timesheetsQuery.data || []).forEach(ts => {
      const date = ts.date instanceof Date ? ts.date : new Date(ts.date);
      const key = format(date, 'yyyy-MM', { locale: de });
      map[key] = (map[key] || 0) + (ts.totalHours || 0);
    });
    return Object.entries(map).slice(-6);
  }, [timesheetsQuery.data]);

  if (loading) return <LoadingSpinner message="Mitarbeiterdaten werden geladen..." />;
  if (error) return <ErrorDisplay error={error as Error} />;
  if (!userQuery.data) return null;

  const user = userQuery.data;
  const workingHoursPerWeek = user.workingHoursPerWeek ?? 0;

  const formatUserDate = (d: Date | undefined) =>
    d ? format(d, 'dd.MM.yyyy', { locale: de }) : '-';

  return (
    <>
      <PageContainer maxWidth="wide">
        <Box sx={{ mb: 3, display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 700 }}>
              {user.displayName || 'Mitarbeiter'}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
              <Chip
                label={roleLabelMap[user.role] || user.role}
                color="primary"
                size="small"
              />
              <Chip
                label={user.active ? 'Aktiv' : 'Inaktiv'}
                color={user.active ? 'success' : 'default'}
                size="small"
              />
            </Box>
          </Box>
          {hasPermission('manage_staff') && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                variant="outlined"
                startIcon={<Download />}
                onClick={exportUserData}
                disabled={isExporting}
              >
                {isExporting ? 'Exportiere…' : 'Datenexport (DSGVO)'}
              </Button>
              <Button
                variant="outlined"
                startIcon={<Edit />}
                onClick={() => setEditDialogOpen(true)}
              >
                Bearbeiten
              </Button>
            </Box>
          )}
        </Box>

        <Card className="glass" sx={{ mb: 3 }}>
          <CardContent>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 3 }}>
                <Typography variant="body2" color="text.secondary">
                  E-Mail
                </Typography>
                <Typography variant="body1">{user.email || '-'}</Typography>
              </Grid>
              <Grid size={{ xs: 12, md: 3 }}>
                <Typography variant="body2" color="text.secondary">
                  Telefon
                </Typography>
                <Typography variant="body1">{user.phone || '-'}</Typography>
              </Grid>
              <Grid size={{ xs: 12, md: 3 }}>
                <Typography variant="body2" color="text.secondary">
                  Arbeitsstunden/Woche
                </Typography>
                <Typography variant="body1">{workingHoursPerWeek}h</Typography>
              </Grid>
              <Grid size={{ xs: 12, md: 3 }}>
                <Typography variant="body2" color="text.secondary">
                  Berufsbezeichnung
                </Typography>
                <Typography variant="body1">{user.jobTitle || '-'}</Typography>
              </Grid>
              <Grid size={{ xs: 12, md: 3 }}>
                <Typography variant="body2" color="text.secondary">
                  Gruppe/Abteilung
                </Typography>
                <Typography variant="body1">{user.group || '-'}</Typography>
              </Grid>
              <Grid size={{ xs: 12, md: 3 }}>
                <Typography variant="body2" color="text.secondary">
                  Mitglied seit
                </Typography>
                <Typography variant="body1">
                  {formatUserDate(user.createdAt instanceof Date ? user.createdAt : new Date(user.createdAt))}
                </Typography>
              </Grid>
              <Grid size={{ xs: 12, md: 3 }}>
                <Typography variant="body2" color="text.secondary">
                  Letzte Aktualisierung
                </Typography>
                <Typography variant="body1">
                  {formatUserDate(user.updatedAt instanceof Date ? user.updatedAt : new Date(user.updatedAt))}
                </Typography>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {hasPermission('manage_staff') && uid && (
          <Grid container spacing={3} sx={{ mb: 3 }}>
            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
              <WeeklyLimitKpi mitarbeiterId={uid} mitarbeiterName={user.displayName} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 4 }}>
              <WeeklyLimitSetter
                employee={{
                  id: user.id,
                  displayName: user.displayName ?? '',
                  wochenstundenLimit: user.wochenstundenLimit,
                  aktuelleWochenstunden: user.aktuelleWochenstunden,
                  limitStatus: user.limitStatus,
                }}
                compact
              />
            </Grid>
          </Grid>
        )}

        <Paper className="glass" sx={{ mb: 3 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)}>
            <Tab label="Übersicht" />
            <Tab label="Zeiterfassung" />
            <Tab label="Zuweisungen" />
            <Tab label="Dokumente" />
            <Tab label="Profil" />
          </Tabs>
        </Paper>

        {tab === 0 && (
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Card className="glass">
                <CardContent>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    Stunden (letzte 6 Monate)
                  </Typography>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Monat</TableCell>
                        <TableCell align="right">Stunden</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {monthlyHours.map(([month, hours]) => (
                        <TableRow key={month}>
                          <TableCell>{month}</TableCell>
                          <TableCell align="right">
                            {Math.round((hours as number) * 10) / 10}h
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Card className="glass">
                <CardContent>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    Statistiken
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 6 }}>
                      <Card className="glass">
                        <CardContent>
                          <Typography variant="body2" color="text.secondary">
                            Timesheets
                          </Typography>
                          <Typography variant="h6">{timesheetsQuery.data?.length || 0}</Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                    <Grid size={{ xs: 6 }}>
                      <Card className="glass">
                        <CardContent>
                          <Typography variant="body2" color="text.secondary">
                            Zuweisungen
                          </Typography>
                          <Typography variant="h6">{assignmentsQuery.data?.length || 0}</Typography>
                        </CardContent>
                      </Card>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}

        {tab === 4 && (
          <Grid container spacing={3}>
            {/* Qualifikationen */}
            <Grid size={12}>
              <Card className="glass">
                <CardContent>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    Qualifikationen ({user.qualifications?.length ?? 0})
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {(user.qualifications?.length
                      ? user.qualifications
                      : []
                    ).map((q, i) => (
                      <Chip key={i} label={q} size="small" color="primary" variant="outlined" />
                    ))}
                    {!user.qualifications?.length && (
                      <Typography variant="body2" color="text.secondary">
                        Keine Qualifikationen hinterlegt
                      </Typography>
                    )}
                  </Box>
                </CardContent>
              </Card>
            </Grid>

            {/* Adresse */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Card className="glass">
                <CardContent>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    Adresse
                  </Typography>
                  <Grid container spacing={1}>
                    <Grid size={{ xs: 12 }}>
                      <Typography variant="body2" color="text.secondary">
                        Straße
                      </Typography>
                      <Typography variant="body1">
                        {user.address?.street || '-'} {user.address?.houseNumber || ''}
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <Typography variant="body2" color="text.secondary">
                        PLZ / Ort
                      </Typography>
                      <Typography variant="body1">
                        {user.address?.postalCode || '-'} {user.address?.city || ''}
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <Typography variant="body2" color="text.secondary">
                        Bundesland / Land
                      </Typography>
                      <Typography variant="body1">
                        {user.address?.state || '-'} {user.address?.country || ''}
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>

            {/* Kontakt */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Card className="glass">
                <CardContent>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    Kontakt
                  </Typography>
                  <Grid container spacing={1}>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography variant="body2" color="text.secondary">
                        Mobil
                      </Typography>
                      <Typography variant="body1">{user.contact?.phoneMobile || '-'}</Typography>
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography variant="body2" color="text.secondary">
                        Festnetz
                      </Typography>
                      <Typography variant="body1">{user.contact?.phoneHome || '-'}</Typography>
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography variant="body2" color="text.secondary">
                        Dienst
                      </Typography>
                      <Typography variant="body1">{user.contact?.phoneWork || '-'}</Typography>
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography variant="body2" color="text.secondary">
                        Privat E-Mail
                      </Typography>
                      <Typography variant="body1">{user.contact?.emailPrivate || '-'}</Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>

            {/* Notfallkontakt */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Card className="glass">
                <CardContent>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    Notfallkontakt
                  </Typography>
                  <Grid container spacing={1}>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography variant="body2" color="text.secondary">
                        Name
                      </Typography>
                      <Typography variant="body1">{user.emergencyContact?.name || '-'}</Typography>
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography variant="body2" color="text.secondary">
                        Beziehung
                      </Typography>
                      <Typography variant="body1">
                        {user.emergencyContact?.relation || '-'}
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography variant="body2" color="text.secondary">
                        Telefon
                      </Typography>
                      <Typography variant="body1">{user.emergencyContact?.phone || '-'}</Typography>
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography variant="body2" color="text.secondary">
                        E-Mail
                      </Typography>
                      <Typography variant="body1">{user.emergencyContact?.email || '-'}</Typography>
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <Typography variant="body2" color="text.secondary">
                        Adresse
                      </Typography>
                      <Typography variant="body1">
                        {user.emergencyContact?.address || '-'}
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>

            {/* Benachrichtigungseinstellungen */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Card className="glass">
                <CardContent>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    Benachrichtigungseinstellungen
                  </Typography>
                  <Grid container spacing={1}>
                    <Grid size={{ xs: 12 }}>
                      <Typography variant="body2" color="text.secondary">
                        E-Mail-Benachrichtigungen
                      </Typography>
                      <Typography variant="body1">
                        {user.notificationSettings?.emailNotifications ? 'An' : 'Aus'}
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <Typography variant="body2" color="text.secondary">
                        Schicht-Erinnerungen
                      </Typography>
                      <Typography variant="body1">
                        {user.notificationSettings?.shiftReminders ? 'An' : 'Aus'}
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <Typography variant="body2" color="text.secondary">
                        Dokument-Ablauf
                      </Typography>
                      <Typography variant="body1">
                        {user.notificationSettings?.documentExpiry ? 'An' : 'Aus'}
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <Typography variant="body2" color="text.secondary">
                        System-Ankündigungen
                      </Typography>
                      <Typography variant="body1">
                        {user.notificationSettings?.systemAnnouncements ? 'An' : 'Aus'}
                      </Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>

            {/* Kontodaten (sichtbar: Admin oder derselbe Nutzer) */}
            {(hasPermission('manage_staff') || authUser?.id === user.id) && (
              <Grid size={{ xs: 12, md: 6 }}>
                <Card className="glass">
                  <CardContent>
                    <Typography variant="h6" sx={{ mb: 2 }}>
                      Kontodaten
                    </Typography>
                    <Grid container spacing={1}>
                      <Grid size={{ xs: 12, md: 6 }}>
                        <Typography variant="body2" color="text.secondary">
                          IBAN
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body1">
                            {user.bankAccount?.iban
                              ? showIban
                                ? user.bankAccount.iban
                                : EncryptionService.maskIBAN(user.bankAccount.iban)
                              : '-'}
                          </Typography>
                          {user.bankAccount?.iban && (
                            <Button
                              size="small"
                              variant="text"
                              onClick={() => setShowIban(v => !v)}
                            >
                              {showIban ? 'Verbergen' : 'Anzeigen'}
                            </Button>
                          )}
                        </Box>
                      </Grid>
                      <Grid size={{ xs: 12, md: 6 }}>
                        <Typography variant="body2" color="text.secondary">
                          BIC
                        </Typography>
                        <Typography variant="body1">{user.bankAccount?.bic || '-'}</Typography>
                      </Grid>
                      <Grid size={{ xs: 12, md: 6 }}>
                        <Typography variant="body2" color="text.secondary">
                          Bank
                        </Typography>
                        <Typography variant="body1">{user.bankAccount?.bankName || '-'}</Typography>
                      </Grid>
                      <Grid size={{ xs: 12, md: 6 }}>
                        <Typography variant="body2" color="text.secondary">
                          Kontoinhaber
                        </Typography>
                        <Typography variant="body1">
                          {user.bankAccount?.accountHolder || '-'}
                        </Typography>
                      </Grid>
                    </Grid>
                  </CardContent>
                </Card>
              </Grid>
            )}

            {/* Ausbildung & Lehrgänge */}
            <Grid size={{ xs: 12 }}>
              <Card className="glass">
                <CardContent>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    Ausbildung & Lehrgänge
                  </Typography>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, md: 4 }}>
                      <Typography variant="body2" color="text.secondary">
                        Höchster Abschluss
                      </Typography>
                      <Typography variant="body1">
                        {user.education?.highestDegree || '-'}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        Institution
                      </Typography>
                      <Typography variant="body1">{user.education?.institution || '-'}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                        Abschlussjahr
                      </Typography>
                      <Typography variant="body1">
                        {user.education?.graduationYear || '-'}
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 12, md: 4 }}>
                      <Typography variant="subtitle1" sx={{ mb: 1 }}>
                        Ausbildungen
                      </Typography>
                      {(user.education?.apprenticeships?.length
                        ? user.education.apprenticeships
                        : []
                      ).map((a, i) => (
                        <Box key={i} sx={{ mb: 1 }}>
                          <Typography variant="body1">{a.title}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {a.provider || ''} {a.startDate ? `(${a.startDate}` : ''}
                            {a.endDate ? ` - ${a.endDate})` : a.startDate ? ')' : ''}
                          </Typography>
                        </Box>
                      ))}
                      {!user.education?.apprenticeships?.length && (
                        <Typography variant="body2" color="text.secondary">
                          Keine Einträge
                        </Typography>
                      )}
                    </Grid>
                    <Grid size={{ xs: 12, md: 4 }}>
                      <Typography variant="subtitle1" sx={{ mb: 1 }}>
                        Lehrgänge
                      </Typography>
                      {(user.education?.trainings?.length ? user.education.trainings : []).map(
                        (t, i) => (
                          <Box key={i} sx={{ mb: 1 }}>
                            <Typography variant="body1">{t.title}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {t.provider || ''} {t.date || ''}{' '}
                              {typeof t.hours === 'number' ? `• ${t.hours} Std.` : ''}
                            </Typography>
                          </Box>
                        )
                      )}
                      {!user.education?.trainings?.length && (
                        <Typography variant="body2" color="text.secondary">
                          Keine Einträge
                        </Typography>
                      )}
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>

            {/* Zertifikate */}
            <Grid size={{ xs: 12 }}>
              <Card className="glass">
                <CardContent>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    Zertifikate
                  </Typography>
                  <Grid container spacing={2}>
                    {(user.education?.certificates?.length ? user.education.certificates : []).map(
                      (c, i) => (
                        <Grid size={{ xs: 12, md: 4 }} key={i}>
                          <Card className="glass">
                            <CardContent>
                              <Typography variant="subtitle1">{c.name}</Typography>
                              <Typography variant="body2" color="text.secondary">
                                {c.issuer || '-'}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ display: 'block', mt: 1 }}
                              >
                                Ausgestellt: {c.issuedAt || '-'}
                              </Typography>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ display: 'block' }}
                              >
                                Gültig bis: {c.expiresAt || '-'}
                              </Typography>
                              {c.certificateId && (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{ display: 'block' }}
                                >
                                  ID: {c.certificateId}
                                </Typography>
                              )}
                            </CardContent>
                          </Card>
                        </Grid>
                      )
                    )}
                    {!user.education?.certificates?.length && (
                      <Grid size={{ xs: 12 }}>
                        <Typography variant="body2" color="text.secondary">
                          Keine Zertifikate vorhanden
                        </Typography>
                      </Grid>
                    )}
                  </Grid>
                </CardContent>
              </Card>
            </Grid>

            {/* Führerschein */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Card className="glass">
                <CardContent>
                  <Typography variant="h6" sx={{ mb: 2 }}>
                    Führerschein
                  </Typography>
                  <Grid container spacing={1}>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography variant="body2" color="text.secondary">
                        Vorhanden
                      </Typography>
                      <Typography variant="body1">
                        {user.driversLicense?.hasLicense ? 'Ja' : 'Nein'}
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography variant="body2" color="text.secondary">
                        Klassen
                      </Typography>
                      <Typography variant="body1">
                        {user.driversLicense?.classes?.join(', ') || '-'}
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 12, md: 6 }}>
                      <Typography variant="body2" color="text.secondary">
                        Eigenes Auto
                      </Typography>
                      <Typography variant="body1">
                        {user.driversLicense?.ownCar ? 'Ja' : 'Nein'}
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <Typography variant="body2" color="text.secondary">
                        Notizen
                      </Typography>
                      <Typography variant="body1">{user.driversLicense?.notes || '-'}</Typography>
                    </Grid>
                  </Grid>
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}

        {tab === 1 && (
          <Card className="glass">
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Zeiterfassung
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Datum</TableCell>
                    <TableCell>Start</TableCell>
                    <TableCell>Ende</TableCell>
                    <TableCell align="right">Stunden</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(timesheetsQuery.data || []).slice(0, 50).map(ts => {
                    const d = ts.date instanceof Date ? ts.date : new Date(ts.date);
                    return (
                      <TableRow key={ts.id} hover>
                        <TableCell>{format(d, 'dd.MM.yyyy', { locale: de })}</TableCell>
                        <TableCell>{ts.startTime || '-'}</TableCell>
                        <TableCell>{ts.endTime || '-'}</TableCell>
                        <TableCell align="right">{ts.totalHours?.toFixed(2) || '0.00'}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={ts.status}
                            color={
                              ts.status === 'approved'
                                ? 'success'
                                : ts.status === 'submitted'
                                  ? 'warning'
                                  : 'default'
                            }
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {tab === 2 && (
          <Card className="glass">
            <CardContent>
              <Typography variant="h6" sx={{ mb: 2 }}>
                Zuweisungen
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Einrichtung</TableCell>
                    <TableCell>Rolle</TableCell>
                    <TableCell>Zeitraum</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(assignmentsQuery.data || []).slice(0, 50).map(asg => {
                    const a = asg as unknown as {
                      startDate?: string | Date;
                      endDate?: string | Date;
                      facilityName?: string;
                      role?: string;
                      status?: string;
                      id: string;
                      declinedAt?: Date | string;
                    };
                    const s = a.startDate ? new Date(a.startDate) : undefined;
                    const e = a.endDate ? new Date(a.endDate) : undefined;
                    return (
                      <TableRow key={a.id} hover>
                        <TableCell>{a.facilityName || '-'}</TableCell>
                        <TableCell>{a.role || '-'}</TableCell>
                        <TableCell>
                          {s && e ? `${format(s, 'dd.MM.yyyy')} - ${format(e, 'dd.MM.yyyy')}` : '-'}
                        </TableCell>
                        <TableCell>
                          <Chip size="small" label={a.status || 'open'} />
                          {a.status === 'declined' && a.declinedAt && (
                            <Typography
                              variant="caption"
                              sx={{ display: 'block', color: 'text.secondary', mt: 0.5 }}
                            >
                              Abgelehnt am{' '}
                              {format(
                                a.declinedAt instanceof Date
                                  ? a.declinedAt
                                  : new Date(a.declinedAt),
                                'dd.MM.yyyy'
                              )}
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {tab === 3 && (
          <Card className="glass">
            <CardContent>
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  mb: 2,
                }}
              >
                <Typography variant="h6">Dokumente</Typography>
                <Button
                  variant="contained"
                  startIcon={<Upload />}
                  onClick={() => setShowDocumentUpload(true)}
                >
                  Dokument hinzufügen
                </Button>
              </Box>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Name</TableCell>
                    <TableCell>Typ</TableCell>
                    <TableCell>Gültig bis</TableCell>
                    <TableCell>Status</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(documentsQuery.data as ServiceDocument[] | undefined)
                    ?.slice(0, 50)
                    .map(document => {
                      const validUntil = document.expiryDate
                        ? document.expiryDate instanceof Date
                          ? document.expiryDate
                          : new Date(document.expiryDate)
                        : null;
                      return (
                        <TableRow key={document.id} hover>
                          <TableCell>{document.name || '-'}</TableCell>
                          <TableCell>{document.type || '-'}</TableCell>
                          <TableCell>
                            {validUntil ? format(validUntil, 'dd.MM.yyyy') : '-'}
                          </TableCell>
                          <TableCell>
                            <Chip size="small" label={document.status || 'unknown'} />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
        <DocumentUpload
          open={showDocumentUpload}
          onClose={() => setShowDocumentUpload(false)}
          onSubmit={handleDocumentUpload}
          isLoading={uploadDocumentMutation.isPending}
          uploadProgress={0}
        />

        <StaffEditDialog
          open={editDialogOpen}
          onClose={() => setEditDialogOpen(false)}
          onSave={handleEditStaff as (data: unknown) => void}
          staff={
            user
              ? {
                  ...user,
                  id: user.id,
                  displayName: user.displayName,
                  email: user.email,
                  phone: user.phone ?? '',
                  role: user.role,
                  customRoleId: user.customRoleId ?? undefined,
                  qualifications: user.qualifications ?? [],
                  active: user.active,
                  createdAt: user.createdAt instanceof Date ? user.createdAt : new Date(user.createdAt),
                }
              : null
          }
        />
      </PageContainer>
    </>
  );
}
