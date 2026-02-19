-- cleanup_duplicate_students_v2.sql
-- Fixes duplicate student entries with conflict resolution
-- Run with: psql -U attendance_user -d attendance -f cleanup_duplicate_students_v2.sql

\echo '========================================='
\echo 'SK Attendance - Duplicate Students Cleanup v2'
\echo '========================================='
\echo ''

-- Show current state
\echo '📊 VORHER - Aktuelle Studenten:'
SELECT 
  canvas_user_id, 
  name,
  COUNT(*) OVER (PARTITION BY name) as duplicates
FROM users
WHERE role = 'student'
ORDER BY name, created_at DESC;

\echo ''
\echo '========================================='
\echo '🔧 STARTE CLEANUP MIT CONFLICT RESOLUTION...'
\echo '========================================='

BEGIN;

-- STRATEGIE:
-- 1. Lösche attendance_records für alte IDs die KONFLIKTIEREN
-- 2. UPDATE attendance_records für alte IDs die NICHT konfliktieren
-- 3. Lösche alte User Einträge

-- ============================================
-- 1. ALINA VOGT
-- ============================================
\echo ''
\echo '👤 Verarbeite Alina Vogt...'

-- Finde konfliktieren Records (gleiche Session, verschiedene IDs)
\echo '  🔍 Suche Konflikte...'

WITH conflicts AS (
  SELECT 
    ar1.id as old_id,
    ar1.canvas_user_id as old_user_id,
    ar2.id as new_id,
    ar2.canvas_user_id as new_user_id,
    ar1.session_id
  FROM attendance_records ar1
  JOIN attendance_records ar2 ON ar1.session_id = ar2.session_id
  WHERE ar1.canvas_user_id IN ('c6403cb2-51df-4cb3-b1cc-e987356a0210', 'SK_lerner03')
    AND ar2.canvas_user_id = 'lerner03'
)
DELETE FROM attendance_records
WHERE id IN (SELECT old_id FROM conflicts);

\echo '  ✅ Konfliktieren Records gelöscht'

-- Update nicht-konfligierende Records
UPDATE attendance_records 
SET canvas_user_id = 'lerner03' 
WHERE canvas_user_id IN ('c6403cb2-51df-4cb3-b1cc-e987356a0210', 'SK_lerner03')
  AND NOT EXISTS (
    SELECT 1 FROM attendance_records ar2 
    WHERE ar2.session_id = attendance_records.session_id 
    AND ar2.canvas_user_id = 'lerner03'
  );

\echo '  ✅ Attendance Records zusammengeführt'

-- Delete duplicate users
DELETE FROM users 
WHERE canvas_user_id IN ('c6403cb2-51df-4cb3-b1cc-e987356a0210', 'SK_lerner03');

\echo '  ✅ Duplikate gelöscht'

-- ============================================
-- 2. GIULIA BIANCHI
-- ============================================
\echo ''
\echo '👤 Verarbeite Giulia Bianchi...'

-- Lösche konfliktieren Records
WITH conflicts AS (
  SELECT 
    ar1.id as old_id
  FROM attendance_records ar1
  JOIN attendance_records ar2 ON ar1.session_id = ar2.session_id
  WHERE ar1.canvas_user_id IN ('a451c830-cee9-47b8-9327-ec4df617a15f', 'SK_lerner01')
    AND ar2.canvas_user_id = 'lerner01'
)
DELETE FROM attendance_records
WHERE id IN (SELECT old_id FROM conflicts);

\echo '  ✅ Konfliktieren Records gelöscht'

-- Update nicht-konfligierende Records
UPDATE attendance_records 
SET canvas_user_id = 'lerner01' 
WHERE canvas_user_id IN ('a451c830-cee9-47b8-9327-ec4df617a15f', 'SK_lerner01')
  AND NOT EXISTS (
    SELECT 1 FROM attendance_records ar2 
    WHERE ar2.session_id = attendance_records.session_id 
    AND ar2.canvas_user_id = 'lerner01'
  );

\echo '  ✅ Attendance Records zusammengeführt'

-- Delete duplicate users
DELETE FROM users 
WHERE canvas_user_id IN ('a451c830-cee9-47b8-9327-ec4df617a15f', 'SK_lerner01');

\echo '  ✅ Duplikate gelöscht'

-- ============================================
-- 3. SAMUEL BRUNNER
-- ============================================
\echo ''
\echo '👤 Verarbeite Samuel Brunner...'

-- Lösche konfliktieren Records
WITH conflicts AS (
  SELECT 
    ar1.id as old_id
  FROM attendance_records ar1
  JOIN attendance_records ar2 ON ar1.session_id = ar2.session_id
  WHERE ar1.canvas_user_id IN ('8cbff058-2fa1-41f8-8156-1d0e04410c9e', 'SK_lerner02')
    AND ar2.canvas_user_id = 'lerner02'
)
DELETE FROM attendance_records
WHERE id IN (SELECT old_id FROM conflicts);

\echo '  ✅ Konfliktieren Records gelöscht'

-- Update nicht-konfligierende Records
UPDATE attendance_records 
SET canvas_user_id = 'lerner02' 
WHERE canvas_user_id IN ('8cbff058-2fa1-41f8-8156-1d0e04410c9e', 'SK_lerner02')
  AND NOT EXISTS (
    SELECT 1 FROM attendance_records ar2 
    WHERE ar2.session_id = attendance_records.session_id 
    AND ar2.canvas_user_id = 'lerner02'
  );

\echo '  ✅ Attendance Records zusammengeführt'

-- Delete duplicate users
DELETE FROM users 
WHERE canvas_user_id IN ('8cbff058-2fa1-41f8-8156-1d0e04410c9e', 'SK_lerner02');

\echo '  ✅ Duplikate gelöscht'

-- ============================================
-- 4. REMOVE NON-ENROLLED STUDENTS
-- ============================================
\echo ''
\echo '🗑️  Entferne nicht-enrollierte Studenten...'

DELETE FROM attendance_records WHERE canvas_user_id IN ('lerner04', 'lerner05');
DELETE FROM users WHERE canvas_user_id IN ('lerner04', 'lerner05');

\echo '  ✅ lerner04 und lerner05 entfernt'

COMMIT;

\echo ''
\echo '========================================='
\echo '✅ CLEANUP ERFOLGREICH ABGESCHLOSSEN!'
\echo '========================================='

\echo ''
\echo '📊 NACHHER - Verbleibende Studenten:'
SELECT 
  canvas_user_id, 
  name,
  email,
  created_at
FROM users
WHERE role = 'student'
ORDER BY name;

\echo ''
\echo '📊 NACHHER - Anzahl Studenten:'
SELECT COUNT(*) as total_students FROM users WHERE role = 'student';

\echo ''
\echo '📊 Attendance Records pro Student:'
SELECT 
  u.name,
  u.canvas_user_id,
  COUNT(ar.id) as attendance_count
FROM users u
LEFT JOIN attendance_records ar ON u.canvas_user_id = ar.canvas_user_id
WHERE u.role = 'student'
GROUP BY u.name, u.canvas_user_id
ORDER BY u.name;

\echo ''
\echo '========================================='
\echo '✅ CLEANUP KOMPLETT!'
\echo '========================================='
\echo ''
\echo '📋 Nächster Schritt:'
\echo '   Fix LTI Launch in server-simplified.js'
\echo '   um zukünftige Duplikate zu vermeiden'
\echo '========================================='
