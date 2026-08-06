import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'schichtklar-rules-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users/nurseA'), { companyId: 'firmaA', role: 'nurse', name: 'A' });
});

const nurseA = env.authenticatedContext('nurseA', { role: 'nurse', companyId: 'firmaA' }).firestore();
// Frisch angemeldeter Account OHNE Claims/User-Dokument (Selbst-Anlage beim ersten Login)
const neuling = env.authenticatedContext('neuling').firestore();

let fehler = 0;
const fall = async (name, fn, erwartet) => {
  try {
    await fn();
    if (erwartet !== 'ERLAUBT') fehler++;
    console.log(`${erwartet === 'ERLAUBT' ? 'OK  ' : 'LECK'} | ${name}: ERLAUBT – erwartet: ${erwartet}`);
  } catch {
    if (erwartet !== 'VERWEIGERT') fehler++;
    console.log(`${erwartet === 'VERWEIGERT' ? 'OK  ' : 'FEHL'} | ${name}: VERWEIGERT – erwartet: ${erwartet}`);
  }
};

console.log('--- Rollen-Eskalation (users self-update) ---');
await fall('Nurse ändert eigenen Namen (harmlos)',
  () => updateDoc(doc(nurseA, 'users/nurseA'), { name: 'Neu' }), 'ERLAUBT');
await fall('Nurse eskaliert eigene Rolle auf admin',
  () => updateDoc(doc(nurseA, 'users/nurseA'), { role: 'admin' }), 'VERWEIGERT');
await fall('Nurse setzt eigene customRoleId',
  () => updateDoc(doc(nurseA, 'users/nurseA'), { customRoleId: 'superadmin' }), 'VERWEIGERT');
await fall('Nurse ändert eigene companyId',
  () => updateDoc(doc(nurseA, 'users/nurseA'), { companyId: 'firmaX' }), 'VERWEIGERT');

console.log('--- Selbst-Anlage users (companyId darf nicht frei gewählt werden) ---');
await fall('Neuling legt eigenes User-Doc ohne companyId an',
  () => setDoc(doc(neuling, 'users/neuling'), { role: 'nurse', name: 'Neu' }), 'ERLAUBT');
await fall('Neuling legt eigenes User-Doc mit FREMDER companyId an',
  () => setDoc(doc(neuling, 'users/neuling'), { role: 'nurse', companyId: 'firmaA' }), 'VERWEIGERT');
await fall('Neuling legt eigenes User-Doc als admin an',
  () => setDoc(doc(neuling, 'users/neuling'), { role: 'admin' }), 'VERWEIGERT');

console.log('--- Timesheets: create nur für eigene userId ---');
await fall('Nurse legt eigenes Timesheet an',
  () => setDoc(doc(nurseA, 'timesheets/tsSelf'), {
    userId: 'nurseA', companyId: 'firmaA', status: 'draft', totalHours: 8,
  }), 'ERLAUBT');
await fall('Nurse legt Timesheet für FREMDE userId an',
  () => setDoc(doc(nurseA, 'timesheets/tsFremd'), {
    userId: 'nurseB', companyId: 'firmaA', status: 'draft', totalHours: 8,
  }), 'VERWEIGERT');

await env.cleanup();
console.log(`--- Ende (${fehler} Fehler) ---`);
if (fehler > 0) process.exit(1);
