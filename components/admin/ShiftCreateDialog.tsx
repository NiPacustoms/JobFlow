'use client';

import { useAuth } from '@/contexts/AuthContext';
import { cloudFunctions, facilityService, shiftService, userService } from '@/lib/services';
import { sendAssignmentFormEmail } from '@/lib/services/email';
import { toast } from '@/lib/utils/toast';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormHelperText,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { FormControlLabel, Switch } from '@mui/material';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Facility, User } from '@/lib/types';
import { de } from 'date-fns/locale';
import { useEffect, useState } from 'react';
import { addDays, eachDayOfInterval, format } from 'date-fns';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { logger, PerformanceMonitor, UserActionTracker } from '@/lib/logging';
import { SHIFT_COLOR_PRESETS, DEFAULT_SHIFT_COLOR } from '@/lib/constants/colorPresets';
import { ColorPresetSwatches } from '@/components/ui/ColorPresetSwatches';

// Validation Schema
const shiftCreateSchema = z
  .object({
    facilityId: z.string().min(1, 'Einrichtung ist erforderlich'),
    date: z.coerce.date().refine(d => d instanceof Date && !isNaN(d.getTime()), {
      message: 'Datum ist erforderlich',
    }),
    dateTo: z.coerce.date().optional(),
    useRange: z.boolean().optional(),
    startTime: z.string().min(1, 'Startzeit ist erforderlich'),
    endTime: z.string().min(1, 'Endzeit ist erforderlich'),
    type: z.string().optional(),
    capacity: z.number().min(1, 'Kapazität muss mindestens 1 sein'),
    requiredQualifications: z.array(z.string()),
    notes: z.string().optional(),
    color: z.string().optional(),
    assignedUserId: z.string().optional(), // Optional: Mitarbeiter direkt zuweisen
  })
  .superRefine((val, ctx) => {
    const { startTime, endTime } = val;
    if (!startTime || !endTime) return;
    // allow overnight (end < start), but disallow equal times
    if (startTime === endTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Endzeit muss ungleich Startzeit sein',
        path: ['endTime'],
      });
      return;
    }
    // If not overnight, ensure end > start
    if (endTime > startTime) return;
    // Overnight is allowed; no issue

    if (val.useRange) {
      const from = val.date;
      const to = val.dateTo ?? val.date;
      if (to < from) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Bis-Datum muss nach Von-Datum liegen',
          path: ['dateTo'],
        });
      }
    }
  });

type ShiftCreateFormData = z.infer<typeof shiftCreateSchema>;

interface ShiftCreateDialogProps {
  open: boolean;
  onClose: () => void;
  initialDate?: Date | null;
}

