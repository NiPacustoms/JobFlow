'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { logger } from '@/lib/logging';
import { useNurseSchedule } from '@/lib/hooks/useNurseSchedule';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  parseISO,
  isValid,
} from 'date-fns';
import { de } from 'date-fns/locale';
import {
  alpha,
  Box,
  Button,
  ButtonGroup,
  Card,
  CardContent,
  IconButton,
  Skeleton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { KeyboardArrowLeft, KeyboardArrowRight, Schedule } from '@mui/icons-material';
import { useState } from 'react';
import { AcceptShiftDialog } from './AcceptShiftDialog';
import { MyAssignmentCard } from './MyAssignmentCard';
import { Alert, Grid } from '@mui/material';

const WEEKDAY_LABELS = ['MO', 'DI', 'MI', 'DO', 'FR', 'SA', 'SO'];

export function NurseScheduleView() {
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
  const [calendarPeriod, setCalendarPeriod] = useState<'week' | 'month'>('month');
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [selectedAssignment, setSelectedAssignment] = useState<{
    id: string;
    shiftId: string;
    userId: string;
    status: string;
    assignedAt?: Date;
    createdAt?: Date;
  } | null>(null);
  const [acceptDialogOpen, setAcceptDialogOpen] = useState(false);

  const {
    myAssignments,
    pendingAssignments,
    upcomingAssignments,
    isLoading,
    error,
    acceptAssignment,
    declineAssignment,
    getShiftTypeColor,
    getStatusColor,
    getStatusLabel,
    formatTime,
    getTimeUntilShift,
  } = useNurseSchedule(viewMode === 'calendar' ? 'month' : calendarPeriod, currentDate);

  const handleAcceptAssignment = async (assignmentId: string) => {
    try {
      await acceptAssignment(assignmentId);
      setAcceptDialogOpen(false);
      setSelectedAssignment(null);
    } catch (error) {
      logger.error('Error accepting assignment:', error);
    }
  };

  const handleDeclineAssignment = async (assignmentId: string, reason?: string) => {
    try {
      await declineAssignment(assignmentId, reason);
    } catch (error) {
      logger.error('Error declining assignment:', error);
    }
  };

  const handleOpenAcceptDialog = (assignment: {
    id: string;
    shiftId: string;
    userId: string;
    status: string;
    assignedAt?: Date;
    createdAt?: Date;
  }) => {
    setSelectedAssignment(assignment);
    setAcceptDialogOpen(true);
  };

  const handlePrev = () => setCurrentDate(prev => addMonths(prev, -1));
  const handleNext = () => setCurrentDate(prev => addMonths(prev, 1));
  const handleToday = () => setCurrentDate(new Date());

  const monthInterval = (() => {
    const start = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  })();

  const assignmentsByDateKey: Record<string, typeof myAssignments> = {};
  for (const a of myAssignments) {
    const raw = (a as { startDate?: Date | string }).startDate;
    if (!raw) continue;
    const d = typeof raw === 'string' ? parseISO(raw) : raw;
    if (!isValid(d)) continue;
    const key = format(d, 'yyyy-MM-dd');
    if (!assignmentsByDateKey[key]) assignmentsByDateKey[key] = [];
    assignmentsByDateKey[key].push(a);
  }

  const upcomingForBox = [...pendingAssignments, ...upcomingAssignments].slice(0, 5);

  if (isLoading) {
    // Skeleton spiegelt das Ziel-Layout: Titel, Karte, Kalender
    return (
      <Box role="status" aria-live="polite" aria-label="Dienstplan wird geladen">
        <Skeleton variant="text" width={220} height={40} sx={{ mb: 1 }} />
        <Skeleton variant="text" width={320} height={20} sx={{ mb: 3 }} />
        <Skeleton variant="rounded" height={120} sx={{ mb: 3, borderRadius: 2 }} />
        <Skeleton variant="rounded" height={360} sx={{ borderRadius: 2 }} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          <Typography variant="h6" gutterBottom>Fehler beim Laden der Daten</Typography>
          <Typography variant="body2">{error.message}</Typography>
        </Alert>
      </Box>
    );
  }

  return (
    <Box className="min-height-viewport" sx={{ backgroundColor: 'background.default', pb: 10 }}>
      {/* Titel + Untertitel + Toggle Kalender/Liste */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
          <Box>
            <Typography variant="h2" component="h1" sx={{ color: 'text.primary', mb: 0.5 }}>
              Mein Dienstplan
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Übersicht deiner geplanten und ausstehenden Schichten
            </Typography>
          </Box>
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(_, v) => v != null && setViewMode(v)}
            size="small"
            sx={{ alignSelf: 'center' }}
          >
            <ToggleButton value="calendar" aria-label="Kalender">
              Kalender
            </ToggleButton>
            <ToggleButton value="list" aria-label="Liste">
              Liste
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Box>

      {viewMode === 'calendar' && (
        <>
          {/* Anstehende Dienste – ruhige Glas-Karte mit getöntem Icon */}
          <Card className="glass" sx={{ mb: 3 }}>
            <CardContent sx={{ p: 2.5, '&:last-child': { pb: 2.5 } }}>
              <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5 }}>
                <Box
                  sx={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: theme => alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.24 : 0.1),
                    color: theme => (theme.palette.mode === 'dark' ? 'primary.light' : 'primary.main'),
                  }}
                >
                  <Schedule fontSize="small" />
                </Box>
                <Typography variant="h5" component="h2">
                  Anstehende Dienste
                </Typography>
              </Stack>
              {upcomingForBox.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Keine anstehenden Dienste.
                </Typography>
              ) : (
                <Stack spacing={0.75}>
                  {upcomingForBox.map((a: any) => {
                    const raw = a.startDate ?? a.assignedAt;
                    const d = raw ? (typeof raw === 'string' ? new Date(raw) : raw) : null;
                    const timeStr = a.startTime && a.endTime ? `${a.startTime} – ${a.endTime}` : '';
                    return (
                      <Typography key={a.id} variant="body2" className="tabular-nums">
                        {d ? format(d, 'EEE, d.M.', { locale: de }) : '–'}
                        {timeStr ? ` · ${timeStr}` : ''}
                      </Typography>
                    );
                  })}
                </Stack>
              )}
            </CardContent>
          </Card>

          {/* Kalender-Steuerung: Woche / Monat, Pfeile, Heute, Monat/Jahr */}
          <Box sx={{ mb: 2 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 1.5,
                mb: 2,
              }}
            >
              <ButtonGroup size="small" variant="outlined">
                <Button
                  variant={calendarPeriod === 'week' ? 'contained' : 'outlined'}
                  onClick={() => setCalendarPeriod('week')}
                >
                  Woche
                </Button>
                <Button
                  variant={calendarPeriod === 'month' ? 'contained' : 'outlined'}
                  onClick={() => setCalendarPeriod('month')}
                >
                  Monat
                </Button>
              </ButtonGroup>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <IconButton size="small" onClick={handlePrev} aria-label="Vorheriger">
                  <KeyboardArrowLeft />
                </IconButton>
                <Typography variant="subtitle1" sx={{ minWidth: 140, textAlign: 'center' }}>
                  {format(currentDate, 'LLLL yyyy', { locale: de })}
                </Typography>
                <IconButton size="small" onClick={handleNext} aria-label="Nächster">
                  <KeyboardArrowRight />
                </IconButton>
              </Stack>
              <Button size="small" variant="outlined" onClick={handleToday}>
                Heute
              </Button>
            </Box>

            {/* Kalender-Grid (Monat) */}
            <Card className="glass" sx={{ overflow: 'hidden' }}>
              <CardContent sx={{ p: 0 }}>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(7, 1fr)',
                    borderBottom: 1,
                    borderColor: 'divider',
                  }}
                >
                  {WEEKDAY_LABELS.map(label => (
                    <Box
                      key={label}
                      sx={{
                        py: 1,
                        px: 0.5,
                        textAlign: 'center',
                        typography: 'caption',
                        color: 'text.secondary',
                        fontWeight: 600,
                      }}
                    >
                      {label}
                    </Box>
                  ))}
                </Box>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                  {monthInterval.map(day => {
                    const key = format(day, 'yyyy-MM-dd');
                    const dayAssignments = assignmentsByDateKey[key] || [];
                    const isCurrentMonth = isSameMonth(day, currentDate);
                    const today = isToday(day);
                    return (
                      <Box
                        key={key}
                        sx={{
                          minHeight: 56,
                          p: 0.5,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          borderRight: (theme: { palette: { divider: string } }) =>
                            (monthInterval.indexOf(day) + 1) % 7 !== 0 ? `1px solid ${theme.palette.divider}` : 'none',
                          borderBottom: 1,
                          borderColor: 'divider',
                          bgcolor: 'transparent',
                          color: !isCurrentMonth ? 'text.disabled' : 'text.primary',
                          borderRadius: 0,
                        }}
                      >
                        <Box
                          sx={{
                            width: 30,
                            height: 30,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: '50%',
                            mt: 0.25,
                            bgcolor: today ? 'primary.main' : 'transparent',
                          }}
                        >
                          <Typography
                            variant="body2"
                            className="tabular-nums"
                            sx={{
                              fontWeight: today ? 700 : 500,
                              color: today ? '#ffffff' : 'inherit',
                              lineHeight: 1,
                            }}
                          >
                            {format(day, 'd')}
                          </Typography>
                        </Box>
                        {dayAssignments.length > 0 && (
                          <Box sx={{ display: 'flex', gap: '3px', mt: 0.5, height: 6 }}>
                            {dayAssignments.slice(0, 3).map((a: any, i: number) => (
                              <Box
                                key={i}
                                sx={{
                                  width: 6,
                                  height: 6,
                                  borderRadius: '50%',
                                  bgcolor: isCurrentMonth
                                    ? getShiftTypeColor(a?.shift?.type ?? a?.type)
                                    : 'text.disabled',
                                }}
                              />
                            ))}
                          </Box>
                        )}
                      </Box>
                    );
                  })}
                </Box>
              </CardContent>
            </Card>
          </Box>
        </>
      )}

      {viewMode === 'list' && (
        <Box sx={{ mt: 2 }}>
          {pendingAssignments.length > 0 && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Schedule color="warning" />
                Ausstehende Entscheidungen ({pendingAssignments.length})
              </Typography>
              <Grid container spacing={2}>
                {pendingAssignments.map((assignment: any) => (
                  <Grid key={assignment.id} size={{ xs: 12, sm: 6, md: 4 }}>
                    <MyAssignmentCard
                      assignment={assignment}
                      onAccept={() => handleOpenAcceptDialog(assignment)}
                      onDecline={(reason?: string) => handleDeclineAssignment(assignment.id, reason ?? '')}
                      getShiftTypeColor={getShiftTypeColor as (type?: string) => string}
                      getStatusColor={getStatusColor as (status: string) => string}
                      getStatusLabel={getStatusLabel as (status: string) => string}
                      formatTime={formatTime}
                      getTimeUntilShift={(shift: { date: string | Date; startTime: string }) => {
                        const dateObj = typeof shift.date === 'string' ? new Date(shift.date) : shift.date;
                        return getTimeUntilShift({ ...(shift as any), date: dateObj } as any);
                      }}
                    />
                  </Grid>
                ))}
              </Grid>
            </Box>
          )}

          {upcomingAssignments.length > 0 && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Schedule color="primary" />
                Anstehende Dienste ({upcomingAssignments.length})
              </Typography>
              <Grid container spacing={2}>
                {upcomingAssignments.map((assignment: any) => (
                  <Grid key={assignment.id} size={{ xs: 12, sm: 6, md: 4 }}>
                    <MyAssignmentCard
                      assignment={assignment}
                      onAccept={() => handleOpenAcceptDialog(assignment)}
                      onDecline={(reason?: string) => handleDeclineAssignment(assignment.id, reason ?? '')}
                      getShiftTypeColor={getShiftTypeColor as (type?: string) => string}
                      getStatusColor={getStatusColor as (status: string) => string}
                      getStatusLabel={getStatusLabel as (status: string) => string}
                      formatTime={formatTime}
                      getTimeUntilShift={(shift: { date: string | Date; startTime: string }) => {
                        const dateObj = typeof shift.date === 'string' ? new Date(shift.date) : shift.date;
                        return getTimeUntilShift({ ...(shift as any), date: dateObj } as any);
                      }}
                    />
                  </Grid>
                ))}
              </Grid>
            </Box>
          )}

          {myAssignments.length === 0 && (
            <Card className="glass" sx={{ p: 4, textAlign: 'center' }}>
              <Typography variant="h6" color="text.secondary" gutterBottom>
                Keine Dienste geplant
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Du hast aktuell keine geplanten Schichten.
              </Typography>
            </Card>
          )}
        </Box>
      )}

      {selectedAssignment && (
        <AcceptShiftDialog
          open={acceptDialogOpen}
          onClose={() => {
            setAcceptDialogOpen(false);
            setSelectedAssignment(null);
          }}
          assignment={selectedAssignment as any}
          onAccept={() => handleAcceptAssignment(selectedAssignment.id)}
          getShiftTypeColor={getShiftTypeColor as (type?: string) => string}
        />
      )}
    </Box>
  );
}
