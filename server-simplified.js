// server-simplified.js
// Vereinfachte LTI 1.3 Implementierung ohne ltijs

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const crypto = require('crypto');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { generators } = require('openid-client');
const { Pool } = require('pg');
const CANVAS_API_TOKEN = process.env.CANVAS_API_TOKEN;
const CANVAS_BASE_URL = process.env.CANVAS_BASE_URL || 'https://integrity4education.instructure.com';

const app = express();
const PORT = process.env.PORT || 3001;

// PostgreSQL Connection
const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: process.env.PG_PORT || 5432,
  database: process.env.PG_DATABASE || 'attendance',
  user: process.env.PG_USER || 'attendance_user',
  password: process.env.PG_PASSWORD
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session Store
const sessionStore = new pgSession({
  pool: pool,
  tableName: 'session',
  createTableIfMissing: false
});

// Session Middleware
app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET || 'sk-attendance-secret-string-54321',
  resave: false,
  saveUninitialized: false,
  name: 'sk.attendance.sid',
  cookie: {
    secure: false,
    sameSite: 'none',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

// Cookie Debug
app.use((req, res, next) => {
  console.log('🍪 Cookies:', req.headers.cookie);
  console.log('📦 Session ID:', req.sessionID);
  console.log('💾 Session Data:', {
    isAuthenticated: req.session?.isAuthenticated,
    hasClaims: !!req.session?.ltiClaims
  });
  next();
});

// Statische Dateien
app.use(express.static('public'));

// ============================================================================
// ÖFFENTLICHE ROUTES
// ============================================================================

app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>SK Attendance LTI</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          max-width: 800px;
          margin: 50px auto;
          padding: 20px;
          background: #f8fafc;
        }
        .container {
          background: white;
          padding: 40px;
          border-radius: 12px;
          box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        h1 { color: #1e293b; margin-top: 0; }
        .status { 
          display: inline-block;
          padding: 8px 16px;
          background: #22c55e;
          color: white;
          border-radius: 6px;
          font-weight: 600;
          margin-bottom: 20px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🎓 SK Attendance LTI Tool</h1>
        <div class="status">✅ Server läuft</div>
        <p>Dieses Tool kann nur über Canvas gestartet werden.</p>
      </div>
    </body>
    </html>
  `);
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString()
  });
});

// ============================================================================
// LTI 1.3 KONFIGURATION
// ============================================================================

const CANVAS_CONFIG = {
  issuer: process.env.CANVAS_ISSUER || 'https://canvas.instructure.com',
  clientId: process.env.CANVAS_CLIENT_ID,
  authorizationUrl: `${process.env.CANVAS_ISSUER || 'https://canvas.instructure.com'}/api/lti/authorize_redirect`,
  tokenUrl: `${process.env.CANVAS_ISSUER || 'https://canvas.instructure.com'}/login/oauth2/token`,
  jwksUrl: `${process.env.CANVAS_ISSUER || 'https://canvas.instructure.com'}/api/lti/security/jwks`
};

const TOOL_CONFIG = {
  publicJwkUrl: process.env.PUBLIC_URL + '/lti/jwks',
  loginUrl: process.env.PUBLIC_URL + '/lti/login',
  launchUrl: process.env.PUBLIC_URL + '/lti/launch'
};

let keyPair = null;
let publicJwk = null;

function generateKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });

  const publicKeyObject = crypto.createPublicKey(publicKey);
  const jwk = publicKeyObject.export({ format: 'jwk' });
  
  publicJwk = {
    kty: jwk.kty,
    e: jwk.e,
    n: jwk.n,
    alg: 'RS256',
    use: 'sig',
    kid: crypto.randomBytes(16).toString('hex')
  };

  keyPair = { privateKey, publicKey };
  console.log('✅ RSA Key Pair generiert');
}

// ============================================================================
// API ROUTES
// ============================================================================

const sessionsRouter = require('./routes/sessions');
app.use('/api', sessionsRouter);

// Routes registrieren
const attendanceRouter = require('./routes/attendance');
app.use('/api', attendanceRouter);

// BAföG Routes
const bafoegRoutes = require('./routes/bafoeg');
app.use('/api/bafoeg', bafoegRoutes);

// Student Profile Routes
const studentProfileRoutes = require('./routes/student-profile');
app.use('/api/student', studentProfileRoutes);

// ============================================================================
// LTI 1.3 ENDPOINTS
// ============================================================================

app.get('/lti/jwks', (req, res) => {
  if (!publicJwk) {
    return res.status(500).json({ error: 'Keys not initialized' });
  }
  res.json({ keys: [publicJwk] });
});

app.all('/lti/login', (req, res) => {
  console.log('\n🔑 LTI LOGIN - Start');
  console.log('Method:', req.method);
  
  const processLogin = (params) => {
    try {
      const { iss, login_hint, target_link_uri, lti_message_hint, client_id } = params;

      if (!iss || !login_hint || !target_link_uri) {
        console.error('❌ Fehlende Parameter');
        return res.status(400).send('Missing required LTI parameters');
      }

      const state = generators.state();
      const nonce = generators.nonce();

      req.session.ltiState = state;
      req.session.ltiNonce = nonce;
      req.session.targetLinkUri = target_link_uri;

      const authUrl = new URL(CANVAS_CONFIG.authorizationUrl);
      authUrl.searchParams.append('response_type', 'id_token');
      authUrl.searchParams.append('response_mode', 'form_post');
      authUrl.searchParams.append('scope', 'openid');
      authUrl.searchParams.append('client_id', client_id || CANVAS_CONFIG.clientId);
      authUrl.searchParams.append('redirect_uri', TOOL_CONFIG.launchUrl);
      authUrl.searchParams.append('state', state);
      authUrl.searchParams.append('nonce', nonce);
      authUrl.searchParams.append('prompt', 'none');
      authUrl.searchParams.append('login_hint', login_hint);
      
      if (lti_message_hint) {
        authUrl.searchParams.append('lti_message_hint', lti_message_hint);
      }

      console.log('✅ Redirect zu Canvas Authorization');
      res.redirect(authUrl.toString());

    } catch (error) {
      console.error('❌ Login Error:', error);
      res.status(500).send(`Login Error: ${error.message}`);
    }
  };

  if (req.method === 'GET') {
    console.log('📍 GET Request');
    processLogin(req.query);
  } else if (req.method === 'POST') {
    if (req.body && Object.keys(req.body).length > 0) {
      console.log('✅ POST Body vorhanden');
      processLogin(req.body);
    } else {
      console.log('⚠️ POST Body leer - lese Stream');
      let body = '';
      req.on('data', chunk => { body += chunk.toString(); });
      req.on('end', () => {
        const params = Object.fromEntries(new URLSearchParams(body));
        console.log('✅ Body Stream gelesen');
        processLogin(params);
      });
    }
  }
});

app.post('/lti/launch', async (req, res) => {
  try {
    console.log('\n🚀 LTI LAUNCH - Start');
    
    const { id_token, state } = req.body;

    if (!id_token) {
      return res.status(400).send('Missing id_token');
    }

    const jwksResponse = await axios.get(CANVAS_CONFIG.jwksUrl);
    const canvasKeys = jwksResponse.data.keys;

    const tokenHeader = JSON.parse(Buffer.from(id_token.split('.')[0], 'base64').toString());
    const canvasPublicKey = canvasKeys.find(k => k.kid === tokenHeader.kid);
    
    if (!canvasPublicKey) {
      return res.status(403).send('Cannot verify token - public key not found');
    }

    const publicKeyPem = crypto.createPublicKey({
      key: canvasPublicKey,
      format: 'jwk'
    }).export({ type: 'spki', format: 'pem' });

    const payload = jwt.verify(id_token, publicKeyPem, { algorithms: ['RS256'] });

    console.log('✅ Token verifiziert');

    // Extrahiere LTI Claims
  const ltiClaims = {
      userId: payload['https://purl.imsglobal.org/spec/lti/claim/custom']?.canvas_user_login_id || 
        payload['https://purl.imsglobal.org/spec/lti/claim/lis']?.person_sourcedid ||
        (payload['https://purl.imsglobal.org/spec/lti/claim/custom']?.canvas_user_sis_id || '').replace('SK_', '') ||
        payload.sub, // Fallback zu UUID
      userName: payload.name || 'User',
      userEmail: payload.email,
      roles: payload['https://purl.imsglobal.org/spec/lti/claim/roles'] || [],
      context: payload['https://purl.imsglobal.org/spec/lti/claim/context'] || {},
      custom: payload['https://purl.imsglobal.org/spec/lti/claim/custom'] || {}
    };

    // Speichere in Session ZUERST
req.session.ltiClaims = ltiClaims;
req.session.isAuthenticated = true;

// Debug: Zeige ALLE LTI Claims (JETZT verfügbar!)
console.log('🔍 RAW LTI PAYLOAD (vollständig):', JSON.stringify(payload, null, 2));

// Original Log (für Übersicht)
console.log('🔍 LTI Claims:', JSON.stringify({
  userId: ltiClaims.userId,
  userName: ltiClaims.userName,
  userEmail: ltiClaims.userEmail,
  roles: ltiClaims.roles,
  context: ltiClaims.context,
  custom: ltiClaims.custom
}, null, 2));

await new Promise((resolve, reject) => {
  req.session.save((err) => {
    if (err) {
      console.error('❌ Session Save Error:', err);
      reject(err);
    } else {
      console.log('✅ Session gespeichert in DB');
      resolve();
    }
  });
});

    console.log('🔍 Session nach Speichern:', {
      isAuthenticated: req.session.isAuthenticated,
      sessionID: req.sessionID,
      hasClaims: !!req.session.ltiClaims
    });

    await saveUserToDatabase(ltiClaims);

    // Speichere Kurs-Enrollment
    if (ltiClaims.context && ltiClaims.context.id) {
      const courseId = ltiClaims.context.id;
      const courseName = ltiClaims.context.label || ltiClaims.context.title || 'Kurs';
      
      // Versuche numerische Course ID aus Custom Claims zu holen
      const numericCourseId = ltiClaims.custom?.canvas_course_id || null;
      
      // Upsert Course
      const upsertCourseQuery = `
  INSERT INTO courses (canvas_course_id, course_name, canvas_course_numeric_id, created_at, updated_at)
  VALUES ($1, $2, $3, NOW(), NOW())
  ON CONFLICT (canvas_course_id) 
  DO UPDATE SET 
    course_name = EXCLUDED.course_name, 
    canvas_course_numeric_id = COALESCE(EXCLUDED.canvas_course_numeric_id, courses.canvas_course_numeric_id),
    updated_at = NOW()
  RETURNING id
`;
      
      await pool.query(upsertCourseQuery, [courseId, courseName, numericCourseId]);
      console.log('✅ Kurs gespeichert:', courseName, numericCourseId ? `(ID: ${numericCourseId})` : '');
    }

    const isInstructor = ltiClaims.roles.some(role => 
      role.includes('Instructor') || role.includes('TeachingAssistant')
    );

    if (isInstructor) {
      ltiClaims.sessionId = req.sessionID;
      res.send(renderInstructorView(ltiClaims, req.sessionID));
    } else {
      res.send(renderStudentView(ltiClaims, req.sessionID));
    }

  } catch (error) {
    console.error('❌ Launch Error:', error);
    res.status(500).send(`<h1>Launch Error</h1><p>${error.message}</p><pre>${error.stack}</pre>`);
  }
});

// ============================================================================
// VIEW ROUTES
// ============================================================================

app.get('/attendance/:sessionId', async (req, res) => {
  const sessionId = req.params.sessionId;
  const canvasSessionId = req.query.sid;

  console.log('📝 Attendance View Request:', {
    sessionId,
    canvasSessionId,
    cookieSessionId: req.sessionID,
    fullQuery: req.query
  });

  if (canvasSessionId) {
    console.log('🔍 Lade Session aus Store:', canvasSessionId);
    
    req.sessionStore.get(canvasSessionId, async (err, session) => {
      if (err) {
        console.error('❌ Session Store Error:', err);
        return res.status(500).send(`
          <h1>Server Error</h1>
          <p>Fehler beim Laden der Session: ${err.message}</p>
          <p><a href="javascript:history.back()">← Zurück</a></p>
        `);
      }

      if (!session) {
        console.error('❌ Session nicht gefunden:', canvasSessionId);
        return res.status(401).send(`
          <h1>Session nicht gefunden</h1>
          <p>Bitte starte das Tool aus Canvas neu.</p>
          <p><a href="javascript:history.back()">← Zurück</a></p>
        `);
      }

      if (!session.isAuthenticated) {
        console.error('❌ Session nicht authentifiziert');
        return res.status(401).send(`
          <h1>Session nicht authentifiziert</h1>
          <p>Bitte starte das Tool aus Canvas neu.</p>
          <p><a href="javascript:history.back()">← Zurück</a></p>
        `);
      }

      console.log('✅ Session erfolgreich geladen:', {
        isAuthenticated: session.isAuthenticated,
        hasClaims: !!session.ltiClaims,
        userName: session.ltiClaims?.userName
      });

      const claims = session.ltiClaims;

// Lade Session-Daten aus DB
const sessionQuery = 'SELECT * FROM sessions WHERE id = $1';
const sessionResult = await pool.query(sessionQuery, [sessionId]);
const sessionData = sessionResult.rows[0];

res.send(renderAttendanceView(sessionId, claims, canvasSessionId, sessionData));
    });
  } else {
    console.log('⚠️ Keine Session-ID in Query');
    
    if (!req.session.isAuthenticated) {
      console.error('❌ Cookie-Session nicht authentifiziert');
      return res.status(401).send(`
        <h1>Nicht authentifiziert</h1>
        <p>Bitte starte das Tool aus Canvas neu.</p>
        <p><a href="javascript:history.back()">← Zurück</a></p>
      `);
    }

    const claims = req.session.ltiClaims;

// Lade Session-Daten aus DB
const sessionQuery = 'SELECT * FROM sessions WHERE id = $1';
const sessionResult = await pool.query(sessionQuery, [sessionId]);
const sessionData = sessionResult.rows[0];

res.send(renderAttendanceView(sessionId, claims, req.sessionID, sessionData));
  }
});

app.get('/checkin/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    console.log('📱 Check-In Request mit Token:', token.substring(0, 10) + '...');

    const tokenQuery = `
      SELECT ct.*, s.session_name, s.start_ts, s.end_ts, c.canvas_course_id
      FROM checkin_tokens ct
      JOIN sessions s ON s.id = ct.session_id
      JOIN courses c ON c.id = s.course_id
      WHERE ct.token = $1 AND ct.is_active = true
    `;
    
    const tokenResult = await pool.query(tokenQuery, [token]);

    if (tokenResult.rows.length === 0) {
      console.log('❌ Token nicht gefunden oder inaktiv');
      return res.send(renderCheckinError('Ungültiger oder abgelaufener QR-Code'));
    }

    const tokenData = tokenResult.rows[0];
    
    const now = new Date();
    const expiresAt = new Date(tokenData.expires_at);
    
    if (expiresAt < now) {
      console.log('❌ Token abgelaufen');
      await pool.query('UPDATE checkin_tokens SET is_active = false WHERE token = $1', [token]);
      return res.send(renderCheckinError('QR-Code ist abgelaufen'));
    }

    console.log('✅ Token gültig für Session:', tokenData.session_name);

    res.send(renderCheckinPage(tokenData, token));

  } catch (error) {
    console.error('❌ Check-In Fehler:', error);
    res.status(500).send(renderCheckinError('Ein Fehler ist aufgetreten: ' + error.message));
  }
});

app.post('/checkin/submit', async (req, res) => {
  try {
    const { token, studentName, studentEmail } = req.body;

    console.log('✅ Check-In Submit:', studentName);

    const tokenQuery = `
      SELECT ct.*, s.start_ts, s.end_ts
      FROM checkin_tokens ct
      JOIN sessions s ON s.id = ct.session_id
      WHERE ct.token = $1 AND ct.is_active = true
    `;
    
    const tokenResult = await pool.query(tokenQuery, [token]);

    if (tokenResult.rows.length === 0) {
      return res.json({ success: false, error: 'Token ungültig' });
    }

    const tokenData = tokenResult.rows[0];
    
    if (new Date(tokenData.expires_at) < new Date()) {
      return res.json({ success: false, error: 'QR-Code abgelaufen' });
    }

    // NEUE LOGIK: Nur registrierte Canvas-User erlaubt!
    let userId;
    let canvasUserId;
    let userResult;

    // 1. Versuch: Exakter Name-Match (nur echte Canvas-User)
    const nameQuery = `
      SELECT id, canvas_user_id 
      FROM users 
      WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
      AND canvas_user_id NOT LIKE 'checkin_%'
      AND role = 'student'
      LIMIT 1
    `;
    userResult = await pool.query(nameQuery, [studentName]);

    // 2. Versuch: Email-Match (falls Email angegeben)
    if (userResult.rows.length === 0 && studentEmail) {
      const emailQuery = `
        SELECT id, canvas_user_id 
        FROM users 
        WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))
        AND canvas_user_id NOT LIKE 'checkin_%'
        AND role = 'student'
        LIMIT 1
      `;
      userResult = await pool.query(emailQuery, [studentEmail]);
    }

    // WICHTIG: Wenn User nicht gefunden, ABLEHNEN statt erstellen!
    if (userResult.rows.length === 0) {
      console.log('❌ Nicht registrierter User versucht Check-In:', studentName);
      return res.json({
        success: false,
        error: 'Du bist nicht für diesen Kurs registriert. Bitte kontaktiere den Dozenten.'
      });
    }

    // User gefunden - Check-In erlauben
    userId = userResult.rows[0].id;
    canvasUserId = userResult.rows[0].canvas_user_id;
    console.log('✅ Registrierter User checked in:', studentName, '→', canvasUserId);

    // Zeitberechnung
    const now = new Date();
    const sessionStart = new Date(tokenData.start_ts);
    const sessionEnd = new Date(tokenData.end_ts);
    const minutes = Math.round((sessionEnd - sessionStart) / 1000 / 60);

    const isLate = now > new Date(sessionStart.getTime() + 5 * 60000);
    const status = isLate ? 'late' : 'present';

    // Prüfe ob bereits eingecheckt
    const checkQuery = `
      SELECT id FROM attendance_records 
      WHERE session_id = $1 AND canvas_user_id = $2
    `;
    const existing = await pool.query(checkQuery, [tokenData.session_id, canvasUserId]);

    if (existing.rows.length > 0) {
      console.log('⚠️ Bereits eingecheckt');
      return res.json({ 
        success: true, 
        alreadyCheckedIn: true,
        message: 'Du bist bereits eingecheckt!' 
      });
    }

    // Erstelle Anwesenheitseintrag
    const insertQuery = `
      INSERT INTO attendance_records (
        session_id,
        canvas_user_id,
        status,
        present_from,
        present_to,
        minutes,
        break_minutes,
        note,
        recorded_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, 0, $7, 'self-checkin')
      RETURNING *
    `;

    await pool.query(insertQuery, [
      tokenData.session_id,
      canvasUserId,
      status,
      sessionStart,
      sessionEnd,
      Math.max(0, minutes),
      `Self-Check-In via QR-Code um ${now.toLocaleTimeString('de-DE')}`
    ]);

    console.log('✅ Anwesenheit erfasst:', status);

    res.json({
      success: true,
      status: status,
      message: isLate ? 'Eingecheckt (verspätet)' : 'Erfolgreich eingecheckt!'
    });

  } catch (error) {
    console.error('❌ Submit Fehler:', error);
    res.json({ 
      success: false, 
      error: 'Fehler beim Einchecken: ' + error.message 
    });
  }
});

// Check-In Submit
app.post('/checkin/submit', async (req, res) => {
  // ... existierender Code ...
});

// Kurs-Übersicht
app.get('/course-overview', (req, res) => {
  const { courseId, sid } = req.query;

  if (!sid) {
    return res.status(401).send('Session ID fehlt');
  }

  console.log('📊 Course Overview Request:', { courseId, sid });

  res.send(renderCourseOverview(courseId, sid));
});

// ============================================================================
// CANVAS API INTEGRATION
// ============================================================================

async function syncCourseEnrollments(canvasCourseId) {
  if (!CANVAS_API_TOKEN) {
    console.warn('⚠️ CANVAS_API_TOKEN nicht konfiguriert - überspringe Enrollment Sync');
    return;
  }

  try {
    console.log('🔄 Synchronisiere Canvas Enrollments für Kurs:', canvasCourseId);

    // Hole numerische Course ID aus DB
    const courseQuery = 'SELECT canvas_course_numeric_id FROM courses WHERE canvas_course_id = $1';
    const courseResult = await pool.query(courseQuery, [canvasCourseId]);
    
    if (courseResult.rows.length === 0 || !courseResult.rows[0].canvas_course_numeric_id) {
      console.warn('⚠️ Numerische Course ID nicht in DB gefunden - überspringe Sync');
      console.warn('💡 Tipp: UPDATE courses SET canvas_course_numeric_id = \'235\' WHERE canvas_course_id = \'' + canvasCourseId + '\';');
      return;
    }

    const numericCourseId = courseResult.rows[0].canvas_course_numeric_id;
    console.log('📋 Nutze numerische Course ID:', numericCourseId);

    // Hole alle Enrollments aus Canvas
    const url = `${CANVAS_BASE_URL}/api/v1/courses/${numericCourseId}/enrollments?type[]=StudentEnrollment&state[]=active&per_page=100`;
    
    console.log('🌐 Canvas API Request:', url);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${CANVAS_API_TOKEN}`
      }
    });

    if (!response.ok) {
      console.error('❌ Canvas API Fehler:', response.status, response.statusText);
      const errorText = await response.text();
      console.error('❌ Error Details:', errorText);
      return;
    }

    const enrollments = await response.json();
    console.log(`📋 ${enrollments.length} aktive Studenten gefunden in Canvas`);

    // Upsert jeden Student in die DB
