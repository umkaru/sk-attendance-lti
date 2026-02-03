import 'dotenv/config';
import express from 'express';
import { lti } from './lti/provider.js';

const app = express();

// einfache Testseite (noch ohne UI)
app.get('/', (req, res) => {
  res.send('SK Attendance LTI läuft 👍');
});

// Wird aufgerufen, wenn Canvas das Tool startet
lti.onConnect(async (token, req, res) => {
  const context =
    token['https://purl.imsglobal.org/spec/lti/claim/context'];
  const roles =
    token['https://purl.imsglobal.org/spec/lti/claim/roles'] || [];

  // Nur Kursleiter dürfen rein
  const isInstructor = roles.some(r =>
    r.includes('Instructor')
  );

  if (!isInstructor) {
    return res.send(
      'Kein Zugriff – nur Kursleiter dürfen die Anwesenheit erfassen.'
    );
  }

  res.send(`
    <h1>Anwesenheit (Stunden)</h1>
    <p>Kurs: ${context?.label || 'Unbekannt'}</p>
    <p>Status: Tool erfolgreich gestartet ✅</p>
  `);
});

// LTI + Express starten
await lti.deploy({
  app,
  port: process.env.PORT || 3000
});