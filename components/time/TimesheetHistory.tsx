'use client';

import { useState } from 'react';
import { GlassCard } from '@/components/ui/GlassCard';
import { Timesheet } from '@/lib/types';
import { useAuth } from '@/contexts/AuthContext';
import { facilityService } from '@/lib/services/facilities';
import { toast } from '@/lib/utils/toast';
import { logger } from '@/lib/logging';
import { Edit, PictureAsPdf, Visibility } from '@mui/icons-material';
import { Box, Button, Chip, CircularProgress, Typography } from '@mui/material';
import { format } from 'date-fns';

interface TimesheetHistoryProps {
  timesheets: Timesheet[];
  onEdit?: (timesheet: Timesheet) => void;
  onView?: (timesheet: Timesheet) => void;
}

export function TimesheetHistory({ timesheets, onEdit, onView }: TimesheetHistoryProps) {
  const { user } = useAuth();
  const [generatingProofId, setGeneratingProofId] = useState<string | null>(null);

  /** Tagesnachweis-PDF erzeugen und öffnen (Einrichtungssignatur inklusive, falls vorhanden). */
  const handleDownloadProof = async (timesheet: Timesheet) => {
    if (!user) return;
    setGeneratingProofId(timesheet.id);
    try {
      const { timesheetProofService } = await import('@/lib/services/timesheetProof');
      let facility: { id?: string; name?: string; address?: string } | undefined;
      if (timesheet.facilityId) {
        try {
          const f = await facilityService.getById(timesheet.facilityId);
          if (f) facility = { id: f.id, name: f.name, address: f.address };
        } catch {
          // Einrichtung nicht auflösbar → Nachweis ohne Einrichtungsdaten
        }
      }
      const result = await timesheetProofService.generateDailyProofPDF({
        timesheet: {
          id: timesheet.id,
          userId: timesheet.userId,
          date: timesheet.date instanceof Date ? timesheet.date : new Date(timesheet.date),
          startTime: timesheet.startTime,
          endTime: timesheet.endTime,
          breakMinutes: timesheet.breakMinutes ?? 0,
          totalHours: timesheet.totalHours ?? 0,
          notes: timesheet.notes,
          facilitySignatureUrl: timesheet.facilitySignatureUrl,
          facilitySignedAt: timesheet.facilitySignedAt,
          facilitySignerName: timesheet.facilitySignerName,
        },
        employee: { id: user.id, name: user.displayName, email: user.email },
        facility,
      });
      window.open(result.url, '_blank', 'noopener');
      toast.success('Tagesnachweis erstellt.');
    } catch (e) {
      logger.error('Tagesnachweis konnte nicht erstellt werden', e);
      toast.error('Tagesnachweis konnte nicht erstellt werden.');
    } finally {
      setGeneratingProofId(null);
    }
  };
  const getStatusColor = (status: Timesheet['status']) => {
    switch (status) {
      case 'draft':
        return 'default';
      case 'submitted':
        return 'info';
      case 'approved':
        return 'success';
      case 'rejected':
        return 'error';
      default:
        return 'default';
    }
  };

  const getStatusLabel = (status: Timesheet['status']) => {
    switch (status) {
      case 'draft':
        return 'Entwurf';
      case 'submitted':
        return 'Eingereicht';
      case 'approved':
        return 'Genehmigt';
      case 'rejected':
        return 'Abgelehnt';
      default:
        return 'Unbekannt';
    }
  };

  if (timesheets.length === 0) {
    return (
      <GlassCard>
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="h6" color="text.secondary" sx={{ mb: 1 }}>
            Keine Zeiterfassungen
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Erstelle deine erste Zeiterfassung
          </Typography>
        </Box>
      </GlassCard>
    );
  }

  return (
    <GlassCard>
      <Box sx={{ p: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
          Letzte Einträge
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {timesheets.map(timesheet => (
            <Box
              key={timesheet.id}
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                p: 2,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
              }}
            >
              <Box sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                  <Typography variant="body1" sx={{ fontWeight: 500 }}>
                    {format(timesheet.date, 'dd.MM.yyyy')}
                  </Typography>
                  <Chip
                    label={getStatusLabel(timesheet.status)}
                    color={getStatusColor(timesheet.status)}
                    size="small"
                  />
                </Box>
                <Typography variant="body2" color="text.secondary">
                  {timesheet.startTime} - {timesheet.endTime} • {timesheet.totalHours}h
                  {timesheet.breakMinutes > 0 && ` • ${timesheet.breakMinutes}min Pause`}
                </Typography>
                {timesheet.notes && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {timesheet.notes}
                  </Typography>
                )}
                {timesheet.rejectionReason && (
                  <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>
                    Grund: {timesheet.rejectionReason}
                  </Typography>
                )}
              </Box>
              <Box sx={{ display: 'flex', gap: 1 }}>
                {onView && (
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<Visibility />}
                    onClick={() => onView(timesheet)}
                  >
                    Ansehen
                  </Button>
                )}
                {onEdit && timesheet.status === 'draft' && (
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<Edit />}
                    onClick={() => onEdit(timesheet)}
                  >
                    Bearbeiten
                  </Button>
                )}
                {timesheet.endTime && timesheet.endTime !== timesheet.startTime && (
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={
                      generatingProofId === timesheet.id ? (
                        <CircularProgress size={14} />
                      ) : (
                        <PictureAsPdf />
                      )
                    }
                    disabled={generatingProofId === timesheet.id}
                    onClick={() => void handleDownloadProof(timesheet)}
                  >
                    Tagesnachweis
                  </Button>
                )}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </GlassCard>
  );
}
