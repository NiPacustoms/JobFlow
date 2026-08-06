'use client';

import { useAuth } from '@/contexts/AuthContext';
import { assignmentService, shiftService, facilityService, documentService, timesheetService } from '@/lib/services';
import { documentGenerationService } from '@/lib/services/documentGeneration';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { AccessTime, LocationOn, Person, Description } from '@mui/icons-material';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from '@/lib/utils/toast';
import { AppLogo } from '@/components/ui/AppLogo';
import { PageContainer } from '@/components/layout/PageContainer';
import { useBrandingSettings } from '@/lib/hooks/useBrandingSettings';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { SignatureDialog } from '@/components/ui/SignatureDialog';

const assignmentFormSchema = z
  .object({
    mode: z.enum(['acknowledge', 'decline']),
    notes: z.string().max(1000).optional(),
    declineDate: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.mode === 'decline' && !values.declineDate?.trim()) {
      ctx.addIssue({
        path: ['declineDate'],
        message: 'Ablehnungsdatum ist erforderlich',
        code: z.ZodIssueCode.custom,
      });
    }
  });

type AssignmentFormValues = z.infer<typeof assignmentFormSchema>;

export default function AssignmentFormPage() {
  const { assignmentId } = useParams() as { assignmentId: string };
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { branding } = useBrandingSettings();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [signatureDataUrl, setSignatureDataUrl] = useState<string | null>(null);
  const [_signerName, setSignerName] = useState<string>('');
  const [stationName, setStationName] = useState<string>('');

  const [assignment, setAssignment] = useState<Awaited<
    ReturnType<typeof assignmentService.getById>
  > | null>(null);
  const [shift, setShift] = useState<Awaited<ReturnType<typeof shiftService.getById>> | null>(null);
  const [facility, setFacility] = useState<Awaited<
    ReturnType<typeof facilityService.getById>
  > | null>(null);
  const [timesheetForShift, setTimesheetForShift] = useState<Awaited<
    ReturnType<typeof timesheetService.getByDate>
  > | null>(null);
  const [assignmentPdfUrl, setAssignmentPdfUrl] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
    reset,
    setValue,
    getValues,
  } = useForm<AssignmentFormValues>({
    resolver: zodResolver(assignmentFormSchema),
    defaultValues: {
      mode: 'acknowledge',
      notes: '',
      declineDate: '',
    },
  });

  const mode = watch('mode');

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const a = await assignmentService.getById(assignmentId);
        if (!a) {
          setError('Zuweisung nicht gefunden');
          setLoading(false);
          return;
        }
        if (!isMounted) return;
        setAssignment(a);

        const s = await shiftService.getById(a.shiftId);
        if (!isMounted) return;
        setShift(s);

        // Lade Facility-Daten
        if (s?.facilityId) {
          const f = await facilityService.getById(s.facilityId);
          if (isMounted) {
            setFacility(f);
            // Lade Station-Name
            if (f && s.stationId) {
              const station = f.stations?.find(st => st.id === s.stationId);
              setStationName(station?.name || '');
            }
          }
        }

        // Wenn Einsatz bereits angenommen: Zeiterfassung und PDF für Zusammenfassung laden
        const isAccepted = a.status === 'accepted' || a.formStatus === 'acknowledged';
        if (isAccepted && a.userId && s?.date) {
          const shiftDate = typeof s.date === 'string' ? new Date(s.date) : s.date;
          const ts = await timesheetService.getByDate(a.userId, shiftDate);
          if (isMounted) setTimesheetForShift(ts);
          try {
            const docs = await documentService.getByUserId(a.userId);
            const pdfDoc = docs.find(d => d.notes?.includes(a.id) || d.name?.toLowerCase().includes('einsatzmitteilung'));
            if (isMounted && pdfDoc?.url) setAssignmentPdfUrl(pdfDoc.url);
          } catch {
            const fallbackUrl = (a as { formPdfUrl?: string; pdfUrl?: string }).formPdfUrl ??
              (a as { pdfUrl?: string }).pdfUrl;
            if (fallbackUrl) setAssignmentPdfUrl(fallbackUrl);
          }
        }

        reset({
          mode: 'acknowledge',
          notes: '',
          declineDate: new Date().toISOString().split('T')[0], // Heute als Standard
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Fehler beim Laden');
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [assignmentId, reset]);

  const isDisabled = useMemo(
    () => saving || loading || !!error || isSubmitting,
    [saving, loading, error, isSubmitting]
  );

  // Generiere PDF und speichere als Dokument (Einsatzmitteilung mit Datumsangaben oben rechts, Unterschrift bei Annahme und Ablehnung)
  const generateAndSaveDocument = async (
    isDeclined: boolean,
    signatureDataUrl?: string,
    declineReason?: string
  ) => {
    if (!assignment || !shift || !user) {
      throw new Error('Fehlende Daten für Dokumentenerstellung');
    }

    const employeeName = user.displayName || user.email || 'Unbekannt';
    const facilityName = facility?.name || shift.facilityId || 'Unbekannt';
    const facilityAddress = facility?.address || '';
    // Overnight-Schichten: Enddatum (Folgetag) mit ausweisen
    const shiftEndDate = (shift as { endDate?: string | Date }).endDate;
    const shiftTimes = shiftEndDate
      ? `${shift.startTime} - ${shift.endTime} (bis ${new Date(shiftEndDate).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })})`
      : `${shift.startTime} - ${shift.endTime}`;
    const currentDate = new Date();
    const shiftDate =
      typeof shift.date === 'string' ? new Date(shift.date) : (shift.date as Date);

    const pdfResult = await documentGenerationService.generateDocument({
      type: 'assignment-notification',
      assignmentId: assignment.id,
      userId: user.id,
      assignmentNotificationData: {
        employeeName,
        facilityName,
        facilityAddress,
        stationName: stationName || undefined,
        shiftTimes,
        assignmentCreationDate: currentDate,
        assignmentDate: shiftDate,
        date: currentDate,
        isDeclined,
        signatureDataUrl,
        declineReason,
        shiftType: (shift as { type?: string }).type || undefined,
        contactPerson: facility?.contactPerson || undefined,
        branding: {
          companyName: branding?.companyName,
          companyLogo: branding?.companyLogo,
        },
      },
    });

    // Speichere als Dokument für Mitarbeiter
    await documentService.create({
      userId: user.id,
      type: 'contract',
      name: `Einsatzmitteilung ${isDeclined ? '(Ablehnung)' : '(Bestätigung)'} - ${currentDate.toLocaleDateString('de-DE')}`,
      url: pdfResult.url,
      fileSize: pdfResult.fileSize,
      mimeType: 'application/pdf',
      notes: `Einsatzmitteilung für Assignment ${assignment.id}`,
    });

    // PDF-URL am Assignment speichern, damit der Admin die Einsatzmitteilung unter
    // „Einsätze“ öffnen kann. WICHTIG: eigene Felder – pdfUrl/pdfGenerated gehören
    // zum Stundennachweis-Lauf und hätten dessen PDF-/Mailversand blockiert.
    await assignmentService.update(assignment.id, {
      formPdfUrl: pdfResult.url,
      formPdfGeneratedAt: new Date(),
    });

    return pdfResult;
  };

  const onSubmit = handleSubmit(async formValues => {
    if (!assignment || !shift || !user) return;

    try {
      setSaving(true);

      if (formValues.mode === 'acknowledge') {
        // Bei Annahme: Unterschrift erforderlich (wie bei Ablehnung), dann auf Dokument
        if (!signatureDataUrl) {
          setSignatureOpen(true);
          return;
        }

        await assignmentService.update(assignment.id, {
          formStatus: 'acknowledged',
          formPlace: facility?.name || shift.facilityId || '',
          formTimes: `${shift.startTime} - ${shift.endTime}`,
          formNotes: formValues.notes?.trim() || undefined,
          formSignatureName: user.displayName || undefined,
          formSignedAt: new Date(),
          status: assignment.status === 'assigned' ? 'accepted' : assignment.status,
          acceptedAt: new Date(),
          decidedAt: new Date(),
        });

        await generateAndSaveDocument(false, signatureDataUrl);
        toast.success('Einsatzmitteilung bestätigt. Danke!');
      } else {
        // Bei Ablehnung: Unterschrift erforderlich
        if (!signatureDataUrl) {
          setSignatureOpen(true);
          return; // Warte auf Unterschrift
        }

        await assignmentService.update(assignment.id, {
          formStatus: 'declined',
          declineReason: formValues.notes?.trim() || 'Ablehnung ohne Begründung',
          status: 'declined',
          declinedAt: new Date(formValues.declineDate!),
          decidedAt: new Date(),
        });

        // Generiere PDF mit Unterschrift
        await generateAndSaveDocument(
          true,
          signatureDataUrl,
          formValues.notes?.trim() || undefined
        );

        toast.success('Dienst wurde abgelehnt.');
      }

      router.back();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  });

  const handleSignatureSave = (dataUrl: string, name?: string) => {
    setSignatureDataUrl(dataUrl);
    setSignerName(name || user?.displayName || '');
    setSignatureOpen(false);

    // Nach Unterschrift automatisch absenden (Annahme und Ablehnung) – dataUrl aus Closure nutzen
    if (!assignment || !shift || !user) return;
    if (mode === 'acknowledge') {
      setTimeout(async () => {
        try {
          setSaving(true);
          await assignmentService.update(assignment.id, {
            formStatus: 'acknowledged',
            formPlace: facility?.name || shift.facilityId || '',
            formTimes: `${shift.startTime} - ${shift.endTime}`,
            // Anmerkungen des Mitarbeiters mitspeichern (gingen früher verloren,
            // weil der Auto-Submit nach der Unterschrift sie nicht übernahm)
            formNotes: getValues('notes')?.trim() || undefined,
            formSignatureName: user.displayName || undefined,
            formSignedAt: new Date(),
            status: assignment.status === 'assigned' ? 'accepted' : assignment.status,
            acceptedAt: new Date(),
            decidedAt: new Date(),
          });
          await generateAndSaveDocument(false, dataUrl);
          toast.success('Einsatzmitteilung bestätigt. Danke!');
          router.back();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Fehler beim Speichern');
        } finally {
          setSaving(false);
        }
      }, 100);
      return;
    }
    if (mode === 'decline') {
      setTimeout(() => {
        handleSubmit(async formValues => {
          if (!assignment || !shift || !user) return;
          try {
            setSaving(true);
            await assignmentService.update(assignment.id, {
              formStatus: 'declined',
              declineReason: formValues.notes?.trim() || 'Ablehnung ohne Begründung',
              status: 'declined',
              declinedAt: new Date(formValues.declineDate!),
              decidedAt: new Date(),
            });
            await generateAndSaveDocument(true, dataUrl, formValues.notes?.trim() || undefined);
            toast.success('Dienst wurde abgelehnt.');
            router.back();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Fehler beim Speichern');
          } finally {
            setSaving(false);
          }
        })();
      }, 100);
    }
  };

  const handleOpenSignature = () => {
    setSignatureOpen(true);
  };

  if (authLoading || loading) {
    return (
      <Box
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh' }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  const isAlreadyAccepted =
    assignment?.status === 'accepted' || assignment?.formStatus === 'acknowledged';

  // Einsatz-Zusammenfassung (wenn bereits angenommen und unterschrieben)
  if (isAlreadyAccepted && assignment && shift) {
    const shiftDate =
      typeof shift.date === 'string' ? new Date(shift.date) : (shift.date as Date);
    const employeeName = user?.displayName || user?.email || 'Unbekannt';
    const facilityName = facility?.name || shift.facilityId || 'Unbekannt';
    const facilityAddress = facility?.address || '';
    const stationLabel = stationName || '–';

    return (
      <PageContainer maxWidth="narrow">
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700, mb: 1 }}>
          Einsatz-Zusammenfassung
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
          Dieser Einsatz wurde von Ihnen bereits angenommen und unterschrieben. Hier die Übersicht.
        </Typography>

        <Card className="glass" sx={{ mb: 3 }}>
          <CardContent>
            <Stack spacing={2}>
              <Stack direction="row" alignItems="flex-start" spacing={1}>
                <LocationOn sx={{ color: 'text.secondary', mt: 0.3 }} />
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Einsatzort
                  </Typography>
                  <Typography variant="body1">
                    {facilityName}
                    {facilityAddress ? `, ${facilityAddress}` : ''}
                  </Typography>
                </Box>
              </Stack>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Station / Etage
                </Typography>
                <Typography variant="body1">{stationLabel}</Typography>
              </Box>
              <Stack direction="row" alignItems="flex-start" spacing={1}>
                <AccessTime sx={{ color: 'text.secondary', mt: 0.3 }} />
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Einsatzdatum
                  </Typography>
                  <Typography variant="body1">
                    {format(shiftDate, 'd.M.yyyy', { locale: de })}
                  </Typography>
                </Box>
              </Stack>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Geplante Zeit
                </Typography>
                <Typography variant="body1">
                  {shift.startTime} – {shift.endTime}
                </Typography>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Tatsächlich geleistete Zeit
                </Typography>
                <Typography variant="body1">
                  {timesheetForShift
                    ? `${timesheetForShift.startTime || '–'} – ${timesheetForShift.endTime || '–'} (${(timesheetForShift.totalHours ?? 0).toFixed(2)} h)`
                    : 'Noch keine Zeiterfassung für diesen Einsatz.'}
                </Typography>
              </Box>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Person sx={{ color: 'text.secondary', fontSize: 20 }} />
                <Box>
                  <Typography variant="caption" color="text.secondary" display="block">
                    Mitarbeiter
                  </Typography>
                  <Typography variant="body1">{employeeName}</Typography>
                </Box>
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Card className="glass" sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Einsatzmitteilung (PDF)
            </Typography>
            {assignmentPdfUrl ? (
              <Button
                variant="contained"
                component="a"
                href={assignmentPdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                startIcon={<Description />}
              >
                PDF anzeigen
              </Button>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Kein PDF für diese Einsatzmitteilung vorhanden.
              </Typography>
            )}
          </CardContent>
        </Card>

        <Button variant="contained" onClick={() => router.back()} fullWidth size="large">
          Zurück
        </Button>
      </PageContainer>
    );
  }

  const employeeName = user?.displayName || user?.email || 'Unbekannt';
  const facilityName = facility?.name || shift?.facilityId || 'Unbekannt';
  const facilityAddress = facility?.address || '';
  const shiftTimes = shift ? `${shift.startTime} - ${shift.endTime}` : '-';
  const currentDate = new Date().toLocaleDateString('de-DE');

  return (
    <PageContainer maxWidth="form">
      {/* Branding-Logo oben */}
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
        <AppLogo
          branding={branding}
          showLogo={branding?.showLogo !== false}
          width={120}
          height={120}
          sx={{ width: 120, height: 120 }}
          showSkeleton={false}
          fallbackBgColor="transparent"
        />
      </Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 2 }}>
        Einsatzmitteilung nach § 11 Absatz 2 Satz 4 AÜG
      </Typography>

      {shift && (
        <Card className="glass" sx={{ mb: 3 }}>
          <CardContent>
            <Typography
              variant="subtitle2"
              color="text.secondary"
              sx={{ mb: 1.5, fontWeight: 600 }}
            >
              Schichtdetails
            </Typography>

            {/* Geplante Arbeitszeiten */}
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <AccessTime sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="body1">
                Schicht •{' '}
                {typeof shift.date === 'string'
                  ? shift.date
                  : (shift.date as Date)?.toLocaleDateString?.('de-DE') || String(shift.date)}{' '}
                • {shift.startTime} - {shift.endTime}
              </Typography>
            </Stack>

            {/* Einrichtung und Station */}
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
              <LocationOn sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="body2" color="text.secondary">
                {facilityName}
                {stationName && ` - ${stationName}`}
                {facilityAddress ? `, ${facilityAddress}` : ''}
              </Typography>
            </Stack>

            {/* Ansprechpartner */}
            {facility?.contactPerson && (
              <Stack direction="row" alignItems="center" spacing={1}>
                <Person sx={{ fontSize: 16, color: 'text.secondary' }} />
                <Typography variant="body2" color="text.secondary">
                  Ansprechpartner: {facility.contactPerson}
                </Typography>
              </Stack>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="glass" sx={{ mb: 3 }}>
        <CardContent>
          <Stack spacing={2}>
            <RadioGroup
              row
              value={mode}
              onChange={e => {
                setValue('mode', e.target.value as AssignmentFormValues['mode']);
                setSignatureDataUrl(null); // Reset Unterschrift bei Moduswechsel
              }}
            >
              <FormControlLabel
                value="acknowledge"
                control={<Radio />}
                label="Einsatz bestätigen"
              />
              <FormControlLabel value="decline" control={<Radio />} label="Dienst ablehnen" />
            </RadioGroup>

            {/* Automatisch ausgefüllte Informationen */}
            <Card variant="outlined" sx={{ p: 2, bgcolor: 'background.default' }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                Mitarbeiter:
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                {employeeName}
              </Typography>

              {mode === 'acknowledge' && (
                <>
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    Einsatzort:
                  </Typography>
                  <Typography variant="body2" sx={{ mb: 2 }}>
                    {facilityName}
                    {facilityAddress ? `, ${facilityAddress}` : ''}
                  </Typography>

                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    Einsatzzeiten:
                  </Typography>
                  <Typography variant="body2" sx={{ mb: 2 }}>
                    {shiftTimes}
                  </Typography>
                </>
              )}
            </Card>

            {mode === 'acknowledge' ? (
              <Stack spacing={2}>
                <Typography variant="body2">
                  Hiermit setzte ich Sie in Kenntnis, dass Sie als Zeitarbeitnehmer für die AufAbruf
                  GmbH tätig werden.
                </Typography>

                <Alert severity="info">
                  Bitte denken Sie daran, die Einsatzzeit mittels den zur Verfügung gestellten
                  Zeiterfassungsbögen zu dokumentieren und vom Berechtigten am Einsatzort
                  unterschreiben zu lassen. Die Zeiterfassungsbögen müssen wöchentlich an die
                  AufAbruf GmbH Zentrale übermittelt werden.
                </Alert>
                <Alert severity="warning">
                  Bitte denken Sie an entsprechende Arbeitsschutzkleidung (Kasack, festes Schuhwerk)
                  und achten die Hygienevorschriften sowie den zur Verfügung gestellten
                  Hautschutzplan.
                </Alert>

                <TextField
                  label="Anmerkungen (optional)"
                  fullWidth
                  multiline
                  minRows={2}
                  {...register('notes')}
                  error={!!errors.notes}
                  helperText={errors.notes?.message}
                />

                <TextField
                  label="Datum"
                  value={currentDate}
                  InputProps={{ readOnly: true }}
                  fullWidth
                />
              </Stack>
            ) : (
              <Stack spacing={2}>
                <Typography variant="body2">Ablehnung der angeforderten Dienste</Typography>
                <Typography variant="body2">
                  Hiermit lehne ich den angeforderten Dienst ab. Mir ist bewusst, dass mir diese
                  Zeit von meiner vertraglich vereinbarten Betriebszeit in Abzug gebracht wird.
                </Typography>
                <TextField
                  label="Begründung (optional)"
                  fullWidth
                  multiline
                  minRows={2}
                  {...register('notes')}
                  error={!!errors.notes}
                  helperText={errors.notes?.message}
                />
                <TextField
                  label="Ablehnungsdatum"
                  type="date"
                  fullWidth
                  InputLabelProps={{ shrink: true }}
                  {...register('declineDate')}
                  error={!!errors.declineDate}
                  helperText={errors.declineDate?.message}
                />

                {signatureDataUrl && <Alert severity="success">Unterschrift wurde erfasst.</Alert>}
              </Stack>
            )}

            <Stack direction="row" spacing={2}>
              <Button variant="outlined" onClick={() => router.back()} disabled={isDisabled}>
                Abbrechen
              </Button>
              <Button
                variant="contained"
                onClick={onSubmit}
                disabled={isDisabled || !signatureDataUrl}
              >
                {mode === 'acknowledge' ? 'Bestätigen' : 'Ablehnen'}
              </Button>
            </Stack>

            {!signatureDataUrl && (
              <Button
                variant="outlined"
                color="primary"
                onClick={handleOpenSignature}
                disabled={isDisabled}
                fullWidth
              >
                Unterschrift erfassen
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>

      <SignatureDialog
        open={signatureOpen}
        title={mode === 'decline' ? 'Unterschrift zur Ablehnung' : 'Unterschrift zur Bestätigung'}
        onClose={() => setSignatureOpen(false)}
        onSave={handleSignatureSave}
        requireName={true}
        nameLabel="Ihr Name"
        initialName={user?.displayName || ''}
      />
    </PageContainer>
  );
}
