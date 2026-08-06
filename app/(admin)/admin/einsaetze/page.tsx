'use client';
export const dynamic = 'force-dynamic';
import { useAssignments } from '@/lib/hooks/useAssignments';
import { useAuth } from '@/contexts/AuthContext';
import { AssignShiftDialog } from '@/components/admin/AssignShiftDialog';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorDisplay } from '@/components/ui/ErrorBoundary';
import { PageContainer } from '@/components/layout/PageContainer';
import { shiftService } from '@/lib/services/shifts';
import type { Shift as ShiftEntity } from '@/lib/services/shifts';
import type { Shift as DomainShift } from '@/lib/types';
import {
  Assignment as AssignmentIcon,
  Cancel,
  CheckCircle,
  Edit,
  Person,
  PersonAdd,
  Schedule,
  FilterList,
  Refresh,
  Search,
  Clear,
  PictureAsPdf,
} from '@mui/icons-material';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  Grid,
  MenuItem,
  Select,
  Typography,
  TextField,
  InputLabel,
  IconButton,
  Alert,
  Paper,
  Tabs,
  Tab,
  Badge,
} from '@mui/material';
import { useState, useMemo } from 'react';
import { cloudFunctions } from '@/lib/services/cloudFunctions';
import { SignatureDialog } from '@/components/ui/SignatureDialog';
import { firebaseStorageService } from '@/lib/services/firebaseStorage';
import { assignmentService } from '@/lib/services/assignments';
import {
  buildAssignmentCollectionPdf,
  downloadCollectionPdf,
  type AssignmentForCollection,
} from '@/lib/services/assignmentCollectionPdf';
import { toast } from '@/lib/utils/toast';

function convertToDomainShift(shift: ShiftEntity): DomainShift {
  const parsedDate =
    typeof shift.date === 'string' ? new Date(shift.date) : (shift.date as unknown as Date);
  const safeDate =
    parsedDate instanceof Date && !Number.isNaN(parsedDate.getTime()) ? parsedDate : new Date();
  return {
    id: shift.id,
    facilityId: shift.facilityId,
    stationId: shift.stationId ?? '',
    companyId: (shift as ShiftEntity & { companyId?: string }).companyId || '',
    date: safeDate,
    startTime: shift.startTime,
    endTime: shift.endTime,
    type: (shift.type as DomainShift['type']) || 'Frühdienst',
    requiredQualifications: shift.requiredQualifications || [],
    maxStaff: shift.maxStaff || shift.capacity || 1,
    status: shift.status || 'open',
    createdAt: shift.createdAt ?? new Date(),
    updatedAt: shift.updatedAt ?? new Date(),
    capacity: shift.capacity || shift.maxStaff || 1,
    assignedCount: shift.assignedCount || 0,
    tz: shift.timezone || 'Europe/Berlin',
    notes: shift.notes,
    createdBy: shift.createdBy || 'system',
  };
}

