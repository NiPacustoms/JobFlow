'use client';

import { useAuth } from '@/contexts/AuthContext';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { PageContainer } from '@/components/layout/PageContainer';
import { ErrorDisplay } from '@/components/ui/ErrorBoundary';
import { useDomainAssignments } from '@/lib/hooks/useDomainAssignments';
import { shiftService } from '@/lib/services/shifts';
import { facilityService } from '@/lib/services/facilities';
import { documentService } from '@/lib/services';
import { useQuery } from '@tanstack/react-query';
import { logger } from '@/lib/logging';
import {
  Box,
  Typography,
  Button,
  Stack,
  CardContent,
  alpha,
} from '@mui/material';
import { AccessTime, LocationOn, Description, CalendarMonth } from '@mui/icons-material';
import { GlassCard } from '@/components/ui/GlassCard';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { assignmentStatusColors, grey } from '@/lib/design-tokens';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { useState, useMemo } from 'react';

type AssignmentDetail = {
  assignment: import('@/lib/types/assignment').Assignment & { formStatus?: string; pdfUrl?: string };
  shift: Awaited<ReturnType<typeof shiftService.getById>>;
  facility: Awaited<ReturnType<typeof facilityService.getById>> | null;
  station: { id: string; name: string } | undefined;
};

