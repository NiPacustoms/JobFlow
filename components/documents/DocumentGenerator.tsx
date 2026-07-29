'use client';

import { logger } from '@/lib/logging';

import { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Box,
  Typography,
  Stack,
  Alert,
  CircularProgress,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { de } from 'date-fns/locale';
import { DocumentType, DocumentGenerationOptions } from '@/lib/services/documentGeneration';
import { documentGenerationService } from '@/lib/services/documentGeneration';
import { toast } from '@/lib/utils/toast';
import { Close, Description } from '@mui/icons-material';
import { useAuth } from '@/contexts/AuthContext';

interface DocumentGeneratorProps {
  open: boolean;
  onClose: () => void;
  onDocumentGenerated?: (url: string, fileName: string) => void;
}

export function DocumentGenerator({ open, onClose, onDocumentGenerated }: DocumentGeneratorProps) {
  const { user } = useAuth();
  const [documentType, setDocumentType] = useState<DocumentType>('timesheet-report');
  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [assignmentId, setAssignmentId] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!documentType) {
      setError('Bitte wählen Sie einen Dokumenttyp aus');
      return;
    }

    // Validierung: Enddatum muss nach Startdatum liegen
    if (startDate && endDate && endDate < startDate) {
      setError('Das Enddatum muss nach dem Startdatum liegen');
      return;
    }

    if (!user?.id) {
      setError('Bitte melden Sie sich an, um Dokumente zu erstellen');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const options: DocumentGenerationOptions = {
        type: documentType,
        title: title || undefined,
        dateRange: startDate && endDate ? { start: startDate, end: endDate } : undefined,
        userId: user.id,
        assignmentId: assignmentId || undefined,
        includeSignatures: true,
      };

      const result = await documentGenerationService.generateDocument(options);

      toast.success('Dokument erfolgreich erstellt!');

      if (onDocumentGenerated) {
        onDocumentGenerated(result.url, result.fileName);
      }

      // Öffne das generierte Dokument in einem neuen Tab
      // Sicherheitsprüfung: Nur URLs von Firebase Storage erlauben
      if (
        result.url &&
        (result.url.startsWith('https://firebasestorage.googleapis.com') ||
          result.url.startsWith('http://localhost'))
      ) {
        window.open(result.url, '_blank', 'noopener,noreferrer');
      } else {
        logger.warn('Unerwartete URL für Dokument:', result.url);
        // Fallback: Download-Link erstellen
        const link = document.createElement('a');
        link.href = result.url;
        link.download = result.fileName;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }

      // Reset form
      handleClose();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Fehler beim Erstellen des Dokuments';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClose = () => {
    setDocumentType('timesheet-report');
    setTitle('');
    setStartDate(null);
    setEndDate(null);
    setAssignmentId('');
    setError(null);
    onClose();
  };

  const documentTypeLabels: Record<DocumentType, string> = {
    'timesheet-report': 'Zeiterfassungsbericht',
    'assignment-confirmation': 'Einsatzbestätigung',
    'shift-summary': 'Schichtzusammenfassung',
    'monthly-report': 'Monatsbericht',
    'custom-report': 'Benutzerdefinierter Bericht',
    'assignment-notification': 'Einsatzmitteilung',
    'assignment-signatures': 'Einsatz mit Signaturen',
    'admin-report': 'Bericht',
    'time-entries-report': 'Meine Zeiten (Stempeluhr)',
  };

  const documentTypeDescriptions: Record<DocumentType, string> = {
    'timesheet-report':
      'Erstellt einen detaillierten Bericht über Ihre Zeiterfassungen für einen bestimmten Zeitraum',
    'assignment-confirmation': 'Generiert eine Bestätigung für einen abgeschlossenen Einsatz',
    'shift-summary': 'Erstellt eine Zusammenfassung aller Schichten für einen Tag',
    'monthly-report': 'Generiert einen umfassenden Monatsbericht mit Statistiken und Übersichten',
    'custom-report': 'Erstellt einen benutzerdefinierten Bericht mit eigenen Daten',
    'assignment-notification': 'Einsatzmitteilung nach § 11 Absatz 2 Satz 4 AÜG',
    'assignment-signatures': 'Generiert ein Dokument mit allen Signaturen eines Einsatzes',
    'admin-report': 'Admin-Bericht (High-End-PDF mit Firmenlogo)',
    'time-entries-report': 'Export der Stempeluhr-Einträge (wird über „Meine Zeiten“ erzeugt)',
  };

  const requiresDateRange = ['timesheet-report', 'shift-summary', 'monthly-report'].includes(
    documentType
  );
  const requiresAssignmentId = documentType === 'assignment-confirmation';

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Description sx={{ color: 'primary.main' }} />
            <Typography variant="h6" sx={{ fontWeight: 600 }}>
              Dokument erstellen
            </Typography>
          </Box>
          <Button variant="outlined" size="small" onClick={handleClose} startIcon={<Close />}>
            Schließen
          </Button>
        </Box>
      </DialogTitle>

      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {/* Dokumenttyp Auswahl */}
          <FormControl fullWidth>
            <InputLabel>Dokumenttyp</InputLabel>
            <Select
              value={documentType}
              label="Dokumenttyp"
              onChange={e => setDocumentType(e.target.value as DocumentType)}
            >
              {Object.entries(documentTypeLabels)
                // Der Zeiten-Export braucht die geladenen Stempeluhr-Einträge
                // und läuft ausschließlich über die Seite „Meine Zeiten".
                .filter(([value]) => value !== 'time-entries-report')
                .map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </Select>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {documentTypeDescriptions[documentType]}
            </Typography>
          </FormControl>

          {/* Titel (optional) */}
          {documentType === 'custom-report' && (
            <TextField
              label="Titel"
              value={title}
              onChange={e => setTitle(e.target.value)}
              fullWidth
              placeholder="Titel des Berichts"
            />
          )}

          {/* Datumsbereich */}
          {requiresDateRange && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Zeitraum
              </Typography>
              <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={de}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <DatePicker
                    label="Von"
                    value={startDate}
                    onChange={newValue => setStartDate(newValue)}
                    slotProps={{
                      textField: {
                        fullWidth: true,
                        size: 'small',
                      },
                    }}
                  />
                  <DatePicker
                    label="Bis"
                    value={endDate}
                    onChange={newValue => setEndDate(newValue)}
                    slotProps={{
                      textField: {
                        fullWidth: true,
                        size: 'small',
                      },
                    }}
                  />
                </Stack>
              </LocalizationProvider>
            </Box>
          )}

          {/* Assignment ID */}
          {requiresAssignmentId && (
            <TextField
              label="Einsatz-ID"
              value={assignmentId}
              onChange={e => setAssignmentId(e.target.value)}
              fullWidth
              placeholder="ID des Einsatzes"
              helperText="Geben Sie die ID des Einsatzes ein, für den Sie eine Bestätigung erstellen möchten"
            />
          )}

          {/* Info Box */}
          <Alert severity="info">
            <Typography variant="body2">
              Das Dokument wird als PDF generiert und kann nach der Erstellung heruntergeladen
              werden.
            </Typography>
          </Alert>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ p: 3 }}>
        <Button onClick={handleClose} disabled={isGenerating}>
          Abbrechen
        </Button>
        <Button
          variant="contained"
          onClick={handleGenerate}
          disabled={
            isGenerating ||
            !documentType ||
            (requiresDateRange && (!startDate || !endDate)) ||
            (requiresAssignmentId && !assignmentId)
          }
          startIcon={isGenerating ? <CircularProgress size={16} /> : <Description />}
          sx={{ minWidth: 150 }}
        >
          {isGenerating ? 'Erstelle...' : 'Dokument erstellen'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
