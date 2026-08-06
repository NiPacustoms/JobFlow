'use client';

import { useEffect, useState } from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import {
  Edit,
  Login,
  Logout,
  PauseCircleOutline,
  PlayCircleOutline,
} from '@mui/icons-material';
import {
  TimeEvent,
  TimeEventType,
  listenToTimeEvents,
  timeEventLabel,
} from '@/lib/services/timeEvents';

const FIELD_LABELS: Record<string, string> = {
  startTime: 'Beginn',
  endTime: 'Ende',
  breakMinutes: 'Pause (Min)',
  notes: 'Notizen',
};

function eventIcon(type: TimeEventType) {
  switch (type) {
    case 'clockIn':
      return <Login fontSize="small" color="success" />;
    case 'clockOut':
      return <Logout fontSize="small" color="error" />;
    case 'pauseStart':
      return <PauseCircleOutline fontSize="small" color="warning" />;
    case 'pauseEnd':
      return <PlayCircleOutline fontSize="small" color="warning" />;
    case 'correction':
      return <Edit fontSize="small" color="info" />;
  }
}

/**
 * Revisionssicherer Verlauf einer Zeiterfassung: zeigt alle Stempel- und
 * Korrektur-Ereignisse chronologisch an (append-only, Rules-geschützt).
 */
export function TimeEventTrail({ timesheetId }: { timesheetId: string }) {
  const [events, setEvents] = useState<TimeEvent[]>([]);

  useEffect(() => {
    const unsubscribe = listenToTimeEvents(timesheetId, setEvents);
    return () => unsubscribe();
  }, [timesheetId]);

  if (events.length === 0) return null;

  return (
    <Box sx={{ mt: 2, pt: 1.5, borderTop: 1, borderColor: 'divider' }}>
      <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', letterSpacing: 0.4 }}>
        VERLAUF
      </Typography>
      <Stack spacing={0.75} sx={{ mt: 1 }} aria-label="Zeiterfassungs-Verlauf">
        {events.map(event => (
          <Stack key={event.id} direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            {eventIcon(event.type)}
            <Typography variant="body2" sx={{ minWidth: 44, color: 'text.secondary' }}>
              {event.at}
            </Typography>
            <Typography variant="body2">{timeEventLabel(event.type)}</Typography>
            {event.corrections?.map((c, i) => (
              <Chip
                key={i}
                size="small"
                variant="outlined"
                label={`${FIELD_LABELS[c.field] || c.field}: ${c.from} → ${c.to}`}
              />
            ))}
            {event.note && (
              <Typography variant="caption" color="text.secondary">
                {event.note}
              </Typography>
            )}
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