export default function MyAssignmentsPage() {
  const { user, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState(0);

  const { assignments = [], isLoading, error } = useDomainAssignments({
    limit: 100,
  });

  const { data: assignmentDetails = [], isLoading: loadingDetails } = useQuery({
    queryKey: ['assignmentDetailsList', assignments.map(a => a.id).join(',')],
    queryFn: async () => {
      const details: AssignmentDetail[] = [];
      for (const assignment of assignments) {
        try {
          const shift = await shiftService.getById(assignment.shiftId);
          if (!shift) continue;
          const facility = shift.facilityId
            ? await facilityService.getById(shift.facilityId)
            : null;
          const station = facility?.stations?.find(s => s.id === shift.stationId);
          details.push({ assignment, shift, facility, station });
        } catch (err) {
          logger.error(`Error loading details for assignment ${assignment.id}`, err instanceof Error ? err : new Error(String(err)));
        }
      }
      return details;
    },
    enabled: assignments.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const { data: userDocuments = [] } = useQuery({
    queryKey: ['userDocuments', user?.id],
    queryFn: () => (user?.id ? documentService.getByUserId(user.id) : Promise.resolve([])),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });

  const signedDetails = useMemo(() => {
    return assignmentDetails.filter(
      d => (d.assignment as { formStatus?: string }).formStatus === 'acknowledged' || (d.assignment as { formStatus?: string }).formStatus === 'declined'
    );
  }, [assignmentDetails]);

  const countAll = signedDetails.length;
  const countAccepted = signedDetails.filter(d => (d.assignment as { formStatus?: string }).formStatus === 'acknowledged').length;
  const countDeclined = signedDetails.filter(d => (d.assignment as { formStatus?: string }).formStatus === 'declined').length;

  const filteredAssignments = useMemo(() => {
    switch (activeTab) {
      case 0:
        return signedDetails;
      case 1:
        return signedDetails.filter(d => (d.assignment as { formStatus?: string }).formStatus === 'acknowledged');
      case 2:
        return signedDetails.filter(d => (d.assignment as { formStatus?: string }).formStatus === 'declined');
      default:
        return signedDetails;
    }
  }, [signedDetails, activeTab]);

  const getPdfUrl = (assignmentId: string, assignment: { formPdfUrl?: string; pdfUrl?: string }) => {
    if (assignment.formPdfUrl) return assignment.formPdfUrl;
    if (assignment.pdfUrl) return assignment.pdfUrl;
    const doc = userDocuments.find(d => d.notes?.includes(assignmentId) || d.name?.toLowerCase().includes('einsatzmitteilung'));
    return doc?.url ?? null;
  };

  const handleTabChange = (_event: React.SyntheticEvent, newValue: number) => {
    setActiveTab(newValue);
  };

  const getFormStatusLabel = (formStatus: string | undefined): string => {
    if (formStatus === 'acknowledged') return 'Angenommen';
    if (formStatus === 'declined') return 'Abgelehnt';
    return '–';
  };

  if (authLoading || isLoading || loadingDetails) {
    return <LoadingSpinner variant="skeleton" message="Einsätze werden geladen..." />;
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
        <Typography variant="body1" sx={{ color: 'text.secondary' }}>
          Bitte melde dich an, um fortzufahren
        </Typography>
      </Box>
    );
  }

  return (
    <PageContainer maxWidth="standard">
      <Box sx={{ mb: 3 }}>
        <Typography
          sx={{
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            color: 'text.secondary',
            mb: 0.5,
          }}
        >
          § 11 AÜG
        </Typography>
        <Typography sx={{ fontSize: { xs: 28, sm: 32 }, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.08 }}>
          Meine Einsatzmitteilungen
        </Typography>
        <Typography variant="body1" sx={{ color: 'text.secondary', mt: 0.75 }}>
          Ihre unterschriebenen Einsatzmitteilungen
        </Typography>
      </Box>

      <Box sx={{ mb: 3 }}>
        <SegmentedControl
          options={[
            { value: '0', label: `Alle (${countAll})` },
            { value: '1', label: `Angenommen (${countAccepted})` },
            { value: '2', label: `Abgelehnt (${countDeclined})` },
          ]}
          value={String(activeTab)}
          onChange={value => handleTabChange(undefined as unknown as React.SyntheticEvent, Number(value))}
          aria-label="Einsatzmitteilungen filtern"
        />
      </Box>

      {filteredAssignments.length === 0 ? (
        <GlassCard hover={false}>
          <CardContent sx={{ py: 5, textAlign: 'center' }}>
            <Typography variant="body1" sx={{ color: 'text.secondary' }}>
              {activeTab === 0
                ? 'Sie haben noch keine unterschriebenen Einsatzmitteilungen.'
                : 'Keine Einträge in dieser Kategorie.'}
            </Typography>
          </CardContent>
        </GlassCard>
      ) : (
        <Stack spacing={2}>
          {filteredAssignments.map(({ assignment, shift, facility }) => {
            if (!assignment) return null;
            const formStatus = (assignment as { formStatus?: string }).formStatus;
            const formSignedAt = (assignment as { formSignedAt?: Date | string }).formSignedAt;
            const signedAtStr = formSignedAt
              ? format(new Date(formSignedAt), 'dd.MM.yyyy HH:mm', { locale: de })
              : '–';
            const facilityAddress = facility
              ? [facility.name, facility.address].filter(Boolean).join(', ') || '–'
              : '–';
            const shiftDateStr = shift?.date
              ? format(new Date(shift.date), 'dd.MM.yyyy', { locale: de })
              : '–';
            const pdfUrl = getPdfUrl(assignment.id, assignment as { formPdfUrl?: string; pdfUrl?: string });
            const statusColor =
              formStatus === 'acknowledged'
                ? assignmentStatusColors.accepted
                : formStatus === 'declined'
                  ? assignmentStatusColors.declined
                  : grey[500];

            return (
              <GlassCard key={assignment.id}>
                <CardContent sx={{ p: { xs: 2, sm: 2.5 }, '&:last-child': { pb: { xs: 2, sm: 2.5 } } }}>
                  <Stack spacing={1.75}>
                    <Stack
                      direction="row"
                      alignItems="flex-start"
                      justifyContent="space-between"
                      spacing={1.5}
                    >
                      <Typography sx={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1.25 }}>
                        {facility?.name || 'Einsatzmitteilung'}
                      </Typography>
                      <Box
                        sx={{
                          flexShrink: 0,
                          px: 1.25,
                          py: 0.4,
                          borderRadius: 999,
                          backgroundColor: alpha(statusColor, 0.14),
                          color: statusColor,
                          fontSize: 12,
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {getFormStatusLabel(formStatus)}
                      </Box>
                    </Stack>

                    <Stack spacing={0.75}>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <LocationOn sx={{ fontSize: 18, color: 'text.secondary' }} />
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          {facilityAddress}
                        </Typography>
                      </Stack>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <CalendarMonth sx={{ fontSize: 18, color: 'text.secondary' }} />
                        <Typography variant="body2" className="tabular-nums" sx={{ color: 'text.secondary' }}>
                          {shiftDateStr}
                        </Typography>
                      </Stack>
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <AccessTime sx={{ fontSize: 18, color: 'text.secondary' }} />
                        <Typography variant="body2" className="tabular-nums" sx={{ color: 'text.secondary' }}>
                          Unterschrieben: {signedAtStr}
                        </Typography>
                      </Stack>
                    </Stack>

                    {pdfUrl ? (
                      <Box>
                        <Button
                          variant="contained"
                          component="a"
                          href={pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          startIcon={<Description />}
                        >
                          PDF anzeigen
                        </Button>
                      </Box>
                    ) : null}
                  </Stack>
                </CardContent>
              </GlassCard>
            );
          })}
        </Stack>
      )}
    </PageContainer>
  );
}
