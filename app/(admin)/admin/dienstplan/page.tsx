'use client';

import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/contexts/PermissionsContext';
import { AdminListView } from '@/components/schedule/AdminListView';
import AdminCalendarView from '@/components/schedule/AdminCalendarView';
import { AssignShiftDialog } from '@/components/admin/AssignShiftDialog';
import { PageContainer } from '@/components/layout/PageContainer';
import { ShiftCreateDialog } from '@/components/admin/ShiftCreateDialog';
import ShiftEditDialog from '@/components/admin/ShiftEditDialog';
import { toast } from '@/lib/utils/toast';
import { shiftService } from '@/lib/services';
import { Shift as ServiceShift } from '@/lib/services/shifts';
import type { Shift as UiShift } from '@/lib/types';
import { Add, Refresh } from '@mui/icons-material';
import {
  Box,
  Button,
  CircularProgress,
  Grid,
  IconButton,
  Paper,
  Tab,
  Tabs,
  Typography,
  Alert,
} from '@mui/material';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { de } from 'date-fns/locale';
import { startOfWeek, endOfWeek, startOfMonth, endOfMonth, startOfDay, endOfDay } from 'date-fns';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { PerformanceMonitor, UserActionTracker } from '@/lib/logging';
import { MenuItem, Select } from '@mui/material';
import { facilityService } from '@/lib/services/facilities';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { getShiftDisplayStatus } from '@/lib/utils/shiftStatus';

