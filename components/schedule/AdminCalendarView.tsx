'use client';

import { Shift } from '@/lib/types';
import { assignmentService } from '@/lib/services';
import { DEFAULT_SHIFT_COLOR } from '@/lib/constants/colorPresets';
import { useShiftEnrichment } from '@/lib/hooks/useShiftEnrichment';
import { Add, ArrowBack, ArrowForward, Event, MoreVert, ViewWeek, CalendarMonth } from '@mui/icons-material';
import {
  Box,
  Button,
  IconButton,
  Typography,
  Grid,
  Paper,
  Chip,
  Menu,
  MenuItem,
  Tooltip,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItemButton,
  ListItemText,
  useMediaQuery,
  useTheme,
  type ChipProps,
} from '@mui/material';
import {
  addMonths,
  addWeeks,
  subWeeks,
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
import { useEffect, useMemo, useRef, useState } from 'react';
import { isShiftEnded } from '@/lib/utils/shiftStatus';

function FormStatusChip({ shiftId }: { shiftId: string }) {
  const [label, setLabel] = useState<string | null>(null);
  const [color, setColor] = useState<'default' | 'success' | 'warning' | 'error'>('default');
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const assignments = await assignmentService.getByShiftId(shiftId);
        if (!mounted) return;
        type AssignmentLite = { formStatus?: 'acknowledged' | 'declined' };
        const ack = assignments.filter(
          a => (a as unknown as AssignmentLite).formStatus === 'acknowledged'
        ).length;
        const dec = assignments.filter(
          a => (a as unknown as AssignmentLite).formStatus === 'declined'
        ).length;
        const total = assignments.length;
        const open = Math.max(0, total - ack - dec);
        const text = `${ack}✓/${dec}✕/${open}`;
        let c: typeof color = 'default';
        if (open > 0) c = 'warning';
        if (dec > 0) c = 'error';
        if (open === 0 && dec === 0 && ack > 0) c = 'success';
        setLabel(text);
        setColor(c);
      } catch {
        if (!mounted) return;
        setLabel(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [shiftId]);
  if (!label) return null;
  return <Chip size="small" label={label} color={color as ChipProps['color']} variant="outlined" />;
}

function CompletedChip({ shiftId }: { shiftId: string }) {
  const [completed, setCompleted] = useState<boolean | null>(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const assignments = await assignmentService.getByShiftId(shiftId);
        if (!mounted) return;
        if (assignments.length === 0) {
          setCompleted(false);
          return;
        }
        type AssignmentLite2 = { status: string; finalSummarySignedAt?: Date | string };
        setCompleted(
          assignments.every((a: unknown) => {
            const x = a as AssignmentLite2;
            return x.status === 'completed' && !!x.finalSummarySignedAt;
          })
        );
      } catch {
        setCompleted(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [shiftId]);
  if (!completed) return null;
  return <Chip size="small" color="success" label="Abgeschlossen" />;
}

interface AdminCalendarViewProps {
  shifts: Shift[];
  /** Wird an useShiftEnrichment übergeben, damit Einrichtungs- und Mitarbeiternamen geladen werden */
  companyId?: string;
  onShiftClick?: (shift: Shift) => void;
  onEdit?: (shift: Shift) => void;
  onAssign?: (shift: Shift) => void;
  onDelete?: (shift: Shift) => void;
  onDayClick?: (date: Date) => void;
  onDayLongPress?: (date: Date) => void;
}

export default function AdminCalendarView({
  shifts,
  companyId: companyIdProp,
  onShiftClick,
  onEdit,
  onAssign,
  onDelete,
  onDayClick,
  onDayLongPress,
}: AdminCalendarViewProps) {
  // Deterministische Farbzuteilung pro Mitarbeiter (aus userId)
  const getColorForUser = (userId: string): string => {
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash);
      hash |= 0;
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue} 65% 50%)`;
  };
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'), {
    noSsr: true,
  });
  const [currentMonth, setCurrentMonth] = useState<Date>(startOfMonth(new Date()));
  const [calendarViewMode, setCalendarViewMode] = useState<'month' | 'week'>('month');
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuShift, setMenuShift] = useState<Shift | null>(null);
  const [selectedDayForDetail, setSelectedDayForDetail] = useState<Date | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef<boolean>(false);

  const currentWeekStart = useMemo(
    () => startOfWeek(currentMonth, { weekStartsOn: 1 }),
    [currentMonth]
  );

  const handlePrev = () =>
    setCurrentMonth(prev =>
      calendarViewMode === 'week' ? subWeeks(prev, 1) : addMonths(prev, -1)
    );
  const handleNext = () =>
    setCurrentMonth(prev =>
      calendarViewMode === 'week' ? addWeeks(prev, 1) : addMonths(prev, 1)
    );

  const monthInterval = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const weekInterval = useMemo(() => {
    const end = endOfWeek(currentWeekStart, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: currentWeekStart, end });
  }, [currentWeekStart]);

  const daysByDate = useMemo(() => {
    const map: Record<string, Shift[]> = {};
    for (const shift of shifts) {
      // tolerant parsing; support string/Date - verwende shift.date statt shift.start
      const rawDate = shift.date as unknown;
      const date = typeof rawDate === 'string' ? parseISO(rawDate) : (rawDate as Date | undefined);
      if (!date || !isValid(date)) continue;
      const key = format(date, 'yyyy-MM-dd');
      if (!map[key]) map[key] = [];
      map[key].push(shift);
    }
    return map;
  }, [shifts]);

  // Gruppiere Schichten nach shiftGroupId für visuelle Kennzeichnung
  const shiftGroups = useMemo(() => {
    const groups: Record<string, Shift[]> = {};
    for (const shift of shifts) {
      const groupId = (shift as unknown as { shiftGroupId?: string }).shiftGroupId;
      if (groupId) {
        if (!groups[groupId]) groups[groupId] = [];
        groups[groupId].push(shift);
      }
    }
    return groups;
  }, [shifts]);

  const handleOpenMenu = (event: React.MouseEvent<HTMLElement>, shift: Shift) => {
    setMenuAnchor(event.currentTarget);
    setMenuShift(shift);
  };

  const handleCloseMenu = () => {
    setMenuAnchor(null);
    setMenuShift(null);
  };

  const weekDayLabels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const { enrichment, isLoading: enrichmentLoading } = useShiftEnrichment(shifts, companyIdProp);

  if (isMobile) {
    const mobileDaysToShow =
      calendarViewMode === 'week'
        ? weekInterval
        : monthInterval.filter(day => (daysByDate[format(day, 'yyyy-MM-dd')] || []).length > 0);

    return (
      <Box>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            mb: 2,
            flexDirection: { xs: 'column', sm: 'row' },
            gap: 1.5,
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <IconButton
              onClick={handlePrev}
              aria-label="Vorheriger Monat"
              size="large"
              sx={{ touchAction: 'manipulation' }}
            >
              <ArrowBack />
            </IconButton>
            <IconButton
              onClick={handleNext}
              aria-label="Nächster Monat"
              size="large"
              sx={{ touchAction: 'manipulation' }}
            >
              <ArrowForward />
            </IconButton>
          </Stack>
          <Typography variant="h5" sx={{ fontWeight: 600 }} align="center">
            {calendarViewMode === 'week' && weekInterval.length === 7
              ? `${format(weekInterval[0], 'd.', { locale: de })}–${format(weekInterval[6], 'd. MMM yyyy', { locale: de })}`
              : format(currentMonth, 'LLLL yyyy', { locale: de })}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
            Tippe auf einen Tag für Details
          </Typography>
        </Box>

        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 1.5 }}>
          <ToggleButtonGroup
            value={calendarViewMode}
            exclusive
            onChange={(_, v) => v && setCalendarViewMode(v)}
            size="small"
          >
            <ToggleButton value="month" aria-label="Monat">Monat</ToggleButton>
            <ToggleButton value="week" aria-label="Woche">Woche</ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        {mobileDaysToShow.length === 0 ? (
          <Paper className="glass" sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {calendarViewMode === 'week'
                ? 'In dieser Woche sind keine Schichten geplant.'
                : 'Für diesen Monat sind keine Schichten geplant.'}
            </Typography>
          </Paper>
        ) : (
          <Stack spacing={2} sx={{ pb: 1 }}>
            {mobileDaysToShow.map(day => {
              const key = format(day, 'yyyy-MM-dd');
              const dayShifts = daysByDate[key] || [];
              const today = isToday(day);

              return (
                <Paper key={key} className="glass" sx={{ p: 2 }} onClick={() => onDayClick?.(day)}>
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      mb: 1.5,
                    }}
                  >
                    <Typography
                      variant="subtitle1"
                      sx={{ fontWeight: 600 }}
                      color={today ? 'primary.main' : 'text.primary'}
                    >
                      {format(day, 'EEEE, d. MMM', { locale: de })}
                    </Typography>
                    {today && (
                      <Chip size="small" color="primary" label="Heute" variant="outlined" />
                    )}
                  </Box>

                  <Stack
                    spacing={1}
                    sx={{
                      maxHeight: 320,
                      overflowX: 'hidden',
                      overflowY: 'auto',
                    }}
                  >
                    {dayShifts.map(shift => {
                      type ShiftLike3 = Shift & {
                        id: string;
                        startTime?: string;
                        endTime?: string;
                        title?: string;
                        facility?: { name?: string };
                        assignedTo?: string[];
                        color?: string;
                        shiftGroupId?: string;
                      };
                      const s = shift as unknown as ShiftLike3;
                      const time =
                        s.startTime && s.endTime ? `${s.startTime}–${s.endTime}${s.endTime < s.startTime ? ' (+1)' : ''}` : undefined;
                      const assignedTo: string[] = (s.assignedTo || []) as string[];
                      const shiftColor = s.color || DEFAULT_SHIFT_COLOR;
                      const isPartOfGroup = !!s.shiftGroupId;
                      const groupShifts = s.shiftGroupId ? shiftGroups[s.shiftGroupId] || [] : [];
                      const groupSize = groupShifts.length;
                      const en = enrichment[s.id];
                      const facilityLabel = enrichmentLoading
                        ? '…'
                        : (en?.facilityName ?? s.facility?.name ?? (s.facilityId ? 'Einrichtung' : 'Schicht'));
                      const stationLabel = en?.stationName;
                      const whereLabel = stationLabel ? `${facilityLabel} · ${stationLabel}` : facilityLabel;
                      const namesLabel = en?.assigneeNames?.length
                        ? en.assigneeNames.join(', ')
                        : enrichmentLoading
                          ? '…'
                          : null;

                      return (
                        <Box
                          key={s.id}
                          sx={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 1,
                            p: 1.25,
                            borderRadius: 2,
                            bgcolor: 'action.hover',
                            borderLeft: `4px solid ${shiftColor}`,
                          }}
                          onClick={event => {
                            event.stopPropagation();
                            onShiftClick?.(shift);
                          }}
                        >
                          <Event fontSize="small" sx={{ mt: 0.25 }} />
                          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                              <Typography variant="body2" sx={{ fontWeight: 600 }} component="span">
                                {whereLabel}
                              </Typography>
                              {isPartOfGroup && groupSize > 1 && (
                                <Chip
                                  size="small"
                                  label={`${groupSize} Tage`}
                                  sx={{
                                    height: 18,
                                    fontSize: '0.65rem',
                                    bgcolor: shiftColor,
                                    color: 'white',
                                    '& .MuiChip-label': { px: 0.75 },
                                  }}
                                />
                              )}
                            </Box>
                            {namesLabel && (
                              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
                                {namesLabel}
                              </Typography>
                            )}
                            <Typography variant="caption" color="text.secondary" display="block">
                              {time || 'Zeit wird festgelegt'}
                            </Typography>
                            <Box
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.5,
                                mt: 0.5,
                                flexWrap: 'wrap',
                              }}
                            >
                              {isShiftEnded(s) ? (
                                <Chip size="small" color="default" variant="outlined" label="Beendet" />
                              ) : (
                                <>
                                  <FormStatusChip shiftId={s.id} />
                                  <CompletedChip shiftId={s.id} />
                                </>
                              )}
                              {assignedTo?.length > 0 && !namesLabel && (
                                <Box sx={{ display: 'flex', gap: 0.5, ml: 0.5 }}>
                                  {assignedTo.slice(0, 3).map(uid => (
                                    <Box
                                      key={uid}
                                      sx={{
                                        width: 10,
                                        height: 10,
                                        borderRadius: '50%',
                                        bgcolor: getColorForUser(uid),
                                        border: '1px solid rgba(0,0,0,0.15)',
                                      }}
                                    />
                                  ))}
                                  {assignedTo.length > 3 && (
                                    <Typography variant="caption" color="text.secondary">
                                      +{assignedTo.length - 3}
                                    </Typography>
                                  )}
                                </Box>
                              )}
                            </Box>
                          </Box>
                          <IconButton
                            size="small"
                            edge="end"
                            aria-label="Weitere Optionen"
                            onClick={event => {
                              event.stopPropagation();
                              handleOpenMenu(event, shift);
                            }}
                          >
                            <MoreVert fontSize="small" />
                          </IconButton>
                        </Box>
                      );
                    })}
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        )}

        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={handleCloseMenu}>
          <MenuItem
            onClick={() => {
              if (menuShift) onEdit?.(menuShift);
              handleCloseMenu();
            }}
          >
            Bearbeiten
          </MenuItem>
          <MenuItem
            onClick={() => {
              if (menuShift) onAssign?.(menuShift);
              handleCloseMenu();
            }}
          >
            Zuweisen
          </MenuItem>
          <MenuItem
            onClick={() => {
              if (menuShift) onDelete?.(menuShift);
              handleCloseMenu();
            }}
            sx={{ color: 'error.main' }}
          >
            Löschen
          </MenuItem>
        </Menu>
      </Box>
    );
  }

  const calendarTitle =
    calendarViewMode === 'week' && weekInterval.length === 7
      ? `${format(weekInterval[0], 'd.', { locale: de })}–${format(weekInterval[6], 'd. MMM yyyy', { locale: de })}`
      : format(currentMonth, 'LLLL yyyy', { locale: de });

  const renderShiftCard = (
    shift: Shift,
    opts: { compact?: boolean; showTime?: boolean }
  ) => {
    type ShiftLike = Shift & {
      id: string;
      startTime?: string;
      endTime?: string;
      title?: string;
      facility?: { name?: string };
      assignedTo?: string[];
      color?: string;
      shiftGroupId?: string;
    };
    const s = shift as unknown as ShiftLike;
    const time = s.startTime && s.endTime ? `${s.startTime}–${s.endTime}${s.endTime < s.startTime ? ' (+1)' : ''}` : undefined;
    const assignedTo: string[] = (s.assignedTo || []) as string[];
    const shiftColor = s.color || DEFAULT_SHIFT_COLOR;
    const isPartOfGroup = !!s.shiftGroupId;
    const groupShifts = s.shiftGroupId ? shiftGroups[s.shiftGroupId] || [] : [];
    const groupSize = groupShifts.length;
    const en = enrichment[s.id];
    const facilityLabel = enrichmentLoading
      ? '…'
      : (en?.facilityName ?? s.facility?.name ?? (s.facilityId ? 'Einrichtung' : 'Schicht'));
    const stationLabel = en?.stationName;
    const whereLabel = stationLabel ? `${facilityLabel} · ${stationLabel}` : facilityLabel;
    const namesLabel = en?.assigneeNames?.length
      ? en.assigneeNames.join(', ')
      : enrichmentLoading ? '…' : null;
    const tooltipTitle = `${whereLabel}${namesLabel ? ` · ${namesLabel}` : ''}${time ? ` · ${time}` : ''}`;

    return (
      <Tooltip key={s.id} title={tooltipTitle}>
        <Box
          data-shift-item
          onClick={event => {
            event.stopPropagation();
            onShiftClick?.(shift);
          }}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 1,
            px: opts.compact ? 0.75 : 1,
            py: opts.compact ? 0.4 : 0.5,
            bgcolor: 'action.hover',
            borderRadius: 1,
            cursor: 'pointer',
            borderLeft: `4px solid ${shiftColor}`,
            '&:hover': { bgcolor: 'action.selected' },
          }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0, flex: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
              <Event fontSize="small" sx={{ flexShrink: 0, fontSize: opts.compact ? 14 : 18 }} />
              {opts.showTime !== false && time && (
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary' }}>
                  {time}
                </Typography>
              )}
              <Typography variant="caption" noWrap sx={{ fontWeight: 600 }}>
                {whereLabel}
              </Typography>
              {isPartOfGroup && groupSize > 1 && (
                <Chip
                  size="small"
                  label={`${groupSize}`}
                  sx={{
                    height: 16,
                    fontSize: '0.6rem',
                    bgcolor: shiftColor,
                    color: 'white',
                    minWidth: 20,
                    '& .MuiChip-label': { px: 0.5 },
                  }}
                />
              )}
            </Box>
            {namesLabel && !opts.compact && (
              <Typography variant="caption" color="text.secondary" noWrap sx={{ pl: opts.compact ? 2.5 : 3.5 }}>
                {namesLabel}
              </Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexShrink: 0 }}>
            {isShiftEnded(s) ? (
              <Chip size="small" color="default" variant="outlined" label="Beendet" />
            ) : (
              <>
                <FormStatusChip shiftId={s.id} />
                <CompletedChip shiftId={s.id} />
              </>
            )}
            {assignedTo?.length > 0 && !namesLabel && (
              <Box sx={{ display: 'flex', gap: 0.5, ml: 0.5 }}>
                {assignedTo.slice(0, 5).map(uid => (
                  <Box
                    key={uid}
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      bgcolor: getColorForUser(uid),
                      border: '1px solid rgba(0,0,0,0.15)',
                    }}
                  />
                ))}
                {assignedTo.length > 5 && (
                  <Typography variant="caption" color="text.secondary">
                    +{assignedTo.length - 5}
                  </Typography>
                )}
              </Box>
            )}
            <IconButton
              size="small"
              aria-label="Weitere Optionen"
              onClick={e => {
                e.stopPropagation();
                handleOpenMenu(e, shift);
              }}
              sx={{ ml: 0.25 }}
            >
              <MoreVert fontSize="small" />
            </IconButton>
          </Box>
        </Box>
      </Tooltip>
    );
  };

  return (
    <Box>
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
        <Stack direction="row" spacing={0.5} alignItems="center">
          <IconButton
            onClick={handlePrev}
            aria-label={calendarViewMode === 'week' ? 'Vorherige Woche' : 'Vorheriger Monat'}
            size="large"
            sx={{ touchAction: 'manipulation' }}
          >
            <ArrowBack />
          </IconButton>
          <IconButton
            onClick={handleNext}
            aria-label={calendarViewMode === 'week' ? 'Nächste Woche' : 'Nächster Monat'}
            size="large"
            sx={{ touchAction: 'manipulation' }}
          >
            <ArrowForward />
          </IconButton>
          <ToggleButtonGroup
            value={calendarViewMode}
            exclusive
            onChange={(_, v) => v && setCalendarViewMode(v)}
            size="small"
            sx={{ ml: 0.5 }}
          >
            <ToggleButton value="month" aria-label="Monatsansicht">
              <CalendarMonth sx={{ mr: 0.5 }} fontSize="small" />
              Monat
            </ToggleButton>
            <ToggleButton value="week" aria-label="Wochenansicht">
              <ViewWeek sx={{ mr: 0.5 }} fontSize="small" />
              Woche
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        <Typography variant="h5" sx={{ fontWeight: 600 }}>
          {calendarTitle}
        </Typography>
        <Box sx={{ width: 48 }} />
      </Box>

      {calendarViewMode === 'week' && (
        <>
          <Grid container spacing={1} sx={{ mb: 1 }}>
            {weekInterval.map(day => {
              const today = isToday(day);
              return (
                <Grid key={format(day, 'yyyy-MM-dd')} size={{ xs: 12, sm: (12 / 7) as unknown as number }}>
                  <Typography
                    variant="subtitle2"
                    align="center"
                    color={today ? 'primary.main' : 'text.secondary'}
                    sx={{ fontWeight: today ? 700 : 500 }}
                  >
                    {format(day, 'EEE', { locale: de })}
                  </Typography>
                  <Typography variant="body2" align="center" color="text.secondary">
                    {format(day, 'd. MMM', { locale: de })}
                  </Typography>
                </Grid>
              );
            })}
          </Grid>
          <Grid container spacing={1}>
            {weekInterval.map(day => {
              const key = format(day, 'yyyy-MM-dd');
              const dayShifts = daysByDate[key] || [];
              const today = isToday(day);
              return (
                <Grid key={key} size={{ xs: 12, sm: (12 / 7) as unknown as number }}>
                  <Paper
                    variant="outlined"
                    className="glass"
                    tabIndex={0}
                    role="button"
                    sx={{
                      p: 1.25,
                      minHeight: 220,
                      cursor: 'pointer',
                      outline: 'none',
                      transition: 'box-shadow 120ms ease',
                      borderColor: today ? 'primary.main' : 'divider',
                      borderWidth: today ? 2 : 1,
                      '&:focus-visible': { boxShadow: theme.shadows[4] },
                    }}
                    onClick={e => {
                      if ((e.target as HTMLElement).closest('[data-shift-item]')) return;
                      onDayClick?.(day);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onDayClick?.(day);
                      }
                    }}
                  >
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                      <Typography
                        variant="caption"
                        sx={{ fontWeight: 600 }}
                        color={today ? 'primary.main' : 'text.secondary'}
                      >
                        {format(day, 'd. MMM', { locale: de })}
                      </Typography>
                      {today && (
                        <Chip size="small" color="primary" label="Heute" variant="outlined" />
                      )}
                      {onDayClick && (
                        <Tooltip title="Schicht hinzufügen">
                          <IconButton
                            size="small"
                            color="primary"
                            aria-label="Schicht hinzufügen"
                            onClick={event => {
                              event.stopPropagation();
                              onDayClick?.(day);
                            }}
                          >
                            <Add fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                    <Stack spacing={0.5} sx={{ maxHeight: 280, overflowY: 'auto' }}>
                      {dayShifts.length === 0 ? (
                        <Typography variant="caption" color="text.secondary">
                          Keine Schichten
                        </Typography>
                      ) : (
                        dayShifts.map(shift => renderShiftCard(shift, { showTime: true }))
                      )}
                    </Stack>
                  </Paper>
                </Grid>
              );
            })}
          </Grid>
        </>
      )}

      {calendarViewMode === 'month' && (
        <>
      {/* Weekday header */}
      <Grid container spacing={1} sx={{ mb: 1 }}>
        {weekDayLabels.map(label => (
          <Grid key={label} size={{ xs: (12 / 7) as unknown as number }}>
            <Typography variant="subtitle2" align="center" color="text.secondary">
              {label}
            </Typography>
          </Grid>
        ))}
      </Grid>

      {/* Days grid */}
      <Grid container spacing={1}>
        {monthInterval.map(day => {
          const isCurrentMonth = isSameMonth(day, currentMonth);
          const key = format(day, 'yyyy-MM-dd');
          const dayShifts = daysByDate[key] || [];
          const today = isToday(day);

          return (
            <Grid key={key} size={{ xs: (12 / 7) as unknown as number }}>
              <Paper
                variant="outlined"
                className="glass"
                tabIndex={0}
                role="button"
                aria-label={`${format(day, 'd. MMM', { locale: de })}${dayShifts.length > 0 ? `, ${dayShifts.length} Schicht(en)` : ''}. Klicken für Details`}
                sx={{
                  p: 1.25,
                  minHeight: { xs: 200, sm: 220 },
                  opacity: isCurrentMonth ? 1 : 0.5,
                  cursor: 'pointer',
                  outline: 'none',
                  transition: 'box-shadow 120ms ease',
                  '&:focus-visible': {
                    boxShadow: theme.shadows[4],
                  },
                }}
                onClick={e => {
                  if ((e.target as HTMLElement).closest('[data-add-shift]')) return;
                  if (!longPressTriggeredRef.current) setSelectedDayForDetail(day);
                  longPressTriggeredRef.current = false;
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setSelectedDayForDetail(day);
                  }
                }}
                onTouchStart={() => {
                  longPressTriggeredRef.current = false;
                  if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
                  longPressTimerRef.current = window.setTimeout(() => {
                    longPressTriggeredRef.current = true;
                    try {
                      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                        (navigator as unknown as { vibrate?: (ms: number) => void }).vibrate?.(10);
                      }
                    } catch {
                      /* ignore */
                    }
                    onDayLongPress?.(day);
                  }, 500);
                }}
                onTouchEnd={() => {
                  if (longPressTimerRef.current) {
                    window.clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = null;
                  }
                }}
                onTouchCancel={() => {
                  if (longPressTimerRef.current) {
                    window.clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = null;
                  }
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    mb: 1,
                    gap: 0.5,
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 600 }}
                    color={today ? 'primary.main' : 'text.secondary'}
                  >
                    {format(day, 'd. MMM', { locale: de })}
                  </Typography>
                  <Stack direction="row" spacing={0.5} alignItems="center">
                    {today && (
                      <Chip size="small" color="primary" label="Heute" variant="outlined" />
                    )}
                    {onDayClick && (
                      <Tooltip title="Schicht hinzufügen">
                        <IconButton
                          data-add-shift
                          size="small"
                          color="primary"
                          aria-label="Schicht hinzufügen"
                          onClick={event => {
                            event.stopPropagation();
                            onDayClick?.(day);
                          }}
                        >
                          <Add fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                </Box>

                <Box
                  sx={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 0.5,
                    alignItems: 'flex-start',
                    alignContent: 'flex-start',
                    minHeight: 120,
                  }}
                >
                  {dayShifts.map(shift => {
                    type ShiftLike = Shift & { startTime?: string; endTime?: string; color?: string };
                    const s = shift as unknown as ShiftLike;
                    const time = s.startTime && s.endTime ? `${s.startTime}–${s.endTime}` : '';
                    const shiftColor = s.color || DEFAULT_SHIFT_COLOR;
                    const en = enrichment[s.id];
                    const facilityLabel = enrichmentLoading
                      ? '…'
                      : (en?.facilityName ?? (s as unknown as { facility?: { name?: string } }).facility?.name ?? 'Einrichtung');
                    const stationLabel = en?.stationName;
                    const whereLabel = stationLabel ? `${facilityLabel} · ${stationLabel}` : facilityLabel;
                    return (
                      <Tooltip key={s.id} title={`${whereLabel} · ${time || 'Zeit n. b.'}`}>
                        <Box
                          sx={{
                            width: 24,
                            height: 24,
                            borderRadius: 1,
                            bgcolor: shiftColor,
                            flexShrink: 0,
                            border: '1px solid rgba(0,0,0,0.12)',
                          }}
                        />
                      </Tooltip>
                    );
                  })}
                </Box>
              </Paper>
            </Grid>
          );
        })}
      </Grid>
        </>
      )}

      <Dialog
        open={Boolean(selectedDayForDetail)}
        onClose={() => setSelectedDayForDetail(null)}
        maxWidth="sm"
        fullWidth
        aria-labelledby="day-detail-dialog-title"
      >
        {selectedDayForDetail && (() => {
          const key = format(selectedDayForDetail, 'yyyy-MM-dd');
          const dayShiftsList = daysByDate[key] || [];
          return (
            <>
              <DialogTitle id="day-detail-dialog-title">
                Schichten am {format(selectedDayForDetail, 'EEEE, d. MMMM yyyy', { locale: de })}
              </DialogTitle>
              <DialogContent>
                {dayShiftsList.length === 0 ? (
                  <Typography color="text.secondary">An diesem Tag sind keine Schichten geplant.</Typography>
                ) : (
                  <List disablePadding>
                    {dayShiftsList.map(shift => {
                      type ShiftLike = Shift & { startTime?: string; endTime?: string; color?: string };
                      const s = shift as unknown as ShiftLike;
                      const time = s.startTime && s.endTime ? `${s.startTime}–${s.endTime}` : 'Zeit n. b.';
                      const en = enrichment[s.id];
                      const facilityName = enrichmentLoading
                        ? '…'
                        : (en?.facilityName ?? (s as unknown as { facility?: { name?: string } }).facility?.name ?? 'Einrichtung');
                      const stationName = en?.stationName;
                      const whereLabel = stationName ? `${facilityName} · ${stationName}` : facilityName;
                      return (
                        <ListItemButton
                          key={s.id}
                          onClick={() => {
                            onShiftClick?.(shift);
                            setSelectedDayForDetail(null);
                          }}
                          sx={{
                            borderRadius: 1,
                            mb: 0.5,
                            borderLeft: `4px solid ${s.color || DEFAULT_SHIFT_COLOR}`,
                          }}
                        >
                          <ListItemText
                            primary={whereLabel}
                            secondary={`Wann: ${time}`}
                            primaryTypographyProps={{ fontWeight: 600 }}
                          />
                        </ListItemButton>
                      );
                    })}
                  </List>
                )}
              </DialogContent>
              <DialogActions>
                {onDayClick && selectedDayForDetail && (
                  <Button
                    startIcon={<Add />}
                    onClick={() => {
                      onDayClick(selectedDayForDetail);
                      setSelectedDayForDetail(null);
                    }}
                  >
                    Schicht hinzufügen
                  </Button>
                )}
                <Button onClick={() => setSelectedDayForDetail(null)}>Schließen</Button>
              </DialogActions>
            </>
          );
        })()}
      </Dialog>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={handleCloseMenu}>
        <MenuItem
          onClick={() => {
            if (menuShift) onEdit?.(menuShift);
            handleCloseMenu();
          }}
        >
          Bearbeiten
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuShift) onAssign?.(menuShift);
            handleCloseMenu();
          }}
        >
          Zuweisen
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuShift) onDelete?.(menuShift);
            handleCloseMenu();
          }}
          sx={{ color: 'error.main' }}
        >
          Löschen
        </MenuItem>
      </Menu>
    </Box>
  );
}
