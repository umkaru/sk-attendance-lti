// routes/student-profile.js
// Student Self-Service Profil-Verwaltung für BAföG Daten

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: process.env.PG_PORT || 5432,
  database: process.env.PG_DATABASE || 'attendance',
  user: process.env.PG_USER || 'attendance_user',
  password: process.env.PG_PASSWORD
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

// GET /api/student/profile - Hole Profildaten
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.session.ltiClaims.userId;
    
    console.log('📋 Lade Profil für:', userId);
    
    const query = `
      SELECT 
        canvas_user_id,
        name,
        email,
        familienname,
        vorname,
        geburtsdatum,
        strasse,
        hausnummer,
        plz,
        wohnort
      FROM users 
      WHERE canvas_user_id = $1
    `;
    
    const result = await pool.query(query, [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'User nicht gefunden' 
      });
    }
    
    const profile = result.rows[0];
    
    // Formatiere Geburtsdatum für HTML input (YYYY-MM-DD)
    if (profile.geburtsdatum) {
      profile.geburtsdatum = new Date(profile.geburtsdatum).toISOString().split('T')[0];
    }
    
    console.log('✅ Profil geladen');
    
    res.json({
      success: true,
      profile
    });
    
  } catch (error) {
    console.error('❌ Profil Load Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// POST /api/student/profile - Update Profildaten
router.post('/profile', requireAuth, async (req, res) => {
  try {
    const userId = req.session.ltiClaims.userId;
    const {
      familienname,
      vorname,
      geburtsdatum,
      strasse,
      hausnummer,
      plz,
      wohnort
    } = req.body;
    
    console.log('💾 Speichere Profil für:', userId);
    
    // Validierung
    const errors = [];
    
    if (familienname && familienname.length > 100) {
      errors.push('Familienname zu lang (max. 100 Zeichen)');
    }
    
    if (vorname && vorname.length > 100) {
      errors.push('Vorname zu lang (max. 100 Zeichen)');
    }
    
    if (geburtsdatum) {
      const date = new Date(geburtsdatum);
      if (isNaN(date.getTime())) {
        errors.push('Ungültiges Geburtsdatum');
      }
      // Plausibilitätsprüfung: zwischen 1900 und heute
      const year = date.getFullYear();
      if (year < 1900 || year > new Date().getFullYear()) {
        errors.push('Geburtsdatum nicht plausibel');
      }
    }
    
    if (plz && !/^\d{5}$/.test(plz)) {
      errors.push('PLZ muss 5 Ziffern haben');
    }
    
    if (strasse && strasse.length > 100) {
      errors.push('Straße zu lang (max. 100 Zeichen)');
    }
    
    if (wohnort && wohnort.length > 100) {
      errors.push('Wohnort zu lang (max. 100 Zeichen)');
    }
    
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        errors
      });
    }
    
    // Update DB
    const updateQuery = `
      UPDATE users 
      SET 
        familienname = $1,
        vorname = $2,
        geburtsdatum = $3,
        strasse = $4,
        hausnummer = $5,
        plz = $6,
        wohnort = $7,
        updated_at = NOW()
      WHERE canvas_user_id = $8
      RETURNING *
    `;
    
    const result = await pool.query(updateQuery, [
      familienname || null,
      vorname || null,
      geburtsdatum || null,
      strasse || null,
      hausnummer || null,
      plz || null,
      wohnort || null,
      userId
    ]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User nicht gefunden'
      });
    }
    
    console.log('✅ Profil gespeichert');
    
    res.json({
      success: true,
      message: 'Profil erfolgreich gespeichert',
      profile: result.rows[0]
    });
    
  } catch (error) {
    console.error('❌ Profil Save Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
