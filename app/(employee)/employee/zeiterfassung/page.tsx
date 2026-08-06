'use client';
import { TimesheetForm } from '@/components/time/TimesheetForm';
import { TimesheetHistory } from '@/components/time/TimesheetHistory';
import { ErrorDisplay } from '@/components/ui/ErrorBoundary';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageContainer } from '@/components/layout/PageContainer';
import { LiveShiftTimer } from '@/components/ui/LiveShiftTimer';
import { useAuth } from '@/contexts/AuthContext';
import { useTimesheet } from '@/lib/hooks/useTimesheet';
import { TimesheetForm as TimesheetFormType, Timesheet } from '@/lib/types';
import { toast } from '@/lib/utils/toast';
import { recordTimeEvent, buildCorrections } from '@/lib/services/timeEvents';
import { TimeEventTrail } from '@/components/time/TimeEventTrail';
import {
  Alert,
  Box,
  Grid,
  Typography,
  Button,
  Card,
  CardContent,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import { DailySignatureDialog } from '@/components/admin/DailySignatureDialog';
import { RelievingPersonnelSignatureDialog } from '@/components/assignments/RelievingPersonnelSignatureDialog';
import { useEffect, useState } from 'react';
import { logger } from '@/lib/logging';
import { EventAvailable, Pause, Stop } from '@mui/icons-material';
import { EmptyState } from '@/components/ui/EmptyState';
import { getTodayAssignment, listAssignmentsForUser } from '@/src/composition';
import { shiftService } from '@/lib/services/shifts';
import { facilityService } from '@/lib/services/facilities';
import { isSignatureRequiredToday } from '@/lib/utils/signatureSchedule';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { AccessTime, LocationOn, Person, Phone, Email } from '@mui/icons-material';
import { SyncStatusIndicator } from '@/components/ui/SyncStatusIndicator';

/** Zeit "HH:MM" in Minuten seit Mitternacht (0–1439) */
function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Minuten seit Mitternacht in "HH:MM" */
function minutesToTime(minutes: number): string {
  const m = ((minutes % 60) + 60) % 60;
  const h = Math.floor((minutes / 60 + 24) % 24);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Früheste erlaubte Startzeit = 15 Min vor Schichtbeginn */
function earliestStartMinutes(shiftStartHHMM: string): number {
  return Math.max(0, timeToMinutes(shiftStartHHMM) - 15);
}

/** Für Abrechnung: Startzeit ist mindestens Schichtbeginn (gezählt wird ab Schichtbeginn) */
function effectiveStartTime(enteredStart: string, shiftStart: string): string {
  return timeToMinutes(enteredStart) < timeToMinutes(shiftStart) ? shiftStart : enteredStart;
}

export default function TimePage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const { timesheet, recentTimesheets, isLoading, error, createTimesheet, updateTimesheet } =
    useTimesheet();

  // Prüfe ob Benutzer ein akzeptiertes Assignment für heute hat
  const { data: todayAssignment, isLoading: loadingAssignment } = useQuery({
    queryKey: ['todayAssignment', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      return await getTodayAssignment.execute(user.id);
    },
    enabled: !!user?.id,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

  // Prüfe ob das Assignment akzeptiert wurde
  const hasAcceptedAssignment =
    todayAssignment?.status === 'accepted' || todayAssignment?.status === 'assigned';

  // Lade Shift und Facility Details für das Assignment
  const { data: assignmentDetails } = useQuery({
    queryKey: ['assignmentDetails', todayAssignment?.id, todayAssignment?.shiftId],
    queryFn: async () => {
      if (!todayAssignment?.shiftId) return null;
      try {
        const shift = await shiftService.getById(todayAssignment.shiftId);
        if (!shift) return null;

        const facility = shift.facilityId ? await facilityService.getById(shift.facilityId) : null;
        const station = facility?.stations?.find(s => s.id === shift.stationId);

        return {
          shift,
          facility,
          station,
        };
      } catch (error) {
        logger.error(
          'Error loading assignment details',
          error instanceof Error ? error : new Error(String(error))
        );
        return null;
      }
    },
    enabled: !!todayAssignment?.shiftId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const [editingTimesheet, setEditingTimesheet] = useState<TimesheetFormType | null>(null);
  // Welcher Eintrag bearbeitet wird (sonst überschriebe „Bearbeiten" eines
  // alten Eintrags stillschweigend das heutige Timesheet)
  const [editingSource, setEditingSource] = useState<Timesheet | null>(null);
  // Laufende Pause der Schnell-Erfassung (überlebt Reload via localStorage)
  const [pauseStartedAt, setPauseStartedAt] = useState<Date | null>(null);
  // Checkout-Dialog: gesetzliche Mindestpause (§4 ArbZG) beim Beenden vorschlagen
  const [endShiftDialog, setEndShiftDialog] = useState<{
    open: boolean;
    endTime?: string;
    suggestedBreak?: number;
    workedMinutes?: number;
    currentBreaks?: number;
  }>({ open: false });
  const [openDailySignature, setOpenDailySignature] = useState<{
    open: boolean;
    tsId?: string;
    date?: Date;
  }>(() => ({ open: false }));
  const [openRelievingSignature, setOpenRelievingSignature] = useState<{
    open: boolean;
    assignmentId?: string;
    timesheetId?: string;
    date?: Date;
  }>(() => ({ open: false }));

  const handleSubmitTimesheet = async (data: TimesheetFormType) => {
    try {
      // Prüfe ob ein akzeptiertes Assignment vorhanden ist
      if (!hasAcceptedAssignment) {
        toast.error(
          'Sie können nur Zeiten erfassen, wenn Ihnen ein Einsatz zugewiesen und von Ihnen akzeptiert wurde.'
        );
        return;
      }

      const dataDate = data.date instanceof Date ? data.date : new Date(data.date);
      const shift = assignmentDetails?.shift;
      const shiftDate = shift?.date ? new Date(shift.date) : null;
      const isSameDay = shiftDate && dataDate && shiftDate.toDateString() === dataDate.toDateString();

      // Regel: Zeiterfassung erst ab 15 Min vor Schichtbeginn
      if (shift?.startTime && isSameDay) {
        const earliestMin = earliestStartMinutes(shift.startTime);
        const startMin = timeToMinutes(data.startTime);
        if (startMin < earliestMin) {
          const earliestStr = minutesToTime(earliestMin);
          toast.error(
            `Zeiterfassung kann frühestens 15 Minuten vor Schichtbeginn gestartet werden (heute ab ${earliestStr}).`
          );
          return;
        }
      }

      // Gezählt wird erst ab Schichtbeginn: effektive Startzeit für Speicherung
      const startTimeForStorage =
        shift?.startTime && isSameDay
          ? effectiveStartTime(data.startTime, shift.startTime)
          : data.startTime;

      const timesheetData = {
        ...data,
        startTime: startTimeForStorage,
      };

      const editTarget = editingSource ?? timesheet;
      if (editingTimesheet && editTarget) {
        // Korrektur als revisionssicheres Ereignis protokollieren (Diff alt → neu).
        // Wichtig: gegen den BEARBEITETEN Eintrag, nicht pauschal den heutigen.
        const corrections = buildCorrections(editTarget, timesheetData);
        await updateTimesheet.mutateAsync({
          id: editTarget.id,
          data: timesheetData,
        });
        if (corrections.length > 0 && user?.id) {
          void recordTimeEvent(editTarget.id, {
            type: 'correction',
            by: user.id,
            note: 'Manuelle Korrektur über das Formular',
            corrections,
          });
        }
        toast.success('Zeiterfassung aktualisiert!');
        setEditingTimesheet(null);
        setEditingSource(null);
        // Prüfe ob Signatur-Dialog geöffnet werden soll
        if (timesheetData.endTime) {
          setOpenDailySignature({ open: true, tsId: editTarget.id, date: data.date });
        }
      } else {
        const timesheetId = await createTimesheet.mutateAsync(timesheetData);
        // Einstempel-Ereignis(se) protokollieren
        if (timesheetId && user?.id) {
          void recordTimeEvent(timesheetId, {
            type: 'clockIn',
            by: user.id,
            at: timesheetData.startTime,
          });
          if (timesheetData.endTime && timesheetData.endTime !== timesheetData.startTime) {
            void recordTimeEvent(timesheetId, {
              type: 'clockOut',
              by: user.id,
              at: timesheetData.endTime,
              note: 'Manuell erfasst',
            });
          }
        }
        toast.success('Zeiterfassung erstellt!');
        setEditingTimesheet(null);
        setEditingSource(null);

        // Prüfe ob Signatur-Dialoge geöffnet werden sollen
        if (timesheetData.endTime && timesheetId && user?.id) {
          // Prüfe auf aktives Assignment für heute
          try {
            const today = new Date(data.date);
            today.setHours(0, 0, 0, 0);

            // Finde aktives Assignment für diesen User
            const assignments = await listAssignmentsForUser.execute({ userId: user.id });

            // Prüfe jedes Assignment synchron
            let activeAssignment = null;
            for (const assignment of assignments) {
              if (assignment.status !== 'accepted' && assignment.status !== 'assigned') {
                continue;
              }

              const shift = await shiftService.getById(assignment.shiftId);
              if (shift) {
                const shiftDate = new Date(shift.date);
                shiftDate.setHours(0, 0, 0, 0);

                if (shiftDate.getTime() === today.getTime()) {
                  activeAssignment = assignment;
                  break;
                }
              }
            }

            if (activeAssignment) {
              // Prüfe ob Relieving-Signatur erforderlich ist
              const shift = await shiftService.getById(activeAssignment.shiftId);
              if (shift) {
                // Berechne Assignment-Zeitraum (vereinfacht: nur Shift-Datum)
                const assignmentStart = new Date(shift.date);
                const assignmentEnd = new Date(shift.date); // Für jetzt: nur ein Tag

                const collectedDates = activeAssignment.signatureSchedule?.collectedDates || [];
                const signatureRequired = isSignatureRequiredToday(
                  assignmentStart,
                  assignmentEnd,
                  collectedDates
                );

                if (signatureRequired) {
                  // Öffne Relieving Signature Dialog
                  setOpenRelievingSignature({
                    open: true,
                    assignmentId: activeAssignment.id,
                    timesheetId: timesheetId,
                    date: data.date,
                  });
                } else {
                  // Öffne normale Daily Signature Dialog
                  setOpenDailySignature({ open: true, tsId: timesheetId, date: data.date });
                }
              } else {
                setOpenDailySignature({ open: true, tsId: timesheetId, date: data.date });
              }
            } else {
              // Kein Assignment gefunden, normale Signatur
              setOpenDailySignature({ open: true, tsId: timesheetId, date: data.date });
            }
          } catch (error) {
            logger.error(
              'Error checking assignment',
              error instanceof Error ? error : new Error(String(error))
            );
            // Fallback: Normale Signatur
            setOpenDailySignature({ open: true, tsId: timesheetId, date: data.date });
          }
        } else if (timesheetData.endTime && timesheetId) {
          // Kein User, normale Signatur
          setOpenDailySignature({ open: true, tsId: timesheetId, date: data.date });
        }
      }
    } catch (error: unknown) {
      toast.error('Fehler: ' + (error instanceof Error ? error.message : 'Unbekannter Fehler'));
    }
  };

  const handleEditTimesheet = (timesheet: Timesheet) => {
    setEditingSource(timesheet);
    setEditingTimesheet({
      date: timesheet.date,
      startTime: timesheet.startTime,
      endTime: timesheet.endTime,
      breakMinutes: timesheet.breakMinutes,
      notes: timesheet.notes || '',
      facilityId: timesheet.facilityId || '',
      station: timesheet.station || '',
    });
  };

  /* ── Schnell-Erfassung: Pause & Checkout (§4 ArbZG) ────────────────────── */

  const pauseStorageKey = timesheet ? `schichtklar.pause.${timesheet.id}` : null;

  // Laufende Pause nach Reload wiederherstellen
  useEffect(() => {
    if (!pauseStorageKey) {
      setPauseStartedAt(null);
      return;
    }
    try {
      const raw = window.localStorage.getItem(pauseStorageKey);
      setPauseStartedAt(raw ? new Date(raw) : null);
    } catch {
      setPauseStartedAt(null);
    }
  }, [pauseStorageKey]);

  /** Minuten einer aktuell laufenden Pause (0, wenn keine läuft). */
  const runningPauseMinutes = (): number =>
    pauseStartedAt ? Math.max(1, Math.round((Date.now() - pauseStartedAt.getTime()) / 60000)) : 0;

  const persistBreakMinutes = async (newBreakMinutes: number, endTime?: string) => {
    if (!timesheet) return;
    await updateTimesheet.mutateAsync({
      id: timesheet.id,
      data: {
        date: timesheet.date,
        startTime: timesheet.startTime,
        endTime: endTime ?? timesheet.endTime,
        breakMinutes: newBreakMinutes,
        notes: timesheet.notes,
      },
    });
  };

  const handleTogglePause = async () => {
    if (!timesheet) return;
    if (!pauseStartedAt) {
      const now = new Date();
      setPauseStartedAt(now);
      try {
        if (pauseStorageKey) window.localStorage.setItem(pauseStorageKey, now.toISOString());
      } catch {
        // localStorage nicht verfügbar – Pause gilt nur für diese Sitzung
      }
      if (user?.id) void recordTimeEvent(timesheet.id, { type: 'pauseStart', by: user.id });
      toast.info('Pause gestartet. Zum Beenden erneut tippen.');
      return;
    }
    const minutes = runningPauseMinutes();
    const newBreakMinutes = (timesheet.breakMinutes ?? 0) + minutes;
    try {
      await persistBreakMinutes(newBreakMinutes);
      setPauseStartedAt(null);
      try {
        if (pauseStorageKey) window.localStorage.removeItem(pauseStorageKey);
      } catch {
        // ignorieren
      }
      if (user?.id) {
        void recordTimeEvent(timesheet.id, {
          type: 'pauseEnd',
          by: user.id,
          note: `${minutes} Min`,
        });
      }
      toast.success(`Pause beendet – ${minutes} Min erfasst (gesamt ${newBreakMinutes} Min).`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Fehler beim Speichern der Pause');
    }
  };

  /** Gesetzliche Mindestpause nach §4 ArbZG für die Netto-Arbeitszeit. */
  const statutoryBreakFor = (workedMinutes: number): number => {
    if (workedMinutes > 9 * 60) return 45;
    if (workedMinutes > 6 * 60) return 30;
    return 0;
  };

  const finishShift = async (endTime: string, breakMinutes: number) => {
    try {
      await persistBreakMinutes(breakMinutes, endTime);
      setPauseStartedAt(null);
      try {
        if (pauseStorageKey) window.localStorage.removeItem(pauseStorageKey);
      } catch {
        // ignorieren
      }
      if (user?.id && timesheet) {
        void recordTimeEvent(timesheet.id, { type: 'clockOut', by: user.id, at: endTime });
      }
      setEndShiftDialog({ open: false });
      toast.success('Schicht beendet.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Fehler beim Beenden');
    }
  };

  const handleEndShiftClick = async () => {
    if (!timesheet) return;
    const now = new Date();
    const endTime = now.toTimeString().slice(0, 5);

    // Laufende Pause automatisch mit abschließen (inkl. pauseEnd-Event,
    // damit der Verlauf konsistent bleibt)
    const runningPause = runningPauseMinutes();
    if (runningPause > 0 && user?.id) {
      void recordTimeEvent(timesheet.id, {
        type: 'pauseEnd',
        by: user.id,
        note: `${runningPause} Min (automatisch beim Schichtende)`,
      });
    }
    const totalBreaks = (timesheet.breakMinutes ?? 0) + runningPause;

    // Brutto-Anwesenheit (Overnight: Ende vor Start → +24h)
    let grossMinutes = timeToMinutes(endTime) - timeToMinutes(timesheet.startTime);
    if (grossMinutes < 0) grossMinutes += 24 * 60;
    const workedMinutes = Math.max(0, grossMinutes - totalBreaks);

    const required = statutoryBreakFor(workedMinutes);
    if (totalBreaks < required) {
      setEndShiftDialog({ open: true, endTime, suggestedBreak: required, workedMinutes, currentBreaks: totalBreaks });
      return;
    }
    await finishShift(endTime, totalBreaks);
  };

  if (authLoading || isLoading || loadingAssignment) {
    return <LoadingSpinner variant="skeleton" message="Zeiterfassung wird geladen..." />;
  }

  if (error) {
    return <ErrorDisplay error={error} />;
  }

  if (!user) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '50vh',
        }}
      >
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="h3" sx={{ color: 'text.primary', fontWeight: 700, mb: 2 }}>
            Schichtklar
          </Typography>
          <Typography variant="body1" sx={{ color: 'text.secondary' }}>
            Bitte melde dich an, um fortzufahren
          </Typography>
        </Box>
      </Box>
    );
  }

  // Prüfe ob ein akzeptiertes Assignment vorhanden ist
  if (!hasAcceptedAssignment && !timesheet) {
    return (
      <PageContainer maxWidth="standard">
        <Box sx={{ mb: 4, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
          <Typography variant="h2" component="h1" sx={{ color: 'text.primary', mb: 1 }}>
            Arbeitszeit erfassen
          </Typography>
          <Button variant="outlined" size="small" onClick={() => router.push('/employee/zeiten')}>
            Mein Zeitkonto
          </Button>
        </Box>

        <EmptyState
          icon={<EventAvailable />}
          title="Kein akzeptierter Einsatz"
          description="Zeiten lassen sich erst erfassen, wenn dir ein Einsatz zugewiesen wurde und du ihn akzeptiert hast. Prüfe dazu deinen Dienstplan."
          action={{ label: 'Zum Dienstplan', onClick: () => router.push('/employee/dienstplan') }}
        />

        {/* Zeige vorhandene Zeiterfassungen an */}
        {recentTimesheets && recentTimesheets.length > 0 && (
          <Box sx={{ mt: 4 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Vergangene Zeiterfassungen
            </Typography>
            <TimesheetHistory timesheets={recentTimesheets} onEdit={handleEditTimesheet} />
          </Box>
        )}
      </PageContainer>
    );
  }

  return (
    <PageContainer maxWidth="standard">
      <Box sx={{ mb: 4, display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
        <Box>
          <Typography variant="h2" component="h1" sx={{ color: 'text.primary', mb: 1 }}>
            Arbeitszeit erfassen
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Erfasse deine Arbeitszeiten manuell
          </Typography>
        </Box>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <Button variant="outlined" size="small" onClick={() => router.push('/employee/zeiten')}>
            Mein Zeitkonto
          </Button>
          <SyncStatusIndicator />
        </Stack>
      </Box>

      {/* Einsatz-Informationen */}
      {hasAcceptedAssignment && assignmentDetails && (
        <Card sx={{ mb: 3, bgcolor: 'background.paper', borderRadius: 2 }} elevation={0}>
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
              Einsatz-Informationen
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Die Arbeitszeiterfassung ist an Datum und Uhrzeiten dieses Einsatzes gekoppelt. Das Formular wird mit den Einsatzzeiten vorausgefüllt.
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Stack spacing={1.5}>
                  {/* Einrichtung und Station */}
                  {assignmentDetails.facility && (
                    <Stack direction="row" alignItems="flex-start" spacing={1}>
                      <LocationOn sx={{ fontSize: 20, color: 'text.secondary', mt: 0.5 }} />
                      <Box>
                        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
                          Einrichtung
                        </Typography>
                        <Typography variant="body1">
                          {assignmentDetails.facility.name}
                          {assignmentDetails.station && ` - ${assignmentDetails.station.name}`}
                        </Typography>
                        {assignmentDetails.facility.address && (
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            {assignmentDetails.facility.address}
                          </Typography>
                        )}
                      </Box>
                    </Stack>
                  )}

                  {/* Arbeitszeiten */}
                  {assignmentDetails.shift && (
                    <Stack direction="row" alignItems="flex-start" spacing={1}>
                      <AccessTime sx={{ fontSize: 20, color: 'text.secondary', mt: 0.5 }} />
                      <Box>
                        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
                          Arbeitszeiten
                        </Typography>
                        <Typography variant="body1">
                          {assignmentDetails.shift.startTime} - {assignmentDetails.shift.endTime}
                        </Typography>
                        {assignmentDetails.shift.date && (
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            {new Date(assignmentDetails.shift.date).toLocaleDateString('de-DE', {
                              weekday: 'long',
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                            })}
                          </Typography>
                        )}
                      </Box>
                    </Stack>
                  )}
                </Stack>
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <Stack spacing={1.5}>
                  {/* Ansprechpartner */}
                  {assignmentDetails.facility?.contactPerson && (
                    <Stack direction="row" alignItems="flex-start" spacing={1}>
                      <Person sx={{ fontSize: 20, color: 'text.secondary', mt: 0.5 }} />
                      <Box>
                        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 600 }}>
                          Ansprechpartner
                        </Typography>
                        <Typography variant="body1">
                          {assignmentDetails.facility.contactPerson}
                        </Typography>
                        {assignmentDetails.facility.phone && (
                          <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.5 }}>
                            <Phone sx={{ fontSize: 14, color: 'text.secondary' }} />
                            <Typography variant="body2" color="text.secondary">
                              {assignmentDetails.facility.phone}
                            </Typography>
                          </Stack>
                        )}
                        {assignmentDetails.facility.email && (
                          <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.5 }}>
                            <Email sx={{ fontSize: 14, color: 'text.secondary' }} />
                            <Typography variant="body2" color="text.secondary">
                              {assignmentDetails.facility.email}
                            </Typography>
                          </Stack>
                        )}
                      </Box>
                    </Stack>
                  )}
                </Stack>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      )}

      {/* Schnell-Erfassung */}
      {hasAcceptedAssignment && (
        <Card sx={{ mb: 3, bgcolor: 'background.paper', borderRadius: 2 }} elevation={0}>
          <CardContent>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
              Schnell-Erfassung
            </Typography>
            {timesheet && timesheet.status === 'draft' && (!timesheet.endTime || timesheet.endTime === timesheet.startTime) ? (
              <>
                <LiveShiftTimer
                  startTime={timesheet.startTime}
                  endTime={assignmentDetails?.shift?.endTime}
                />
                <Stack direction="row" spacing={2} flexWrap="wrap" justifyContent="center" sx={{ mt: 1 }}>
                  <Button
                    variant="contained"
                    startIcon={<Pause />}
                    size="large"
                    color={pauseStartedAt ? 'success' : 'warning'}
                    sx={{ boxShadow: 'none', '&:hover': { boxShadow: 'none' } }}
                    data-testid="pause-button"
                    aria-label={pauseStartedAt ? 'Pause beenden' : 'Pause starten'}
                    disabled={updateTimesheet.isPending}
                    onClick={() => void handleTogglePause()}
                  >
                    {pauseStartedAt ? 'Pause beenden' : 'Pause'}
                  </Button>
                  <Button
                    variant="contained"
                    color="error"
                    startIcon={<Stop />}
                    size="large"
                    sx={{ boxShadow: 'none', '&:hover': { boxShadow: 'none' } }}
                    data-testid="end-shift-button"
                    aria-label="Schicht beenden"
                    disabled={updateTimesheet.isPending}
                    onClick={() => void handleEndShiftClick()}
                  >
                    Schicht beenden
                  </Button>
                </Stack>
                <TimeEventTrail timesheetId={timesheet.id} />
              </>
            ) : (
              <Typography variant="body1" color="text.secondary">
                Keine laufende Schicht. Nutzen Sie das Formular unten, um Zeiten zu erfassen oder zu starten.
              </Typography>
            )}
          </CardContent>
        </Card>
      )}

      {/* Zeiten manuell eintragen */}
      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
        Zeiten manuell eintragen
      </Typography>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 6 }}>
          {!hasAcceptedAssignment && timesheet && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Sie bearbeiten eine bestehende Zeiterfassung. Für neue Zeiterfassungen benötigen Sie
              ein akzeptiertes Assignment.
            </Alert>
          )}
          <TimesheetForm
            initialData={
              editingTimesheet ||
              (timesheet
                ? {
                    date: timesheet.date,
                    startTime: timesheet.startTime,
                    endTime: timesheet.endTime,
                    breakMinutes: timesheet.breakMinutes,
                    notes: timesheet.notes,
                  }
                : undefined)
            }
            onSubmit={handleSubmitTimesheet}
            isLoading={createTimesheet.isPending || updateTimesheet.isPending}
            isEdit={!!editingTimesheet || !!timesheet}
            disabled={!hasAcceptedAssignment && !timesheet}
          />
        </Grid>

        {/* Heutige Einträge */}
        <Grid size={{ xs: 12, md: 6 }}>
          <TimesheetHistory timesheets={recentTimesheets} onEdit={handleEditTimesheet} />
        </Grid>
      </Grid>
      {/* Tages-Signatur durch Einrichtung auf Mitarbeitergerät */}
      {openDailySignature.tsId && (
        <DailySignatureDialog
          open={openDailySignature.open}
          onClose={() => setOpenDailySignature({ open: false })}
          timesheetId={openDailySignature.tsId}
          date={openDailySignature.date || new Date()}
        />
      )}

      {/* Relieving Personnel Signature Dialog */}
      {openRelievingSignature.assignmentId && (
        <RelievingPersonnelSignatureDialog
          open={openRelievingSignature.open}
          onClose={() => setOpenRelievingSignature({ open: false })}
          assignmentId={openRelievingSignature.assignmentId}
          timesheetId={openRelievingSignature.timesheetId}
          date={openRelievingSignature.date || new Date()}
          onSuccess={() => {
            // Nach erfolgreicher Signatur: Prüfe ob noch weitere Signaturen erforderlich sind
            // oder ob PDF generiert werden soll
            toast.success('Signatur durch ablösendes Personal erfolgreich gespeichert');
          }}
        />
      )}

      {/* Checkout-Dialog: gesetzliche Mindestpause (§4 ArbZG) */}
      <Dialog open={endShiftDialog.open} onClose={() => setEndShiftDialog({ open: false })} maxWidth="xs" fullWidth>
        <DialogTitle>Pause fehlt</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            Bei {Math.floor((endShiftDialog.workedMinutes ?? 0) / 60)}:
            {String((endShiftDialog.workedMinutes ?? 0) % 60).padStart(2, '0')} Stunden Arbeitszeit
            schreibt das Arbeitszeitgesetz (§4 ArbZG) mindestens{' '}
            <strong>{endShiftDialog.suggestedBreak} Minuten Pause</strong> vor — erfasst sind
            bisher {endShiftDialog.currentBreaks ?? timesheet?.breakMinutes ?? 0} Minuten.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Soll die gesetzliche Mindestpause übernommen werden? Ohne ausreichende Pause kann die
            Zeiterfassung später nicht eingereicht werden.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEndShiftDialog({ open: false })}>Abbrechen</Button>
          <Button
            variant="contained"
            onClick={() =>
              void finishShift(endShiftDialog.endTime || '', endShiftDialog.suggestedBreak || 0)
            }
          >
            {endShiftDialog.suggestedBreak} Min übernehmen & beenden
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
}
