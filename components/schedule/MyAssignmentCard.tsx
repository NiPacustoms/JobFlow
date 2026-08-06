'use client';

import { GlassCard } from '@/components/ui/GlassCard';
import { assignmentStatusColors } from '@/lib/design-tokens';
import { useEffect, useState } from 'react';
import { shiftService } from '@/lib/services/shifts';
import { facilityService } from '@/lib/services/facilities';
import { Assignment } from '@/lib/types';
import { AccessTime, Cancel, CheckCircle, LocationOn, Schedule, Person } from '@mui/icons-material';
import { Alert, Box, Button, CardContent, Chip, Typography } from '@mui/material';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

interface MyAssignmentCardProps {
  assignment: Assignment;
  onAccept: () => void;
  onDecline: (reason?: string) => void;
  getShiftTypeColor: (type: string) => string;
  getStatusColor: (status: string) => string;
  getStatusLabel: (status: string) => string;
  formatTime: (date: Date, time: string) => string;
  getTimeUntilShift: (shift: { date: string; startTime: string }) => string;
}

export function MyAssignmentCard({
  assignment,
  onAccept,
  onDecline,
  getShiftTypeColor,
  getStatusLabel,
  formatTime: _formatTime,
  getTimeUntilShift,
}: MyAssignmentCardProps) {
  const [shiftDetails, setShiftDetails] = useState<{
    date: Date;
    startTime?: string;
    endTime?: string;
    facilityName?: string;
    stationName?: string;
    contactPerson?: string;
    type?: string;
    requiredQualifications?: string[];
  }>({
    date: new Date(assignment.assignedAt),
  });

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const shift = await shiftService.getById(assignment.shiftId);
        if (mounted && shift) {
          const facility = shift.facilityId
            ? await facilityService.getById(shift.facilityId)
            : null;
          const station = facility?.stations?.find(s => s.id === shift.stationId);

          setShiftDetails({
            date: new Date(shift.date),
            startTime: shift.startTime,
            endTime: shift.endTime,
            type: shift.type,
            requiredQualifications: shift.requiredQualifications,
            facilityName: facility?.name,
            stationName: station?.name,
            contactPerson: facility?.contactPerson,
          });
        }
      } catch (_e) {
        // Fallback bleibt auf assignedAt-Datum, ohne Mockdaten
      }
    })();
    return () => {
      mounted = false;
    };
  }, [assignment.shiftId, assignment.assignedAt]);

  // Ein Assignment ist ausstehend, wenn es pending, requested oder assigned ist
  // (assigned bedeutet, dass es zugewiesen wurde, aber noch nicht bestätigt wurde)
  const isPending =
    assignment.status === 'pending' ||
    assignment.status === 'requested' ||
    assignment.status === 'assigned';
  const isAccepted = assignment.status === 'accepted';
  const isDeclined = assignment.status === 'declined';
  const isCompleted = assignment.status === 'completed' || assignment.status === 'done';

  const timeUntilShift = getTimeUntilShift({
    date: shiftDetails.date.toISOString(),
    startTime: shiftDetails.startTime || '',
  });
  const isLoadingDetails = Boolean(assignment.shiftId && !shiftDetails.facilityName);

  return (
    <GlassCard>
      <CardContent sx={{ p: 3 }}>
        {isLoadingDetails && (
          <>
            <Box className="shimmer-skeleton" sx={{ height: 24, width: '70%', mb: 1.5 }} aria-hidden />
            <Box className="shimmer-skeleton" sx={{ height: 16, width: '50%', mb: 1.5 }} aria-hidden />
            <Box className="shimmer-skeleton" sx={{ height: 16, width: '90%', mb: 2 }} aria-hidden />
          </>
        )}
        {/* Header with Status */}
        <Box
          sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}
        >
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
              {shiftDetails.facilityName || 'Schicht'}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {shiftDetails.stationName || ''}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <Schedule
                sx={{ fontSize: 16, color: getShiftTypeColor(shiftDetails.type || 'Schicht') }}
              />
              <Typography
                variant="body2"
                sx={{ color: getShiftTypeColor(shiftDetails.type || 'Schicht'), fontWeight: 500 }}
              >
                Schicht
              </Typography>
            </Box>
          </Box>
          <Chip
            label={getStatusLabel(assignment.status)}
            size="small"
            sx={{
              fontWeight: 600,
              height: 28,
              backgroundColor: assignmentStatusColors[assignment.status] ?? assignmentStatusColors.pending,
              color: '#fff',
            }}
          />
        </Box>

        {/* Date and Time */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <AccessTime sx={{ fontSize: 16, color: 'text.secondary' }} />
          <Typography variant="body2" color="text.secondary">
            {format(shiftDetails.date, 'dd.MM.yyyy', { locale: de })} •{' '}
            {shiftDetails.startTime || ''} - {shiftDetails.endTime || ''}
          </Typography>
        </Box>

        {/* Location */}
        {(shiftDetails.facilityName || shiftDetails.stationName) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <LocationOn sx={{ fontSize: 16, color: 'text.secondary' }} />
            <Typography variant="body2" color="text.secondary">
              {shiftDetails.facilityName || 'Einrichtung'}
              {shiftDetails.stationName && ` - ${shiftDetails.stationName}`}
            </Typography>
          </Box>
        )}

        {/* Ansprechpartner */}
        {shiftDetails.contactPerson && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <Person sx={{ fontSize: 16, color: 'text.secondary' }} />
            <Typography variant="body2" color="text.secondary">
              Ansprechpartner: {shiftDetails.contactPerson}
            </Typography>
          </Box>
        )}

        {/* Time Until Shift */}
        {isAccepted && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Schicht beginnt in:
            </Typography>
            <Typography variant="h6" color="primary.main" sx={{ fontWeight: 600 }}>
              {timeUntilShift}
            </Typography>
          </Box>
        )}


        {/* Required Qualifications */}
        {Array.isArray(shiftDetails.requiredQualifications) &&
          shiftDetails.requiredQualifications.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Erforderliche Qualifikationen:
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {shiftDetails.requiredQualifications.map(qual => (
                  <Chip
                    key={qual}
                    label={qual}
                    size="small"
                    variant="outlined"
                    color="primary"
                    sx={{
                      fontWeight: 600,
                      height: 28,
                    }}
                  />
                ))}
              </Box>
            </Box>
          )}

        {/* Assignment Notes */}
        {assignment.notes && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Notizen:
            </Typography>
            <Typography variant="body2" sx={{ fontStyle: 'italic' }}>
              {assignment.notes}
            </Typography>
          </Box>
        )}

        {/* Status-specific Information */}
        {isDeclined && (
          <>
            {assignment.declinedAt && (
              <Box sx={{ mb: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  Abgelehnt am: {format(assignment.declinedAt, 'dd.MM.yyyy HH:mm', { locale: de })}
                </Typography>
              </Box>
            )}
            {assignment.declineReason && (
              <Alert
                severity="info"
                sx={{
                  mb: 2,
                  py: 1.5,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'info.main',
                }}
              >
                <Typography variant="body2">
                  <strong>Grund für Ablehnung:</strong> {assignment.declineReason}
                </Typography>
              </Alert>
            )}
          </>
        )}

        {isCompleted && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Abgeschlossen am:{' '}
              {assignment.completedAt
                ? format(assignment.completedAt, 'dd.MM.yyyy HH:mm', { locale: de })
                : 'Unbekannt'}
            </Typography>
          </Box>
        )}

        {/* Action Buttons */}
        {isPending && (
          <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
            <Button
              variant="contained"
              color="success"
              startIcon={<CheckCircle />}
              onClick={onAccept}
              sx={{
                flex: 1,
                textTransform: 'none',
                fontWeight: 600,
                borderRadius: 2,
                boxShadow: 'var(--shadow-soft)',
              }}
              size="large"
            >
              Annehmen
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={<Cancel />}
              onClick={() => onDecline()}
              sx={{
                flex: 1,
                textTransform: 'none',
                fontWeight: 600,
                borderRadius: 2,
                borderWidth: 1.5,
              }}
              size="large"
            >
              Ablehnen
            </Button>
          </Box>
        )}

        {isAccepted && (
          <Box sx={{ mt: 2 }}>
            <Alert
              severity="success"
              sx={{
                py: 1.5,
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'success.main',
              }}
            >
              <Typography variant="body2" fontWeight={600}>
                ✓ Schicht angenommen
              </Typography>
            </Alert>
          </Box>
        )}

        {isDeclined && (
          <Box sx={{ mt: 2 }}>
            <Alert
              severity="error"
              sx={{
                py: 1.5,
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'error.main',
              }}
            >
              <Typography variant="body2" fontWeight={600}>
                ✗ Schicht abgelehnt
              </Typography>
            </Alert>
          </Box>
        )}

        {isCompleted && (
          <Box sx={{ mt: 2 }}>
            <Alert
              severity="info"
              sx={{
                py: 1.5,
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'info.main',
              }}
            >
              <Typography variant="body2" fontWeight={600}>
                ✓ Schicht abgeschlossen
              </Typography>
            </Alert>
          </Box>
        )}
      </CardContent>
    </GlassCard>
  );
}
