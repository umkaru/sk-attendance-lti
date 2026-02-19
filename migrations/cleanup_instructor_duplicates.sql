-- cleanup_instructor_duplicates.sql
-- Removes duplicate instructor entries

\echo '========================================='
\echo 'Cleanup Instructor Duplicates'
\echo '========================================='

BEGIN;

\echo ''
\echo '👤 Cleaning Jens Neumann...'

-- Keep: jensa
-- Delete: $Person.sourcedId, UUID
DELETE FROM users 
WHERE canvas_user_id IN ('$Person.sourcedId', '104db362-b565-47f6-b3d9-486c64362023')
  AND role = 'instructor';

\echo '  ✅ Jens Neumann duplicates removed'

\echo ''
\echo '👤 Cleaning Miriam Frei...'

-- Keep: dozent01
-- Delete: SK_dozent-01, UUID
DELETE FROM users 
WHERE canvas_user_id IN ('SK_dozent-01', '5a873aaa-aae1-4dfc-a734-dd7f2f424117')
  AND role = 'instructor';

\echo '  ✅ Miriam Frei duplicates removed'

COMMIT;

\echo ''
\echo '========================================='
\echo '✅ Instructor Cleanup Complete!'
\echo '========================================='
\echo ''

SELECT canvas_user_id, name, role FROM users WHERE role = 'instructor' ORDER BY name;

\echo ''
\echo 'Should show:'
\echo '  - jensa (Jens Neumann)'
\echo '  - dozent01 (Miriam Frei)'
\echo '========================================='
