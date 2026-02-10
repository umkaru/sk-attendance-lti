// routes/sessions.js
// API-Endpoints für Session-Management

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD
});

// Middleware: Prüfe ob User eingeloggt ist
function requireAuth(req, res, next) {
  // Hole Session-ID aus Query oder Cookie
  const sessionId = req.query.sid || req.sessionID;
  
  console.log('🔐 Auth Check:', {
    querySessionId: req.query.sid,
    cookieSessionId: req.sessionID,
    usingSessionId: sessionId
  });
  
  // Lade Session manuell wenn aus Query
  if (req.query.sid && req.query.sid !== req.sessionID) {
    req.sessionStore.get(req.query.sid, (err, session) => {
      if (err || !session) {
        return res.status(401).json({ 
          error: 'Not authenticated',
          details: 'Session nicht gefunden'
        });
      }
      
      // Setze Session-Daten
      req.session.isAuthenticated = session.isAuthenticated;
      req.session.ltiClaims = session.ltiClaims;
      
      console.log('✅ Session aus Query geladen:', {
        isAuthenticated: req.session.isAuthenticated,
        hasClaims: !!req.session.ltiClaims
      });
      
      if (!req.session.isAuthenticated) {
        return res.status(401).json({ 
          error: 'Not authenticated',
          details: 'Bitte starte das Tool aus Canvas neu'
        });
      }
      
      next();
    });
  } else {
    if (!req.session.isAuthenticated) {
      return res.status(401).json({ 
        error: 'Not authenticated',
        details: 'Bitte starte das Tool aus Canvas neu'
      });
    }
    next();
  }
}

// Middleware: Prüfe ob User Instructor ist
function requireInstructor(req, res, next) {
  console.log('👨‍🏫 Instructor Check:', {
    hasClaims: !!req.session.ltiClaims,
    roles: req.session.ltiClaims?.roles
  });
  
  if (!req.session.ltiClaims) {
    return res.status(401).json({ 
      error: 'Not authenticated',
      details: 'LTI Claims fehlen'
    });
  }
  
  const isInstructor = req.session.ltiClaims.roles.some(r => 
    r.includes('Instructor') || r.includes('TeachingAssistant')
  );
  
  if (!isInstructor) {
    return res.status(403).json({ 
      error: 'Instructor access required',
      details: 'Diese Funktion ist nur für Dozenten verfügbar'
    });
  }
  
  next();
}

// ============================================================================
// SESSION ROUTES
// ============================================================================

