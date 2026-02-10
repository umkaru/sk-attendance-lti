// routes/attendance.js
// API-Endpoints für Anwesenheitserfassung

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const QRCode = require('qrcode');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const pool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD
});

// Multer Konfiguration für Datei-Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../public/uploads/excuses');
    
    // Erstelle Ordner falls nicht vorhanden
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `excuse-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Nur PDF, JPG und PNG Dateien erlaubt!'));
    }
  }
});

// Middleware: Session-Handling
function requireAuth(req, res, next) {
  const sessionId = req.query.sid || req.sessionID;
  
  if (req.query.sid && req.query.sid !== req.sessionID) {
    req.sessionStore.get(req.query.sid, (err, session) => {
      if (err || !session || !session.isAuthenticated) {
        return res.status(401).json({ error: 'Not authenticated' });
      }
      req.session.isAuthenticated = session.isAuthenticated;
      req.session.ltiClaims = session.ltiClaims;
      next();
    });
  } else {
    if (!req.session.isAuthenticated) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
  }
}

function requireInstructor(req, res, next) {
  if (!req.session.ltiClaims) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  const isInstructor = req.session.ltiClaims.roles.some(r => 
    r.includes('Instructor') || r.includes('TeachingAssistant')
  );
  
  if (!isInstructor) {
    return res.status(403).json({ error: 'Instructor access required' });
  }
  
  next();
}

// ============================================================================
// ATTENDANCE ROUTES
// ============================================================================

// GET /api/attendance/session/:sessionId - Anwesenheit für eine Session
router.get('/attendance/session/:sessionId', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    console.log('📊 Lade Anwesenheit für Session:', sessionId);
    
    // Hole Session-Info um Course-ID zu bekommen
    const sessionQuery = `
      SELECT s.id, c.canvas_course_id 
      FROM sessions s
      JOIN courses c ON c.id = s.course_id
      WHERE s.id = $1
    `;
    const sessionResult = await pool.query(sessionQuery, [sessionId]);
    
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Session not found' 
      });
    }
    
    const canvasCourseId = sessionResult.rows[0].canvas_course_id;
    
    // Hole alle Studenten aus DB
const query = `
  WITH all_students AS (
    -- Echte Canvas-User
    SELECT DISTINCT
      u.id::text as id,
      u.canvas_user_id,
      u.name,
      u.email,
      ar.id as attendance_id,
      ar.status,
      ar.present_from,
      ar.present_to,
      ar.minutes,
      ar.break_minutes,
      ar.net_minutes,
      ar.note as notes,
      ar.excuse_filename,
      ar.excuse_uploaded_at
    FROM users u
    LEFT JOIN attendance_records ar ON ar.canvas_user_id = u.canvas_user_id AND ar.session_id = $1
    WHERE u.role = 'student' AND u.canvas_user_id NOT LIKE 'checkin_%'
    
    UNION
    
    -- QR-Code Check-Ins (nur wenn kein echter User existiert)
    SELECT DISTINCT
      NULL as id,
      ar.canvas_user_id,
      COALESCE(
        (SELECT name FROM users WHERE canvas_user_id = ar.canvas_user_id LIMIT 1),
        REGEXP_REPLACE(ar.note, '^Self-Check-In via QR-Code um .*', '')
      ) as name,
      NULL as email,
      ar.id as attendance_id,
      ar.status,
      ar.present_from,
      ar.present_to,
      ar.minutes,
      ar.break_minutes,
      ar.net_minutes,
      ar.note as notes,
      ar.excuse_filename,
      ar.excuse_uploaded_at
    FROM attendance_records ar
    WHERE ar.session_id = $1 
      AND ar.canvas_user_id LIKE 'checkin_%'
      AND ar.recorded_by = 'self-checkin'
      AND NOT EXISTS (
        SELECT 1 FROM users u2 
        WHERE u2.role = 'student' 
        AND u2.canvas_user_id NOT LIKE 'checkin_%'
        AND LOWER(TRIM(u2.name)) = LOWER(TRIM(
          COALESCE(
            (SELECT name FROM users WHERE canvas_user_id = ar.canvas_user_id LIMIT 1),
            REGEXP_REPLACE(ar.note, '^Self-Check-In via QR-Code um .*', '')
          )
        ))
      )
  )
  SELECT * FROM all_students
  ORDER BY name
