'use client';

import { useAuth } from '@/contexts/AuthContext';
import { useFeatureFlags } from '@/lib/hooks/useFeatureFlags';
import {
  AccessTime,
  Assessment,
  Assignment as AssignmentIcon,
  Business,
  CalendarMonth,
  Dashboard,
  Description,
  FactCheck,
  History,
  Home,
  InsertDriveFile,
  People,
  Person,
  Schedule,
  ViewList,
  ViewModule,
} from '@mui/icons-material';
import {
  Avatar,
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Drawer,
  useTheme,
  Divider,
  Typography,
} from '@mui/material';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getThemeConstants, type ThemeMode } from '@/lib/theme';
import { ROUTES } from '@/lib/constants/routes';
import { AppLogo } from '@/components/ui/AppLogo';
import { useBrandingSettings } from '@/lib/hooks/useBrandingSettings';

const SIDEBAR_WIDTH = 248;

type FeatureFlagCheck =
  | 'canAccessAssignments'
  | 'canAccessAdminReports'
  | 'canAccessAuditLogs'
  | 'canAccessEmployeeDocuments'
  | 'canAccessEmployeeAssignments'
  | 'canAccessEmployeeFacilities'
  | 'canAccessEmployeeNotifications';

interface NavItem {
  href: string;
  icon: React.ReactNode;
  label: string;
  feature?: FeatureFlagCheck;
}

const nurseMainItems: NavItem[] = [
  { href: ROUTES.EMPLOYEE.DASHBOARD, icon: <Home />, label: 'Arbeitsplatz' },
  { href: ROUTES.EMPLOYEE.DIENSTPLAN, icon: <CalendarMonth />, label: 'Dienstplan' },
  { href: ROUTES.EMPLOYEE.ZEITERFASSUNG, icon: <AccessTime />, label: 'Zeit' },
  { href: ROUTES.EMPLOYEE.PROFIL, icon: <Person />, label: 'Profil' },
];

const nurseMoreItems: NavItem[] = [
  { href: ROUTES.EMPLOYEE.ASSIGNMENTS, icon: <AssignmentIcon />, label: 'Meine Einsätze' },
  { href: ROUTES.EMPLOYEE.ZEITEN, icon: <Schedule />, label: 'Zeiten & Zeitkonto' },
  { href: ROUTES.EMPLOYEE.BERICHTE, icon: <Assessment />, label: 'Meine Berichte' },
  {
    href: ROUTES.EMPLOYEE.DOKUMENTE,
    icon: <Description />,
    label: 'Nachweise',
    feature: 'canAccessEmployeeDocuments',
  },
];

const adminMainItems: NavItem[] = [
  { href: ROUTES.ADMIN.UEBERSICHT, icon: <Dashboard />, label: 'Übersicht' },
  { href: ROUTES.ADMIN.SHIFTS, icon: <CalendarMonth />, label: 'Schichten' },
  { href: ROUTES.ADMIN.MITARBEITER, icon: <People />, label: 'Personal' },
  { href: ROUTES.ADMIN.EINRICHTUNGEN, icon: <Business />, label: 'Standorte' },
];

const adminMoreItems: NavItem[] = [
  {
    href: ROUTES.ADMIN.EINSAETZE,
    icon: <AssignmentIcon />,
    label: 'Einsätze',
    feature: 'canAccessAssignments',
  },
  { href: ROUTES.ADMIN.STUNDEN, icon: <Schedule />, label: 'Stundenübersicht' },
  {
    href: ROUTES.ADMIN.BERICHTE,
    icon: <Assessment />,
    label: 'Berichte',
    feature: 'canAccessAdminReports',
  },
  {
    href: ROUTES.ADMIN.PRÜFPROTOKOLLE,
    icon: <FactCheck />,
    label: 'Prüfprotokolle',
    feature: 'canAccessAuditLogs',
  },
  { href: ROUTES.ADMIN.AKTIVITAETEN, icon: <History />, label: 'Aktivitäten' },
  {
    href: ROUTES.ADMIN.DOCUMENTE_VORLAGEN,
    icon: <InsertDriveFile />,
    label: 'Dokumente & Vorlagen',
  },
  { href: ROUTES.ADMIN.PERSONAL_KOMPAKT, icon: <ViewList />, label: 'Personal-Kompakt' },
  { href: ROUTES.ADMIN.STAFF_SIMPLE, icon: <ViewModule />, label: 'Staff-Simple' },
  { href: ROUTES.ADMIN.EINSTELLUNGEN, icon: <Person />, label: 'Einstellungen' },
];

