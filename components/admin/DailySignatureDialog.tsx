'use client';

import { logger } from '@/lib/logging';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  FormControl,
  FormLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Checkbox,
  Typography,
  Alert,
} from '@mui/material';
import { SignatureDialog } from '@/components/ui/SignatureDialog';
import { firebaseStorageService } from '@/lib/services/firebaseStorage';
import { timesheetService, Timesheet } from '@/lib/services/timesheets';
import { toast } from '@/lib/utils/toast';

interface DailySignatureDialogProps {
  open: boolean;
  onClose: () => void;
  timesheetId: string;
  date: Date;
  facilityName?: string;
  signerUserId?: string; // autorisierte Person der Einrichtung (optional)
}

export function DailySignatureDialog({
  open,
  onClose,
  timesheetId,
  date,
  facilityName,
  signerUserId,
}: DailySignatureDialogProps) {
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [timesheet, setTimesheet] = useState<Timesheet | null>(null);
  const [status, setStatus] = useState<'performed' | 'aborted' | 'no-show' | ''>('');
  const [confirmReviewed, setConfirmReviewed] = useState(false);
  const [signerName, setSignerName] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      if (!open || !timesheetId) return;
      try {
        const t = await timesheetService.getById(timesheetId);
        if (active) {
          if (!t) {
            setError('Timesheet nicht gefunden');
          } else {
            setTimesheet(t);
            setError(null);
          }
        }
      } catch (err) {
        if (active) {
          setError('Fehler beim Laden des Timesheets');
          logger.error('Error loading timesheet:', err);
        }
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [open, timesheetId]);

  const handleSign = () => setSignatureOpen(true);

  const handleSaveSignature = async (dataUrl: string, dialogSignerName?: string) => {
    setSignatureOpen(false);
    setIsSubmitting(true);
    setError(null);
    try {
      if (!timesheetId) {
        throw new Error('Timesheet-ID fehlt');
      }

      // Verwende den Namen aus dem Dialog oder aus dem Textfeld
      const finalSignerName = dialogSignerName || signerName;

      const res = await fetch(dataUrl);
      if (!res.ok) {
        throw new Error('Fehler beim Konvertieren der Signatur');
      }
      const blob = await res.blob();
      const file = new File([blob], 'facility-daily-signature.png', { type: 'image/png' });

      const upload = await firebaseStorageService.uploadFile(
        file,
        `signatures/timesheets/${timesheetId}/${date.toISOString().slice(0, 10)}.png`,
        {
          kind: 'timesheet-daily',
          role: 'facility',
          date: date.toISOString(),
          signerName: finalSignerName,
        }
      );

      if (!upload?.url) {
        throw new Error('Upload fehlgeschlagen - keine URL erhalten');
      }

      await timesheetService.approveWithFacilitySignature({
        timesheetId,
        signatureUrl: upload.url,
        signerUserId,
        status: status || undefined,
        signerName: finalSignerName || undefined,
        facilityNotes: notes.trim() || undefined,
      });

      toast.success('Signatur erfolgreich gespeichert');
      onClose();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Fehler beim Speichern der Signatur';
      setError(errorMessage);
      toast.error(errorMessage);
      setSignatureOpen(true); // Signatur-Dialog wieder öffnen, damit User es erneut versuchen kann
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Tägliche Bestätigung (Einrichtung)</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          <TextField label="Datum" value={date.toLocaleDateString('de-DE')} size="small" disabled />
          {facilityName && (
            <TextField label="Einrichtung" value={facilityName} size="small" disabled />
          )}

          <TextField
            label="Name der unterzeichnenden Person"
            value={signerName}
            onChange={e => setSignerName(e.target.value)}
            size="small"
          />

          {timesheet && (
            <Box
              sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1 }}
            >
              <TextField label="Start" value={timesheet.startTime} size="small" disabled />
              <TextField label="Ende" value={timesheet.endTime} size="small" disabled />
              <TextField label="Pause (Min)" value={timesheet.breakMinutes} size="small" disabled />
              <TextField
                label="Stunden (gesamt)"
                value={timesheet.totalHours}
                size="small"
                disabled
              />
            </Box>
          )}

          <FormControl>
            <FormLabel>Leistungsstatus</FormLabel>
            <RadioGroup
              row
              value={status}
              onChange={e => setStatus(e.target.value as 'performed' | 'aborted' | 'no-show')}
            >
              <FormControlLabel value="performed" control={<Radio />} label="Dienst geleistet" />
              <FormControlLabel value="aborted" control={<Radio />} label="Abgebrochen" />
              <FormControlLabel value="no-show" control={<Radio />} label="Nicht angetreten" />
            </RadioGroup>
          </FormControl>

          <FormControlLabel
            control={
              <Checkbox
                checked={confirmReviewed}
                onChange={e => setConfirmReviewed(e.target.checked)}
              />
            }
            label={
              <Typography variant="body2">
                Ich habe die Zeiten geprüft und bestätige die Auswahl.
              </Typography>
            }
          />

          <TextField
            label="Notiz (optional)"
            value={notes}
            onChange={e => setNotes(e.target.value)}
            size="small"
            multiline
            minRows={2}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={isSubmitting}>
          Abbrechen
        </Button>
        <Button
          onClick={handleSign}
          variant="contained"
          disabled={isSubmitting || !confirmReviewed || !status || !signerName.trim()}
          data-testid="daily-signature-submit"
          aria-label="Tägliche Bestätigung signieren"
        >
          Signieren
        </Button>
      </DialogActions>

      <SignatureDialog
        open={signatureOpen}
        title="Einrichtungs-Unterschrift"
        onClose={() => setSignatureOpen(false)}
        onSave={handleSaveSignature}
        requireName={!signerName.trim()}
        nameLabel="Name der unterschreibenden Person"
        initialName={signerName}
      />
    </Dialog>
  );
}
