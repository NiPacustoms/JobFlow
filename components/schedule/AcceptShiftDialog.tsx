'use client';

import { useEffect, useMemo, useState } from 'react';
import { Assignment } from '@/lib/types';
import { shiftService } from '@/lib/services/shifts';
import { facilityService } from '@/lib/services/facilities';
import { logger } from '@/lib/logging';
import { AccessTime, CheckCircle, LocationOn, Schedule } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  CircularProgress,
} from '@mui/material';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

interface AcceptShiftDialogProps {
  open: boolean;
  onClose: () => void;
  assignment: Assignment;
  onAccept: () => void;
  getShiftTypeColor: (type: string) => string;
}

export function AcceptShiftDialog({
  open,
  onClose,
  assignment,
  onAccept,
}: AcceptShiftDialogProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [shiftDetails, setShiftDetails] = useState<{
    type?: string;
    startTime?: string;
    endTime?: string;
    date?: Date;
    facilityName?: string;
    stationName?: string;
    requiredQualifications?: string[];
  } | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadShiftDetails = async () => {
      if (!assignment.shiftId) {
        if (isMounted) {
          setShiftDetails(null);
          setIsLoading(false);
        }
        return;
      }

      setIsLoading(true);
      try {
        const shift = await shiftService.getById(assignment.shiftId);
        if (!isMounted) return;

        if (!shift) {
          setShiftDetails(null);
          return;
        }

        const facility = shift.facilityId ? await facilityService.getById(shift.facilityId) : null;
        const station = facility?.stations?.find(stationItem => stationItem.id === shift.stationId);

        setShiftDetails({
          type: shift.type,
          startTime: shift.startTime,
          endTime: shift.endTime,
          date: shift.date ? new Date(shift.date) : new Date(assignment.assignedAt),
          facilityName: facility?.name,
          stationName: station?.name,
          requiredQualifications: shift.requiredQualifications || [],
        });
      } catch (error) {
        if (isMounted) {
          setShiftDetails(null);
        }
        logger.error(
          'Failed to load shift details for AcceptShiftDialog',
          error instanceof Error ? error : new Error(String(error)),
          { assignmentId: assignment.id, shiftId: assignment.shiftId } as Record<string, unknown>
        );
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadShiftDetails();

    return () => {
      isMounted = false;
    };
  }, [assignment.id, assignment.shiftId, assignment.assignedAt]);

  const resolvedDate = useMemo(() => {
    if (shiftDetails?.date && !Number.isNaN(shiftDetails.date.getTime())) {
      return shiftDetails.date;
    }
    return new Date(assignment.assignedAt);
  }, [shiftDetails?.date, assignment.assignedAt]);

  const facilityLabel = shiftDetails?.facilityName || 'Unbekannte Einrichtung';
  const stationLabel = shiftDetails?.stationName;
  const shiftTypeLabel = 'Schicht';


  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
        },
      }}
    >
      <DialogTitle sx={{ fontWeight: 700, fontSize: '20px', pb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <CheckCircle color="success" sx={{ fontSize: 24 }} />
          <Typography variant="h6" component="span" sx={{ fontWeight: 700 }}>
            Schicht annehmen
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent>
        {isLoading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={32} />
          </Box>
        )}
        <Box sx={{ mb: 3 }}>
          <Typography variant="body1" gutterBottom sx={{ fontSize: '15px', lineHeight: 1.6 }}>
            Möchtest du diese Schicht annehmen?
          </Typography>
        </Box>

        {/* Shift Details */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="h6" gutterBottom sx={{ fontWeight: 600 }}>
            {facilityLabel}
            {stationLabel ? ` - ${stationLabel}` : ''}
          </Typography>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <Schedule sx={{ fontSize: 16, color: 'primary.main' }} />
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
              {shiftTypeLabel}
            </Typography>
          </Box>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <AccessTime sx={{ fontSize: 16, color: 'text.secondary' }} />
            <Typography variant="body2" color="text.secondary">
              {format(resolvedDate, 'dd.MM.yyyy', { locale: de })} •{' '}
              {shiftDetails?.startTime || '--:--'} - {shiftDetails?.endTime || '--:--'}
            </Typography>
          </Box>

          {(shiftDetails?.facilityName || shiftDetails?.stationName) && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <LocationOn sx={{ fontSize: 16, color: 'text.secondary' }} />
              <Typography variant="body2" color="text.secondary">
                {facilityLabel}
                {stationLabel ? ` - ${stationLabel}` : ''}
              </Typography>
            </Box>
          )}
        </Box>

        {/* Required Qualifications */}
        {shiftDetails?.requiredQualifications && shiftDetails.requiredQualifications.length > 0 && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Erforderliche Qualifikationen:
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {shiftDetails.requiredQualifications.map(qual => (
                <Chip key={qual} label={qual} size="small" variant="outlined" color="primary" />
              ))}
            </Box>
          </Box>
        )}


        {/* Assignment Notes */}
        {assignment.notes && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Notizen zur Zuweisung:
            </Typography>
            <Typography
              variant="body2"
              sx={{ fontStyle: 'italic', p: 2, bgcolor: 'grey.50', borderRadius: 1 }}
            >
              {assignment.notes}
            </Typography>
          </Box>
        )}

        {/* General Information */}
        <Alert
          severity="info"
          sx={{
            mb: 2,
            borderRadius: 2,
            border: '1px solid',
            borderColor: 'info.main',
          }}
        >
          <Typography variant="body2">
            <strong>Hinweis:</strong> Nach der Annahme kannst du die Schicht nur noch in besonderen
            Fällen ablehnen. Bitte stelle sicher, dass du an diesem Tag verfügbar bist.
          </Typography>
        </Alert>

      </DialogContent>

      <DialogActions sx={{ p: 3, pt: 2 }}>
        <Button
          onClick={onClose}
          color="inherit"
          sx={{
            textTransform: 'none',
            fontWeight: 600,
            borderRadius: 2,
          }}
        >
          Abbrechen
        </Button>
        <Button
          onClick={onAccept}
          variant="contained"
          color="success"
          startIcon={<CheckCircle />}
          sx={{
            textTransform: 'none',
            fontWeight: 600,
            borderRadius: 2,
            px: 3,
            boxShadow: 'var(--shadow-soft)',
          }}
        >
          Schicht annehmen
        </Button>
      </DialogActions>
    </Dialog>
  );
}
