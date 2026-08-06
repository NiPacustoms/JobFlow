'use client';

import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/contexts/PermissionsContext';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { LEGAL_URLS } from '@/lib/config/legal';
import { GlassCard } from '@/components/ui/GlassCard';
import { AppLogo } from '@/components/ui/AppLogo';
import {
  alpha,
  Box,
  Button,
  Container,
  Stack,
  Typography,
  useScrollTrigger,
  Zoom,
  Fab,
} from '@mui/material';
import {
  AccessTime,
  ArrowForward,
  Assessment,
  CalendarMonth,
  CheckCircleOutline,
  Description,
  Draw,
  KeyboardArrowUp,
  VerifiedUser,
  PhoneAndroid,
} from '@mui/icons-material';
import { useBrandingSettings } from '@/lib/hooks/useBrandingSettings';
import { ThemeProvider } from '@mui/material/styles';
import { createAppTheme } from '@/lib/theme';
import { colors, gradients, heroGradient } from '@/lib/design-tokens';

function ScrollToTop() {
  const trigger = useScrollTrigger({ disableHysteresis: true, threshold: 120 });

  return (
    <Zoom in={trigger}>
      <Fab
        color="primary"
        size="medium"
        aria-label="Nach oben scrollen"
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        sx={{ position: 'fixed', right: 24, bottom: 24, zIndex: 1000 }}
      >
        <KeyboardArrowUp />
      </Fab>
    </Zoom>
  );
}

/** Getönter Icon-Kreis – dasselbe Muster wie im App-Inneren */
function TintedIcon({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        width: 44,
        height: 44,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        backgroundColor: alpha(colors.brand, 0.1),
        color: 'primary.main',
      }}
    >
      {children}
    </Box>
  );
}

const FEATURES = [
  {
    icon: <CalendarMonth fontSize="small" />,
    title: 'Dienstplanung',
    desc: 'Schichten anlegen, Einsätze zuweisen und den Dienstplan für alle sichtbar halten – Kalender- und Listenansicht inklusive.',
  },
  {
    icon: <AccessTime fontSize="small" />,
    title: 'Zeiterfassung',
    desc: 'Schichten starten, Pausen erfassen, Zeitkonto und Überstunden im Blick – minutengenau und nachvollziehbar.',
  },
  {
    icon: <Draw fontSize="small" />,
    title: 'Digitale Signatur',
    desc: 'Arbeitszeiten direkt in der Einrichtung digital gegenzeichnen lassen – ohne Papier und ohne Nachlauf.',
  },
  {
    icon: <Description fontSize="small" />,
    title: 'Einsatzmitteilungen',
    desc: 'Einsatzmitteilungen nach § 11 AÜG digital erstellen, unterschreiben und revisionssicher ablegen.',
  },
  {
    icon: <Assessment fontSize="small" />,
    title: 'Berichte & Exporte',
    desc: 'Stunden, Auslastung und Einsätze auswerten – als PDF oder CSV exportieren, bereit für die Abrechnung.',
  },
  {
    icon: <VerifiedUser fontSize="small" />,
    title: 'Rollen & Datenschutz',
    desc: 'Klare Rollentrennung zwischen Verwaltung und Pflegekräften, DSGVO-konforme Datenhaltung und Löschkonzepte.',
  },
];

const STEPS = [
  {
    step: '1',
    title: 'Einrichtung registrieren',
    desc: 'Firma anlegen, Standorte und Stationen hinterlegen – in wenigen Minuten startklar.',
  },
  {
    step: '2',
    title: 'Team einladen',
    desc: 'Pflegekräfte per E-Mail einladen. Qualifikationen und Nachweise werden zentral gepflegt.',
  },
  {
    step: '3',
    title: 'Einsätze planen & erfassen',
    desc: 'Schichten zuweisen, Zeiten erfassen, digital signieren – alles in einem Ablauf.',
  },
];

const AUDIENCE = [
  {
    title: 'Für Einrichtungen & Agenturen',
    points: [
      'Offene Schichten und Besetzung auf einen Blick',
      'Wochenlimits nach ArbZG/MiLoG automatisch im Blick',
      'Nachweise und Dokumente zentral verwaltet',
    ],
  },
  {
    title: 'Für Pflegekräfte',
    points: [
      'Dienstplan und Einsätze mobil auf dem eigenen Gerät',
      'Zeiten erfassen und Zeitkonto jederzeit einsehen',
      'Einsätze mit einem Fingertipp annehmen oder ablehnen',
    ],
  },
];