`;
    
    const result = await pool.query(query, [sessionId]);
    
    console.log(`✅ ${result.rows.length} Studenten geladen`);
    
    res.json({
      success: true,
      students: result.rows,
      courseId: canvasCourseId
    });
    
  } catch (error) {
    console.error('Error fetching attendance:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// POST /api/attendance/mark - Alternative endpoint für Frontend
router.post('/attendance/mark', requireAuth, requireInstructor, async (req, res) => {
  try {
    const {
      sessionId,
      studentId,
      status,
      presentFrom,
      presentTo,
      minutes,
      breakMinutes,
      note
    } = req.body;

    console.log('✏️ Mark Attendance:', { sessionId, studentId, status });

    if (!sessionId || !studentId || !status) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: sessionId, studentId, status'
      });
    }

    // Hole canvas_user_id aus User-Tabelle
    const userQuery = 'SELECT canvas_user_id FROM users WHERE id = $1';
    const userResult = await pool.query(userQuery, [studentId]);
    
    if (userResult.rows.length === 0) {
      console.error('❌ User not found:', studentId);
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const canvasUserId = userResult.rows[0].canvas_user_id;
    console.log('📋 Found canvas_user_id:', canvasUserId);

    // Prüfe ob Eintrag existiert
    const checkQuery = `
      SELECT id FROM attendance_records 
      WHERE session_id = $1 AND canvas_user_id = $2
    `;
    const existing = await pool.query(checkQuery, [sessionId, canvasUserId]);

    let result;

    if (existing.rows.length > 0) {
      // Update (net_minutes wird automatisch berechnet!)
      const updateQuery = `
        UPDATE attendance_records
        SET 
          status = $1,
          present_from = $2,
          present_to = $3,
          minutes = $4,
          break_minutes = $5,
          note = $6,
          updated_at = NOW()
        WHERE session_id = $7 AND canvas_user_id = $8
        RETURNING *
      `;
      
      result = await pool.query(updateQuery, [
        status,
        presentFrom || null,
        presentTo || null,
        minutes || null,
        breakMinutes || 0,
        note || null,
        sessionId,
        canvasUserId
      ]);
      
      console.log('✅ Anwesenheit aktualisiert für:', canvasUserId);
    } else {
      // Insert (net_minutes wird automatisch berechnet!)
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `;
      
      result = await pool.query(insertQuery, [
        sessionId,
        canvasUserId,
        status,
        presentFrom || null,
        presentTo || null,
        minutes || null,
        breakMinutes || 0,
        note || null,
        req.session.ltiClaims?.userId || 'system'
      ]);
      
      console.log('✅ Anwesenheit erfasst für:', canvasUserId);
    }

    res.json({
      success: true,
      attendance: result.rows[0],
      message: 'Anwesenheit gespeichert'
    });

  } catch (error) {
    console.error('❌ Mark Attendance Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/attendance - Anwesenheit erfassen (einzelner Student)
router.post('/attendance', requireAuth, requireInstructor, async (req, res) => {
  try {
    const {
      sessionId,
      userId,
      status,
      presentFrom,
      presentTo,
      breakMinutes,
      notes
    } = req.body;

    console.log('✏️ Erfasse Anwesenheit:', { sessionId, userId, status });

    if (!sessionId || !userId || !status) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    // Hole canvas_user_id
    const userQuery = 'SELECT canvas_user_id FROM users WHERE id = $1';
    const userResult = await pool.query(userQuery, [userId]);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }
    
    const canvasUserId = userResult.rows[0].canvas_user_id;

    let minutes = 0;
    let actualPresentFrom = null;
    let actualPresentTo = null;
    let actualBreakMinutes = breakMinutes || 0;

    if (status === 'present' || status === 'late' || status === 'partial') {
  if (presentFrom && presentTo) {
    actualPresentFrom = new Date(presentFrom);
    actualPresentTo = new Date(presentTo);
    minutes = Math.round((actualPresentTo - actualPresentFrom) / 1000 / 60);
  }
}

    const checkQuery = `
      SELECT id FROM attendance_records 
      WHERE session_id = $1 AND canvas_user_id = $2
    `;
    const existing = await pool.query(checkQuery, [sessionId, canvasUserId]);

    let result;

    if (existing.rows.length > 0) {
      const updateQuery = `
        UPDATE attendance_records
        SET 
          status = $1,
          present_from = $2,
          present_to = $3,
          minutes = $4,
          break_minutes = $5,
          note = $6,
          updated_at = NOW()
        WHERE session_id = $7 AND canvas_user_id = $8
        RETURNING *
      `;
      
      result = await pool.query(updateQuery, [
        status,
        actualPresentFrom,
        actualPresentTo,
        minutes,
        actualBreakMinutes,
        notes || null,
        sessionId,
        canvasUserId
      ]);
      
      console.log('✅ Anwesenheit aktualisiert');
    } else {
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `;
      
      result = await pool.query(insertQuery, [
        sessionId,
        canvasUserId,
        status,
        actualPresentFrom,
        actualPresentTo,
        minutes,
        actualBreakMinutes,
        notes || null,
        req.session.ltiClaims.userId
      ]);
      
      console.log('✅ Anwesenheit erfasst');
    }

    res.json({
      success: true,
      attendance: result.rows[0],
      message: 'Anwesenheit gespeichert'
    });

  } catch (error) {
    console.error('Error recording attendance:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// POST /api/attendance/bulk - Alle als anwesend markieren
router.post('/attendance/bulk', requireAuth, requireInstructor, async (req, res) => {
  try {
    const {
      sessionId,
      studentIds,
      status,
      presentFrom,
      presentTo,
      breakMinutes
    } = req.body;

    console.log('📝 Bulk-Anwesenheit:', { 
      sessionId, 
      studentCount: studentIds?.length,
      status 
    });

    if (!sessionId || !studentIds || studentIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    let minutes = 0;
    let actualPresentFrom = null;
    let actualPresentTo = null;
    let actualBreakMinutes = breakMinutes || 0;

    if ((status === 'present' || status === 'partial') && presentFrom && presentTo) {
      actualPresentFrom = new Date(presentFrom);
      actualPresentTo = new Date(presentTo);
      minutes = Math.round((actualPresentTo - actualPresentFrom) / 1000 / 60);
    }

    // Hole canvas_user_ids
    const userQuery = 'SELECT id, canvas_user_id FROM users WHERE id = ANY($1)';
    const userResult = await pool.query(userQuery, [studentIds]);
    const userMap = {};
    userResult.rows.forEach(row => {
      userMap[row.id] = row.canvas_user_id;
    });

    const promises = studentIds.map(async (userId) => {
      const canvasUserId = userMap[userId];
      if (!canvasUserId) return;

      const checkQuery = `
        SELECT id FROM attendance_records 
        WHERE session_id = $1 AND canvas_user_id = $2
      `;
      const existing = await pool.query(checkQuery, [sessionId, canvasUserId]);

      if (existing.rows.length > 0) {
        const updateQuery = `
          UPDATE attendance_records
          SET 
            status = $1,
            present_from = $2,
            present_to = $3,
            minutes = $4,
            break_minutes = $5,
            updated_at = NOW()
          WHERE session_id = $6 AND canvas_user_id = $7
        `;
        
        return pool.query(updateQuery, [
          status,
          actualPresentFrom,
          actualPresentTo,
          minutes,
          actualBreakMinutes,
          sessionId,
          canvasUserId
        ]);
      } else {
        const insertQuery = `
          INSERT INTO attendance_records (
            session_id,
            canvas_user_id,
            status,
            present_from,
            present_to,
            minutes,
            break_minutes,
            recorded_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;
        
        return pool.query(insertQuery, [
          sessionId,
          canvasUserId,
          status,
          actualPresentFrom,
          actualPresentTo,
          minutes,
          actualBreakMinutes,
          req.session.ltiClaims.userId
        ]);
      }
    });

    await Promise.all(promises);

    console.log(`✅ ${studentIds.length} Anwesenheiten gespeichert`);

    res.json({
      success: true,
      count: studentIds.length,
      message: `${studentIds.length} Anwesenheiten gespeichert`
    });

  } catch (error) {
    console.error('Error bulk recording attendance:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// DELETE /api/attendance/:attendanceId
router.delete('/attendance/:attendanceId', requireAuth, requireInstructor, async (req, res) => {
  try {
    const { attendanceId } = req.params;

    const query = 'DELETE FROM attendance_records WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [attendanceId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Attendance record not found'
      });
    }

    res.json({
      success: true,
      message: 'Anwesenheit gelöscht'
    });

  } catch (error) {
    console.error('Error deleting attendance:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================================
// QR-CODE CHECK-IN ROUTES
// ============================================================================

// POST /api/checkin/generate/:sessionId - Generiere QR-Code für Session
router.post('/checkin/generate/:sessionId', requireAuth, requireInstructor, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { validMinutes = 15 } = req.body; // Wie lange ist der QR-Code gültig?

    // Canvas Enrollment Sync
    const sessionQuery = `
      SELECT s.*, c.canvas_course_id
      FROM sessions s
      JOIN courses c ON c.id = s.course_id
      WHERE s.id = $1
    `;
    const sessionResult = await pool.query(sessionQuery, [sessionId]);

    if (sessionResult.rows.length > 0 && sessionResult.rows[0].canvas_course_id) {
      const canvasCourseId = sessionResult.rows[0].canvas_course_id;
      console.log('🔄 Starte Enrollment Sync für Canvas Course:', canvasCourseId);
      
      if (req.app.locals.syncCourseEnrollments) {
        await req.app.locals.syncCourseEnrollments(canvasCourseId);
      }
    }

    console.log('🎫 Generiere Check-In Token für Session:', sessionId);

    // Generiere sicheren Token
    const token = crypto.randomBytes(32).toString('hex');
    
    // Berechne Ablaufzeit
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + validMinutes);

    // Deaktiviere alte Tokens für diese Session
    await pool.query(
      'UPDATE checkin_tokens SET is_active = false WHERE session_id = $1',
      [sessionId]
    );

    // Erstelle neuen Token
    const insertQuery = `
      INSERT INTO checkin_tokens (session_id, token, expires_at, created_by)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    
    const result = await pool.query(insertQuery, [
      sessionId,
      token,
      expiresAt,
      req.session.ltiClaims.userId
    ]);

    // Generiere Check-In URL
    const baseUrl = process.env.PUBLIC_URL || 'http://localhost:3001';
    const checkinUrl = `${baseUrl}/checkin/${token}`;

    // Generiere QR-Code als Data URL
    const qrCodeDataUrl = await QRCode.toDataURL(checkinUrl, {
      width: 400,
      margin: 2,
      color: {
        dark: '#1e293b',
        light: '#ffffff'
      }
    });

    console.log('✅ Token erstellt, gültig bis:', expiresAt);

    res.json({
      success: true,
      token: result.rows[0],
      checkinUrl,
      qrCodeDataUrl,
      expiresAt,
      validMinutes
    });

  } catch (error) {
    console.error('Error generating check-in token:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /api/checkin/status/:sessionId - Status des aktuellen Tokens
router.get('/checkin/status/:sessionId', requireAuth, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const query = `
      SELECT token, expires_at, is_active, created_at
      FROM checkin_tokens
      WHERE session_id = $1 AND is_active = true
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const result = await pool.query(query, [sessionId]);

    if (result.rows.length === 0) {
      return res.json({
        success: true,
        active: false
      });
    }

    const token = result.rows[0];
    const now = new Date();
    const isExpired = new Date(token.expires_at) < now;

    if (isExpired) {
      // Deaktiviere abgelaufenen Token
      await pool.query(
        'UPDATE checkin_tokens SET is_active = false WHERE token = $1',
        [token.token]
      );

      return res.json({
        success: true,
        active: false,
        expired: true
      });
    }

    const baseUrl = process.env.PUBLIC_URL || 'http://localhost:3001';
    const checkinUrl = `${baseUrl}/checkin/${token.token}`;

    const qrCodeDataUrl = await QRCode.toDataURL(checkinUrl, {
      width: 400,
      margin: 2
    });

    res.json({
      success: true,
      active: true,
      token: token.token,
      expiresAt: token.expires_at,
      checkinUrl,
      qrCodeDataUrl
    });

  } catch (error) {
    console.error('Error checking token status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// DELETE /api/checkin/deactivate/:sessionId - Deaktiviere Check-In
router.delete('/checkin/deactivate/:sessionId', requireAuth, requireInstructor, async (req, res) => {
  try {
    const { sessionId } = req.params;

    await pool.query(
      'UPDATE checkin_tokens SET is_active = false WHERE session_id = $1',
      [sessionId]
    );

    console.log('🔒 Check-In für Session deaktiviert:', sessionId);

    res.json({
      success: true,
      message: 'Check-In deaktiviert'
    });

  } catch (error) {
    console.error('Error deactivating check-in:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================================
// STUDENT STATISTICS ROUTES
// ============================================================================

router.get('/student/stats/:courseId', requireAuth, async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.session.ltiClaims.userId;

    console.log('📊 Lade Statistiken für Student:', userId, 'Kurs:', courseId);

    const userQuery = 'SELECT canvas_user_id FROM users WHERE canvas_user_id = $1';
    const userResult = await pool.query(userQuery, [userId]);

    if (userResult.rows.length === 0) {
      return res.json({ success: true, stats: null, sessions: [] });
    }

    const canvasUserId = userResult.rows[0].canvas_user_id;

    const courseQuery = 'SELECT id FROM courses WHERE canvas_course_id = $1';
    const courseResult = await pool.query(courseQuery, [courseId]);

    if (courseResult.rows.length === 0) {
      return res.json({ success: true, stats: null, sessions: [] });
    }

    const internalCourseId = courseResult.rows[0].id;

    const statsQuery = `
      WITH session_stats AS (
        SELECT 
          COUNT(DISTINCT s.id) as total_sessions,
          COUNT(DISTINCT CASE WHEN ar.status IN ('present', 'late', 'partial') THEN s.id END) as attended_sessions,
          SUM(CASE WHEN ar.status IN ('present', 'late', 'partial') THEN ar.net_minutes ELSE 0 END) as total_minutes,
          SUM(s.expected_minutes) as expected_minutes
        FROM sessions s
        LEFT JOIN attendance_records ar ON ar.session_id = s.id AND ar.canvas_user_id = $1
        WHERE s.course_id = $2
      )
      SELECT * FROM session_stats
    `;

    const statsResult = await pool.query(statsQuery, [canvasUserId, internalCourseId]);
    const stats = statsResult.rows[0];

    const sessionsQuery = `
      SELECT s.id, s.session_name, s.session_type, s.start_ts, s.end_ts, s.expected_minutes,
        ar.status, ar.present_from, ar.present_to, ar.net_minutes, ar.note
      FROM sessions s
      LEFT JOIN attendance_records ar ON ar.session_id = s.id AND ar.canvas_user_id = $1
      WHERE s.course_id = $2
      ORDER BY s.start_ts DESC
    `;

    const sessionsResult = await pool.query(sessionsQuery, [canvasUserId, internalCourseId]);

    console.log('✅ Statistiken geladen');

    res.json({
      success: true,
      stats: {
        totalSessions: parseInt(stats.total_sessions) || 0,
        attendedSessions: parseInt(stats.attended_sessions) || 0,
        totalMinutes: parseInt(stats.total_minutes) || 0,
        totalHours: ((parseInt(stats.total_minutes) || 0) / 60).toFixed(2),
        expectedMinutes: parseInt(stats.expected_minutes) || 0,
        attendanceRate: stats.total_sessions > 0 ? parseFloat(((stats.attended_sessions / stats.total_sessions) * 100).toFixed(1)) : 0,
        timeRate: stats.expected_minutes > 0 ? parseFloat(((stats.total_minutes / stats.expected_minutes) * 100).toFixed(1)) : 0
      },
      sessions: sessionsResult.rows
    });

  } catch (error) {
    console.error('Error fetching student stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================================
// BAFÖG PDF GENERATION
// ============================================================================

const PDFDocument = require('pdfkit');

router.get('/bafog-pdf/:courseId', requireAuth, async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.session.ltiClaims.userId;
    const userName = req.session.ltiClaims.userName;

    console.log('📄 Generiere BAföG-PDF für:', userName, 'Kurs:', courseId);

    // Hole canvas_user_id
    const userQuery = 'SELECT canvas_user_id FROM users WHERE canvas_user_id = $1';
    const userResult = await pool.query(userQuery, [userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).send('User nicht gefunden');
    }

    const canvasUserId = userResult.rows[0].canvas_user_id;

    // Hole Kurs-Info
    const courseQuery = 'SELECT id, course_name FROM courses WHERE canvas_course_id = $1';
    const courseResult = await pool.query(courseQuery, [courseId]);

    if (courseResult.rows.length === 0) {
      return res.status(404).send('Kurs nicht gefunden');
    }

    const course = courseResult.rows[0];

    // Hole alle Sessions mit Anwesenheit
    const sessionsQuery = `
      SELECT 
        s.session_name,
        s.session_type,
        s.start_ts,
        s.end_ts,
        s.expected_minutes,
        ar.status,
        ar.present_from,
        ar.present_to,
        ar.net_minutes,
        ar.note
      FROM sessions s
      LEFT JOIN attendance_records ar ON ar.session_id = s.id AND ar.canvas_user_id = $1
      WHERE s.course_id = $2
      ORDER BY s.start_ts ASC
    `;

    const sessionsResult = await pool.query(sessionsQuery, [canvasUserId, course.id]);

    // Berechne Statistiken
    let totalMinutes = 0;
    let attendedSessions = 0;
    let totalSessions = sessionsResult.rows.length;

    sessionsResult.rows.forEach(session => {
      if (session.status && ['present', 'late', 'partial'].includes(session.status)) {
        totalMinutes += parseInt(session.net_minutes) || 0;
        attendedSessions++;
      }
    });

    const totalHours = (totalMinutes / 60).toFixed(2);
    const attendanceRate = totalSessions > 0 
      ? ((attendedSessions / totalSessions) * 100).toFixed(1) 
      : 0;

    console.log('📊 Statistiken:', {
      totalHours,
      attendedSessions,
      totalSessions,
      attendanceRate
    });

    // Erstelle PDF
    const doc = new PDFDocument({
      size: 'A4',
      margin: 50,
      info: {
        Title: 'BAföG Anwesenheitsbescheinigung',
        Author: 'SK Attendance System',
        Subject: `Bescheinigung für ${userName}`,
        Creator: 'SK Attendance LTI Tool'
      }
    });

    // Stream direkt zum Client
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="BAföG-Bescheinigung-${userName.replace(/\s/g, '_')}.pdf"`);
    doc.pipe(res);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('Anwesenheitsbescheinigung', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica').text('für BAföG-Antrag', { align: 'center' });
    doc.moveDown(2);

    // Teilnehmer-Info
    doc.fontSize(12).font('Helvetica-Bold').text('Teilnehmer:');
    doc.fontSize(11).font('Helvetica').text(userName);
    doc.moveDown(1);

    // Kurs-Info
    doc.fontSize(12).font('Helvetica-Bold').text('Kurs:');
    doc.fontSize(11).font('Helvetica').text(course.course_name);
    doc.moveDown(1);

    // Zusammenfassung
    doc.fontSize(12).font('Helvetica-Bold').text('Zusammenfassung:');
    doc.fontSize(11).font('Helvetica')
      .text(`Gesamtstunden: ${totalHours}h`)
      .text(`Besuchte Sessions: ${attendedSessions} von ${totalSessions}`)
      .text(`Anwesenheitsquote: ${attendanceRate}%`);
    doc.moveDown(2);

    // Tabelle: Sessions
    doc.fontSize(12).font('Helvetica-Bold').text('Detaillierte Anwesenheitsliste:');
    doc.moveDown(0.5);

    // Tabellen-Header
    const tableTop = doc.y;
    const colDate = 50;
    const colSession = 130;
    const colStatus = 300;
    const colHours = 420;

    doc.fontSize(10).font('Helvetica-Bold');
    doc.text('Datum', colDate, tableTop);
    doc.text('Session', colSession, tableTop);
    doc.text('Status', colStatus, tableTop);
    doc.text('Stunden', colHours, tableTop);

    // Linie unter Header
    doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

    let yPosition = tableTop + 25;
    doc.fontSize(9).font('Helvetica');

    sessionsResult.rows.forEach(session => {
      // Neue Seite wenn nötig
      if (yPosition > 700) {
        doc.addPage();
        yPosition = 50;
      }

      const date = new Date(session.start_ts);
      const dateStr = date.toLocaleDateString('de-DE', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric' 
      });

      const status = session.status || 'nicht erfasst';
      const statusLabel = {
        present: 'Anwesend',
        late: 'Verspätet',
        partial: 'Teilweise',
        absent: 'Abwesend',
        excused: 'Entschuldigt',
        'nicht erfasst': 'Nicht erfasst'
      }[status];

      const hours = session.net_minutes 
        ? (session.net_minutes / 60).toFixed(2) + 'h'
        : '-';

      doc.text(dateStr, colDate, yPosition);
      doc.text(session.session_name.substring(0, 30), colSession, yPosition);
      doc.text(statusLabel, colStatus, yPosition);
      doc.text(hours, colHours, yPosition);

      yPosition += 20;
    });

    // Unterschrift/Bestätigung
    doc.moveDown(3);
    if (doc.y > 650) {
      doc.addPage();
    }

    doc.fontSize(10).font('Helvetica')
      .text('Diese Bescheinigung wurde automatisch erstellt am:', 50, doc.y);
    doc.font('Helvetica-Bold')
      .text(new Date().toLocaleDateString('de-DE', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }));

    doc.moveDown(2);
    doc.fontSize(9).font('Helvetica')
      .text('SK Attendance System - Integrity4Education GmbH', { align: 'center' });

    // Finalisiere PDF
    doc.end();

    console.log('✅ PDF generiert und gesendet');

  } catch (error) {
    console.error('❌ PDF Generation Error:', error);
    res.status(500).send('Fehler beim Generieren des PDFs: ' + error.message);
  }
});

// ============================================================================
// EXCEL/CSV EXPORT
// ============================================================================

const ExcelJS = require('exceljs');

router.get('/export/excel/:sessionId', requireAuth, requireInstructor, async (req, res) => {
  try {
    const { sessionId } = req.params;

    console.log('📊 Exportiere Excel für Session:', sessionId);

    // Hole Session-Info
    const sessionQuery = `
      SELECT s.*, c.course_name
      FROM sessions s
      JOIN courses c ON c.id = s.course_id
      WHERE s.id = $1
    `;
    const sessionResult = await pool.query(sessionQuery, [sessionId]);

    if (sessionResult.rows.length === 0) {
      return res.status(404).send('Session nicht gefunden');
    }

    const session = sessionResult.rows[0];

    // Hole alle Studenten mit Anwesenheit
    const attendanceQuery = `
      SELECT 
        u.name,
        u.email,
        ar.status,
        ar.present_from,
        ar.present_to,
        ar.minutes,
        ar.break_minutes,
        ar.net_minutes,
        ar.note
      FROM users u
      LEFT JOIN attendance_records ar ON ar.canvas_user_id = u.canvas_user_id AND ar.session_id = $1
      WHERE u.role = 'student' AND u.canvas_user_id NOT LIKE 'checkin_%'
      ORDER BY u.name
    `;
    const attendanceResult = await pool.query(attendanceQuery, [sessionId]);

    // Erstelle Excel Workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Anwesenheit');

    // Metadaten
    workbook.creator = 'SK Attendance System';
    workbook.created = new Date();

    // Header-Styling
    const headerStyle = {
      font: { bold: true, color: { argb: 'FFFFFFFF' } },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1e293b' } },
      alignment: { vertical: 'middle', horizontal: 'center' }
    };

    // Titel
    worksheet.mergeCells('A1:I1');
    worksheet.getCell('A1').value = 'Anwesenheitsliste';
    worksheet.getCell('A1').font = { bold: true, size: 16 };
    worksheet.getCell('A1').alignment = { horizontal: 'center' };

    // Session-Info
    worksheet.mergeCells('A2:I2');
    const sessionDate = new Date(session.start_ts);
    worksheet.getCell('A2').value = `${session.session_name} - ${session.course_name} - ${sessionDate.toLocaleDateString('de-DE')}`;
    worksheet.getCell('A2').alignment = { horizontal: 'center' };

    worksheet.addRow([]); // Leerzeile

    // Spalten-Header
    const headerRow = worksheet.addRow([
      'Name',
      'Email',
      'Status',
      'Von',
      'Bis',
      'Minuten',
      'Pause (Min)',
      'Netto (Min)',
      'Stunden',
      'Notizen'
    ]);

    headerRow.eachCell((cell) => {
      cell.style = headerStyle;
    });

    // Spaltenbreiten
    worksheet.columns = [
      { width: 25 }, // Name
      { width: 30 }, // Email
      { width: 15 }, // Status
      { width: 12 }, // Von
      { width: 12 }, // Bis
      { width: 12 }, // Minuten
      { width: 12 }, // Pause
      { width: 12 }, // Netto
      { width: 10 }, // Stunden
      { width: 40 }  // Notizen
    ];

    // Daten-Zeilen
    attendanceResult.rows.forEach(record => {
      const status = record.status || 'nicht erfasst';
      const statusLabel = {
        present: 'Anwesend',
        late: 'Verspätet',
        partial: 'Teilweise',
        absent: 'Abwesend',
        excused: 'Entschuldigt',
        'nicht erfasst': 'Nicht erfasst'
      }[status];

      const von = record.present_from 
        ? new Date(record.present_from).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
        : '-';

      const bis = record.present_to
        ? new Date(record.present_to).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
        : '-';

      const stunden = record.net_minutes 
        ? (record.net_minutes / 60).toFixed(2)
        : '-';

      const row = worksheet.addRow([
        record.name,
        record.email || '-',
        statusLabel,
        von,
        bis,
        record.minutes || '-',
        record.break_minutes || 0,
        record.net_minutes || '-',
        stunden,
        record.note || ''
      ]);

      // Farb-Codierung nach Status
      const statusColors = {
        'Anwesend': 'FFD1FAE5',
        'Verspätet': 'FFFEF3C7',
        'Teilweise': 'FFFCE7F3',
        'Abwesend': 'FFFEE2E2',
        'Entschuldigt': 'FFE0E7FF'
      };

      if (statusColors[statusLabel]) {
        row.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: statusColors[statusLabel] }
          };
        });
      }
    });

    // Zusammenfassung
    worksheet.addRow([]); // Leerzeile
    const summaryRow = worksheet.addRow(['Zusammenfassung:']);
    summaryRow.getCell(1).font = { bold: true };

    const totalStudents = attendanceResult.rows.length;
    const presentCount = attendanceResult.rows.filter(r => 
      r.status && ['present', 'late', 'partial'].includes(r.status)
    ).length;
    const totalMinutes = attendanceResult.rows.reduce((sum, r) => 
      sum + (parseInt(r.net_minutes) || 0), 0
    );
    const totalHours = (totalMinutes / 60).toFixed(2);

    worksheet.addRow(['Gesamt Studenten:', totalStudents]);
    worksheet.addRow(['Anwesend:', presentCount]);
    worksheet.addRow(['Gesamtstunden:', totalHours + 'h']);

    // Dateiname
    const filename = `Anwesenheit-${session.session_name.replace(/\s/g, '_')}-${sessionDate.toISOString().split('T')[0]}.xlsx`;

    // Sende Excel-Datei
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();

    console.log('✅ Excel-Export erfolgreich');

  } catch (error) {
    console.error('❌ Excel Export Error:', error);
    res.status(500).send('Fehler beim Exportieren: ' + error.message);
  }
});

// CSV Export (Alternative zu Excel)
router.get('/export/csv/:sessionId', requireAuth, requireInstructor, async (req, res) => {
  try {
    const { sessionId } = req.params;

    console.log('📊 Exportiere CSV für Session:', sessionId);

    const sessionQuery = `
      SELECT s.*, c.course_name
      FROM sessions s
      JOIN courses c ON c.id = s.course_id
      WHERE s.id = $1
    `;
    const sessionResult = await pool.query(sessionQuery, [sessionId]);

    if (sessionResult.rows.length === 0) {
      return res.status(404).send('Session nicht gefunden');
    }

    const session = sessionResult.rows[0];

    const attendanceQuery = `
      SELECT 
        u.name,
        u.email,
        ar.status,
        ar.present_from,
        ar.present_to,
        ar.net_minutes,
        ar.note
      FROM users u
      LEFT JOIN attendance_records ar ON ar.canvas_user_id = u.canvas_user_id AND ar.session_id = $1
      WHERE u.role = 'student' AND u.canvas_user_id NOT LIKE 'checkin_%'
      ORDER BY u.name
    `;
    const attendanceResult = await pool.query(attendanceQuery, [sessionId]);

    // CSV erstellen
    let csv = 'Name,Email,Status,Von,Bis,Stunden,Notizen\n';

    attendanceResult.rows.forEach(record => {
      const status = record.status || 'nicht erfasst';
      const statusLabel = {
        present: 'Anwesend',
        late: 'Verspätet',
        partial: 'Teilweise',
        absent: 'Abwesend',
        excused: 'Entschuldigt',
        'nicht erfasst': 'Nicht erfasst'
      }[status];

      const von = record.present_from 
        ? new Date(record.present_from).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
        : '-';

      const bis = record.present_to
        ? new Date(record.present_to).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
        : '-';

      const stunden = record.net_minutes 
        ? (record.net_minutes / 60).toFixed(2)
        : '-';

      const note = (record.note || '').replace(/"/g, '""'); // Escape quotes

      csv += `"${record.name}","${record.email || '-'}","${statusLabel}","${von}","${bis}","${stunden}","${note}"\n`;
    });

    const sessionDate = new Date(session.start_ts);
    const filename = `Anwesenheit-${session.session_name.replace(/\s/g, '_')}-${sessionDate.toISOString().split('T')[0]}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\ufeff' + csv); // BOM für Excel

    console.log('✅ CSV-Export erfolgreich');

  } catch (error) {
    console.error('❌ CSV Export Error:', error);
    res.status(500).send('Fehler beim Exportieren: ' + error.message);
  }
});

// ============================================================================
// ENTSCHULDIGUNGEN / EXCUSES
// ============================================================================

// POST /excuses/upload - Entschuldigung hochladen
router.post('/excuses/upload', requireAuth, upload.single('excuse'), async (req, res) => {
  try {
    const { sessionId } = req.body;
    const userId = req.session.ltiClaims.userId;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Keine Datei hochgeladen'
      });
    }

    console.log('📎 Entschuldigung hochgeladen:', req.file.filename, 'für Session:', sessionId);

    // Hole canvas_user_id
    const userQuery = 'SELECT canvas_user_id FROM users WHERE canvas_user_id = $1';
    const userResult = await pool.query(userQuery, [userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User nicht gefunden'
      });
    }

    const canvasUserId = userResult.rows[0].canvas_user_id;

    // Aktualisiere Anwesenheitseintrag mit Entschuldigung
    const updateQuery = `
      UPDATE attendance_records
      SET 
        status = 'excused',
        excuse_filename = $1,
        excuse_uploaded_at = NOW()
      WHERE session_id = $2 AND canvas_user_id = $3
      RETURNING *
    `;

    let result = await pool.query(updateQuery, [
      req.file.filename,
      sessionId,
      canvasUserId
    ]);

    // Falls noch kein Eintrag existiert, erstelle einen
    if (result.rows.length === 0) {
      const insertQuery = `
        INSERT INTO attendance_records (
          session_id,
          canvas_user_id,
          status,
          excuse_filename,
          excuse_uploaded_at,
          recorded_by
        )
        VALUES ($1, $2, 'excused', $3, NOW(), 'student')
        RETURNING *
      `;
      
      result = await pool.query(insertQuery, [
        sessionId,
        canvasUserId,
        req.file.filename
      ]);
    }

    console.log('✅ Entschuldigung gespeichert');

    res.json({
      success: true,
      message: 'Entschuldigung erfolgreich hochgeladen',
      filename: req.file.filename
    });

  } catch (error) {
    console.error('❌ Upload Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// GET /excuses/:filename - Entschuldigung anzeigen/herunterladen
router.get('/excuses/:filename', requireAuth, (req, res) => {
  try {
    const { filename } = req.params;
    const filepath = path.join(__dirname, '../public/uploads/excuses', filename);

    if (!fs.existsSync(filepath)) {
      return res.status(404).send('Datei nicht gefunden');
    }

    console.log('📄 Entschuldigung angezeigt:', filename);

    res.sendFile(filepath);

  } catch (error) {
    console.error('❌ File Error:', error);
    res.status(500).send('Fehler beim Laden der Datei');
  }
});

// ============================================================================
// KURS-ÜBERSICHT / AGGREGIERTE ANWESENHEIT
// ============================================================================

router.get('/course-overview/:courseId', requireAuth, requireInstructor, async (req, res) => {
  try {
    const { courseId } = req.params;

    console.log('📊 Lade Kurs-Übersicht für:', courseId);

// Hole oder erstelle Course
let courseQuery = 'SELECT id, course_name FROM courses WHERE canvas_course_id = $1';
let courseResult = await pool.query(courseQuery, [courseId]);

let course;
if (courseResult.rows.length === 0) {
  // Kurs existiert noch nicht - erstelle ihn
  const insertCourse = `
    INSERT INTO courses (canvas_course_id, course_name, created_at, updated_at)
    VALUES ($1, $2, NOW(), NOW())
    RETURNING id, course_name
  `;
  courseResult = await pool.query(insertCourse, [courseId, 'Kurs (wird beim nächsten Launch aktualisiert)']);
  course = courseResult.rows[0];
} else {
  course = courseResult.rows[0];
}

    // Hole alle Sessions des Kurses
    const sessionsQuery = `
      SELECT id, session_name, start_ts, expected_minutes
      FROM sessions
      WHERE course_id = $1
      ORDER BY start_ts ASC
    `;
    const sessionsResult = await pool.query(sessionsQuery, [course.id]);

// Hole ALLE Studenten (auch ohne Anwesenheit) - aber entferne Duplikate
const studentsQuery = `
  SELECT DISTINCT ON (u.canvas_user_id)
    u.id, 
    u.canvas_user_id, 
    u.name, 
    u.email
  FROM users u
  WHERE u.role = 'student' 
  AND u.canvas_user_id NOT LIKE 'checkin_%'
  ORDER BY u.canvas_user_id, u.created_at DESC
`;
const studentsResult = await pool.query(studentsQuery);

    // Hole alle Anwesenheitsdaten
    const attendanceQuery = `
      SELECT 
        ar.canvas_user_id,
        ar.session_id,
        ar.status,
        ar.net_minutes
      FROM attendance_records ar
      WHERE ar.session_id = ANY($1)
    `;
    const sessionIds = sessionsResult.rows.map(s => s.id);
    const attendanceResult = await pool.query(attendanceQuery, [sessionIds]);

    // Baue Attendance-Map
    const attendanceMap = {};
    attendanceResult.rows.forEach(record => {
      const key = `${record.canvas_user_id}_${record.session_id}`;
      attendanceMap[key] = record;
    });

    // Berechne Statistiken pro Student
    const studentsWithStats = studentsResult.rows.map(student => {
      let totalSessions = sessionsResult.rows.length;
      let attendedSessions = 0;
      let totalMinutes = 0;
      let expectedMinutes = 0;

      const sessionAttendance = sessionsResult.rows.map(session => {
        const key = `${student.canvas_user_id}_${session.id}`;
        const record = attendanceMap[key];
        
        expectedMinutes += session.expected_minutes;

        if (record && ['present', 'late', 'partial'].includes(record.status)) {
          attendedSessions++;
          totalMinutes += record.net_minutes || 0;
        }

        return {
          sessionId: session.id,
          status: record ? record.status : null,
          netMinutes: record ? record.net_minutes : null
        };
      });

      const attendanceRate = totalSessions > 0 
        ? ((attendedSessions / totalSessions) * 100).toFixed(1)
        : 0;

      const totalHours = (totalMinutes / 60).toFixed(2);

      return {
        ...student,
        sessionAttendance,
        stats: {
          totalSessions,
          attendedSessions,
          totalMinutes,
          totalHours,
          expectedMinutes,
          attendanceRate
        }
      };
    });

    console.log('✅ Kurs-Übersicht geladen:', studentsWithStats.length, 'Studenten');

    res.json({
      success: true,
      course: {
        id: course.id,
        name: course.course_name
      },
      sessions: sessionsResult.rows,
      students: studentsWithStats
    });

  } catch (error) {
    console.error('❌ Course Overview Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;