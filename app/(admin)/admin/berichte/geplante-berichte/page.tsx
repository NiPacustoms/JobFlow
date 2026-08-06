'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { ErrorDisplay } from '@/components/ui/ErrorBoundary';
import { GlassCard } from '@/components/ui/GlassCard';
import { scheduledReportConfigService } from '@/lib/services/scheduledReportConfigService';
import type { ScheduledReportConfig } from '@/lib/types/scheduledReportConfig';
import type { ScheduledReportConfigCreateInput } from '@/lib/services/scheduledReportConfigService';
import { cloudFunctions } from '@/lib/services/cloudFunctions';
import { toast } from '@/lib/utils/toast';
import { ROUTES } from '@/lib/constants/routes';
import {
  Box,
  Button,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { Add, Delete, Edit, PlayArrow, ArrowBack } from '@mui/icons-material';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

const TYPE_LABELS: Record<string, string> = {
  timesheet: 'Zeiterfassung',
  shifts: 'Schichten',
  summary: 'Zusammenfassung',
};
const PERIOD_LABELS: Record<string, string> = {
  'current-month': 'Aktueller Monat',
  'last-month': 'Vormonat',
  'current-quarter': 'Aktuelles Quartal',
  'current-year': 'Aktuelles Jahr',
};
const FORMAT_LABELS: Record<string, string> = { pdf: 'PDF', excel: 'Excel', csv: 'CSV' };
const SCHEDULE_LABELS: Record<string, string> = { daily: 'Täglich', monthly: 'Monatlich' };

function formatLastRun(lastRunAt: ScheduledReportConfig['lastRunAt']): string {
  if (!lastRunAt) return '–';
  try {
    const d = typeof lastRunAt.toDate === 'function' ? lastRunAt.toDate() : lastRunAt;
    return d instanceof Date ? format(d, 'dd.MM.yyyy HH:mm', { locale: de }) : '–';
  } catch {
    return '–';
  }
}

export default function GeplanteBerichtePage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [form, setForm] = useState<ScheduledReportConfigCreateInput>({
    type: 'timesheet',
    period: 'current-month',
    format: 'pdf',
    schedule: 'daily',
    recipientEmails: [],
  });
  const [recipientEmailsText, setRecipientEmailsText] = useState('');

  const listQuery = useQuery({
    queryKey: ['scheduledReportConfigs'],
    queryFn: () => scheduledReportConfigService.list(),
  });

  const createMutation = useMutation({
    mutationFn: (payload: ScheduledReportConfigCreateInput) =>
      scheduledReportConfigService.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduledReportConfigs'] });
      toast.success('Geplanter Bericht angelegt.');
      setDialogOpen(false);
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string;
      payload: Parameters<typeof scheduledReportConfigService.update>[1];
    }) => scheduledReportConfigService.update(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduledReportConfigs'] });
      toast.success('Konfiguration aktualisiert.');
      setDialogOpen(false);
      setEditId(null);
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => scheduledReportConfigService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduledReportConfigs'] });
      toast.success('Konfiguration gelöscht.');
      setDeleteId(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function resetForm() {
    setForm({
      type: 'timesheet',
      period: 'current-month',
      format: 'pdf',
      schedule: 'daily',
      recipientEmails: [],
    });
    setRecipientEmailsText('');
  }

  function openCreate() {
    resetForm();
    setEditId(null);
    setDialogOpen(true);
  }

  function openEdit(config: ScheduledReportConfig) {
    setForm({
      type: config.type,
      period: config.period,
      format: config.format,
      schedule: config.schedule,
      recipientEmails: Array.isArray(config.recipientEmails) ? config.recipientEmails : [],
    });
    setRecipientEmailsText(
      Array.isArray(config.recipientEmails) ? config.recipientEmails.join(', ') : ''
    );
    setEditId(config.id);
    setDialogOpen(true);
  }

  function handleSave() {
    const emails = recipientEmailsText
      .split(/[,\s]+/)
      .map(e => e.trim())
      .filter(Boolean);
    if (emails.length === 0) {
      toast.error('Mindestens eine E-Mail-Adresse eingeben.');
      return;
    }
    const payload = { ...form, recipientEmails: emails };
    if (editId) {
      updateMutation.mutate({ id: editId, payload });
    } else {
      createMutation.mutate(payload);
    }
  }

  async function handleRunNow() {
    setRunLoading(true);
    try {
      await cloudFunctions.runScheduledReportsNow();
      toast.success('Geplante Berichte wurden ausgeführt.');
      queryClient.invalidateQueries({ queryKey: ['scheduledReportConfigs'] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Ausführung fehlgeschlagen');
    } finally {
      setRunLoading(false);
    }
  }

  if (listQuery.isLoading) return <LoadingSpinner message="Geplante Berichte werden geladen…" />;
  if (listQuery.error) return <ErrorDisplay error={listQuery.error as Error} />;

  const configs = listQuery.data ?? [];

  return (
    <PageContainer maxWidth="wide">
      <PageHeader
        title="Geplante Berichte"
        actions={
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button
              component={Link}
              href={ROUTES.ADMIN.BERICHTE}
              startIcon={<ArrowBack />}
              variant="outlined"
              size="small"
            >
              Zurück zu Berichten
            </Button>
            <Button
              variant="outlined"
              startIcon={<PlayArrow />}
              onClick={handleRunNow}
              disabled={runLoading}
              size="small"
            >
              {runLoading ? 'Wird ausgeführt…' : 'Jetzt ausführen'}
            </Button>
            <Button variant="contained" startIcon={<Add />} onClick={openCreate} size="small">
              Neuer geplanter Bericht
            </Button>
          </Box>
        }
      />

      <GlassCard sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Geplante Berichte werden täglich um 6:00 Uhr (Europe/Berlin) ausgeführt. Mit „Jetzt
            ausführen“ können Sie den Job manuell starten.
          </Typography>
          {configs.length === 0 ? (
            <Typography color="text.secondary">
              Noch keine geplanten Berichte. Legen Sie einen an, um automatisch Berichte per E-Mail
              zu erhalten.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Typ</TableCell>
                  <TableCell>Zeitraum</TableCell>
                  <TableCell>Format</TableCell>
                  <TableCell>Intervall</TableCell>
                  <TableCell>Empfänger</TableCell>
                  <TableCell>Letzter Lauf</TableCell>
                  <TableCell align="right">Aktionen</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {configs.map(c => (
                  <TableRow key={c.id} hover>
                    <TableCell>{TYPE_LABELS[c.type] ?? c.type}</TableCell>
                    <TableCell>{PERIOD_LABELS[c.period] ?? c.period}</TableCell>
                    <TableCell>{FORMAT_LABELS[c.format] ?? c.format}</TableCell>
                    <TableCell>{SCHEDULE_LABELS[c.schedule] ?? c.schedule}</TableCell>
                    <TableCell>
                      {Array.isArray(c.recipientEmails)
                        ? c.recipientEmails.slice(0, 2).join(', ') +
                          (c.recipientEmails.length > 2
                            ? ` (+${c.recipientEmails.length - 2})`
                            : '')
                        : '–'}
                    </TableCell>
                    <TableCell>{formatLastRun(c.lastRunAt)}</TableCell>
                    <TableCell align="right">
                      <Button size="small" startIcon={<Edit />} onClick={() => openEdit(c)}>
                        Bearbeiten
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        startIcon={<Delete />}
                        onClick={() => setDeleteId(c.id)}
                      >
                        Löschen
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </GlassCard>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editId ? 'Geplanten Bericht bearbeiten' : 'Neuer geplanter Bericht'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Typ</InputLabel>
              <Select
                value={form.type}
                label="Typ"
                onChange={e => setForm(f => ({ ...f, type: e.target.value as typeof form.type }))}
              >
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Zeitraum</InputLabel>
              <Select
                value={form.period}
                label="Zeitraum"
                onChange={e =>
                  setForm(f => ({ ...f, period: e.target.value as typeof form.period }))
                }
              >
                {Object.entries(PERIOD_LABELS).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Format</InputLabel>
              <Select
                value={form.format}
                label="Format"
                onChange={e =>
                  setForm(f => ({ ...f, format: e.target.value as typeof form.format }))
                }
              >
                {Object.entries(FORMAT_LABELS).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel>Intervall</InputLabel>
              <Select
                value={form.schedule}
                label="Intervall"
                onChange={e =>
                  setForm(f => ({ ...f, schedule: e.target.value as typeof form.schedule }))
                }
              >
                {Object.entries(SCHEDULE_LABELS).map(([value, label]) => (
                  <MenuItem key={value} value={value}>
                    {label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              fullWidth
              size="small"
              label="E-Mail-Empfänger (kommagetrennt)"
              value={recipientEmailsText}
              onChange={e => setRecipientEmailsText(e.target.value)}
              placeholder="admin@firma.de, buchhaltung@firma.de"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Abbrechen</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={createMutation.isPending || updateMutation.isPending}
          >
            {editId ? 'Speichern' : 'Anlegen'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(deleteId)} onClose={() => setDeleteId(null)}>
        <DialogTitle>Geplanten Bericht löschen?</DialogTitle>
        <DialogContent>
          <Typography>
            Diese Konfiguration wird gelöscht. Die Berichte werden dann nicht mehr automatisch
            versendet.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteId(null)}>Abbrechen</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            disabled={deleteMutation.isPending}
          >
            Löschen
          </Button>
        </DialogActions>
      </Dialog>
    </PageContainer>
  );
}