// GET /api/sessions/:courseId - Alle Sessions für einen Kurs
router.get('/sessions/:courseId', requireAuth, async (req, res) => {
  try {
    const { courseId } = req.params;
    
    console.log('📚 Lade Sessions für Canvas Course:', courseId);
    
    // Hole interne Course ID
    const courseQuery = `
      SELECT id FROM courses WHERE canvas_course_id = $1
    `;
    const courseResult = await pool.query(courseQuery, [courseId]);
    
    if (courseResult.rows.length === 0) {
      // Kurs existiert noch nicht - erstelle ihn
      const createQuery = `
        INSERT INTO courses (canvas_course_id, created_at, updated_at)
        VALUES ($1, NOW(), NOW())
        RETURNING id
      `;
      const newCourse = await pool.query(createQuery, [courseId]);
      const internalCourseId = newCourse.rows[0].id;
      
      console.log('📚 Neuer Kurs erstellt:', internalCourseId);
      
      // Keine Sessions vorhanden
      return res.json({
        success: true,
        sessions: []
      });
    }
    
    const internalCourseId = courseResult.rows[0].id;
    
    const query = `
      SELECT 
        id,
        session_name,
        session_type,
        start_ts,
        end_ts,
        expected_minutes,
        is_online,
        meeting_url,
        location,
        is_mandatory
      FROM sessions
      WHERE course_id = $1
      ORDER BY start_ts DESC
    `;
    
    const result = await pool.query(query, [internalCourseId]);
    
    console.log(`✅ ${result.rows.length} Sessions gefunden`);
    
    res.json({
      success: true,
      sessions: result.rows
    });
    
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// POST /api/sessions - Neue Session erstellen
router.post('/sessions', requireAuth, requireInstructor, async (req, res) => {
  try {
    const {
      courseId,
      sessionName,
      sessionType,
      sessionDate,
      startTime,
      endTime,
      isOnline,
      meetingUrl,
      meetingPlatform,
      location,
      roomNumber,
      isMandatory,
      description
    } = req.body;

    // Validierung
    if (!courseId || !sessionName || !sessionDate || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields'
      });
    }

    // Kombiniere Datum + Zeit zu Timestamp
    const startTs = new Date(`${sessionDate}T${startTime}`);
    const endTs = new Date(`${sessionDate}T${endTime}`);
    
    // Berechne Dauer in Minuten
    const expectedMinutes = Math.round((endTs - startTs) / 1000 / 60);

// Erstelle Kurs-Eintrag falls nicht existiert und hole die ID
const courseQuery = `
  INSERT INTO courses (canvas_course_id, created_at, updated_at)
  VALUES ($1, NOW(), NOW())
  ON CONFLICT (canvas_course_id) 
  DO UPDATE SET updated_at = NOW()
  RETURNING id
`;
const courseResult = await pool.query(courseQuery, [courseId]);
const internalCourseId = courseResult.rows[0].id;

console.log('📚 Course ID:', { canvas: courseId, internal: internalCourseId });

// Erstelle Session
const query = `
  INSERT INTO sessions (
    course_id,
    session_name,
    session_type,
    start_ts,
    end_ts,
    expected_minutes,
    is_online,
    meeting_url,
    meeting_platform,
    location,
    room_number,
    is_mandatory,
    description,
    created_by
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
  RETURNING *
`;

const values = [
  internalCourseId, // Jetzt die interne ID verwenden
  sessionName,
  sessionType || 'regular',
  startTs,
  endTs,
  expectedMinutes,
  isOnline || false,
  meetingUrl || null,
  meetingPlatform || null,
  location || null,
  roomNumber || null,
  isMandatory !== false,
  description || null,
  req.session.ltiClaims.userId
];

    const result = await pool.query(query, values);

    res.json({
      success: true,
      session: result.rows[0],
      message: 'Session erfolgreich erstellt'
    });

  } catch (error) {
    console.error('Error creating session:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// DELETE /api/sessions/:sessionId - Session löschen
router.delete('/sessions/:sessionId', requireAuth, requireInstructor, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const query = 'DELETE FROM sessions WHERE id = $1 RETURNING id';
    const result = await pool.query(query, [sessionId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    res.json({
      success: true,
      message: 'Session gelöscht'
    });

  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// PUT /sessions/:id - Session aktualisieren
router.put('/sessions/:id', requireAuth, requireInstructor, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      session_name,
      session_type,
      start_ts,
      end_ts,
      is_online,
      meeting_url,
      meeting_platform,
      location,
      description,
      is_mandatory
    } = req.body;

    console.log('✏️ Aktualisiere Session:', id);

    // Berechne neue expected_minutes
    const startDate = new Date(start_ts);
    const endDate = new Date(end_ts);
    const expected_minutes = Math.round((endDate - startDate) / 1000 / 60);

    const updateQuery = `
      UPDATE sessions
      SET 
        session_name = $1,
        session_type = $2,
        start_ts = $3,
        end_ts = $4,
        expected_minutes = $5,
        is_online = $6,
        meeting_url = $7,
        meeting_platform = $8,
        location = $9,
        description = $10,
        is_mandatory = $11,
        updated_at = NOW()
      WHERE id = $12
      RETURNING *
    `;

    const result = await pool.query(updateQuery, [
      session_name,
      session_type,
      start_ts,
      end_ts,
      expected_minutes,
      is_online,
      meeting_url,
      meeting_platform,
      location,
      description,
      is_mandatory,
      id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Session nicht gefunden'
      });
    }

    console.log('✅ Session aktualisiert');

    res.json({
      success: true,
      session: result.rows[0]
    });

  } catch (error) {
    console.error('Error updating session:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;