let syncedCount = 0;
for (const enrollment of enrollments) {
  const user = enrollment.user;
  
  const upsertQuery = `
    INSERT INTO users (canvas_user_id, name, email, role, created_at, updated_at)
    VALUES ($1, $2, $3, 'student', NOW(), NOW())
    ON CONFLICT (canvas_user_id) 
    DO UPDATE SET 
      name = EXCLUDED.name,
      email = EXCLUDED.email,
      updated_at = NOW()
    RETURNING id
  `;

  // Normalisiere SIS IDs: SK_lerner01 → lerner01
let canvasUserId = user.login_id || user.sis_user_id || user.integration_id || String(user.id);
if (canvasUserId.startsWith('SK_')) {
  canvasUserId = canvasUserId.replace('SK_', '');
}

  await pool.query(upsertQuery, [
    canvasUserId,  // ✅ Priorisiert login_id (SK_lerner01)
    user.name,
    user.email || user.login_id || ''
  ]);

  syncedCount++;
}

    console.log(`✅ ${syncedCount} Enrollments synchronisiert`);
    return syncedCount;

  } catch (error) {
    console.error('❌ Enrollment Sync Fehler:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Exportiere für Routes
app.locals.syncCourseEnrollments = syncCourseEnrollments;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function saveUserToDatabase(ltiClaims) {
  try {
    const query = `
      INSERT INTO users (canvas_user_id, name, email, role, created_at, updated_at)
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      ON CONFLICT (canvas_user_id) 
      DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, updated_at = NOW()
    `;
    
    const role = ltiClaims.roles.some(r => r.includes('Instructor')) ? 'instructor' : 'student';
    
    await pool.query(query, [ltiClaims.userId, ltiClaims.userName, ltiClaims.userEmail, role]);
    console.log('✅ User in DB gespeichert');
  } catch (error) {
    console.error('❌ DB Error:', error);
  }
}

// ============================================================================
// RENDER FUNCTIONS
// ============================================================================

function renderInstructorView(claims, sessionId) {
  const courseId = claims.context.id || 'unknown';
  const courseName = claims.context.label || claims.context.title || 'Kurs';
  // sessionId ist jetzt als Parameter verfügbar

  return `
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>SK Attendance - Dozent</title>
      <link rel="stylesheet" href="/css/styles.css">
    </head>
    <body>
      <div class="container">
        <h1>🎓 SK Attendance - Dozentenansicht</h1>
        <p><strong>Willkommen:</strong> ${claims.userName}</p>
        <p><strong>Kurs:</strong> ${courseName}</p>

        <div style="margin: 30px 0;">
          <button class="btn" onclick="sessionManager.showCreateForm()">+ Neue Session erstellen</button>
        </div>

        <div style="margin: 20px 0;">
  <button class="btn" onclick="window.location.href='/course-overview?courseId=${courseId}&sid=${sessionId}'" style="background: #0891b2;">
    📊 Kurs-Übersicht anzeigen
  </button>
</div>

        <h2>Geplante Sessions</h2>
        <div id="sessions-list">
          <p>Lade Sessions...</p>
        </div>
      </div>

      <div id="create-session-modal" class="modal">
        <div class="modal-content">
          <span class="close" onclick="sessionManager.hideCreateForm()">&times;</span>
          <h2>Neue Session erstellen</h2>
          
          <form onsubmit="handleCreateSession(event)">
            <div class="form-group">
              <label>Session-Name *</label>
              <input type="text" id="sessionName" required placeholder="z.B. Woche 1: Samstag Vormittag">
            </div>

            <div class="form-group">
              <label>Session-Typ *</label>
              <select id="sessionType" required>
                <option value="weekend">Wochenendkurs</option>
                <option value="evening">Abendkurs</option>
                <option value="online">Online-Seminar</option>
                <option value="regular">Regulär</option>
              </select>
            </div>

            <div class="form-group">
              <label>Datum *</label>
              <input type="date" id="sessionDate" required>
            </div>

            <div class="form-group">
              <label>Startzeit *</label>
              <input type="time" id="startTime" required value="09:00">
            </div>

            <div class="form-group">
              <label>Endzeit *</label>
              <input type="time" id="endTime" required value="12:45">
            </div>

            <div class="form-group">
              <label>
                <input type="checkbox" id="isOnline">
                Online-Session (MS Teams, Zoom, etc.)
              </label>
            </div>

            <div class="form-group">
              <label>Meeting-URL</label>
              <input type="url" id="meetingUrl" placeholder="https://teams.microsoft.com/...">
            </div>

            <div class="form-group">
              <label>Plattform</label>
              <select id="meetingPlatform">
                <option value="">-</option>
                <option value="ms_teams">MS Teams</option>
                <option value="zoom">Zoom</option>
                <option value="webex">Webex</option>
              </select>
            </div>

            <div class="form-group">
              <label>Ort (für Präsenz)</label>
              <input type="text" id="location" placeholder="z.B. Raum 301">
            </div>

            <div class="form-group">
              <label>Beschreibung</label>
              <textarea id="description" rows="3" placeholder="Optionale Notizen"></textarea>
            </div>

            <div class="form-group">
              <label>
                <input type="checkbox" id="isMandatory" checked>
                Pflichtveranstaltung
              </label>
            </div>

            <div class="form-actions">
              <button type="button" class="btn btn-danger" onclick="sessionManager.hideCreateForm()">Abbrechen</button>
              <button type="submit" class="btn">Erstellen</button>
            </div>
          </form>
        </div>
      </div>

      <script src="/js/instructor.js"></script>
      <script>
        sessionManager = new SessionManager('${courseId}', '${sessionId}');
        sessionManager.loadSessions();
      </script>
    </body>
    </html>
  `;
}

function renderCourseOverview(courseId, sessionId) {
  return `
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Kurs-Übersicht</title>
      <link rel="stylesheet" href="/css/styles.css">
      <style>
        .overview-container {
          padding: 20px;
          max-width: 100%;
          overflow-x: auto;
        }
        .matrix-table {
          width: 100%;
          border-collapse: collapse;
          margin: 20px 0;
          font-size: 14px;
        }
        .matrix-table th {
          background: #1e293b;
          color: white;
          padding: 12px 8px;
          text-align: center;
          position: sticky;
          top: 0;
          z-index: 10;
        }
        .matrix-table th:first-child {
          text-align: left;
          min-width: 150px;
        }
        .matrix-table td {
          padding: 10px 8px;
          text-align: center;
          border: 1px solid #e2e8f0;
        }
        .matrix-table td:first-child {
          text-align: left;
          font-weight: 600;
          background: #f8fafc;
          position: sticky;
          left: 0;
          z-index: 5;
        }
        .matrix-table tr:hover {
          background: #f1f5f9;
        }
        .status-cell {
          font-size: 20px;
          cursor: help;
        }
        .status-present { color: #10b981; }
        .status-late { color: #f59e0b; }
        .status-partial { color: #ec4899; }
        .status-absent { color: #ef4444; }
        .status-excused { color: #6366f1; }
        .status-none { color: #94a3b8; }
        .stats-cell {
          font-weight: 600;
          background: #f1f5f9;
        }
        .rate-good { color: #10b981; }
        .rate-medium { color: #f59e0b; }
        .rate-bad { color: #ef4444; }
        .loading {
          text-align: center;
          padding: 40px;
          font-size: 18px;
        }
      </style>
    </head>
    <body>
      <div class="overview-container">
        <h1>📊 Kurs-Übersicht</h1>
        <p><a href="javascript:history.back()">← Zurück zu Sessions</a></p>

        <div id="overview-content">
          <div class="loading">⏳ Lade Kurs-Übersicht...</div>
        </div>
      </div>

      <script>
        const courseId = '${courseId}';
        const sessionId = '${sessionId}';

        async function loadOverview() {
          try {
            const response = await fetch(
              \`/api/course-overview/\${courseId}?sid=\${sessionId}\`,
              { credentials: 'include' }
            );

            if (!response.ok) throw new Error('Fehler beim Laden');

            const data = await response.json();

            if (data.success) {
              renderOverview(data);
            }
          } catch (error) {
            console.error('Error:', error);
            document.getElementById('overview-content').innerHTML = \`
              <div style="padding: 40px; text-align: center; color: #ef4444;">
                <h2>Fehler beim Laden</h2>
                <p>\${error.message}</p>
              </div>
            \`;
          }
        }

        function renderOverview(data) {
          const { course, sessions, students } = data;

          const statusIcons = {
            present: '✅',
            late: '⏰',
            partial: '🔶',
            absent: '❌',
            excused: '📋',
            null: '—'
          };

          const statusLabels = {
            present: 'Anwesend',
            late: 'Verspätet',
            partial: 'Teilweise',
            absent: 'Abwesend',
            excused: 'Entschuldigt',
            null: 'Nicht erfasst'
          };

          let html = \`
            <h2>\${course.name}</h2>
            <p><strong>Studenten:</strong> \${students.length} | <strong>Sessions:</strong> \${sessions.length}</p>

            <table class="matrix-table">
              <thead>
                <tr>
                  <th>Student</th>
                  \${sessions.map(session => {
                    const date = new Date(session.start_ts);
                    return \`<th title="\${session.session_name}">\${date.toLocaleDateString('de-DE', {day: '2-digit', month: '2-digit'})}</th>\`;
                  }).join('')}
                  <th class="stats-cell">Anw. %</th>
                  <th class="stats-cell">Stunden</th>
                </tr>
              </thead>
              <tbody>
                \${students.map(student => {
                  const rateClass = student.stats.attendanceRate >= 80 ? 'rate-good' :
                                   student.stats.attendanceRate >= 60 ? 'rate-medium' : 'rate-bad';

                  return \`
                    <tr>
                      <td>\${student.name}</td>
                      \${student.sessionAttendance.map(att => {
                        const icon = statusIcons[att.status];
                        const label = statusLabels[att.status];
                        const statusClass = att.status ? \`status-\${att.status}\` : 'status-none';
                        return \`<td class="status-cell \${statusClass}" title="\${label}">\${icon}</td>\`;
                      }).join('')}
                      <td class="stats-cell \${rateClass}">\${student.stats.attendanceRate}%</td>
                      <td class="stats-cell">\${student.stats.totalHours}h</td>
                    </tr>
                  \`;
                }).join('')}
              </tbody>
            </table>

            <div style="margin-top: 30px; padding: 20px; background: #f8fafc; border-radius: 8px;">
              <h3>Legende:</h3>
              <p>
                ✅ Anwesend | 
                ⏰ Verspätet | 
                🔶 Teilweise | 
                ❌ Abwesend | 
                📋 Entschuldigt | 
                — Nicht erfasst
              </p>
            </div>
          \`;

          document.getElementById('overview-content').innerHTML = html;
        }

        loadOverview();
      </script>
    </body>
    </html>
  `;
}

function renderStudentView(claims, sessionId) {
  const courseId = claims.context.id || 'unknown';
  const courseName = claims.context.label || claims.context.title || 'Kurs';

  return `
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Meine Anwesenheit</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #f8fafc;
          padding: 20px;
        }
        .container {
          max-width: 1200px;
          margin: 0 auto;
          background: white;
          padding: 40px;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        h1 {
          color: #1e293b;
          border-bottom: 3px solid #10b981;
          padding-bottom: 15px;
          margin-bottom: 30px;
        }
        .stats-dashboard { padding: 20px 0; }
        .stats-cards {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }
        .stat-card {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 25px;
          border-radius: 12px;
          text-align: center;
          box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }
        .stat-icon { font-size: 36px; margin-bottom: 10px; }
        .stat-value { font-size: 32px; font-weight: 700; margin: 10px 0; }
        .stat-label {
          font-size: 14px;
          opacity: 0.9;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .progress-section {
          background: #f8fafc;
          padding: 25px;
          border-radius: 12px;
          margin-bottom: 30px;
        }
        .progress-section h3 { margin-bottom: 15px; color: #1e293b; }
        .progress-bar {
          background: #e2e8f0;
          height: 30px;
          border-radius: 15px;
          overflow: hidden;
          margin-bottom: 10px;
        }
        .progress-fill {
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 600;
          transition: width 0.5s ease;
        }
        .progress-label {
          text-align: center;
          color: #475569;
          font-size: 16px;
          margin-top: 10px;
        }
        .sessions-section { margin-top: 30px; }
        .sessions-section h3 { margin-bottom: 20px; color: #1e293b; }
        .sessions-table {
          width: 100%;
          border-collapse: collapse;
          background: white;
        }
        .sessions-table thead {
          background: #1e293b;
          color: white;
        }
        .sessions-table th,
        .sessions-table td {
          padding: 12px;
          text-align: left;
          border-bottom: 1px solid #e2e8f0;
        }
        .session-row.status-present { background-color: rgba(16, 185, 129, 0.05); }
        .session-row.status-late { background-color: rgba(245, 158, 11, 0.05); }
        .session-row.status-absent { background-color: rgba(239, 68, 68, 0.05); }
        .session-row.status-not-attended { opacity: 0.6; }
        .status-badge {
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 500;
        }
        .status-present { background: #d1fae5; color: #065f46; }
        .status-absent { background: #fee2e2; color: #991b1b; }
        .status-late { background: #fef3c7; color: #92400e; }
        .status-excused { background: #e0e7ff; color: #3730a3; }
        .status-partial { background: #fce7f3; color: #831843; }
        .status-not-attended { background: #f1f5f9; color: #475569; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📚 Meine Anwesenheit</h1>
        <p><strong>Hallo:</strong> ${claims.userName}</p>
        <p><strong>Kurs:</strong> ${courseName}</p>
        <div style="margin: 20px 0;">
  <div style="display: flex; gap: 10px; margin-top: 10px;">
  <a href="/api/attendance/bafoeg-pdf/${courseId}?sid=${sessionId}" 
   class="btn" style="flex: 1;">
  📄 BAföG Bescheinigung (einfach)
</a>
  
  <a href="/api/bafoeg/formblatt-f/${courseId}?sid=${sessionId}" 
   class="btn" style="flex: 1;">
  📋 Formblatt F (offiziell)
</a>
</div>
</div>

<!-- Student Profil-Formular für BAföG Daten -->

<div style="margin: 30px 0; padding: 20px; background: white; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
  <h2 style="margin-top: 0;">📋 Persönliche Daten für BAföG</h2>
  <p style="color: #6b7280; font-size: 14px; margin-bottom: 20px;">
    Diese Daten werden für das offizielle BAföG Formblatt F benötigt.
    Felder mit * sind Pflichtfelder.
  </p>
  
  <form id="profile-form" style="background: #f9fafb; padding: 20px; border-radius: 8px;">
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
      
      <!-- Familienname -->
      <div>
        <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #374151;">
          Familienname *
        </label>
        <input 
          type="text" 
          id="familienname" 
          name="familienname"
          required
          maxlength="100"
          style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;">
      </div>
      
      <!-- Vorname -->
      <div>
        <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #374151;">
          Vorname(n) *
        </label>
        <input 
          type="text" 
          id="vorname" 
          name="vorname"
          required
          maxlength="100"
          style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;">
      </div>
      
      <!-- Geburtsdatum -->
      <div>
        <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #374151;">
          Geburtsdatum *
        </label>
        <input 
          type="date" 
          id="geburtsdatum" 
          name="geburtsdatum"
          required
          style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;">
      </div>
      
      <!-- Straße & Hausnummer -->
      <div style="grid-column: span 2; display: grid; grid-template-columns: 3fr 1fr; gap: 15px;">
        <div>
          <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #374151;">
            Straße
          </label>
          <input 
            type="text" 
            id="strasse" 
            name="strasse"
            maxlength="100"
            placeholder="Musterstraße"
            style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;">
        </div>
        
        <div>
          <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #374151;">
            Hausnr.
          </label>
          <input 
            type="text" 
            id="hausnummer" 
            name="hausnummer"
            maxlength="10"
            placeholder="42"
            style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;">
        </div>
      </div>
      
      <!-- PLZ -->
      <div>
        <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #374151;">
          Postleitzahl
        </label>
        <input 
          type="text" 
          id="plz" 
          name="plz"
          pattern="[0-9]{5}"
          maxlength="5"
          placeholder="12345"
          style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;">
      </div>
      
      <!-- Wohnort -->
      <div>
        <label style="display: block; margin-bottom: 5px; font-weight: 500; color: #374151;">
          Wohnort
        </label>
        <input 
          type="text" 
          id="wohnort" 
          name="wohnort"
          maxlength="100"
          placeholder="Berlin"
          style="width: 100%; padding: 10px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 14px;">
      </div>
      
    </div>
    
    <!-- Submit Button -->
    <div style="margin-top: 20px; display: flex; align-items: center; gap: 15px;">
      <button 
        type="submit" 
        class="btn" 
        style="background-color: #10b981; color: white; padding: 12px 24px; border: none; cursor: pointer; font-weight: 500;">
        💾 Daten speichern
      </button>
      <span id="save-status" style="font-size: 14px;"></span>
    </div>
  </form>
</div>

<script>
(function() {
  const sessionId = '${sessionId}';
  
  // Lade Profildaten beim Start
  async function loadProfile() {
    try {
      const res = await fetch('/api/student/profile?sid=' + sessionId);
      const data = await res.json();
      
      if (data.success && data.profile) {
        const p = data.profile;
        document.getElementById('familienname').value = p.familienname || '';
        document.getElementById('vorname').value = p.vorname || '';
        document.getElementById('geburtsdatum').value = p.geburtsdatum || '';
        document.getElementById('strasse').value = p.strasse || '';
        document.getElementById('hausnummer').value = p.hausnummer || '';
        document.getElementById('plz').value = p.plz || '';
        document.getElementById('wohnort').value = p.wohnort || '';
        console.log('✅ Profil geladen');
      }
    } catch (err) {
      console.error('❌ Error loading profile:', err);
    }
  }
  
  // Speichere Profil beim Submit
  document.getElementById('profile-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formData = {
      familienname: document.getElementById('familienname').value.trim(),
      vorname: document.getElementById('vorname').value.trim(),
      geburtsdatum: document.getElementById('geburtsdatum').value,
      strasse: document.getElementById('strasse').value.trim(),
      hausnummer: document.getElementById('hausnummer').value.trim(),
      plz: document.getElementById('plz').value.trim(),
      wohnort: document.getElementById('wohnort').value.trim()
    };
    
    const statusEl = document.getElementById('save-status');
    statusEl.textContent = '💾 Speichere...';
    statusEl.style.color = '#6b7280';
    
    try {
      const res = await fetch('/api/student/profile?sid=' + sessionId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      
      const data = await res.json();
      
      if (data.success) {
        statusEl.textContent = '✅ Erfolgreich gespeichert!';
        statusEl.style.color = '#10b981';
        setTimeout(() => { statusEl.textContent = ''; }, 3000);
      } else {
        const errorMsg = data.errors ? data.errors.join(', ') : data.error;
        statusEl.textContent = '❌ Fehler: ' + errorMsg;
        statusEl.style.color = '#ef4444';
      }
    } catch (error) {
      console.error('Save error:', error);
      statusEl.textContent = '❌ Fehler beim Speichern';
      statusEl.style.color = '#ef4444';
    }
  });
  
  // Lade Profil beim Seitenaufruf
  loadProfile();
})();
</script>


        <div id="stats-container">
          <div style="text-align: center; padding: 40px;">
            <p>⏳ Lade Statistiken...</p>
          </div>
        </div>
      </div>

      <script>
        class StudentStats {
          constructor(courseId, canvasSessionId) {
            this.courseId = courseId;
            this.canvasSessionId = canvasSessionId;
            this.stats = null;
            this.sessions = [];
          }

          async loadStats() {
            try {
              console.log('🔍 Lade Statistiken für Kurs:', this.courseId);
              console.log('🔍 Session ID:', this.canvasSessionId);

              const response = await fetch(
                \`/api/student/stats/\${this.courseId}?sid=\${this.canvasSessionId}\`,
                { credentials: 'include' }
              );

              console.log('📡 Response Status:', response.status);

              if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Response Error:', errorText);
                throw new Error('Fehler beim Laden (Status: ' + response.status + ')');
              }

const responseText = await response.text();
console.log('📄 Raw Response:', responseText.substring(0, 500));

let data;
try {
  data = JSON.parse(responseText);
  console.log('✅ Daten erhalten:', data);
} catch (e) {
  console.error('❌ JSON Parse Error:', e);
  throw new Error('Server gab kein JSON zurück: ' + responseText.substring(0, 100));
}

              if (data.success) {
                this.stats = data.stats;
                this.sessions = data.sessions;
                this.renderDashboard();
              }

            } catch (error) {
              console.error('❌ Error loading stats:', error);
              document.getElementById('stats-container').innerHTML = \`
                <div style="padding: 40px; text-align: center; color: #ef4444;">
                  <h2>Fehler beim Laden der Statistiken</h2>
                  <p>\${error.message}</p>
                  <p>Öffne die Browser Console (F12) für Details.</p>
                </div>
              \`;
            }
          }

          renderDashboard() {
            if (!this.stats) {
              document.getElementById('stats-container').innerHTML = \`
                <div style="padding: 40px; text-align: center;">
                  <h2>Noch keine Daten vorhanden</h2>
                  <p>Sobald Anwesenheitsdaten erfasst wurden, siehst du hier deine Statistiken.</p>
                </div>
              \`;
              return;
            }

            const rateColor = this.stats.attendanceRate >= 80 ? '#10b981' : 
                              this.stats.attendanceRate >= 60 ? '#f59e0b' : '#ef4444';

            document.getElementById('stats-container').innerHTML = \`
              <div class="stats-dashboard">
                <div class="stats-cards">
                  <div class="stat-card">
                    <div class="stat-icon">⏱️</div>
                    <div class="stat-value">\${this.stats.totalHours}h</div>
                    <div class="stat-label">Gesamtstunden</div>
                  </div>

                  <div class="stat-card">
                    <div class="stat-icon">📊</div>
                    <div class="stat-value" style="color: \${rateColor}">\${this.stats.attendanceRate}%</div>
                    <div class="stat-label">Anwesenheitsquote</div>
                  </div>

                  <div class="stat-card">
                    <div class="stat-icon">📚</div>
                    <div class="stat-value">\${this.stats.attendedSessions}/\${this.stats.totalSessions}</div>
                    <div class="stat-label">Sessions besucht</div>
                  </div>
                </div>

                <div class="progress-section">
                  <h3>Anwesenheits-Fortschritt</h3>
                  <div class="progress-bar">
                    <div class="progress-fill" style="width: \${this.stats.attendanceRate}%; background: \${rateColor};">
                      \${this.stats.attendanceRate}%
                    </div>
                  </div>
                  <p class="progress-label">
                    \${this.getProgressMessage(this.stats.attendanceRate)}
                  </p>
                </div>

                <div class="sessions-section">
                  <h3>Meine Sessions</h3>
                  \${this.renderSessionsList()}
                </div>
              </div>
            \`;
          }

          renderSessionsList() {
            if (this.sessions.length === 0) {
              return '<p>Noch keine Sessions vorhanden.</p>';
            }

            return \`
              <table class="sessions-table">
                <thead>
                  <tr>
                    <th>Datum</th>
<th>Session</th>
<th>Zeit</th>
<th>Status</th>
<th>Stunden</th>
<th>Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  \${this.sessions.map(session => this.renderSessionRow(session)).join('')}
                </tbody>
              </table>
            \`;
          }

          renderSessionRow(session) {
            const date = new Date(session.start_ts);
            const status = session.status || 'not_attended';
            const statusLabel = this.getStatusLabel(status);
            const statusClass = this.getStatusClass(status);
            
            const hours = session.net_minutes 
              ? (session.net_minutes / 60).toFixed(2) 
              : '-';

            const expectedHours = (session.expected_minutes / 60).toFixed(2);

            let timeDisplay = '';
            if (session.present_from && session.present_to) {
              const from = new Date(session.present_from);
              const to = new Date(session.present_to);
              timeDisplay = \`\${from.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})} - \${to.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})}\`;
            } else {
              const start = new Date(session.start_ts);
              const end = new Date(session.end_ts);
              timeDisplay = \`\${start.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})} - \${end.toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'})}\`;
            }

            return \`
              <tr class="session-row \${statusClass}">
                <td>\${date.toLocaleDateString('de-DE', {day: '2-digit', month: '2-digit', year: 'numeric'})}</td>
                <td>
                  <strong>\${session.session_name}</strong>
                  \${session.note ? \`<br><small style="color: #64748b;">\${session.note}</small>\` : ''}
                </td>
                <td><small>\${timeDisplay}</small></td>
                <td>
                  <span class="status-badge \${statusClass}">\${statusLabel}</span>
                </td>
                <td>
                  \${status !== 'absent' && status !== 'not_attended' 
                    ? \`<strong>\${hours}h</strong> <small>/ \${expectedHours}h</small>\` 
                    : \`<span style="color: #94a3b8;">-</span>\`
                  }
                </td>
                <td>
  \${status === 'absent' || status === 'not_attended' 
    ? \`<button class="btn" style="padding: 6px 12px; font-size: 12px; background: #6366f1;" onclick="studentStats.showExcuseModal(\${session.id}, '\${session.session_name}')">📎 Entschuldigung</button>\`
    : '-'
  }
</td>
              </tr>
            \`;
          }

          getStatusLabel(status) {
            const labels = {
              present: 'Anwesend',
              late: 'Verspätet',
              partial: 'Teilweise',
              absent: 'Abwesend',
              excused: 'Entschuldigt',
              not_attended: 'Nicht erfasst'
            };
            return labels[status] || 'Unbekannt';
          }

          getStatusClass(status) {
            if (!status) return 'status-not-recorded';
            return 'status-' + status.replace('_', '-');
          }

          getProgressMessage(rate) {
            if (rate >= 90) return '🌟 Hervorragend! Weiter so!';
            if (rate >= 80) return '✅ Sehr gut!';
            if (rate >= 70) return '👍 Gut';
            if (rate >= 60) return '⚠️ Akzeptabel, aber ausbaufähig';
            return '❌ Achtung: Anwesenheit zu niedrig!';
          }
        }

        const studentStats = new StudentStats('${courseId}', '${sessionId}');
        studentStats.loadStats();
      </script>
      <!-- Entschuldigungs-Modal -->
<div id="excuse-modal" class="modal" style="display: none;">
  <div class="modal-content" style="max-width: 500px;">
    <span class="close" onclick="document.getElementById('excuse-modal').style.display='none'">&times;</span>
    <h2>📎 Entschuldigung hochladen</h2>
    <p id="excuse-session-name" style="color: #64748b; margin-bottom: 20px;"></p>
    
    <form id="excuse-form" style="margin-top: 20px;">
      <input type="hidden" id="excuse-session-id">
      
      <div style="margin: 20px 0;">
        <label style="display: block; margin-bottom: 10px; font-weight: 600;">
          Datei auswählen (PDF, JPG, PNG - max 5MB):
        </label>
        <input type="file" id="excuse-file" accept=".pdf,.jpg,.jpeg,.png" required
               style="padding: 10px; border: 2px solid #e2e8f0; border-radius: 6px; width: 100%;">
      </div>

      <div id="excuse-message" style="display: none; padding: 15px; border-radius: 6px; margin: 15px 0;"></div>

      <div style="display: flex; gap: 10px; margin-top: 20px;">
        <button type="button" onclick="document.getElementById('excuse-modal').style.display='none'"
                style="flex: 1; padding: 12px; background: #94a3b8; color: white; border: none; border-radius: 6px; cursor: pointer;">
          Abbrechen
        </button>
        <button type="submit" id="excuse-submit-btn"
                style="flex: 1; padding: 12px; background: #6366f1; color: white; border: none; border-radius: 6px; font-weight: 600; cursor: pointer;">
          📤 Hochladen
        </button>
      </div>
    </form>
  </div>
</div>

<script>
  // Erweitere StudentStats Klasse
  StudentStats.prototype.showExcuseModal = function(sessionId, sessionName) {
    document.getElementById('excuse-session-id').value = sessionId;
    document.getElementById('excuse-session-name').textContent = 'Session: ' + sessionName;
    document.getElementById('excuse-modal').style.display = 'block';
    document.getElementById('excuse-message').style.display = 'none';
    document.getElementById('excuse-form').reset();
  };

  // Entschuldigungs-Upload Handler
  document.getElementById('excuse-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const sessionId = document.getElementById('excuse-session-id').value;
    const fileInput = document.getElementById('excuse-file');
    const submitBtn = document.getElementById('excuse-submit-btn');
    const message = document.getElementById('excuse-message');
    
    if (!fileInput.files[0]) {
      message.style.display = 'block';
      message.style.background = '#fee2e2';
      message.style.color = '#991b1b';
      message.textContent = 'Bitte wähle eine Datei aus!';
      return;
    }

    const formData = new FormData();
    formData.append('excuse', fileInput.files[0]);
    formData.append('sessionId', sessionId);

    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Lädt hoch...';

    try {
      const response = await fetch(\`/api/excuses/upload?sid=\${studentStats.canvasSessionId}\`, {
        method: 'POST',
        credentials: 'include',
        body: formData
      });

      const data = await response.json();

      if (data.success) {
        message.style.display = 'block';
        message.style.background = '#d1fae5';
        message.style.color = '#065f46';
        message.textContent = '✅ ' + data.message;
        
        setTimeout(() => {
          document.getElementById('excuse-modal').style.display = 'none';
          studentStats.loadStats(); // Reload stats
        }, 2000);
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      message.style.display = 'block';
      message.style.background = '#fee2e2';
      message.style.color = '#991b1b';
      message.textContent = '❌ Fehler: ' + error.message;
      submitBtn.disabled = false;
      submitBtn.textContent = '📤 Hochladen';
    }
  });
</script>
    </body>
    </html>
  `;
}

function renderAttendanceView(sessionId, claims, canvasSessionId, sessionData = null) {
  return `
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Anwesenheit erfassen</title>
      <link rel="stylesheet" href="/css/styles.css">
    </head>
    <body>
      <div class="container">
        <h1>📝 Anwesenheit erfassen</h1>
        <p><a href="javascript:history.back()">← Zurück zu Sessions</a></p>

        <div class="time-controls">
  <h3>Zeiterfassung</h3>
  <div class="form-group">
    <label>Datum</label>
    <input type="date" id="attendanceDate" value="${sessionData ? new Date(sessionData.start_ts).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]}">
  </div>
  <div class="form-group">
    <label>Von</label>
    <input type="time" id="startTime" value="${sessionData ? new Date(sessionData.start_ts).toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'}) : '09:00'}">
  </div>
  <div class="form-group">
    <label>Bis</label>
    <input type="time" id="endTime" value="${sessionData ? new Date(sessionData.end_ts).toLocaleTimeString('de-DE', {hour: '2-digit', minute: '2-digit'}) : '16:30'}">
  </div>
          <div class="form-group">
            <label>Pause (Min)</label>
            <input type="number" id="breakMinutes" value="0" min="0">
          </div>
          <div class="form-group" style="padding-top: 24px;">
            <button class="btn" onclick="attendanceManager.generateQRCode()" style="background: #8b5cf6; margin-right: 10px;">
              📱 QR-Code generieren
            </button>
            <button class="btn" onclick="attendanceManager.markAllPresent()">
              ✅ Alle als anwesend markieren
            </button>
            <a href="/api/export/excel/${sessionId}?sid=${canvasSessionId}" 
   class="btn" 
   style="background: #059669; margin-left: 10px;">
  📊 Excel Export
</a>
<a href="/api/export/csv/${sessionId}?sid=${canvasSessionId}" 
   class="btn" 
   style="background: #0891b2; margin-left: 10px;">
  📄 CSV Export
</a>
          </div>
        </div>

        <h2>Teilnehmer</h2>
        <div id="students-list">
          <p>Lade Teilnehmer...</p>
        </div>
      </div>

      <script src="/js/attendance.js?v=${Date.now()}"></script>
      <script>
        attendanceManager = new AttendanceManager(${sessionId}, '${canvasSessionId}');
        attendanceManager.loadStudents();
      </script>
    </body>
    </html>
  `;
}

function renderCheckinPage(tokenData, token) {
  const sessionName = tokenData.session_name;
  const startTime = new Date(tokenData.start_ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const endTime = new Date(tokenData.end_ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

  return `
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Check-In - SK Attendance</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }
        .container {
          background: white;
          padding: 40px;
          border-radius: 16px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          max-width: 500px;
          width: 100%;
        }
        h1 { color: #1e293b; margin-bottom: 10px; font-size: 28px; }
        .session-info {
          background: #f1f5f9;
          padding: 15px;
          border-radius: 8px;
          margin: 20px 0;
        }
        .session-info p { margin: 5px 0; color: #475569; }
        .form-group { margin: 20px 0; }
        .form-group label {
          display: block;
          margin-bottom: 8px;
          color: #334155;
          font-weight: 500;
        }
        .form-group input {
          width: 100%;
          padding: 12px;
          border: 2px solid #e2e8f0;
          border-radius: 8px;
          font-size: 16px;
        }
        .form-group input:focus {
          outline: none;
          border-color: #667eea;
        }
        .btn {
          width: 100%;
          padding: 14px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 18px;
          font-weight: 600;
          cursor: pointer;
        }
        .btn:hover { transform: translateY(-2px); }
        .btn:disabled { opacity: 0.6; cursor: not-allowed; }
        .success-message {
          background: #d1fae5;
          border-left: 4px solid #10b981;
          padding: 15px;
          border-radius: 6px;
          margin: 20px 0;
          display: none;
        }
        .error-message {
          background: #fee2e2;
          border-left: 4px solid #ef4444;
          padding: 15px;
          border-radius: 6px;
          margin: 20px 0;
          display: none;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📱 Check-In</h1>
        <p style="color: #64748b; margin-bottom: 20px;">Bitte trage deine Daten ein.</p>

        <div class="session-info">
          <p><strong>📚 Session:</strong> ${sessionName}</p>
          <p><strong>⏰ Zeit:</strong> ${startTime} - ${endTime}</p>
        </div>

        <form id="checkin-form" onsubmit="submitCheckin(event)">
          <div class="form-group">
            <label>Dein Name *</label>
            <input type="text" id="studentName" required placeholder="Max Mustermann">
          </div>

          <div class="form-group">
            <label>E-Mail (optional)</label>
            <input type="email" id="studentEmail" placeholder="max@example.com">
          </div>

          <div class="success-message" id="success">
            <strong>✅ Erfolgreich eingecheckt!</strong>
            <p id="success-text"></p>
          </div>

          <div class="error-message" id="error">
            <strong>❌ Fehler</strong>
            <p id="error-text"></p>
          </div>

          <button type="submit" class="btn" id="submit-btn">
            ✅ Jetzt einchecken
          </button>
        </form>
      </div>

      <script>
        async function submitCheckin(e) {
          e.preventDefault();
          
          const btn = document.getElementById('submit-btn');
          const success = document.getElementById('success');
          const error = document.getElementById('error');
          
          btn.disabled = true;
          btn.textContent = '⏳ Einen Moment...';
          success.style.display = 'none';
          error.style.display = 'none';

          const data = {
            token: '${token}',
            studentName: document.getElementById('studentName').value,
            studentEmail: document.getElementById('studentEmail').value
          };

          try {
            const response = await fetch('/checkin/submit', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data)
            });

            const result = await response.json();

            if (result.success) {
              success.style.display = 'block';
              document.getElementById('success-text').textContent = result.message;
              btn.textContent = '✅ Eingecheckt!';
              btn.style.background = '#10b981';
              
              setTimeout(() => {
                document.getElementById('checkin-form').style.display = 'none';
              }, 2000);
            } else {
              error.style.display = 'block';
              document.getElementById('error-text').textContent = result.error;
              btn.disabled = false;
              btn.textContent = '✅ Jetzt einchecken';
            }
          } catch (err) {
            error.style.display = 'block';
            document.getElementById('error-text').textContent = 'Verbindungsfehler: ' + err.message;
            btn.disabled = false;
            btn.textContent = '✅ Jetzt einchecken';
          }
        }
      </script>
    </body>
    </html>
  `;
}

function renderCheckinError(message) {
  return `
    <!DOCTYPE html>
    <html lang="de">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Fehler - SK Attendance</title>
      <style>
        body {
          font-family: -apple-system, sans-serif;
          background: #f8fafc;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 20px;
        }
        .container {
          background: white;
          padding: 40px;
          border-radius: 12px;
          box-shadow: 0 4px 6px rgba(0,0,0,0.1);
          max-width: 500px;
          text-align: center;
        }
        h1 { color: #ef4444; margin-bottom: 20px; }
        p { color: #64748b; font-size: 16px; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>❌ ${message}</h1>
        <p>Bitte kontaktiere deine Lehrkraft.</p>
      </div>
    </body>
    </html>
  `;
}

// ============================================================================
// SERVER START
// ============================================================================

async function startServer() {
  try {
    await pool.query('SELECT NOW()');
    console.log('✅ PostgreSQL verbunden');

    generateKeyPair();

    app.listen(PORT, () => {
      console.log('\n' + '='.repeat(60));
      console.log('🚀 SK ATTENDANCE LTI SERVER LÄUFT');
      console.log('='.repeat(60));
      console.log(`📍 Lokal:   http://localhost:${PORT}`);
      console.log(`📍 Health:  http://localhost:${PORT}/health`);
      console.log(`📍 JWKS:    http://localhost:${PORT}/lti/jwks`);
      console.log('='.repeat(60));
      console.log('Bereit für LTI-Launches von Canvas!\n');
    });

  } catch (error) {
    console.error('❌ Server Start Fehler:', error);
    process.exit(1);
  }
}

startServer();