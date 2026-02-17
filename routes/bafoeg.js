// routes/bafoeg.js
// BAföG Formblatt F Generator - KOMPLETTE VERSION mit Canvas API Integration

const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { PDFDocument, StandardFonts, PDFName, PDFBool } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const pool = new Pool({
  host: process.env.PG_HOST || 'localhost',
  port: process.env.PG_PORT || 5432,
  database: process.env.PG_DATABASE || 'attendance',
  user: process.env.PG_USER || 'attendance_user',
  password: process.env.PG_PASSWORD
});

// Canvas API Helper: Hole Assignments und Submissions
async function getCanvasAssignments(courseId, canvasUserId) {
  try {
    const CANVAS_BASE_URL = process.env.CANVAS_BASE_URL || 'https://canvas.instructure.com';
    const CANVAS_API_TOKEN = process.env.CANVAS_API_TOKEN;

    if (!CANVAS_API_TOKEN) {
      console.warn('⚠️ CANVAS_API_TOKEN nicht konfiguriert - Leistungskontrollen = 0');
      return { totalAssignments: 0, completedAssignments: 0 };
    }

    // Extrahiere numerische Course ID aus Canvas Course ID
    // Format kann sein: "123" oder "48923~BuX9jS..." 
    const courseNumericId = courseId.includes('~') 
      ? courseId.split('~')[0] 
      : courseId;

    console.log('📚 Hole Canvas Assignments für Kurs:', courseNumericId);

    // 1. Hole alle Assignments des Kurses
    const assignmentsUrl = `${CANVAS_BASE_URL}/api/v1/courses/${courseNumericId}/assignments`;
    const assignmentsRes = await axios.get(assignmentsUrl, {
      headers: { 
        'Authorization': `Bearer ${CANVAS_API_TOKEN}`,
        'Accept': 'application/json'
      },
      params: {
        per_page: 100,  // Hole bis zu 100 Assignments
        include: ['submission']
      }
    });

    const assignments = assignmentsRes.data;
    
    // Filter nur graded Assignments (keine ungraded practice quizzes)
    const gradedAssignments = assignments.filter(a => 
      a.submission_types && 
      !a.submission_types.includes('not_graded') &&
      a.published
    );
    
    const totalAssignments = gradedAssignments.length;

    console.log(`✅ Gefunden: ${totalAssignments} bewertbare Assignments`);

    if (totalAssignments === 0) {
      return { totalAssignments: 0, completedAssignments: 0 };
    }

    // 2. Hole Submissions für diesen Student
    const submissionsUrl = `${CANVAS_BASE_URL}/api/v1/courses/${courseNumericId}/students/submissions`;
    const submissionsRes = await axios.get(submissionsUrl, {
      headers: { 
        'Authorization': `Bearer ${CANVAS_API_TOKEN}`,
        'Accept': 'application/json'
      },
      params: {
        student_ids: [canvasUserId],
        per_page: 100,
        include: ['assignment']
      }
    });

    const submissions = submissionsRes.data;

    // Zähle nur submitted oder graded Assignments
    // workflow_state kann sein: unsubmitted, submitted, graded, pending_review
    const completedAssignments = submissions.filter(sub => {
      const isCompleted = sub.workflow_state === 'submitted' || 
                         sub.workflow_state === 'graded' ||
                         sub.workflow_state === 'pending_review';
      
      // Prüfe auch ob Assignment in gradedAssignments ist
      const assignmentId = sub.assignment_id;
      const isGradedAssignment = gradedAssignments.some(a => a.id === assignmentId);
      
      return isCompleted && isGradedAssignment;
    }).length;

    console.log(`✅ Student hat ${completedAssignments} von ${totalAssignments} Assignments abgeschlossen`);

    return {
      totalAssignments,
      completedAssignments
    };

  } catch (error) {
    console.error('❌ Canvas API Error:', error.message);
    if (error.response) {
      console.error('Response Status:', error.response.status);
      console.error('Response Data:', JSON.stringify(error.response.data).substring(0, 200));
    }
    
    // Fallback zu 0/0
    return {
      totalAssignments: 0,
      completedAssignments: 0
    };
  }
}

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