export default function AssignmentsPage() {
  const { user } = useAuth();

  // State für Filter
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState(0);
  const [signatureOpenFor, setSignatureOpenFor] = useState<string | null>(null);
  const [generatingPDF, setGeneratingPDF] = useState<string | null>(null);
  const [exportingCollection, setExportingCollection] = useState(false);
  const [reassignShift, setReassignShift] = useState<DomainShift | null>(null);
  const [loadingReassignId, setLoadingReassignId] = useState<string | null>(null);

  // Filter-Objekt für useAssignments
  const filters = useMemo(
    () => ({
      status: statusFilter as
        | 'assigned'
        | 'accepted'
        | 'requested'
        | 'declined'
        | 'completed'
        | 'pending-signature'
        | undefined,
      priority: priorityFilter as 'high' | 'medium' | 'low' | undefined,
      search: searchTerm || undefined,
    }),
    [statusFilter, priorityFilter, searchTerm]
  );

  const {
    assignments,
    pendingAssignments,
    acceptedAssignments,
    declinedAssignments,
    completedAssignments,
    isLoading,
    error,
    acceptAssignment,
    declineAssignment,
    updateAssignment: _updateAssignment,
    deleteAssignment,
    getStatusColor,
    getStatusLabel,
    getPriorityColor: _getPriorityColor,
    getPriorityLabel: _getPriorityLabel,
    formatDate: _formatDate,
    formatTime: _formatTime,
    formatDateTime: _formatDateTime,
    getStats,
    isAccepting,
    isDeclining,
    isDeleting,
    refetch,
  } = useAssignments(filters);

  const stats = getStats();

  /** Einsätze mit Einsatzmitteilung (formPdfUrl, Fallback pdfUrl) für Sammel-PDF */
  const assignmentsWithPdf = useMemo((): AssignmentForCollection[] => {
    return assignments
      .map(a => ({ id: a.id, userId: a.userId, pdfUrl: a.formPdfUrl || a.pdfUrl }))
      .filter((a): a is AssignmentForCollection => Boolean(a.pdfUrl));
  }, [assignments]);

  const handleExportCollectionPdf = async () => {
    if (assignmentsWithPdf.length === 0) {
      toast.error('Keine Einsätze mit Einsatzmitteilung vorhanden.');
      return;
    }
    setExportingCollection(true);
    try {
      const bytes = await buildAssignmentCollectionPdf({
        assignments: assignmentsWithPdf,
        title: 'Einsatzmitteilungen mit Zeiterfassung',
      });
      downloadCollectionPdf(bytes);
      toast.success(
        `Sammel-PDF mit ${assignmentsWithPdf.length} Einsatzmitteilung(en) erstellt. Download gestartet.`
      );
    } catch (e) {
      toast.error(
        'Fehler beim Erstellen des Sammel-PDFs: ' +
          (e instanceof Error ? e.message : 'Unbekannter Fehler')
      );
    } finally {
      setExportingCollection(false);
    }
  };

  const getTabContent = () => {
    switch (activeTab) {
      case 0:
        return assignments;
      case 1:
        return pendingAssignments;
      case 2:
        return acceptedAssignments;
      case 3:
        return declinedAssignments;
      case 4:
        return completedAssignments;
      default:
        return [];
    }
  };

  const handleAccept = (assignmentId: string) => {
    acceptAssignment(assignmentId);
  };

  const handleDecline = (assignmentId: string) => {
    declineAssignment(assignmentId);
  };

  const handleSignDecline = (assignmentId: string) => {
    setSignatureOpenFor(assignmentId);
  };

  const handleGeneratePDF = async (assignmentId: string) => {
    setGeneratingPDF(assignmentId);
    try {
      const result = await assignmentService.generateSignaturePDFAndSendEmails(assignmentId);
      toast.success(
        `PDF erfolgreich generiert${result.emailsSent ? ' und E-Mails versendet' : ''}`
      );
      refetch();
    } catch (error) {
      toast.error(
        'Fehler beim Generieren des PDFs: ' +
          (error instanceof Error ? error.message : 'Unbekannter Fehler')
      );
    } finally {
      setGeneratingPDF(null);
    }
  };

  const handleAdminSignatureSave = async (dataUrl: string, signerName?: string) => {
    const assignmentId = signatureOpenFor;
    if (!assignmentId) {
      toast.error('Keine Assignment-ID gefunden');
      return;
    }

    // Setze signatureOpenFor erst zurück, wenn alles erfolgreich war
    try {
      // Upload admin signature (muss zuerst erfolgreich sein)
      const res = await fetch(dataUrl);
      if (!res.ok) {
        throw new Error('Fehler beim Konvertieren der Signatur');
      }
      const blob = await res.blob();
      const file = new File([blob], 'admin-signature.png', { type: 'image/png' });
      const upload = await firebaseStorageService.uploadFile(
        file,
        `signatures/assignments/${assignmentId}/admin-signature.png`,
        { kind: 'assignment-decline', role: 'admin' }
      );

      if (!upload?.url) {
        throw new Error('Upload fehlgeschlagen - keine URL erhalten');
      }

      // Confirm decline with admin signature
      await cloudFunctions.declineAssignment({
        assignmentId,
        declineType: 'nurse-initiated',
        adminSignature: 'true',
      });

      await assignmentService.update(assignmentId, {
        adminSignatureUrl: upload.url,
        adminSignedAt: new Date(),
        ...(signerName && { adminSignerName: signerName }),
      });

      setSignatureOpenFor(null);
      refetch();
      toast.success('Admin-Signatur erfolgreich gespeichert');
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Fehler beim Speichern der Admin-Signatur';
      toast.error(errorMessage);
      // Dialog bleibt offen, damit User es erneut versuchen kann
    }
  };

  const handleDelete = (assignmentId: string) => {
    deleteAssignment(assignmentId);
  };

  const handleReassignClick = async (assignment: { id: string; shiftId?: string }) => {
    if (!assignment.shiftId) {
      toast.error('Keine Schicht mit diesem Einsatz verknüpft.');
      return;
    }
    setLoadingReassignId(assignment.id);
    try {
      const shift = await shiftService.getById(assignment.shiftId);
      if (!shift) {
        toast.error('Schicht nicht gefunden.');
        return;
      }
      setReassignShift(convertToDomainShift(shift));
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : 'Schicht konnte nicht geladen werden.'
      );
    } finally {
      setLoadingReassignId(null);
    }
  };

  const clearFilters = () => {
    setStatusFilter('');
    setPriorityFilter('');
    setSearchTerm('');
  };

  if (isLoading) {
    return <LoadingSpinner variant="skeleton" message="Einsätze werden geladen..." />;
  }

  if (error) {
    return <ErrorDisplay error={error} />;
  }

  if (!user) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Bitte melde dich an, um Einsätze zu verwalten.</Alert>
      </Box>
    );
  }

  const currentAssignments = getTabContent();

  return (
    <PageContainer maxWidth="standard">
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography
            variant="h4"
            sx={{
              color: 'text.primary',
              fontWeight: 700,
              mb: 1,
            }}
          >
            Einsatzverwaltung
          </Typography>
          <Typography variant="body1" sx={{ color: 'text.secondary' }}>
            Verwalte und überwache alle Einsätze und Schichtzuweisungen
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button
            variant="outlined"
            size="medium"
            startIcon={<PictureAsPdf />}
            onClick={handleExportCollectionPdf}
            disabled={exportingCollection || assignmentsWithPdf.length === 0}
          >
            {exportingCollection
              ? 'Wird erstellt…'
              : `Sammel-PDF (${assignmentsWithPdf.length})`}
          </Button>
          <IconButton onClick={() => refetch()} sx={{ color: 'text.primary' }} aria-label="Aktualisieren">
            <Refresh />
          </IconButton>
        </Box>
      </Box>

      {/* Statistiken */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid size={{ xs: 12, sm: 6, md: 2.4 }}>
          <Card className="glass">
            <CardContent sx={{ textAlign: 'center' }}>
              <Typography variant="h4" color="primary" sx={{ fontWeight: 600 }}>
                {stats.total}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Gesamt
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 2.4 }}>
          <Card className="glass">
            <CardContent sx={{ textAlign: 'center' }}>
              <Typography variant="h4" color="warning.main" sx={{ fontWeight: 600 }}>
                {stats.pending}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Ausstehend
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 2.4 }}>
          <Card className="glass">
            <CardContent sx={{ textAlign: 'center' }}>
              <Typography variant="h4" color="success.main" sx={{ fontWeight: 600 }}>
                {stats.accepted}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Angenommen
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 2.4 }}>
          <Card className="glass">
            <CardContent sx={{ textAlign: 'center' }}>
              <Typography variant="h4" color="error.main" sx={{ fontWeight: 600 }}>
                {stats.declined}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Abgelehnt
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 2.4 }}>
          <Card className="glass">
            <CardContent sx={{ textAlign: 'center' }}>
              <Typography variant="h4" color="info.main" sx={{ fontWeight: 600 }}>
                {stats.completed}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Abgeschlossen
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Filter */}
      <Paper className="glass" sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={3} alignItems="center">
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Einsatz suchen..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              InputProps={{
                startAdornment: <Search sx={{ mr: 1, color: 'text.secondary' }} />,
                endAdornment: searchTerm && (
                  <IconButton size="small" onClick={() => setSearchTerm('')} aria-label="Suche löschen">
                    <Clear />
                  </IconButton>
                ),
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Status</InputLabel>
              <Select
                value={statusFilter}
                label="Status"
                onChange={e => setStatusFilter(e.target.value)}
              >
                <MenuItem value="">Alle</MenuItem>
                <MenuItem value="pending">Ausstehend</MenuItem>
                <MenuItem value="accepted">Angenommen</MenuItem>
                <MenuItem value="declined">Abgelehnt</MenuItem>
                <MenuItem value="completed">Abgeschlossen</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Priorität</InputLabel>
              <Select
                value={priorityFilter}
                label="Priorität"
                onChange={e => setPriorityFilter(e.target.value)}
              >
                <MenuItem value="">Alle</MenuItem>
                <MenuItem value="urgent">Dringend</MenuItem>
                <MenuItem value="high">Hoch</MenuItem>
                <MenuItem value="medium">Mittel</MenuItem>
                <MenuItem value="low">Niedrig</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Button
              variant="outlined"
              startIcon={<FilterList />}
              onClick={clearFilters}
              fullWidth
              size="small"
            >
              Filter zurücksetzen
            </Button>
          </Grid>
        </Grid>
      </Paper>

      {/* Tabs */}
      <Paper className="glass" sx={{ mb: 3 }}>
        <Tabs value={activeTab} onChange={(_, newValue) => setActiveTab(newValue)}>
          <Tab
            label={`Alle (${assignments.length})`}
            icon={<AssignmentIcon />}
            iconPosition="start"
          />
          <Tab
            label={`Ausstehend (${stats.pending})`}
            icon={
              <Badge badgeContent={stats.pending} color="warning">
                <AssignmentIcon />
              </Badge>
            }
            iconPosition="start"
          />
          <Tab
            label={`Angenommen (${stats.accepted})`}
            icon={
              <Badge badgeContent={stats.accepted} color="success">
                <AssignmentIcon />
              </Badge>
            }
            iconPosition="start"
          />
          <Tab
            label={`Abgelehnt (${stats.declined})`}
            icon={
              <Badge badgeContent={stats.declined} color="error">
                <AssignmentIcon />
              </Badge>
            }
            iconPosition="start"
          />
          <Tab
            label={`Abgeschlossen (${stats.completed})`}
            icon={
              <Badge badgeContent={stats.completed} color="info">
                <AssignmentIcon />
              </Badge>
            }
            iconPosition="start"
          />
        </Tabs>
      </Paper>

      {/* Assignments List */}
      {currentAssignments.length === 0 ? (
        <Paper className="glass" sx={{ p: 4, textAlign: 'center' }}>
          <AssignmentIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" sx={{ mb: 1 }}>
            Keine Einsätze gefunden
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Versuche andere Filter oder erstelle einen neuen Einsatz.
          </Typography>
        </Paper>
      ) : (
        <Grid container spacing={3}>
          {getTabContent().map(assignment => (
            <Grid key={assignment.id} size={{ xs: 12, md: 6 }}>
              <Card className="glass">
                <CardContent>
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      mb: 2,
                    }}
                  >
                    <Box>
                      <Typography variant="h6" sx={{ color: 'text.primary', fontWeight: 600 }}>
                        {assignment.shiftId || 'Einsatz'}
                      </Typography>
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        {assignment.shiftId || 'Einrichtung nicht verfügbar'}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                      <Chip
                        label={getStatusLabel(assignment.status)}
                        color={
                          getStatusColor(assignment.status) as
                            | 'success'
                            | 'error'
                            | 'warning'
                            | 'info'
                        }
                        size="small"
                      />
                      <Chip label="Normal" color="default" size="small" />
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <Schedule sx={{ fontSize: 16, color: 'text.secondary', mr: 1 }} />
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      {_formatDate(assignment.assignedAt)} • {_formatTime(assignment.assignedAt)} -{' '}
                      {_formatTime(assignment.assignedAt)}
                    </Typography>
                  </Box>

                  {assignment.status === 'declined' && assignment.declinedAt && (
                    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                      <Cancel sx={{ fontSize: 16, color: 'error.main', mr: 1 }} />
                      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        Abgelehnt am {_formatDate(assignment.declinedAt)}
                        {assignment.declineReason ? ` – ${assignment.declineReason}` : ''}
                      </Typography>
                    </Box>
                  )}

                  <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Person sx={{ fontSize: 16, color: 'text.secondary', mr: 1 }} />
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      {assignment.userId || 'Nicht zugewiesen'}
                    </Typography>
                  </Box>

                  {assignment.status === 'pending' && (
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button
                        variant="contained"
                        color="success"
                        size="small"
                        startIcon={<CheckCircle />}
                        onClick={() => handleAccept(assignment.id)}
                        disabled={isAccepting}
                        sx={{ flex: 1 }}
                      >
                        {isAccepting ? 'Annehme...' : 'Annehmen'}
                      </Button>
                      <Button
                        variant="outlined"
                        color="error"
                        size="small"
                        startIcon={<Cancel />}
                        onClick={() => handleDecline(assignment.id)}
                        disabled={isDeclining}
                        sx={{ flex: 1 }}
                      >
                        {isDeclining ? 'Lehne ab...' : 'Ablehnen'}
                      </Button>
                    </Box>
                  )}

                  {assignment.status === 'accepted' && (
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button variant="outlined" size="small" startIcon={<Edit />} sx={{ flex: 1 }}>
                        Bearbeiten
                      </Button>
                      <Button
                        variant="outlined"
                        color="error"
                        size="small"
                        startIcon={<Cancel />}
                        onClick={() => handleDelete(assignment.id)}
                        disabled={isDeleting}
                        sx={{ flex: 1 }}
                      >
                        {isDeleting ? 'Lösche...' : 'Stornieren'}
                      </Button>
                    </Box>
                  )}

                  {assignment.status === 'pending-signature' && (
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      <Button
                        variant="contained"
                        color="warning"
                        size="small"
                        startIcon={<Edit />}
                        onClick={() => handleSignDecline(assignment.id)}
                        sx={{ flex: 1 }}
                      >
                        Ablehnung unterschreiben
                      </Button>
                    </Box>
                  )}

                  {/* Einsatzmitteilung (PDF) – sichtbar, sobald Mitarbeiter das Formular unterschrieben hat (Annahme/Ablehnung) */}
                  {assignment.pdfUrl ? (
                    <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                      <Button
                        variant="outlined"
                        color="success"
                        size="small"
                        startIcon={<PictureAsPdf />}
                        onClick={() => window.open(assignment.pdfUrl, '_blank')}
                        sx={{ flex: 1 }}
                      >
                        Einsatzmitteilung (PDF) öffnen
                      </Button>
                    </Box>
                  ) : assignment.relievingSignatures && assignment.relievingSignatures.length > 0 ? (
                    <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                      <Button
                        variant="contained"
                        color="primary"
                        size="small"
                        startIcon={<PictureAsPdf />}
                        onClick={() => handleGeneratePDF(assignment.id)}
                        disabled={generatingPDF === assignment.id}
                        sx={{ flex: 1 }}
                      >
                        {generatingPDF === assignment.id ? 'Generiere PDF...' : 'PDF generieren'}
                      </Button>
                    </Box>
                  ) : null}

                  {(assignment.status === 'declined' || assignment.status === 'completed') && (
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      {assignment.status === 'declined' && (
                        <Button
                          variant="contained"
                          color="primary"
                          size="small"
                          startIcon={<PersonAdd />}
                          onClick={() => handleReassignClick(assignment)}
                          disabled={loadingReassignId === assignment.id}
                          sx={{ flex: 1 }}
                        >
                          {loadingReassignId === assignment.id ? 'Lade...' : 'Neu zuweisen'}
                        </Button>
                      )}
                      <Button
                        variant="outlined"
                        color="error"
                        size="small"
                        startIcon={<Cancel />}
                        onClick={() => handleDelete(assignment.id)}
                        disabled={isDeleting}
                        sx={{ flex: 1 }}
                      >
                        {isDeleting ? 'Lösche...' : 'Löschen'}
                      </Button>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <SignatureDialog
        open={!!signatureOpenFor}
        title="Ablehnung unterschreiben"
        onClose={() => setSignatureOpenFor(null)}
        onSave={handleAdminSignatureSave}
        requireName={true}
        nameLabel="Ihr Name"
      />

      {reassignShift && (
        <AssignShiftDialog
          open={!!reassignShift}
          shift={reassignShift}
          onClose={() => {
            setReassignShift(null);
            refetch();
          }}
        />
      )}
    </PageContainer>
  );
}