export default function HomePage() {
  const { user, loading } = useAuth();
  const { canAccessAdminArea } = usePermissions();
  const { branding, isLoading: _brandingLoading } = useBrandingSettings();
  const router = useRouter();
  // Marketing-Seite ist immer hell – unabhängig von System-/App-Theme
  const lightTheme = useMemo(() => createAppTheme('light'), []);

  // Fallback für branding, falls es undefined ist
  const brandingData = branding || {
    companyName: 'Schichtklar',
    companyLogo: undefined,
    showLogo: false,
  };

  useEffect(() => {
    if (!loading && user) {
      if (canAccessAdminArea) router.push('/admin/uebersicht');
      else if (user.role === 'nurse') router.push('/employee/arbeitsplatz');
    }
  }, [user, loading, router, canAccessAdminArea]);

  // Marketing-Seite ist immer hell: data-theme für die Dauer der Landing auf 'light'
  // pinnen (sonst scheint der dunkle Body-Hintergrund durch); beim Verlassen zurücksetzen.
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'light');
    return () => {
      if (prev) root.setAttribute('data-theme', prev);
    };
  }, []);

  // Minimales Loading/Weiterleitung ohne LoadingSpinner (vermeidet Absturz durch Branding/Theme)
  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '80vh',
          gap: 2,
        }}
      >
        <Typography variant="h6">Schichtklar wird geladen…</Typography>
        <Button component={Link} href="/anmelden" variant="outlined">
          Zur Anmeldung
        </Button>
      </Box>
    );
  }

  if (user) {
    return (
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '80vh',
          gap: 2,
        }}
      >
        <Typography variant="h6">Weiterleitung…</Typography>
        <Button
          component={Link}
          href={canAccessAdminArea ? '/admin/uebersicht' : '/employee/arbeitsplatz'}
          variant="contained"
        >
          Zum Dashboard
        </Button>
      </Box>
    );
  }

  return (
    <ThemeProvider theme={lightTheme}>
      <Box
        sx={{
          minHeight: '100dvh',
          backgroundColor: '#fafaf9',
          backgroundImage: gradients.light.brandLight,
          backgroundRepeat: 'no-repeat',
          backgroundSize: '100% 100vh',
          color: 'text.primary',
        }}
      >
      {/* Kopfzeile: Logo links, Login rechts – ruhig und klein */}
      <Container maxWidth="lg">
        <Box
          component="header"
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            py: 2,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', height: 48 }}>
            <AppLogo
              branding={brandingData}
              showLogo={brandingData?.showLogo !== false}
              width={160}
              height={48}
              sx={{ width: 160, height: 48 }}
              showSkeleton={false}
              fallbackBgColor="transparent"
              priority
            />
          </Box>
          <Button component={Link} href="/anmelden" variant="outlined" size="small">
            Login
          </Button>
        </Box>
      </Container>

      {/* Hero – viel Weißraum, eine Botschaft */}
      <Container maxWidth="md" sx={{ textAlign: 'center', pt: { xs: 8, md: 14 }, pb: { xs: 8, md: 12 } }}>
        <Typography
          variant="overline"
          component="p"
          sx={{ color: 'primary.main', mb: 2 }}
        >
          Digitale Personalplanung für die Pflege
        </Typography>
        <Typography
          variant="h1"
          sx={{
            fontSize: { xs: 34, md: 48 },
            lineHeight: 1.12,
            letterSpacing: '-0.02em',
            mb: 3,
          }}
        >
          Dienstplan, Zeiterfassung und Einsätze – an einem Ort.
        </Typography>
        <Typography
          variant="body1"
          color="text.secondary"
          sx={{ fontSize: 17, maxWidth: 620, mx: 'auto', mb: 5 }}
        >
          Schichtklar verbindet Einrichtungen und Pflegekräfte: Einsätze planen, Arbeitszeiten
          erfassen und digital signieren – ohne Zettelwirtschaft, konform mit § 11 AÜG.
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="center" sx={{ mb: 6 }}>
          <Button
            component={Link}
            href="/admin-registrieren"
            variant="contained"
            size="large"
            endIcon={<ArrowForward />}
          >
            Firma registrieren
          </Button>
          <Button component={Link} href="/anmelden" size="large" variant="text">
            Ich habe bereits ein Konto
          </Button>
        </Stack>

        {/* Sachliche Vertrauens-Hinweise – Text statt Deko */}
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={{ xs: 1, sm: 4 }}
          justifyContent="center"
          sx={{ color: 'text.secondary' }}
        >
          {['DSGVO-konforme Datenhaltung', 'Einsatzmitteilungen nach § 11 AÜG', 'Digitale Signatur'].map(
            item => (
              <Stack key={item} direction="row" spacing={1} alignItems="center" justifyContent="center">
                <CheckCircleOutline sx={{ fontSize: 18, color: 'success.main' }} />
                <Typography variant="body2">{item}</Typography>
              </Stack>
            )
          )}
        </Stack>
      </Container>

      {/* Funktionen */}
      <Container maxWidth="lg" sx={{ pb: { xs: 8, md: 12 } }}>
        <Typography variant="overline" component="p" sx={{ color: 'text.secondary', textAlign: 'center', mb: 1 }}>
          Funktionen
        </Typography>
        <Typography variant="h2" sx={{ textAlign: 'center', mb: 6 }}>
          Alles, was der Pflegealltag braucht
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gap: 3,
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' },
          }}
        >
          {FEATURES.map(f => (
            <GlassCard key={f.title} hover={false} sx={{ p: 3, height: '100%' }}>
              <Stack spacing={2}>
                <TintedIcon>{f.icon}</TintedIcon>
                <Box>
                  <Typography variant="h5" component="h3" sx={{ mb: 0.5 }}>
                    {f.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {f.desc}
                  </Typography>
                </Box>
              </Stack>
            </GlassCard>
          ))}
        </Box>
      </Container>

      {/* So funktioniert es */}
      <Container maxWidth="lg" sx={{ pb: { xs: 8, md: 12 } }}>
        <Typography variant="overline" component="p" sx={{ color: 'text.secondary', textAlign: 'center', mb: 1 }}>
          So funktioniert es
        </Typography>
        <Typography variant="h2" sx={{ textAlign: 'center', mb: 6 }}>
          In drei Schritten startklar
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gap: 3,
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
          }}
        >
          {STEPS.map(s => (
            <Box key={s.step} sx={{ textAlign: 'center', px: 2 }}>
              <Box
                aria-hidden
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mx: 'auto',
                  mb: 2,
                  backgroundColor: alpha(colors.brand, 0.1),
                  color: 'primary.main',
                  fontWeight: 600,
                  fontSize: 17,
                }}
                className="tabular-nums"
              >
                {s.step}
              </Box>
              <Typography variant="h5" component="h3" sx={{ mb: 1 }}>
                {s.title}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {s.desc}
              </Typography>
            </Box>
          ))}
        </Box>
      </Container>

      {/* Zielgruppen */}
      <Container maxWidth="lg" sx={{ pb: { xs: 8, md: 12 } }}>
        <Box
          sx={{
            display: 'grid',
            gap: 3,
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
          }}
        >
          {AUDIENCE.map(a => (
            <GlassCard key={a.title} hover={false} sx={{ p: 4, height: '100%' }}>
              <Typography variant="h4" component="h3" sx={{ mb: 3 }}>
                {a.title}
              </Typography>
              <Stack spacing={1.5}>
                {a.points.map(p => (
                  <Stack key={p} direction="row" spacing={1.5} alignItems="flex-start">
                    <CheckCircleOutline
                      sx={{ fontSize: 20, color: 'success.main', mt: '2px', flexShrink: 0 }}
                    />
                    <Typography variant="body2" color="text.secondary">
                      {p}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </GlassCard>
          ))}
        </Box>
      </Container>

      {/* Abschluss-CTA */}
      <Container maxWidth="lg" sx={{ pb: { xs: 8, md: 12 } }}>
        <Box
          sx={{
            textAlign: 'center',
            borderRadius: 6,
            px: { xs: 3, md: 8 },
            py: { xs: 6, md: 9 },
            background: heroGradient,
            color: '#ffffff',
            boxShadow: '0 20px 44px -18px rgba(11,88,80,0.6)',
          }}
        >
          <Typography variant="h2" sx={{ mb: 2, color: '#ffffff' }}>
            Bereit für klare Schichten?
          </Typography>
          <Typography
            variant="body1"
            sx={{ maxWidth: 560, mx: 'auto', mb: 4, color: 'rgba(255,255,255,0.9)' }}
          >
            Registrieren Sie Ihre Einrichtung und planen Sie den ersten Dienstplan noch heute.
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="center">
            <Button
              component={Link}
              href="/admin-registrieren"
              size="large"
              endIcon={<ArrowForward />}
              sx={{
                backgroundColor: '#ffffff',
                color: colors.brandDark,
                boxShadow: '0 10px 22px -10px rgba(0,0,0,0.4)',
                '&:hover': { backgroundColor: '#f5f5f4' },
              }}
            >
              Firma registrieren
            </Button>
            <Button
              component={Link}
              href="/anmelden"
              size="large"
              variant="text"
              sx={{ color: '#ffffff', '&:hover': { backgroundColor: 'rgba(255,255,255,0.12)' } }}
            >
              Ich habe bereits ein Konto
            </Button>
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            justifyContent="center"
            sx={{ mt: 3, color: 'rgba(255,255,255,0.85)' }}
          >
            <PhoneAndroid sx={{ fontSize: 16 }} />
            <Typography variant="caption">
              Läuft im Browser – auf Smartphone, Tablet und Desktop
            </Typography>
          </Stack>
        </Box>
      </Container>

      {/* Footer */}
      <Container maxWidth="lg" sx={{ pb: 6 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 2,
            flexWrap: 'wrap',
            borderTop: '1px solid',
            borderColor: 'divider',
            pt: 3,
          }}
        >
          <Typography variant="body2" color="text.secondary">
            © {new Date().getFullYear()} Schichtklar
          </Typography>
          <Stack direction="row" spacing={3}>
            <Button key="impressum" component={Link} href={LEGAL_URLS.impressum} color="inherit" size="small">
              Impressum
            </Button>
            <Button key="datenschutz" component={Link} href={LEGAL_URLS.datenschutz} color="inherit" size="small">
              Datenschutz
            </Button>
            <Button key="agb" component={Link} href={LEGAL_URLS.agb} color="inherit" size="small">
              AGB
            </Button>
            <Button key="avv" component={Link} href={LEGAL_URLS.avv} color="inherit" size="small">
              AVV
            </Button>
          </Stack>
        </Box>
      </Container>

      <ScrollToTop />
      </Box>
    </ThemeProvider>
  );
}