function filterByFeatureFlags<T extends { feature?: FeatureFlagCheck }>(
  items: T[],
  flags: Record<string, boolean>
): T[] {
  return items.filter((item): item is T => {
    if (!item.feature) return true;
    return flags[item.feature] === true;
  });
}

export function AppSidebar() {
  const pathname = usePathname();
  const theme = useTheme();
  const themeConstants = getThemeConstants((theme.palette.mode || 'light') as ThemeMode);
  const { user } = useAuth();
  const featureFlags = useFeatureFlags();

  const isNurse = user?.role === 'nurse';
  const _isAdmin = user?.role === 'admin';

  const mainItems = isNurse ? nurseMainItems : adminMainItems;
  const moreItems = filterByFeatureFlags(
    isNurse ? nurseMoreItems : adminMoreItems,
    featureFlags as unknown as Record<string, boolean>
  );
  const allItems = [...mainItems, ...moreItems];

  const { branding } = useBrandingSettings();
  const brandingData = branding ?? { companyName: 'Schichtklar', companyLogo: undefined, showLogo: true };
  const displayName = user?.displayName || user?.email || '';
  const initials = displayName
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join('');
  const roleLabel = isNurse ? 'Mitarbeiter/in' : 'Administration';

  const content = (
    <Box
      sx={{
        width: SIDEBAR_WIDTH,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: theme.palette.background.paper,
        borderRight: `1px solid ${themeConstants.CARD_BORDER_LIGHT}`,
      }}
    >
      {/* Marke oben */}
      <Box
        component={Link}
        href={isNurse ? ROUTES.EMPLOYEE.DASHBOARD : ROUTES.ADMIN.UEBERSICHT}
        sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2.5, py: 2.25, textDecoration: 'none' }}
        aria-label="Zur Startseite"
      >
        <AppLogo
          branding={brandingData}
          showLogo
          width={140}
          height={34}
          sx={{ width: 'auto', height: 34, borderRadius: 0 }}
          showSkeleton={false}
          fallbackBgColor="transparent"
        />
      </Box>
      <Divider sx={{ borderColor: '#ececee' }} />

      <List component="nav" sx={{ flex: 1, py: 1.5, px: 1 }}>
        {allItems.map(item => {
          const isActive =
            pathname === item.href ||
            (item.href !== '/' && (pathname ?? '').startsWith(item.href + '/'));
          return (
            <ListItem key={item.href} disablePadding sx={{ mb: 0.25 }}>
              <ListItemButton
                component={Link}
                href={item.href}
                selected={isActive}
                sx={{
                  borderRadius: '10px',
                  minHeight: 44,
                  px: 1.5,
                  m: 0,
                  '&.Mui-selected': {
                    backgroundColor: 'rgba(15,118,110,0.10)',
                    color: 'primary.main',
                    '&:hover': { backgroundColor: 'rgba(15,118,110,0.16)' },
                    '& .MuiListItemIcon-root': { color: 'primary.main' },
                  },
                }}
              >
                <ListItemIcon
                  sx={{ minWidth: 36, color: isActive ? 'primary.main' : 'text.secondary' }}
                >
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={item.label}
                  primaryTypographyProps={{
                    fontSize: 15,
                    fontWeight: isActive ? 600 : 500,
                    letterSpacing: '-0.01em',
                  }}
                />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>

      {/* User-Zeile unten */}
      {displayName && (
        <>
          <Divider sx={{ borderColor: '#ececee' }} />
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2, py: 1.75 }}>
            <Avatar sx={{ width: 34, height: 34, fontSize: 14 }}>{initials || '·'}</Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontSize: 14, fontWeight: 600, lineHeight: 1.25 }}>
                {displayName}
              </Typography>
              <Typography noWrap sx={{ fontSize: 12, color: 'text.secondary', lineHeight: 1.2 }}>
                {roleLabel}
              </Typography>
            </Box>
          </Box>
        </>
      )}
    </Box>
  );

  return (
    <Drawer
      variant="permanent"
      sx={{
        display: { xs: 'none', lg: 'block' },
        width: SIDEBAR_WIDTH,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: SIDEBAR_WIDTH,
          boxSizing: 'border-box',
          top: 0,
          left: 0,
          border: 'none',
          background: 'transparent',
          boxShadow: 'none',
        },
      }}
    >
      {content}
    </Drawer>
  );
}

export const SIDEBAR_WIDTH_PX = SIDEBAR_WIDTH;
