'use client';
/* eslint-disable @typescript-eslint/no-explicit-any */

import { logger } from '@/lib/logging';

import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../contexts/PermissionsContext';
import { LoadingSpinner } from '../ui/LoadingSpinner';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { adminSettingsService } from '@/lib/services/adminSettings';

interface AuthGuardProps {
  children: React.ReactNode;
  requireAdmin?: boolean;
}

export function AuthGuard({ children, requireAdmin = false }: AuthGuardProps) {
  const { user, loading, firebaseUser } = useAuth();
  const { canAccessAdminArea } = usePermissions();
  const router = useRouter();
  const pathname = usePathname();
  const isE2E =
    typeof window !== 'undefined' &&
    (window as unknown as { __E2E_TEST_MODE__?: boolean }).__E2E_TEST_MODE__ === true;
  const _isAdmin = user?.role === 'admin';
  const [isSyncingClaims, setIsSyncingClaims] = useState(false);
  const [bootstrapDone, setBootstrapDone] = useState(false);
  const bootstrapAttemptedRef = useRef(false);

  // Debug: Logge die Rolle wenn requireAdmin true ist
  useEffect(() => {
    if (requireAdmin && !loading && user) {
      logger.info('[AuthGuard] Prüfe Admin-Zugriff:', {
        role: user.role,
        canAccessAdminArea,
        email: user.email,
        id: user.id,
      });
    }
  }, [requireAdmin, loading, user, canAccessAdminArea]);

  // Load admin settings only if user can access admin area
  const { data: settings } = useQuery({
    queryKey: ['adminSettings'],
    queryFn: () => adminSettingsService.getSettings(),
    enabled: canAccessAdminArea,
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const twoFactorRequired = settings?.twoFactorRequired || false;

  // Sync claims if user is admin but claims might be missing
  useEffect(() => {
    if (requireAdmin && user && firebaseUser && !loading && !isE2E) {
      const checkAndSyncClaims = async () => {
        try {
          const tokenResult = await firebaseUser.getIdTokenResult();
          const hasRoleClaim = Boolean(tokenResult.claims.role);
          const claimRole = tokenResult.claims.role as string | undefined;

          // Wenn User Admin-Rolle hat, aber Claims fehlen oder nicht übereinstimmen
          if (
            user.role === 'admin' &&
            (!hasRoleClaim || claimRole !== user.role)
          ) {
            setIsSyncingClaims(true);
            const token = await firebaseUser.getIdToken(true);
            const response = await fetch('/api/auth/sync-claims', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
              },
            });

            if (response.ok) {
              await firebaseUser.getIdToken(true);
              setIsSyncingClaims(false);
            } else {
              setIsSyncingClaims(false);
            }
          }
        } catch (error) {
          logger.error('Failed to sync claims:', error);
          setIsSyncingClaims(false);
        }
      };

      checkAndSyncClaims();
    }
  }, [requireAdmin, user, firebaseUser, loading, isE2E]);

  // Admin hat keine Nurse-Rolle: Einmalig versuchen, Bootstrap-Admin zu setzen (ENABLE_ADMIN_BOOTSTRAP + ADMIN_BOOTSTRAP_EMAIL)
  useEffect(() => {
    if (
      isE2E ||
      !requireAdmin ||
      loading ||
      !user ||
      !firebaseUser ||
      canAccessAdminArea ||
      user.role !== 'nurse' ||
      bootstrapAttemptedRef.current
    ) {
      if (!canAccessAdminArea && user?.role === 'nurse' && bootstrapAttemptedRef.current) {
        setBootstrapDone(true);
      }
      return;
    }
    let cancelled = false;
    bootstrapAttemptedRef.current = true;
    (async () => {
      try {
        const token = await firebaseUser!.getIdToken(true);
        const res = await fetch('/api/auth/ensure-admin-role', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok && data.success) {
          window.location.reload();
          return;
        }
      } catch {
        // ignorieren
      }
      if (!cancelled) setBootstrapDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [requireAdmin, loading, user, firebaseUser, canAccessAdminArea, isE2E]);

  useEffect(() => {
    if (isE2E) return;
    if (!loading && !user) {
      // Ursprüngliches Ziel mitgeben, damit der Login dorthin zurückführt
      const target = pathname && pathname.startsWith('/') && !pathname.startsWith('//') ? pathname : '/';
      router.push(`/anmelden?redirect=${encodeURIComponent(target)}`);
      return;
    }
    // Ohne Admin-Recht: nach Bootstrap-Versuch in den Mitarbeiterbereich (Admin hat keine Nurse-Rolle; Nurse bleibt Nurse)
    if (
      !loading &&
      user &&
      requireAdmin &&
      !canAccessAdminArea &&
      (bootstrapDone || user.role !== 'nurse' || !firebaseUser)
    ) {
      router.replace('/employee/arbeitsplatz');
    }
  }, [loading, user, router, pathname, isE2E, requireAdmin, canAccessAdminArea, bootstrapDone, firebaseUser]);

  if (loading || isSyncingClaims || (!user && typeof window !== 'undefined')) {
    return (
      <LoadingSpinner
        variant="fullscreen"
        message={
          isSyncingClaims
            ? 'Berechtigungen werden synchronisiert...'
            : loading
              ? 'Authentifizierung wird überprüft...'
              : 'Weiterleitung zum Login...'
        }
        size={60}
        showLogo={true}
      />
    );
  }

  if (requireAdmin && !canAccessAdminArea) {
    logger.debug('[AuthGuard] Kein Admin-Zugriff', { id: user?.id, email: user?.email, role: user?.role });
    const message =
      user?.role === 'nurse' && !bootstrapDone
        ? 'Berechtigung wird geprüft…'
        : 'Weiterleitung zum Mitarbeiterbereich…';
    return (
      <LoadingSpinner variant="fullscreen" message={message} size={60} showLogo={true} />
    );
  }

  // Enforce MFA for admins when required by system settings
  const mfaRequired = twoFactorRequired;
  const isPrivileged = canAccessAdminArea;
  const hasMfa = !!(
    firebaseUser &&
    'multiFactor' in firebaseUser &&
    (firebaseUser as any).multiFactor?.enrolledFactors?.length
  );
  if (requireAdmin && isPrivileged && mfaRequired && !hasMfa) {
    if (typeof window !== 'undefined') {
      // Redirect admin to secure setup page
      router.push('/admin/sicherheits-check');
    }
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-600 mb-4">2FA erforderlich</h1>
          <p className="text-gray-600">
            Bitte richte die Zwei-Faktor-Authentifizierung ein, um fortzufahren.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export default AuthGuard;
