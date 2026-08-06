import React from 'react';
import { Box, Typography, Button, Avatar } from '@mui/material';
import { GlassCard } from './GlassCard';
import {
  Assignment as AssignmentIcon,
  Notifications,
  Schedule,
  Work,
  People,
  Assessment,
  DocumentScanner,
  CalendarToday,
  TrendingUp,
  Search,
  FilterList,
} from '@mui/icons-material';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  secondaryAction?: {
    label: string;
    onClick: () => void;
  };
  size?: 'small' | 'medium' | 'large';
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  secondaryAction,
  size = 'medium',
  className: _className = 'glass',
}) => {
  const iconSize = size === 'small' ? 40 : size === 'medium' ? 64 : 80;
  const spacing = size === 'small' ? 2 : size === 'medium' ? 3 : 4;

  return (
    <GlassCard
      sx={{
        p: spacing,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        minHeight: size === 'small' ? 120 : size === 'medium' ? 200 : 300,
      }}
    >
      <Avatar
        sx={{
          width: iconSize,
          height: iconSize,
          backgroundColor: 'primary.main',
          color: 'primary.contrastText',
          mb: 2,
          boxShadow: 'none',
        }}
      >
        {icon}
      </Avatar>

      <Typography
        variant={size === 'small' ? 'h6' : size === 'medium' ? 'h5' : 'h4'}
        sx={{
          fontWeight: 700,
          mb: 1,
          color: 'text.primary',
          fontSize: size === 'small' ? '18px' : size === 'medium' ? '24px' : '32px',
        }}
      >
        {title}
      </Typography>

      {description && (
        <Typography
          variant="body1"
          sx={{
            color: 'text.secondary',
            mb: 3,
            maxWidth: 400,
            fontSize: '15px',
            lineHeight: 1.6,
          }}
        >
          {description}
        </Typography>
      )}

      {(action || secondaryAction) && (
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
          {action && (
            <Button
              variant="contained"
              onClick={action.onClick}
              size={size === 'small' ? 'small' : 'medium'}
              sx={{
                borderRadius: 2,
                textTransform: 'none',
                fontWeight: 600,
                px: 3,
                boxShadow: '0 2px 8px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.06)',
              }}
            >
              {action.label}
            </Button>
          )}
          {secondaryAction && (
            <Button
              variant="outlined"
              onClick={secondaryAction.onClick}
              size={size === 'small' ? 'small' : 'medium'}
              sx={{
                borderRadius: 2,
                textTransform: 'none',
                fontWeight: 600,
                px: 3,
                borderWidth: 1.5,
              }}
            >
              {secondaryAction.label}
            </Button>
          )}
        </Box>
      )}
    </GlassCard>
  );
};

// Vordefinierte Empty States für verschiedene Kontexte
export const EmptyNotifications: React.FC<{ onRefresh?: () => void }> = ({ onRefresh }) => (
  <EmptyState
    icon={<Notifications />}
    title="Keine Benachrichtigungen"
    description="Sie haben derzeit keine Benachrichtigungen. Neue Nachrichten werden hier angezeigt."
    action={onRefresh ? { label: 'Aktualisieren', onClick: onRefresh } : undefined}
  />
);

export const EmptyAssignments: React.FC<{ onRefresh?: () => void }> = ({ onRefresh }) => (
  <EmptyState
    icon={<AssignmentIcon />}
    title="Keine Einsätze"
    description="Derzeit sind keine Einsätze verfügbar. Neue Aufträge werden hier angezeigt."
    action={onRefresh ? { label: 'Aktualisieren', onClick: onRefresh } : undefined}
  />
);

export const EmptyTimesheets: React.FC<{ onRefresh?: () => void }> = ({ onRefresh }) => (
  <EmptyState
    icon={<Schedule />}
    title="Keine Zeiteinträge"
    description="Sie haben noch keine Zeiteinträge erstellt. Beginnen Sie mit der Zeiterfassung."
    action={onRefresh ? { label: 'Aktualisieren', onClick: onRefresh } : undefined}
  />
);

export const EmptyEmployees: React.FC<{ onRefresh?: () => void }> = ({ onRefresh }) => (
  <EmptyState
    icon={<People />}
    title="Keine Mitarbeiter"
    description="Es sind noch keine Mitarbeiter registriert. Fügen Sie den ersten Mitarbeiter hinzu."
    action={onRefresh ? { label: 'Aktualisieren', onClick: onRefresh } : undefined}
  />
);

export const EmptyFacilities: React.FC<{ onRefresh?: () => void }> = ({ onRefresh }) => (
  <EmptyState
    icon={<Work />}
    title="Keine Einrichtungen"
    description="Es sind noch keine Einrichtungen registriert. Fügen Sie die erste Einrichtung hinzu."
    action={onRefresh ? { label: 'Aktualisieren', onClick: onRefresh } : undefined}
  />
);

export const EmptyReports: React.FC<{ onRefresh?: () => void }> = ({ onRefresh }) => (
  <EmptyState
    icon={<Assessment />}
    title="Keine Berichte"
    description="Es sind noch keine Berichte verfügbar. Generieren Sie Ihren ersten Bericht."
    action={onRefresh ? { label: 'Aktualisieren', onClick: onRefresh } : undefined}
  />
);

export const EmptyDocuments: React.FC<{ onRefresh?: () => void }> = ({ onRefresh }) => (
  <EmptyState
    icon={<DocumentScanner />}
    title="Keine Dokumente"
    description="Es sind noch keine Dokumente hochgeladen. Laden Sie Ihr erstes Dokument hoch."
    action={onRefresh ? { label: 'Aktualisieren', onClick: onRefresh } : undefined}
  />
);

export const EmptyCalendar: React.FC<{ onRefresh?: () => void }> = ({ onRefresh }) => (
  <EmptyState
    icon={<CalendarToday />}
    title="Keine Termine"
    description="Es sind noch keine Termine geplant. Fügen Sie Ihren ersten Termin hinzu."
    action={onRefresh ? { label: 'Aktualisieren', onClick: onRefresh } : undefined}
  />
);

export const EmptySearch: React.FC<{
  searchTerm?: string;
  onClearSearch?: () => void;
}> = ({ searchTerm, onClearSearch }) => (
  <EmptyState
    icon={<Search />}
    title={searchTerm ? `Keine Ergebnisse für "${searchTerm}"` : 'Keine Suchergebnisse'}
    description={
      searchTerm
        ? 'Versuchen Sie andere Suchbegriffe oder erweitern Sie Ihre Suche.'
        : 'Geben Sie einen Suchbegriff ein, um Ergebnisse zu finden.'
    }
    action={onClearSearch ? { label: 'Suche zurücksetzen', onClick: onClearSearch } : undefined}
  />
);

export const EmptyFilters: React.FC<{
  onClearFilters?: () => void;
}> = ({ onClearFilters }) => (
  <EmptyState
    icon={<FilterList />}
    title="Keine Ergebnisse"
    description="Ihre aktuellen Filter zeigen keine Ergebnisse. Versuchen Sie andere Filtereinstellungen."
    action={onClearFilters ? { label: 'Filter zurücksetzen', onClick: onClearFilters } : undefined}
  />
);

export const EmptyTrends: React.FC<{ onRefresh?: () => void }> = ({ onRefresh }) => (
  <EmptyState
    icon={<TrendingUp />}
    title="Keine Trend-Daten"
    description="Es sind noch nicht genügend Daten vorhanden, um Trends zu analysieren."
    action={onRefresh ? { label: 'Aktualisieren', onClick: onRefresh } : undefined}
  />
);

export default EmptyState;
