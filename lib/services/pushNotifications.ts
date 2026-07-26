'use client';

import { getMessaging, getToken, onMessage, type Messaging } from 'firebase/messaging';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getFirebaseConfig } from '@/lib/firebase';
import { logger } from '@/lib/logging';

let messaging: Messaging | null = null;

// Initialisiere Firebase Messaging
const initMessaging = (): Messaging | null => {
  if (typeof window === 'undefined') {
    return null; // Server-side: kein Messaging
  }

  if (messaging) {
    return messaging;
  }

  try {
    const app = getApps().length > 0 ? getApp() : initializeApp(getFirebaseConfig());
    messaging = getMessaging(app);
    return messaging;
  } catch (error) {
    logger.warn('Firebase Messaging konnte nicht initialisiert werden', {}, { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
};

// Hole FCM Token für den aktuellen Benutzer
export async function getFCMToken(): Promise<string | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  if (!('serviceWorker' in navigator)) {
    logger.warn('Browser unterstützt keine Service Worker - Push nicht möglich');
    return null;
  }

  const messagingInstance = initMessaging();
  if (!messagingInstance) {
    return null;
  }

  const FCM_SW_SCOPE = '/firebase-cloud-messaging-push-scope';

  const getServiceWorkerRegistration = async (): Promise<ServiceWorkerRegistration | null> => {
    try {
      // Bevorzugt den dedizierten FCM-Service-Worker (eigener Scope, siehe
      // app/layout.tsx). Nur dieser kann onBackgroundMessage verarbeiten.
      const fcmRegistration = await navigator.serviceWorker
        .getRegistration(FCM_SW_SCOPE)
        .catch(() => null);
      if (fcmRegistration) {
        logger.info('FCM Service Worker gefunden', {}, { scope: fcmRegistration.scope });
        return fcmRegistration;
      }

      // Warte zunächst auf Service Worker Ready State (mit Timeout)
      const readyPromise = navigator.serviceWorker.ready;
      const timeoutPromise = new Promise<null>((resolve) => 
        setTimeout(() => resolve(null), 5000)
      );
      
      const registration = await Promise.race([readyPromise, timeoutPromise]).catch(() => null);
      
      if (registration) {
        logger.info('Service Worker ready für Push-Benachrichtigungen', {}, { scope: registration.scope });
        return registration;
      }

      // Fallback: Suche nach bestehender Registration
      const existingRegistration = await navigator.serviceWorker.getRegistration('/sw.js').catch(() => null);
      if (existingRegistration) {
        logger.info('Bestehende Service Worker Registration gefunden', {}, { scope: existingRegistration.scope });
        return existingRegistration;
      }

      const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      if (!isDevelopment) {
        // Fallback: Registriere Service Worker, falls dies noch nicht passiert ist
        logger.info('Registriere Service Worker für Push-Benachrichtigungen...');
        const newRegistration = await navigator.serviceWorker.register('/sw.js');
        logger.info('Service Worker erfolgreich registriert', {}, { scope: newRegistration.scope });
        return newRegistration;
      }
    } catch (error) {
      logger.warn(
        'Service Worker für Push-Benachrichtigungen konnte nicht vorbereitet werden',
        {},
        { error: error instanceof Error ? error.message : String(error) }
      );
    }

    return null;
  };

  const serviceWorkerRegistration = await getServiceWorkerRegistration();
  if (!serviceWorkerRegistration) {
    logger.warn('Kein Service Worker verfügbar - FCM Token kann nicht abgerufen werden');
    return null;
  }

  try {
    // VAPID Key sollte aus Umgebungsvariablen kommen
    // Unterstütze beide Variablennamen für Flexibilität
    const vapidKey = process.env.NEXT_PUBLIC_FCM_VAPID_KEY || process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
    if (!vapidKey) {
      // Nur in Production warnen, in Development ist das optional
      if (process.env.NODE_ENV === 'production') {
        logger.warn('FCM VAPID Key nicht konfiguriert - Push-Benachrichtigungen werden nicht funktionieren');
      }
      return null;
    }

    // Warte zusätzlich auf aktiven Service Worker
    if (serviceWorkerRegistration.active) {
      const token = await getToken(messagingInstance, { vapidKey, serviceWorkerRegistration });
      if (token) {
        logger.info('FCM Token erfolgreich abgerufen');
        return token;
      }
    } else {
      // Service Worker ist noch nicht aktiv - warte kurz
      logger.info('Warte auf Service Worker Aktivierung...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Versuche es erneut
      if (serviceWorkerRegistration.active) {
        const token = await getToken(messagingInstance, { vapidKey, serviceWorkerRegistration });
        if (token) {
          logger.info('FCM Token erfolgreich abgerufen (nach Wartezeit)');
          return token;
        }
      }
    }
    
    return null;
  } catch (error) {
    logger.error('Fehler beim Abrufen des FCM Tokens', error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

// Speichere FCM Token für den Benutzer
export async function saveFCMToken(userId: string, token: string): Promise<void> {
  try {
    const { getDb, doc, setDoc, serverTimestamp } = await import('@/lib/firebase');
    const db = getDb();
    
    await setDoc(doc(db, 'fcmTokens', userId), {
      token,
      userId,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    }, { merge: true });
  } catch (error) {
    logger.error('Fehler beim Speichern des FCM Tokens', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

// Aktualisiere FCM Token (für Token-Refresh)
export async function updateFCMToken(userId: string, oldToken: string, newToken: string): Promise<void> {
  try {
    const { getDb, doc, getDoc, setDoc, serverTimestamp } = await import('@/lib/firebase');
    const db = getDb();
    
    const tokenDoc = await getDoc(doc(db, 'fcmTokens', userId));
    if (tokenDoc.exists()) {
      const data = tokenDoc.data();
      // Nur aktualisieren wenn Token sich geändert hat
      if (data?.token === oldToken) {
        await setDoc(doc(db, 'fcmTokens', userId), {
          token: newToken,
          userId,
          updatedAt: serverTimestamp(),
        }, { merge: true });
      }
    } else {
      // Token existiert nicht - erstelle neuen
      await saveFCMToken(userId, newToken);
    }
  } catch (error) {
    logger.error('Fehler beim Aktualisieren des FCM Tokens', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

// Hole FCM Token für einen Benutzer
export async function getFCMTokenForUser(userId: string): Promise<string | null> {
  try {
    const { getDb, doc, getDoc } = await import('@/lib/firebase');
    const db = getDb();
    
    const tokenDoc = await getDoc(doc(db, 'fcmTokens', userId));
    if (!tokenDoc.exists()) {
      return null;
    }
    
    const data = tokenDoc.data();
    return data?.token || null;
  } catch (error) {
    logger.error('Fehler beim Abrufen des FCM Tokens für Benutzer', error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

// Sende Push-Benachrichtigung über API-Route
export async function sendPushNotification(params: {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  link?: string;
}): Promise<void> {
  try {
    // Hole Firebase Auth Token für die API-Authentifizierung
    let authToken: string | null = null;
    try {
      const { auth } = await import('@/lib/firebase');
      if (auth?.currentUser) {
        authToken = await auth.currentUser.getIdToken();
      }
    } catch (tokenError) {
      logger.warn('Konnte Firebase Auth Token für Push API nicht abrufen', {}, { error: tokenError instanceof Error ? tokenError.message : String(tokenError) });
    }

    const baseUrl = typeof window !== 'undefined' 
      ? window.location.origin 
      : process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    
    const response = await fetch(`${baseUrl}/api/push/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        userId: params.userId,
        notification: {
          title: params.title,
          body: params.body,
        },
        data: {
          ...params.data,
          link: params.link || '',
        },
      }),
    });

    if (response.status === 401 && !authToken) {
      throw new Error('Kein Auth-Token verfügbar. Bitte erneut einloggen.');
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    const result = await response.json();
    return result;
  } catch (error) {
    logger.error('Fehler beim Senden der Push-Benachrichtigung', error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

// Listener für eingehende Nachrichten (wenn App im Vordergrund ist)
export function setupMessageListener(callback: (payload: { notification?: { title?: string; body?: string }; data?: Record<string, unknown> }) => void): (() => void) | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const messagingInstance = initMessaging();
  if (!messagingInstance) {
    return null;
  }

  try {
    const unsubscribe = onMessage(messagingInstance, (payload) => {
      // Token-Refresh prüfen
      if (payload.fcmOptions?.link) {
        // Token könnte sich geändert haben - prüfe und aktualisiere
        getFCMToken().then((newToken) => {
          if (newToken) {
            // Token wird beim nächsten Save aktualisiert
          }
        }).catch(() => {
          // Ignoriere Token-Refresh-Fehler
        });
      }
      
      callback(payload);
    });
    
    return unsubscribe;
  } catch (error) {
    logger.error('Fehler beim Einrichten des Message Listeners', error instanceof Error ? error : new Error(String(error)));
    return null;
  }
}

// Prüfe ob Push-Benachrichtigungen unterstützt werden
export function isPushNotificationSupported(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// Frage Push-Berechtigung an
export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }

  if (Notification.permission === 'granted') {
    return 'granted';
  }

  if (Notification.permission === 'denied') {
    return 'denied';
  }

  try {
    const permission = await Notification.requestPermission();
    return permission;
  } catch (error) {
    logger.error('Fehler beim Anfordern der Benachrichtigungsberechtigung', error instanceof Error ? error : new Error(String(error)));
    return 'denied';
  }
}

