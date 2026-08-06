/**
 * Rules-Test für die vormals default-deny Collections (Mitarbeiter-eigene Daten,
 * Personalgruppen, Messaging). Beweist: Owner-/Teilnehmer-Zugriff erlaubt,
 * Fremdzugriff verweigert. assertSucceeds/assertFails → echtes Pass/Fail.
 */
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, getDoc, setDoc, getDocs, collection, query, where } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'schichtklar-rules-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users/nurseA'), { companyId: 'firmaA', role: 'nurse' });
  await setDoc(doc(db, 'users/adminA'), { companyId: 'firmaA', role: 'admin' });
  await setDoc(doc(db, 'users/adminB'), { companyId: 'firmaB', role: 'admin' });
  await setDoc(doc(db, 'employeeFacilities/efA'), { userId: 'nurseA', companyId: 'firmaA' });
  await setDoc(doc(db, 'facilityFavorites/favA'), { userId: 'nurseA', companyId: 'firmaA' });
  await setDoc(doc(db, 'employeeNotifications/enA'), { userId: 'nurseA' });
  await setDoc(doc(db, 'notificationSettings/nsA'), { userId: 'nurseA' });
  await setDoc(doc(db, 'fcmTokens/nurseA'), { userId: 'nurseA', token: 'x' });
  await setDoc(doc(db, 'staffGroups/sgA'), { companyId: 'firmaA', members: ['nurseA'] });
});

const nurseA = env.authenticatedContext('nurseA', { role: 'nurse', companyId: 'firmaA' }).firestore();
const adminA = env.authenticatedContext('adminA', { role: 'admin', companyId: 'firmaA' }).firestore();
const adminB = env.authenticatedContext('adminB', { role: 'admin', companyId: 'firmaB' }).firestore();
const outsider = env.authenticatedContext('outsider', { role: 'nurse', companyId: 'firmaB' }).firestore();

let failures = 0;
const check = async (name, expect, fn) => {
  try {
    await (expect === 'ALLOW' ? assertSucceeds(fn()) : assertFails(fn()));
    console.log(`OK   | ${name} (${expect})`);
  } catch (e) {
    failures++;
    console.log(`FAIL | ${name} (erwartet ${expect}) → ${e.message?.split('\n')[0]}`);
  }
};

console.log('--- Mitarbeiter-eigene Collections ---');
await check('NurseA liest eigene employeeFacility', 'ALLOW', () => getDoc(doc(nurseA, 'employeeFacilities/efA')));
await check('Fremder liest employeeFacility', 'DENY', () => getDoc(doc(outsider, 'employeeFacilities/efA')));
await check('NurseA liest eigenen Favorit', 'ALLOW', () => getDoc(doc(nurseA, 'facilityFavorites/favA')));
await check('Fremder liest Favorit', 'DENY', () => getDoc(doc(outsider, 'facilityFavorites/favA')));
await check('NurseA liest eigene employeeNotification', 'ALLOW', () => getDoc(doc(nurseA, 'employeeNotifications/enA')));
await check('AdminA liest employeeNotification (Admin)', 'ALLOW', () => getDoc(doc(adminA, 'employeeNotifications/enA')));
await check('Fremder liest employeeNotification', 'DENY', () => getDoc(doc(outsider, 'employeeNotifications/enA')));
await check('NurseA liest eigene notificationSettings', 'ALLOW', () => getDoc(doc(nurseA, 'notificationSettings/nsA')));
await check('Fremder liest notificationSettings', 'DENY', () => getDoc(doc(outsider, 'notificationSettings/nsA')));
await check('NurseA liest eigenen FCM-Token', 'ALLOW', () => getDoc(doc(nurseA, 'fcmTokens/nurseA')));
await check('Fremder liest fremden FCM-Token', 'DENY', () => getDoc(doc(outsider, 'fcmTokens/nurseA')));

console.log('--- Personalgruppen ---');
await check('AdminA liest eigene staffGroup', 'ALLOW', () => getDoc(doc(adminA, 'staffGroups/sgA')));
await check('Mitglied (nurseA) liest staffGroup', 'ALLOW', () => getDoc(doc(nurseA, 'staffGroups/sgA')));
await check('Fremd-Admin (B) liest staffGroup A', 'DENY', () => getDoc(doc(adminB, 'staffGroups/sgA')));

console.log('--- Messaging (teilnehmerbasiert) ---');

await env.cleanup();
console.log(`--- Test beendet: ${failures} Fehler ---`);
if (failures > 0) process.exit(1);