export function ShiftCreateDialog({ open, onClose, initialDate }: ShiftCreateDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isOvernight, setIsOvernight] = useState(false);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });

  const {
    register: _register,
    handleSubmit,
    formState: { errors },
    setValue,
    watch,
    reset,
  } = useForm<ShiftCreateFormData>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(shiftCreateSchema) as any,
    defaultValues: {
      facilityId: '',
      capacity: 1,
      requiredQualifications: [],
      type: 'Frühdienst', // Backend erwartet type; in der UI nicht mehr auswählbar
      date: initialDate || new Date(),
      dateTo: initialDate || new Date(),
      useRange: false,
      startTime: '',
      endTime: '',
      notes: '',
      color: DEFAULT_SHIFT_COLOR,
      assignedUserId: '', // Optional: Mitarbeiter direkt zuweisen
    },
  });

  // Aktualisiere Datum bei geänderten Props, wenn Dialog geöffnet wird
  useEffect(() => {
    if (open && initialDate) {
      setValue('date', initialDate);
    }
  }, [open, initialDate, setValue]);

  // Facilities laden
  const { data: facilities = [] } = useQuery<Facility[]>({
    queryKey: ['facilities'],
    queryFn: () => facilityService.getAll(),
  });

  // Mitarbeiter laden (nur aktive)
  const { data: availableUsers = [], isLoading: usersLoading } = useQuery<User[]>({
    queryKey: ['availableUsersForAssignment'],
    queryFn: async () => {
      // Lade alle aktiven Mitarbeiter (nicht nur Krankenschwestern, da auch andere Rollen zugewiesen werden können)
      const response = await userService.getAll();
      const allUsers = Array.isArray(response) ? response : response.data;
      return allUsers.filter(user => user.active !== false && user.role !== 'admin');
    },
  });

  // Schicht erstellen
  const createShiftMutation = useMutation({
    mutationFn: async (data: ShiftCreateFormData) => {
      if (!user?.id) throw new Error('User not authenticated');

      // Overnight (Ende vor Start): Enddatum = Folgetag mitschreiben
      const overnightEndDate =
        data.endTime < data.startTime && data.date
          ? addDays(data.date instanceof Date ? data.date : new Date(data.date), 1)
          : undefined;

      return await shiftService.createWithCapacity({
        ...data,
        ...(overnightEndDate ? { endDate: overnightEndDate } : {}),
        createdBy: user.id,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    },
    retry: 2,
    retryDelay: attempt => Math.min(1000 * Math.pow(2, attempt), 5000),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      // onClose und reset werden in onSubmit nach Zuweisung aufgerufen
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
      toast.error('Fehler beim Erstellen der Schicht: ' + message);
    },
  });

  // Mitarbeiter zuweisen
  const assignUserMutation = useMutation({
    mutationFn: async ({ shiftId, user }: { shiftId: string; user: User }) => {
      // Admins können Konflikte überschreiben
      const result = await cloudFunctions.assignShiftToUser(shiftId, user.id, false, true);
      return { result, user };
    },
    retry: 2,
    retryDelay: attempt => Math.min(1000 * Math.pow(2, attempt), 5000),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['schedule'] });
      queryClient.invalidateQueries({ queryKey: ['assignedUsers'] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Unbekannter Fehler';
      toast.error('Fehler beim Zuweisen des Mitarbeiters: ' + message);
    },
  });

  const handleFacilityChange = (facilityId: string) => {
    setValue('facilityId', facilityId);
  };

  const handleTimeChange = (field: 'startTime' | 'endTime', value: string) => {
    setValue(field, value);

    // Overnight-Check
    const startTime = field === 'startTime' ? value : watch('startTime');
    const endTime = field === 'endTime' ? value : watch('endTime');

    if (startTime && endTime) {
      const overnight = endTime < startTime;
      setIsOvernight(overnight);
    }
  };

  const onSubmit = async (data: ShiftCreateFormData) => {
    if (process.env.NODE_ENV === 'development') {
      PerformanceMonitor.startTimer('shift.create');
      UserActionTracker.trackAction('shift_create_submit', {
        facilityId: data.facilityId,
        type: data.type,
      });
    }

    const assignedUserId = data.assignedUserId;

    if (!data.useRange) {
      // Einzelne Schicht erstellen
      createShiftMutation.mutate(data, {
        onSuccess: async shiftId => {
          if (process.env.NODE_ENV === 'development') {
            PerformanceMonitor.endTimer('shift.create', { result: 'success' });
          }
          logger.info('Shift created', { type: data.type, facilityId: data.facilityId } as Record<
            string,
            unknown
          >);

          // Mitarbeiter zuweisen, falls ausgewählt
          if (assignedUserId && shiftId) {
            const assignedUser = availableUsers.find(u => u.id === assignedUserId);
            if (assignedUser) {
              try {
                const { result } = await assignUserMutation.mutateAsync({
                  shiftId,
                  user: assignedUser,
                });
                const assignmentId = result.assignmentId;

                // E-Mail- und Push-Benachrichtigung versenden
                const shiftDate = data.date instanceof Date ? data.date : new Date(data.date);
                const shiftInfo = `${format(shiftDate, 'dd.MM.yyyy', { locale: de })} • ${data.startTime} - ${data.endTime}`;
                const formLink = assignmentId
                  ? `/employee/formulare/einsaetze/${assignmentId}`
                  : null;
                const fullFormLink =
                  formLink && typeof window !== 'undefined'
                    ? new URL(formLink, window.location.origin).toString()
                    : (formLink ?? undefined);

                if (assignedUser.email && formLink) {
                  try {
                    await sendAssignmentFormEmail({
                      to: assignedUser.email,
                      employeeName: assignedUser.displayName,
                      formLink: fullFormLink ?? formLink ?? '',
                      shiftInfo,
                    });
                  } catch (emailError) {
                    logger.warn('Fehler beim Versenden der E-Mail-Benachrichtigung:', emailError);
                  }
                }

                toast.success(result.message || 'Schicht erstellt und Mitarbeiter zugewiesen!');
              } catch (assignError) {
                // Log the error for debugging
                const errorMessage =
                  assignError instanceof Error ? assignError.message : 'Unbekannter Fehler';
                const error =
                  assignError instanceof Error ? assignError : new Error(String(assignError));
                logger.error('Fehler bei automatischer Zuweisung nach Erstellung', error, {
                  component: 'ShiftCreateDialog',
                  action: 'auto-assign-after-create',
                  timestamp: new Date(),
                });

                // Show user-friendly error message
                toast.error(`Schicht erstellt, aber Zuweisung fehlgeschlagen: ${errorMessage}`);
                toast.success('Schicht erfolgreich erstellt!');
              }
            } else {
              toast.info('Schicht erstellt, aber Mitarbeiterdaten konnten nicht geladen werden');
            }
          } else {
            toast.success('Schicht erfolgreich erstellt!');
          }

          // Dialog schließen und Formular zurücksetzen
          onClose();
          reset();
        },
        onError: (err: unknown) => {
          if (process.env.NODE_ENV === 'development') {
            PerformanceMonitor.endTimer('shift.create', { result: 'error' });
          }
          logger.error(
            'Shift create failed',
            err instanceof Error ? err : new Error('Unknown error'),
            { type: data.type } as Record<string, unknown>
          );
        },
      });
    } else {
      // Zeitraum: Mehrere Schichten erstellen
      const start = data.date;
      const end = data.dateTo || data.date;
      const days = eachDayOfInterval({ start, end });
      // Generiere eine gemeinsame shiftGroupId für alle Schichten im Zeitraum
      const shiftGroupId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      (async () => {
        try {
          const createdShiftIds: string[] = [];

          for (const day of days) {
            // Als Date (lokale Mitternacht) speichern – identisch zum
            // Einzelschicht-Pfad. Der frühere toISOString()-String rutschte in
            // Europe/Berlin auf den Vortag UND war für Date-Range-Queries
            // unsichtbar (String matcht keinen Timestamp).
            const dayDate = typeof day === 'string' ? new Date(day) : day;
            // Overnight: Ende liegt vor dem Start → Enddatum ist der Folgetag
            const overnightEndDate =
              data.endTime < data.startTime ? addDays(dayDate, 1) : undefined;
            const shiftId = await shiftService.createWithCapacity({
              facilityId: data.facilityId,
              date: dayDate,
              ...(overnightEndDate ? { endDate: overnightEndDate } : {}),
              startTime: data.startTime,
              endTime: data.endTime,
              type: data.type,
              capacity: data.capacity,
              requiredQualifications: data.requiredQualifications,
              notes: data.notes,
              color: data.color,
              shiftGroupId: shiftGroupId,
              createdBy: user?.id || 'system',
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any);

            createdShiftIds.push(shiftId);
          }

          // Mitarbeiter allen Schichten im Zeitraum zuweisen, falls ausgewählt
          if (assignedUserId) {
            const assignedUser = availableUsers.find(u => u.id === assignedUserId);
            if (!assignedUser) {
              toast.error('Ausgewählter Mitarbeiter ist nicht mehr verfügbar.');
            } else {
              let assignedCount = 0;
              let failedCount = 0;
              let firstAssignmentId: string | undefined;

              for (const shiftId of createdShiftIds) {
                try {
                  const { result } = await assignUserMutation.mutateAsync({
                    shiftId,
                    user: assignedUser,
                  });
                  const assignmentId = result?.assignmentId;
                  if (assignmentId && !firstAssignmentId) {
                    firstAssignmentId = assignmentId;
                  }
                  assignedCount++;
                } catch (_assignError) {
                  failedCount++;
                }
              }

              // E-Mail- und Push-Benachrichtigung für die erste Zuweisung versenden
              if (assignedCount > 0 && firstAssignmentId) {
                const shiftDate = data.date instanceof Date ? data.date : new Date(data.date);
                const shiftInfo = `${format(shiftDate, 'dd.MM.yyyy', { locale: de })} - ${data.dateTo ? format(data.dateTo instanceof Date ? data.dateTo : new Date(data.dateTo), 'dd.MM.yyyy', { locale: de }) : format(shiftDate, 'dd.MM.yyyy', { locale: de })} • ${data.startTime} - ${data.endTime}`;
                const formLink = `/employee/formulare/einsaetze/${firstAssignmentId}`;
                const fullFormLink =
                  typeof window !== 'undefined'
                    ? new URL(formLink, window.location.origin).toString()
                    : formLink;

                // E-Mail-Benachrichtigung
                if (assignedUser.email) {
                  try {
                    await sendAssignmentFormEmail({
                      to: assignedUser.email,
                      employeeName: assignedUser.displayName,
                      formLink: fullFormLink,
                      shiftInfo: `Zeitraum: ${shiftInfo}`,
                    });
                  } catch (emailError) {
                    logger.warn('Fehler beim Versenden der E-Mail-Benachrichtigung:', emailError);
                  }
                }
              }

              if (assignedCount > 0) {
                toast.success(
                  `Schichten für Zeitraum erstellt. Mitarbeiter ${assignedCount} von ${createdShiftIds.length} Schichten zugewiesen.${failedCount > 0 ? ` (${failedCount} Fehler)` : ''}`
                );
              } else {
                toast.warning('Schichten erstellt, aber Zuweisung fehlgeschlagen.');
              }
            }
          } else {
            toast.success('Schichten für Zeitraum erstellt');
          }

          if (process.env.NODE_ENV === 'development') {
            PerformanceMonitor.endTimer('shift.create', { result: 'success_range' });
          }
          queryClient.invalidateQueries({ queryKey: ['shifts'] });
          queryClient.invalidateQueries({ queryKey: ['schedule'] });
          handleClose();
        } catch (err) {
          if (process.env.NODE_ENV === 'development') {
            PerformanceMonitor.endTimer('shift.create', { result: 'error_range' });
          }
          const message =
            err instanceof Error ? err.message : 'Fehler beim Erstellen des Zeitraums';
          toast.error(message);
          logger.error(
            'Shift range create failed',
            err instanceof Error ? err : new Error('Unknown error')
          );
        }
      })();
    }
  };

  const handleClose = () => {
    reset();
    setIsOvernight(false);
    onClose();
  };

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={de}>
      <Dialog
        open={open}
        onClose={handleClose}
        maxWidth="md"
        fullWidth
        fullScreen={isMobile}
        sx={isMobile ? { '& .MuiDialog-container': { alignItems: 'flex-end' } } : undefined}
        PaperProps={{
          sx: isMobile ? { borderRadius: '20px 20px 0 0' } : { borderRadius: 3 },
          onTouchStart: isMobile
            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (e: any) => {
                (e.currentTarget as unknown as { __touchStartY?: number }).__touchStartY =
                  e.touches[0].clientY;
              }
            : undefined,
          onTouchMove: isMobile
            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (e: any) => {
                (e.currentTarget as unknown as { __touchMoveY?: number }).__touchMoveY =
                  e.touches[0].clientY;
              }
            : undefined,
          onTouchEnd: isMobile
            ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
              (e: any) => {
                const current = e.currentTarget as unknown as {
                  __touchStartY?: number;
                  __touchMoveY?: number;
                };
                const startY = current.__touchStartY || 0;
                const endY = current.__touchMoveY || startY;
                if (endY - startY > 60) handleClose();
              }
            : undefined,
        }}
      >
        <DialogTitle
          sx={{
            fontSize: isMobile ? 18 : 20,
            py: isMobile ? 1.5 : 2.5,
            fontWeight: 700,
          }}
        >
          Neue Schicht erstellen
        </DialogTitle>

        <form onSubmit={handleSubmit(onSubmit)}>
          <DialogContent sx={{ py: isMobile ? 1 : undefined }}>
            <Grid container spacing={isMobile ? 2 : 3}>
              {/* Einrichtung */}
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl fullWidth error={!!errors.facilityId}>
                  <InputLabel>Einrichtung</InputLabel>
                  <Select
                    value={watch('facilityId') ?? ''}
                    label="Einrichtung"
                    onChange={e => handleFacilityChange(e.target.value)}
                  >
                    {facilities.map(facility => (
                      <MenuItem key={facility.id} value={facility.id}>
                        {facility.name}
                      </MenuItem>
                    ))}
                  </Select>
                  {errors.facilityId && (
                    <FormHelperText component="div">{errors.facilityId.message}</FormHelperText>
                  )}
                </FormControl>
              </Grid>

              {/* Datum */}
              <Grid size={{ xs: 12, sm: 6 }}>
                <DatePicker
                  label="Datum"
                  value={(watch('date') || initialDate || new Date()) as unknown as Date}
                  onChange={date => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    setValue('date', (date || new Date()) as any);
                  }}
                  slotProps={{
                    textField: {
                      fullWidth: true,
                      error: !!errors.date,
                      helperText: errors.date?.message,
                      size: isMobile ? 'medium' : 'small',
                    },
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={Boolean(watch('useRange'))}
                      onChange={e => setValue('useRange', e.target.checked)}
                    />
                  }
                  label="Zeitraum verwenden"
                />
              </Grid>

              {watch('useRange') && (
                <Grid size={{ xs: 12, sm: 6 }}>
                  <DatePicker
                    label="Bis Datum"
                    value={
                      (watch('dateTo') ||
                        watch('date') ||
                        initialDate ||
                        new Date()) as unknown as Date
                    }
                    onChange={date => {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      setValue('dateTo', (date || new Date()) as any);
                    }}
                    slotProps={{
                      textField: {
                        fullWidth: true,
                        error: !!errors.dateTo,
                        helperText: errors.dateTo?.message,
                        size: isMobile ? 'medium' : 'small',
                      },
                    }}
                  />
                </Grid>
              )}

              {/* Startzeit */}
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="Startzeit"
                  type="time"
                  value={watch('startTime') ?? ''}
                  onChange={e => handleTimeChange('startTime', e.target.value)}
                  error={!!errors.startTime}
                  helperText={errors.startTime?.message}
                  InputLabelProps={{ shrink: true }}
                  size={isMobile ? 'medium' : 'small'}
                />
              </Grid>

              {/* Endzeit */}
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="Endzeit"
                  type="time"
                  value={watch('endTime') ?? ''}
                  onChange={e => handleTimeChange('endTime', e.target.value)}
                  error={!!errors.endTime}
                  helperText={errors.endTime?.message}
                  InputLabelProps={{ shrink: true }}
                  size={isMobile ? 'medium' : 'small'}
                />
              </Grid>

              {/* Overnight-Hinweis */}
              {isOvernight && (
                <Grid size={{ xs: 12 }}>
                  <Alert severity="info">
                    <Typography component="span" variant="body2">
                      <strong>Overnight-Schicht erkannt:</strong> Die Endzeit liegt vor der
                      Startzeit. Die Schicht geht über Mitternacht bis zum{' '}
                      <strong>
                        {format(addDays((watch('date') as Date) || new Date(), 1), 'dd.MM.yyyy', { locale: de })}
                      </strong>{' '}
                      (Folgetag) und wird automatisch korrekt berechnet.
                    </Typography>
                  </Alert>
                </Grid>
              )}

              {/* Kapazität */}
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  label="Kapazität"
                  type="number"
                  value={watch('capacity') ?? 1}
                  onChange={e => setValue('capacity', parseInt(e.target.value) || 1)}
                  error={!!errors.capacity}
                  helperText={errors.capacity?.message || 'Anzahl der benötigten Mitarbeiter'}
                  inputProps={{ min: 1 }}
                  size={isMobile ? 'medium' : 'small'}
                />
              </Grid>

              {/* Erforderliche Qualifikationen */}
              {/* Qualifikations-Auswahl entfällt ohne Stationsauswahl */}

              {/* Farbe – nur 8 Vorauswahlen, keine Pipette */}
              <Grid size={{ xs: 12, sm: 6 }}>
                <ColorPresetSwatches
                  presets={SHIFT_COLOR_PRESETS}
                  value={watch('color') ?? DEFAULT_SHIFT_COLOR}
                  onChange={c => setValue('color', c)}
                  label="Farbe"
                  helperText={errors.color?.message || 'Farbe für die Schicht im Kalender'}
                />
              </Grid>

              {/* Mitarbeiter zuweisen (optional) */}
              <Grid size={{ xs: 12 }}>
                <FormControl fullWidth>
                  <InputLabel>Mitarbeiter zuweisen (optional)</InputLabel>
                  <Select
                    value={watch('assignedUserId') ?? ''}
                    label="Mitarbeiter zuweisen (optional)"
                    onChange={e => setValue('assignedUserId', e.target.value)}
                    disabled={usersLoading}
                    size={isMobile ? 'medium' : 'small'}
                  >
                    <MenuItem value="">
                      <em>Keine Zuweisung</em>
                    </MenuItem>
                    {availableUsers.map(employee => (
                      <MenuItem key={employee.id} value={employee.id}>
                        {employee.displayName} {employee.email ? `(${employee.email})` : ''}
                      </MenuItem>
                    ))}
                  </Select>
                  <FormHelperText component="div">
                    Optional: Wählen Sie einen Mitarbeiter aus, der dieser Schicht direkt zugewiesen
                    werden soll.
                    {watch('useRange') &&
                      ' Bei Zeiträumen wird der Mitarbeiter allen Schichten zugewiesen.'}
                  </FormHelperText>
                </FormControl>
              </Grid>

              {/* Notizen */}
              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth
                  label="Notizen (optional)"
                  multiline
                  rows={3}
                  value={watch('notes') ?? ''}
                  onChange={e => setValue('notes', e.target.value)}
                  error={!!errors.notes}
                  helperText={errors.notes?.message}
                  size={isMobile ? 'medium' : 'small'}
                />
              </Grid>
            </Grid>

            {/* Fehleranzeige */}
            {!!createShiftMutation.error && (
              <Alert
                severity="error"
                sx={{
                  mt: 2,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'error.main',
                }}
              >
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {String(createShiftMutation.error as any)}
              </Alert>
            )}
          </DialogContent>

          <DialogActions sx={{ p: 3, pt: 2 }}>
            <Button
              onClick={handleClose}
              disabled={createShiftMutation.isPending || assignUserMutation.isPending}
              size={isMobile ? 'large' : 'medium'}
              fullWidth={isMobile}
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                borderRadius: 2,
              }}
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={createShiftMutation.isPending || assignUserMutation.isPending}
              size={isMobile ? 'large' : 'medium'}
              fullWidth={isMobile}
              sx={{
                textTransform: 'none',
                fontWeight: 600,
                borderRadius: 2,
                px: 3,
                boxShadow: 'var(--shadow-soft)',
              }}
            >
              {createShiftMutation.isPending || assignUserMutation.isPending
                ? 'Erstelle...'
                : 'Schicht erstellen'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </LocalizationProvider>
  );
}