export default function AdminDienstplanPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState(0);
  const [dateFrom, setDateFrom] = useState<Date | null>(null);
  const [dateTo, setDateTo] = useState<Date | null>(null);
  const [statusFilter, setStatusFilter] = useState<ServiceShift['status'] | 'ended' | ''>('');
  const [facilityFilter, setFacilityFilter] = useState<string>('');
  const { data: facilities = [] } = useQuery({
    queryKey: ['facilities', user?.companyId],
    queryFn: () => facilityService.getAll(user?.companyId),
    enabled: !!user?.companyId, // Nur laden, wenn companyId vorhanden ist
    staleTime: 5 * 60 * 1000,
  });

  const FILTERS_VERSION = 'v1';
  const storageKey = useMemo(
    () => `admin_shift_filters_${FILTERS_VERSION}_${user?.id || 'anon'}`,
    [user?.id]
  );

  const {
    data: shifts = [],
    isLoading,
    refetch,
  } = useQuery<ServiceShift[]>({
    queryKey: [
      'adminShifts',
      user?.companyId,
      dateFrom?.toISOString() || null,
      dateTo?.toISOString() || null,
      statusFilter || null,
      facilityFilter || null,
    ],
    queryFn: () =>
      shiftService.getAll({
        companyId: user?.companyId,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        status: statusFilter === 'ended' ? undefined : (statusFilter || undefined),
        facilityId: facilityFilter || undefined,
      }),
    enabled: !!user?.companyId, // Nur laden, wenn companyId vorhanden ist
  });

  // Realtime-Updates: invalidiere Query bei Änderungen
  const queryClient = useQueryClient();
  useEffect(() => {
    const unsubscribe = shiftService.subscribeAll(
      {
        companyId: user?.companyId || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        status: statusFilter === 'ended' ? undefined : (statusFilter || undefined),
        facilityId: facilityFilter || undefined,
      },
      newShifts => {
        queryClient.setQueryData<ServiceShift[]>(
          [
            'adminShifts',
            dateFrom?.toISOString() || null,
            dateTo?.toISOString() || null,
            statusFilter || null,
            facilityFilter || null,
          ],
          newShifts
        );
      },
      () => {
        /* optional: Fehler ignorieren */
      }
    );
    return () => unsubscribe();
  }, [queryClient, user?.companyId, dateFrom, dateTo, statusFilter, facilityFilter]);

  // Load filters from localStorage
  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (typeof parsed === 'object' && parsed) {
          if (parsed.dateFrom) setDateFrom(new Date(parsed.dateFrom));
          if (parsed.dateTo) setDateTo(new Date(parsed.dateTo));
          if (parsed.statusFilter != null) setStatusFilter(parsed.statusFilter);
          if (parsed.facilityFilter != null) setFacilityFilter(parsed.facilityFilter);
        }
      }
    } catch (_e) {
      // ignore malformed storage
    }
  }, [storageKey]);

  // Persist filters to localStorage
  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({
            dateFrom: dateFrom ? dateFrom.toISOString() : undefined,
            dateTo: dateTo ? dateTo.toISOString() : undefined,
            statusFilter: statusFilter || undefined,
            facilityFilter: facilityFilter || undefined,
          })
        );
      }
    } catch (_e) {
      // ignore quota errors
    }
  }, [storageKey, dateFrom, dateTo, statusFilter, facilityFilter]);

  // Dialog/Action State
  const [assignOpen, setAssignOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedCreateDate, setSelectedCreateDate] = useState<Date | null>(null);
  const [selectedShift, setSelectedShift] = useState<ServiceShift | null>(null);
  const { hasPermission } = usePermissions();
  const canManage = hasPermission('manage_shifts');
  const theme = useTheme();
  const _isMobile = useMediaQuery(theme.breakpoints.down('sm'), { noSsr: true });
  const [sendingReminders, setSendingReminders] = useState(false);

  const handleSendReminders = async () => {
    try {
      setSendingReminders(true);
      const res = await fetch('/api/forms/reminders', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Fehler beim Senden');
      toast.success(`Erinnerungen versendet: ${data.sent}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Fehler beim Senden');
    } finally {
      setSendingReminders(false);
    }
  };

  const handleOpenAssign = (shift: ServiceShift) => {
    if (process.env.NODE_ENV === 'development') {
      PerformanceMonitor.startTimer('dialog.assign.open');
      UserActionTracker.trackAction('open_assign_dialog', { shiftId: shift.id });
    }
    setSelectedShift(shift);
    setAssignOpen(true);
  };

  const handleDelete = async (shift: ServiceShift) => {
    try {
      await shiftService.delete(shift.id);
      toast.success('Schicht gelöscht');
      refetch();
    } catch (err: unknown) {
      const message = (err as { message?: string })?.message || 'Löschen fehlgeschlagen';
      toast.error(message);
    }
  };

  const handleEdit = (shift: ServiceShift) => {
    if (process.env.NODE_ENV === 'development') {
      PerformanceMonitor.startTimer('dialog.edit.open');
      UserActionTracker.trackAction('open_edit_dialog', { shiftId: shift.id });
    }
    setSelectedShift(shift);
    setEditOpen(true);
  };

  const filteredShifts = useMemo(() => {
    const dayStart = dateFrom
      ? new Date(dateFrom.getFullYear(), dateFrom.getMonth(), dateFrom.getDate(), 0, 0, 0, 0)
      : null;
    const dayEnd = dateTo
      ? new Date(dateTo.getFullYear(), dateTo.getMonth(), dateTo.getDate(), 23, 59, 59, 999)
      : null;

    let list = shifts.filter(s => {
      const date = s?.date ? new Date(s.date) : null;
      if (dayStart && date && date < dayStart) return false;
      if (dayEnd && date && date > dayEnd) return false;
      return true;
    });

    // Nach Anzeige-Status: Beendete Schichten nicht unter "Besetzt"
    if (statusFilter === 'filled') list = list.filter(s => getShiftDisplayStatus(s) === 'filled');
    else if (statusFilter === 'open') list = list.filter(s => getShiftDisplayStatus(s) === 'open');
    else if (statusFilter === 'ended') list = list.filter(s => getShiftDisplayStatus(s) === 'ended');
    else if (statusFilter === 'cancelled') list = list.filter(s => s.status === 'cancelled');

    return list;
  }, [shifts, dateFrom, dateTo, statusFilter]);

  if (!user) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">Bitte melde dich an, um den Admin-Dienstplan zu sehen.</Alert>
      </Box>
    );
  }

  return (
    <PageContainer maxWidth="wide">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ fontWeight: 600 }}>
          Admin-Dienstplan
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <IconButton onClick={() => refetch()} aria-label="Aktualisieren">
            <Refresh />
          </IconButton>
          <Button
            variant="text"
            onClick={handleSendReminders}
            disabled={sendingReminders || !canManage}
          >
            {sendingReminders ? 'Sende…' : 'Erinnerungen senden'}
          </Button>
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => {
              if (!canManage) {
                toast.error('Keine Berechtigung, Schichten zu erstellen');
                return;
              }
              if (process.env.NODE_ENV === 'development') {
                PerformanceMonitor.startTimer('dialog.create.open');
                UserActionTracker.trackAction('open_create_dialog');
              }
              setCreateOpen(true);
            }}
            disabled={!canManage}
          >
            Neue Schicht
          </Button>
          {/* Zeitraum-Button entfernt, da Zeitraum nun im Erstell-Dialog verfügbar ist */}
        </Box>
      </Box>

      <Paper className="glass" sx={{ mb: 3 }}>
        <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)}>
          <Tab label="Liste" />
          <Tab label="Kalender" />
        </Tabs>
      </Paper>

      <Paper className="glass" sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
          <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={de}>
            <DatePicker
              label="Von Datum"
              value={dateFrom}
              onChange={d => setDateFrom(d)}
              slotProps={{ textField: { size: 'small' } }}
            />
            <DatePicker
              label="Bis Datum"
              value={dateTo}
              onChange={d => setDateTo(d)}
              slotProps={{ textField: { size: 'small' } }}
            />
          </LocalizationProvider>
          <Select
            size="small"
            displayEmpty
            value={statusFilter}
            onChange={e => setStatusFilter((e.target.value as ServiceShift['status'] | 'ended') || '')}
          >
            <MenuItem value="">
              <em>Status: Alle</em>
            </MenuItem>
            <MenuItem value="open">Offen</MenuItem>
            <MenuItem value="filled">Besetzt</MenuItem>
            <MenuItem value="ended">Beendet</MenuItem>
            <MenuItem value="cancelled">Abgesagt</MenuItem>
          </Select>
          <Select
            size="small"
            displayEmpty
            value={facilityFilter}
            onChange={e => setFacilityFilter((e.target.value as string) || '')}
          >
            <MenuItem value="">
              <em>Einrichtung: Alle</em>
            </MenuItem>
            {facilities.map(f => (
              <MenuItem key={f.id} value={f.id}>
                {f.name}
              </MenuItem>
            ))}
          </Select>
          <Box sx={{ ml: 'auto' }}>
            <Button
              size="small"
              sx={{ mr: 1 }}
              onClick={() => {
                const now = new Date();
                setDateFrom(startOfDay(now));
                setDateTo(endOfDay(now));
              }}
            >
              Heute
            </Button>
            <Button
              size="small"
              sx={{ mr: 1 }}
              onClick={() => {
                const now = new Date();
                setDateFrom(startOfWeek(now, { weekStartsOn: 1 }));
                setDateTo(endOfWeek(now, { weekStartsOn: 1 }));
              }}
            >
              Diese Woche
            </Button>
            <Button
              size="small"
              sx={{ mr: 1 }}
              onClick={() => {
                const now = new Date();
                setDateFrom(startOfMonth(now));
                setDateTo(endOfMonth(now));
              }}
            >
              Dieser Monat
            </Button>
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                setDateFrom(null);
                setDateTo(null);
                setStatusFilter('');
                setFacilityFilter('');
                try {
                  if (typeof window !== 'undefined') window.localStorage.removeItem(storageKey);
                } catch (_e) {
                  /* noop */
                }
              }}
            >
              Zurücksetzen
            </Button>
          </Box>
        </Box>
      </Paper>

      {isLoading ? (
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '40vh',
          }}
        >
          <CircularProgress />
        </Box>
      ) : (
        <Grid container spacing={3}>
          {activeTab === 0 && (
            <Grid size={{ xs: 12 }}>
              <AdminListView
                shifts={filteredShifts as unknown as UiShift[]}
                onShiftClick={(s: UiShift) => setSelectedShift(s as unknown as ServiceShift)}
                onEdit={(s: UiShift) => {
                  if (!canManage) {
                    toast.error('Keine Berechtigung zum Bearbeiten');
                    return;
                  }
                  handleEdit(s as unknown as ServiceShift);
                }}
                onAssign={(s: UiShift) => {
                  if (!canManage) {
                    toast.error('Keine Berechtigung zum Zuweisen');
                    return;
                  }
                  handleOpenAssign(s as unknown as ServiceShift);
                }}
                onDelete={(s: UiShift) => {
                  if (!canManage) {
                    toast.error('Keine Berechtigung zum Löschen');
                    return;
                  }
                  handleDelete(s as unknown as ServiceShift);
                }}
              />
            </Grid>
          )}
          {activeTab === 1 && (
            <Grid size={{ xs: 12 }}>
              <AdminCalendarView
                shifts={filteredShifts as unknown as UiShift[]}
                onShiftClick={(s: UiShift) => setSelectedShift(s as unknown as ServiceShift)}
                onEdit={(s: UiShift) => {
                  if (!canManage) {
                    toast.error('Keine Berechtigung zum Bearbeiten');
                    return;
                  }
                  handleEdit(s as unknown as ServiceShift);
                }}
                onAssign={(s: UiShift) => {
                  if (!canManage) {
                    toast.error('Keine Berechtigung zum Zuweisen');
                    return;
                  }
                  handleOpenAssign(s as unknown as ServiceShift);
                }}
                onDelete={(s: UiShift) => {
                  if (!canManage) {
                    toast.error('Keine Berechtigung zum Löschen');
                    return;
                  }
                  handleDelete(s as unknown as ServiceShift);
                }}
                onDayClick={(d: Date) => {
                  if (!canManage) {
                    toast.error('Keine Berechtigung, Schichten zu erstellen');
                    return;
                  }
                  setSelectedCreateDate(d);
                  setCreateOpen(true);
                }}
                onDayLongPress={(d: Date) => {
                  if (!canManage) {
                    toast.error('Keine Berechtigung');
                    return;
                  }
                  setSelectedCreateDate(d);
                  setCreateOpen(true);
                }}
              />
            </Grid>
          )}
        </Grid>
      )}

      {/* Dialoge */}
      {selectedShift &&
        (() => {
          const selectedShiftUi = selectedShift as unknown as UiShift;
          return (
            <AssignShiftDialog
              open={assignOpen}
              onClose={() => setAssignOpen(false)}
              shift={selectedShiftUi}
            />
          );
        })()}
      <ShiftEditDialog
        open={editOpen}
        shift={selectedShift}
        onClose={() => setEditOpen(false)}
        onUpdated={() => refetch()}
      />
      <ShiftCreateDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setSelectedCreateDate(null);
        }}
        initialDate={selectedCreateDate}
      />
      {/* Kein FAB/Speeddial auf Mobil gemäß Anforderung */}
    </PageContainer>
  );
}