// GET /api/bafoeg/formblatt-f/:courseId - Generate Formblatt F PDF
router.get('/formblatt-f/:courseId', requireAuth, async (req, res) => {
  try {
    const { courseId } = req.params;
    const userId = req.session.ltiClaims.userId;
    const userName = req.session.ltiClaims.userName || 'Student';

    console.log('📄 Generiere BAföG Formblatt F für:', userName, 'Kurs:', courseId);

    // Hole canvas_user_id UND Personendaten
    const userQuery = `
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
    const userResult = await pool.query(userQuery, [userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).send('User nicht gefunden');
    }

    const student = userResult.rows[0];
    const canvasUserId = student.canvas_user_id;

    // Prepare personal data for PDF
    const personData = {
      familienname: student.familienname || student.name.split(' ').pop() || '',
      vorname: student.vorname || student.name.split(' ').slice(0, -1).join(' ') || '',
      geburtsdatum: student.geburtsdatum 
        ? new Date(student.geburtsdatum).toLocaleDateString('de-DE', { 
            day: '2-digit', 
            month: '2-digit', 
            year: '2-digit' 
          }) 
        : '',
      strasse: student.strasse || '',
      hausnummer: student.hausnummer || '',
      plz: student.plz || '',
      wohnort: student.wohnort || ''
    };

    console.log('👤 Personendaten:', personData);

    // Hole Kurs-Info
    const courseQuery = 'SELECT id, course_name, canvas_course_numeric_id FROM courses WHERE canvas_course_id = $1';
    const courseResult = await pool.query(courseQuery, [courseId]);

    if (courseResult.rows.length === 0) {
      return res.status(404).send('Kurs nicht gefunden');
    }

    const course = courseResult.rows[0];

    // Hole Kurs-Startdatum (erste Session)
    const startDateQuery = `
      SELECT MIN(start_ts) as start_date
      FROM sessions
      WHERE course_id = $1
    `;
    const startDateResult = await pool.query(startDateQuery, [course.id]);
    const courseStartDate = startDateResult.rows[0]?.start_date;

    if (!courseStartDate) {
      return res.status(404).send('Keine Sessions gefunden');
    }

    // Hole alle Sessions mit Anwesenheit
    const sessionsQuery = `
      SELECT 
        s.id,
        s.session_name,
        s.start_ts,
        s.end_ts,
        s.planned_break_minutes,
        s.expected_minutes,
        ar.status,
        ar.net_minutes,
        ar.present_from,
        ar.present_to
      FROM sessions s
      LEFT JOIN attendance_records ar ON ar.session_id = s.id AND ar.canvas_user_id = $1
      WHERE s.course_id = $2
      ORDER BY s.start_ts ASC
    `;

    const sessionsResult = await pool.query(sessionsQuery, [canvasUserId, course.id]);

    // Berechne Statistiken
    let totalMinutesAttended = 0;  // IST-Minuten (60 Min)
    let totalMinutesRequired = 0;   // SOLL-Minuten (60 Min)
    let attendedSessions = 0;
    let totalSessions = sessionsResult.rows.length;

    sessionsResult.rows.forEach(session => {
      totalMinutesRequired += session.expected_minutes || 0;
      
      if (session.status && ['present', 'late', 'partial'].includes(session.status)) {
        totalMinutesAttended += session.net_minutes || 0;
        attendedSessions++;
      }
    });

    // Umrechnung: 60 Min → 45 Min Unterrichtsstunden
    const hoursAttended45 = Math.round((totalMinutesAttended / 45) * 10) / 10;
    const hoursRequired45 = Math.round((totalMinutesRequired / 45) * 10) / 10;

    // Anwesenheitsquote berechnen
    const attendanceRate = totalSessions > 0 
      ? Math.round((attendedSessions / totalSessions) * 100)
      : 0;

    // NEU: Hole Canvas Assignments
console.log('📚 Hole Leistungskontrollen aus Canvas...');

// Verwende numerische Course ID wie bei syncCourseEnrollments
const numericCourseId = course.canvas_course_numeric_id;

if (!numericCourseId) {
  console.warn('⚠️ Numerische Course ID nicht in DB - Leistungskontrollen = 0');
  console.warn('💡 Tipp: UPDATE courses SET canvas_course_numeric_id = \'DEINE_ID\' WHERE canvas_course_id = \'' + courseId + '\';');
  // Fallback zu 0/0
  var assignments = { totalAssignments: 0, completedAssignments: 0 };
} else {
  console.log('📋 Nutze numerische Course ID für Canvas API:', numericCourseId);
  var assignments = await getCanvasAssignments(numericCourseId, canvasUserId);
}

    console.log('📊 Statistiken:', {
      totalSessions,
      attendedSessions,
      attendanceRate: attendanceRate + '%',
      minutesAttended60: totalMinutesAttended,
      minutesRequired60: totalMinutesRequired,
      hoursAttended45: hoursAttended45,
      hoursRequired45: hoursRequired45,
      assignmentsTotal: assignments.totalAssignments,
      assignmentsCompleted: assignments.completedAssignments
    });

    // Lade Formblatt F Template
    const templatePath = path.join(__dirname, '../assets/formblatt_f.pdf');
    
    if (!fs.existsSync(templatePath)) {
      return res.status(500).send('Formblatt F Template nicht gefunden. Bitte platziere formblatt_f.pdf in ./assets/');
    }

    const existingPdfBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const form = pdfDoc.getForm();

    // Embed Standard Font (WICHTIG für Formularfelder!)
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    console.log('📋 PDF geladen, Felder:', form.getFields().length);

    try {
      // Zeile 14: Zeitraum
      const today = new Date();
      const startDateStr = new Date(courseStartDate).toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit'
      });
      const endDateStr = today.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit'
      });

      // Mapping: Feldnummer → Wert
      const fieldMappings = {
        // Zeile 1: Personendaten
        '2': personData.familienname,      // Familienname
        '4': personData.vorname,           // Vorname(n)
        '5': personData.geburtsdatum,      // Geburtsdatum
        
        // Zeile 2: Adresse
        '6': personData.strasse,           // Straße
        '7': personData.hausnummer,        // Hausnummer
        
        // Zeile 3: Ort
        '9': personData.plz,               // Postleitzahl
        '10': personData.wohnort,          // Wohnort
        
        // Zeile 4: Fortbildungsstätte
        '11': 'Akademie Schneller Karriere GmbH, Porschering 14, 71404 Korb, 07151 – 1690656, service@schneller-karriere.de',
        
        // Zeile 6: Bezeichnung der Maßnahme
        '14': course.course_name,          // Kursname
        
        // Zeile 14: Zeitraum
        '12': startDateStr,                // von (Datum)
        '13': endDateStr,                  // bis (Datum)
        
        // Zeile 14/15: Präsenzstunden (erste Position)
        '15': hoursRequired45.toString(),  // Anzahl Präsenzstunden (SOLL)
        '16': hoursAttended45.toString(),  // davon teilgenommen (IST)
        
        // Zeile 14-15: Fernunterricht/Mediengestützter Unterricht
        '49': startDateStr,                            // von (Datum)
        '50': endDateStr,                              // bis (Datum)
        '51': course.course_name,                      // Bezeichnung des Fernlehrgangs
        '52': hoursRequired45.toString(),              // Präsenzstunden gesamt (SOLL)
        '53': hoursAttended45.toString(),              // Präsenzstunden teilgenommen (IST)
        '54': assignments.totalAssignments.toString(), // Leistungskontrollen gesamt (SOLL)
        '55': assignments.completedAssignments.toString() // Leistungskontrollen absolviert (IST)
      };

      console.log('📋 Fülle PDF Felder:', Object.keys(fieldMappings).length, 'Felder');

      // NeedAppearances setzen - damit PDF die Felder selbst rendert
      form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True);

      let fieldsSet = 0;
      
      for (const [fieldName, value] of Object.entries(fieldMappings)) {
        try {
          const field = form.getTextField(fieldName);
          field.setText(value || '');
          fieldsSet++;
          console.log(`✅ Feld "${fieldName}" gesetzt: "${value}"`);
        } catch (e) {
          console.log(`⚠️ Feld "${fieldName}": ${e.message}`);
        }
      }

      console.log(`✅ ${fieldsSet} von ${Object.keys(fieldMappings).length} Feldern erfolgreich ausgefüllt`);

      if (fieldsSet === 0) {
        console.warn('⚠️ WARNUNG: Keine Felder konnten ausgefüllt werden!');
      }

    } catch (fieldError) {
      console.warn('⚠️ Fehler beim Ausfüllen:', fieldError.message);
      console.error(fieldError.stack);
    }

    // Flatten form (macht Felder nicht mehr editierbar)
    form.flatten();

    // Speichere PDF
    const pdfBytes = await pdfDoc.save();

    // Dateiname
    const filename = `BAföG-Formblatt-F-${student.name.replace(/\s/g, '_')}-${new Date().toISOString().split('T')[0]}.pdf`;

    // Sende an Client
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(Buffer.from(pdfBytes));

    console.log('✅ Formblatt F generiert und gesendet');

  } catch (error) {
    console.error('❌ Formblatt F Error:', error);
    res.status(500).send('Fehler beim Generieren des Formblatts F: ' + error.message);
  }
});

// Exportiere Router
module.exports = router;
