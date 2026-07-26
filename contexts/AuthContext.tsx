'use client';

import { User } from '@/lib/types';
import { logger } from '@/lib/logging';
import { createContext, useContext, useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { User as FirebaseUser } from 'firebase/auth';
import { signInWithEmailAndPassword, signOut, sendPasswordResetEmail, sendEmailVerification } from 'firebase/auth';
import { getAuthSafe } from '@/lib/firebase';
import { firebaseAuthErrorMessages } from '@/lib/validations/authForms';
import { AuthService } from '@/lib/services/authService';
import { authUserService } from '@/lib/services/authUserService';

declare global {
  interface Window {
    __E2E_TEST_MODE__?: boolean;
  }
}

interface AuthContextType {
  user: (User & { facilityIds?: string[] }) | null;
  firebaseUser: FirebaseUser | null;
  loading: boolean;
  /** Nach Login, wenn Session-Cookie fehlschlägt (z. B. Firebase Admin in Dev nicht aktiv) */
  authError: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateUser: (data: Partial<User>) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  sendEmailVerificationEmail: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const isE2ETestMode = typeof window !== 'undefined' && window.__E2E_TEST_MODE__ === true;
  /**
   * Laufende Nummer des aktuellen Auth-Vorgangs. signIn() und der
   * onAuthStateChanged-Listener laden das Profil beide asynchron; ohne diese
   * Sequenz konnte die langsamere (ältere) Kette die neuere überschreiben –
   * etwa mit einem Claims-Fallback-Profil statt der echten Firestore-Daten,
   * oder nach schnellem Abmelden/Anmelden mit dem Profil des Vor-Nutzers.
   */
  const authSequenceRef = useRef(0);
  const beginAuthSequence = useCallback(() => {
    authSequenceRef.current += 1;
    return authSequenceRef.current;
  }, []);
  const isCurrentSequence = useCallback((sequence: number) => authSequenceRef.current === sequence, []);

  const handleLoadingTimeout = useCallback(() => {
    setLoading((prev) => {
      if (prev) {
        logger.debug('Auth loading timeout reached, forcing loading to false');
        return false;
      }
      return prev;
    });
  }, []);

  useEffect(() => {
    const timeout = setTimeout(handleLoadingTimeout, 20000);
    return () => clearTimeout(timeout);
  }, [handleLoadingTimeout]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setLoading(false);
      return;
    }
    const authInstance = getAuthSafe();
    if (!authInstance) {
      logger.warn('Firebase Auth not initialized');
      setLoading(false);
      return;
    }
    if (isE2ETestMode) {
      logger.debug('E2E Test Mode detected, skipping Firebase auth listener');
      setLoading(false);
      setUser(null);
      return;
    }

    const unsubscribe = authInstance.onAuthStateChanged((fbUser: FirebaseUser | null) => {
      const sequence = beginAuthSequence();
      setAuthError(null);
      if (fbUser) {
        // Sofort FirebaseUser setzen, aber loading bleibt true bis Profil+Rolle geladen
        setFirebaseUser(fbUser);
        (async () => {
          try {
            // Parallel: Session-Cookie und User-Profil – spart spürbar Zeit
            const [_, loadedUser] = await Promise.all([
              AuthService.setSessionCookie(fbUser),
              authUserService.loadUserForAuth(fbUser),
            ]);
            if (!isCurrentSequence(sequence)) return;
            if (loadedUser) {
              setUser(loadedUser);
            } else {
              // Nur als Fallback wenn Firestore nicht erreichbar: Rolle aus Claims lesen
              const fallback = await authUserService.buildFallbackUserWithClaims(fbUser);
              if (!isCurrentSequence(sequence)) return;
              setUser(fallback);
            }
          } catch (error) {
            if (!isCurrentSequence(sequence)) return;
            const msg = error instanceof Error ? error.message : String(error);
            setAuthError(msg || 'Sitzung konnte nicht eingerichtet werden.');
            logger.error('Session/User fehlgeschlagen', error instanceof Error ? error : new Error(String(error)));
            // Im Fehlerfall: Fallback-User mit Claims-Rolle setzen
            const fallback = await authUserService.buildFallbackUserWithClaims(fbUser);
            if (!isCurrentSequence(sequence)) return;
            setUser(fallback);
          } finally {
            if (isCurrentSequence(sequence)) setLoading(false);
          }
        })();
      } else {
        setUser(null);
        setFirebaseUser(null);
        setLoading(false);
        void AuthService.clearSessionCookie();
      }
    });

    return () => unsubscribe();
  }, [isE2ETestMode, beginAuthSequence, isCurrentSequence]);

  const signIn = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    // Nur für E2E-Login ohne echte DB; kein Produktionscode. App-Runtime nutzt sonst ausschließlich Firebase Auth.
    if (isE2ETestMode) {
      if (!email?.trim() || !password?.trim()) {
        throw new Error('E-Mail und Passwort sind erforderlich');
      }
      const lower = email.toLowerCase();
      const derivedRole: User['role'] = lower.includes('admin') ? 'admin' : 'nurse';
      const mock: User = {
        id: `e2e-${derivedRole}-user`,
        email,
        displayName: `E2E ${derivedRole}`,
        role: derivedRole,
        active: true,
        phone: '',
        qualifications: [],
        documents: [],
        notificationSettings: {
          emailNotifications: true,
          pushNotifications: true,
          shiftReminders: true,
          documentExpiry: true,
          systemAnnouncements: true,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      setUser(mock);
      setFirebaseUser(null);
      if (typeof window !== 'undefined') {
        (window as unknown as { __SCHICHTKLAR_USER_ROLE?: string }).__SCHICHTKLAR_USER_ROLE = mock.role;
      }
      return;
    }

    if (!email?.trim() || !password?.trim()) {
      throw new Error('E-Mail und Passwort sind erforderlich');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('Ungültige E-Mail-Adresse');
    }
    logger.debug('Attempting Firebase authentication', {}, { email });
    const authInstance = getAuthSafe();
    if (!authInstance) throw new Error('Firebase Auth not initialized');
    try {
      await signInWithEmailAndPassword(authInstance, email, password);
      logger.info('Firebase authentication successful', {}, { email });
      const fbUser = authInstance.currentUser;
      if (fbUser) {
        // Eigene Sequenz: Der onAuthStateChanged-Listener läuft parallel und
        // würde sonst mit seinem (evtl. älteren) Ergebnis das hier geladene
        // Profil überschreiben.
        const sequence = beginAuthSequence();
        try {
          const token = await fbUser.getIdToken();
          const [_, firestoreUser] = await Promise.all([
            AuthService.setSessionCookieWithToken(token),
            authUserService.getOrCreateAuthUser(fbUser),
          ]);
          const loadedUser = firestoreUser
            ? await authUserService.applyClaimsToUser(fbUser, firestoreUser)
            : null;
          const resolvedUser =
            loadedUser ?? (await authUserService.buildFallbackUserWithClaims(fbUser));
          if (!isCurrentSequence(sequence)) return;
          setUser(resolvedUser);
          setFirebaseUser(fbUser);
        } catch (sessionError) {
          if (isCurrentSequence(sequence)) {
            const msg = sessionError instanceof Error ? sessionError.message : String(sessionError);
            setAuthError(msg || 'Sitzung konnte nicht eingerichtet werden.');
            setUser(null);
            setFirebaseUser(null);
            setLoading(false);
          }
          throw sessionError;
        }
      }
      setLoading(false);
    } catch (error: unknown) {
      setLoading(false);
      logger.error('Firebase authentication failed', error instanceof Error ? error : new Error(String(error)));
      const code = (error as { code?: string })?.code;
      const errorMessage =
        (code && firebaseAuthErrorMessages[code as keyof typeof firebaseAuthErrorMessages]) ||
        'Anmeldung fehlgeschlagen';
      throw new Error(errorMessage);
    }
  }, [isE2ETestMode, beginAuthSequence, isCurrentSequence]);

  const signOutUser = useCallback(async () => {
    // Entwertet alle laufenden Profil-Ladevorgänge, damit ein spät
    // eintreffendes Ergebnis nach dem Abmelden keinen Nutzer mehr setzt.
    beginAuthSequence();
    try {
      if (process.env.NODE_ENV === 'test' || isE2ETestMode) {
        setUser(null);
        setFirebaseUser(null);
        return;
      }
      await AuthService.clearSessionCookie();
      const authInstance = getAuthSafe();
      if (!authInstance) throw new Error('Firebase Auth not initialized');
      await signOut(authInstance);
      setUser(null);
      setFirebaseUser(null);
    } catch (error: unknown) {
      throw new Error((error as Error).message || 'Logout fehlgeschlagen');
    }
  }, [isE2ETestMode, beginAuthSequence]);

  const updateUser = useCallback(async (data: Partial<User>) => {
    if (!user) throw new Error('No user logged in');
    try {
      await authUserService.updateAuthUserProfile(user.id, data);
      setUser((prev) => (prev ? { ...prev, ...data } : null));
    } catch (error) {
      logger.error('Failed to update user', error instanceof Error ? error : new Error(String(error)));
      throw new Error('Benutzeraktualisierung fehlgeschlagen');
    }
  }, [user]);

  const sendPasswordReset = useCallback(async (email: string) => {
    if (!email?.trim()) throw new Error('E-Mail ist erforderlich');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Ungültige E-Mail-Adresse');
    const authInstance = getAuthSafe();
    if (!authInstance) throw new Error('Firebase Auth not initialized');
    const actionCodeSettings = {
      url: `${typeof window !== 'undefined' ? window.location.origin : ''}/anmelden`,
      handleCodeInApp: false,
    };
    try {
      await sendPasswordResetEmail(authInstance, email, actionCodeSettings);
    } catch (error: unknown) {
      logger.error('Password reset failed', error instanceof Error ? error : new Error(String(error)));
      const code = (error as { code?: string })?.code;
      const errorMessage =
        (code && firebaseAuthErrorMessages[code as keyof typeof firebaseAuthErrorMessages]) ||
        'Fehler beim Senden der Passwort-Reset-E-Mail';
      throw new Error(errorMessage);
    }
  }, []);

  const sendEmailVerificationEmail = useCallback(async () => {
    const authInstance = getAuthSafe();
    if (!authInstance?.currentUser) throw new Error('Kein Benutzer angemeldet');
    const actionCodeSettings = {
      url: `${typeof window !== 'undefined' ? window.location.origin : ''}/anmelden`,
      handleCodeInApp: false,
    };
    try {
      await sendEmailVerification(authInstance.currentUser, actionCodeSettings);
    } catch (error: unknown) {
      logger.error('Email verification failed', error instanceof Error ? error : new Error(String(error)));
      const code = (error as { code?: string })?.code;
      const errorMessage =
        (code && firebaseAuthErrorMessages[code as keyof typeof firebaseAuthErrorMessages]) ||
        'Fehler beim Senden der E-Mail-Verifizierung';
      throw new Error(errorMessage);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      firebaseUser,
      loading,
      authError,
      signIn,
      signOut: signOutUser,
      updateUser,
      sendPasswordReset,
      sendEmailVerificationEmail,
    }),
    [user, firebaseUser, loading, authError, signIn, signOutUser, updateUser, sendPasswordReset, sendEmailVerificationEmail]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
