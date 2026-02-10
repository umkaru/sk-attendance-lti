# Changelog

All notable changes to the SK Attendance LTI Tool will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Planned
- Canvas webhooks for real-time enrollment sync
- Email notifications for absence and excuse reminders
- Bulk operations (select multiple students)
- Attendance analytics dashboard with charts
- Multi-language support (English, Turkish, Arabic)
- Redis caching layer for performance
- TypeScript migration
- Comprehensive unit test suite

---

## [2.0.0] - 2026-02-09

### 🎉 Major Release - Production Ready

This release marks the tool as production-ready with comprehensive documentation, Canvas API integration, enhanced security, and critical bug fixes.

### Added
- **Canvas API Integration** - Automatic enrollment synchronization from Canvas
  - Syncs all active students when QR code is generated
  - Uses Canvas People API (`/api/v1/courses/{id}/enrollments`)
  - Supports courses with numeric course ID mapping
- **Whitelist-Based Check-In Security** - Only Canvas-enrolled students can check in via QR code
  - Prevents unauthorized attendance recording
  - Validates student enrollment before allowing check-in
  - Rejects non-registered users with clear error message
- **Individual Time Recording Modals** - Enhanced time tracking for late/partial attendance
  - Modal for "Verspätet angekommen" (Late Arrival) with time input
  - Modal for "Früher gegangen" (Early Departure) with time input
  - Automatic minute calculation based on session times
  - Optional notes field for documentation
- **Course Auto-Creation** - Courses automatically created on first LTI launch
  - Stores course name from Canvas context
  - Updates on subsequent launches
  - Handles missing course records gracefully
- **Comprehensive Documentation Suite**
  - `README.md` - Setup guide, features overview, quick start
  - `ARCHITECTURE.md` - Technical architecture, database schema, API docs
  - `DEPLOYMENT.md` - Production deployment guide with multiple hosting options
  - `TODO.md` - Future features, known issues, development roadmap
  - `.env.example` - Complete environment configuration template
  - `CHANGELOG.md` - Version history and changes (this file)
- **Multiple Deployment Options** - Documented in DEPLOYMENT.md
  - Cloudflare Named Tunnel setup
  - Traditional VPS deployment (DigitalOcean, Linode)
  - Heroku deployment
  - DigitalOcean App Platform
  - AWS Elastic Beanstalk
- **Enhanced Error Handling**
  - Better error messages for common issues
  - Improved LTI launch error handling
  - Database connection error recovery
  - Canvas API error handling with fallback
- **Mobile-Responsive Improvements**
  - Better QR code scanning on mobile devices
  - Improved form inputs for mobile
  - Touch-friendly buttons and controls

### Fixed
- **CRITICAL: Modal Type Mismatch Bug** - Modals for late/partial attendance were not appearing
  - Issue: Student IDs stored as strings but compared as numbers
  - Impact: "Verspätet angekommen" and "Früher gegangen" dropdowns did not trigger modals
  - Solution: Convert student IDs to strings before comparison in `handleStatusChange()`
  - Affected Code: `public/js/attendance.js`
- **Duplicate Students in Course Overview**
  - Issue: Students appeared multiple times when Canvas API IDs differed from LTI IDs
  - Solution: Use `DISTINCT ON (canvas_user_id)` in database queries
  - Added index for better performance
  - Known Limitation: Manual cleanup still required if duplicates already exist
- **Canvas Course ID Mapping**
  - Issue: Canvas API uses numeric course IDs, LTI uses hash-based IDs
  - Solution: Store both `canvas_course_id` (hash) and `canvas_course_numeric_id` (numeric)
  - Added database column migration
  - Auto-populate from Canvas custom claims when available
- **QR Code 404 Errors**
  - Issue: Canvas API enrollment sync returned 404 for missing numeric course ID
  - Solution: Query database for numeric ID before API call
  - Added helpful warning if numeric ID not found
  - Documented manual setup procedure
- **Trailing Slash in PUBLIC_URL**
  - Issue: Double slashes in redirect URIs caused "bad request" errors
  - Solution: Validate PUBLIC_URL has no trailing slash
  - Added warning in documentation
  - Updated configuration examples
- **Session Corruption on Launch Failure**
  - Issue: Failed LTI launches left corrupted session data
  - Solution: Clear session on launch error
  - Improved error page with instructions
- **Missing Course Names in Overview**
  - Issue: Course overview showed "null" as course name
  - Solution: Auto-create course record on first launch
  - Fallback to context label if course name not available

### Changed
- **Enrollment Sync Strategy** - Changed from manual to automatic
  - Previously: Instructor had to manually register students
  - Now: Automatic sync when QR code generated
  - Benefit: Always up-to-date student lists
- **Event Handler Strategy** - Changed from inline `onchange` to JavaScript event listeners
  - Previously: `<select onchange="attendanceManager.handleStatusChange(...)">`
  - Now: Event listeners attached after rendering with `addEventListener()`
  - Reason: Canvas CSP may block inline event handlers
  - Benefit: More reliable, easier to debug
- **Database Session Storage** - Improved session persistence
  - Previously: In-memory sessions (lost on restart)
  - Now: PostgreSQL session store with `connect-pg-simple`
  - Benefit: Sessions persist across server restarts
- **Environment Variable Structure** - Reorganized for clarity
  - Added extensive comments in `.env.example`
  - Grouped related settings
  - Added validation examples
  - Documented all optional settings
- **Error Logging** - Enhanced logging throughout application
  - Added emoji prefixes for quick visual scanning (✅ ❌ ⚠️ 🔄)
  - Structured log format for easier debugging
  - Include context in error messages (session ID, course ID, etc.)
  - Log API requests for troubleshooting

### Security
- **Whitelist-Based Check-In** - Major security improvement
  - Prevents "proxy attendance" by non-students
  - Validates against Canvas enrollment list
  - Only allows check-in for registered students
  - Logs rejected check-in attempts
- **Session ID CSRF Protection** - Enhanced security for API endpoints
  - All API calls require `sid` query parameter
  - Prevents CSRF attacks on attendance marking
  - Session ID cannot be guessed
- **SQL Injection Prevention** - All queries use parameterized statements
  - No string concatenation in SQL queries
  - User input always sanitized
  - Prepared statements throughout codebase
- **File Upload Validation** - Enhanced security for excuse uploads
  - Strict MIME type checking (PDF, JPEG, PNG only)
  - File size limits (5 MB default)
  - Unique filename generation with UUID
  - Directory traversal prevention

### Performance
- **Database Indexing** - Added critical indexes
  - `idx_users_canvas_id` - Fast user lookups
  - `idx_sessions_course` - Fast session queries
  - `idx_attendance_session` - Fast attendance loading
  - `idx_tokens_token` - Fast QR code validation
- **Connection Pooling** - Optimized PostgreSQL connections
  - Max 20 connections by default
  - Idle timeout: 30 seconds
  - Connection timeout: 2 seconds
  - Reuse existing connections
- **Enrollment Sync Optimization** - Single API request per course
  - Pagination support for large courses (>100 students)
  - Bulk insert/update for better performance
  - Only sync when QR code generated (not on every page load)

### Documentation
- **README.md** - 300+ lines
  - Quick start guide
  - Feature overview
  - Canvas Developer Key setup
  - Usage workflow for instructors and students
  - Troubleshooting section
- **ARCHITECTURE.md** - 800+ lines
  - System architecture diagram
  - Complete database schema with ERD
  - LTI 1.3 flow with sequence diagram
  - API endpoint documentation
  - Security implementation details
  - Performance considerations
- **DEPLOYMENT.md** - 600+ lines
  - Pre-deployment checklist
  - 5 hosting options with cost estimates
  - Cloudflare Tunnel setup (Named Tunnel)
  - Traditional VPS deployment (12-step guide)
  - SSL/HTTPS setup with Let's Encrypt
  - Monitoring and logging setup
  - Backup strategies
  - Troubleshooting guide
- **TODO.md** - 400+ lines
  - Priority features with effort estimates
  - Known issues with workarounds
  - Feature backlog
  - Technical debt documentation
  - Development roadmap (v2.1 - v3.0)
  - Contribution guidelines
- **.env.example** - 300+ lines
  - All configuration options documented
  - Extensive comments and examples
  - Security best practices
  - Default values specified
  - Development vs production settings

### Developer Experience
- **Comprehensive Code Comments** - Added detailed comments throughout codebase
- **Consistent Code Style** - Standardized formatting and naming conventions
- **Error Messages** - Improved error messages with actionable suggestions
- **Logging** - Structured logging with clear prefixes and context
- **Git Workflow** - Documented feature branch workflow in README

---

## [1.0.0] - 2026-02-02

### Initial Release - MVP

First working version with core attendance tracking functionality.

### Added
- LTI 1.3 integration with Canvas LMS
- PostgreSQL database with BAföG-compliant time tracking
- Session management (create, edit, delete)
- QR-code self-check-in system
- Manual attendance marking (present, absent, late, partial, excused)
- Student personal dashboard with statistics
- BAföG PDF certificate generation
- Excel and CSV export
- Course overview matrix
- Excuse file uploads
- Mobile-responsive CSS
- Basic error handling
- Session-based authentication
- Time-limited QR codes (15 minutes)

### Known Issues
- No automatic enrollment sync (manual registration required)
- Duplicate students possible in some scenarios
- Modals for late/partial attendance not working (type mismatch)
- Limited documentation
- No deployment guide
- Cloudflare tunnel URL changes on restart

---

## [0.5.0] - 2026-01-25

### Beta Release - Internal Testing

Limited release for internal testing with SK team.

### Added
- Basic LTI launch
- Simple attendance tracking
- QR code generation
- Student check-in form
- Database schema

### Known Issues
- Many bugs and incomplete features
- No production readiness
- Limited error handling

---

## Version History Summary

| Version | Date | Status | Description |
|---------|------|--------|-------------|
| **2.0.0** | 2026-02-09 | ✅ Stable | Production-ready with full docs |
| 1.0.0 | 2026-02-02 | ⚠️ Limited | Working MVP, limited docs |
| 0.5.0 | 2026-01-25 | ❌ Beta | Internal testing only |

---

## Migration Guides

### Migrating from 1.0.0 to 2.0.0

**Database Changes:**

```sql
-- Add numeric course ID column
ALTER TABLE courses 
ADD COLUMN IF NOT EXISTS canvas_course_numeric_id TEXT;

-- Update with your numeric course ID
UPDATE courses 
SET canvas_course_numeric_id = 'YOUR_NUMERIC_ID'
WHERE canvas_course_id = 'YOUR_HASH_ID';

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_canvas_id ON users(canvas_user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_course ON sessions(canvas_course_id);
CREATE INDEX IF NOT EXISTS idx_attendance_session ON attendance_records(session_id);
CREATE INDEX IF NOT EXISTS idx_tokens_token ON checkin_tokens(token);
```

**Environment Variables:**

Add to `.env`:
```bash
# Canvas API (new in 2.0.0)
CANVAS_API_TOKEN=your_canvas_admin_token
CANVAS_BASE_URL=https://your-canvas-instance.instructure.com

# Ensure PUBLIC_URL has NO trailing slash
PUBLIC_URL=https://your-domain.com  # ✅ Correct
# PUBLIC_URL=https://your-domain.com/  # ❌ Wrong
```

**Code Changes:**

If you modified `public/js/attendance.js`, ensure `handleStatusChange` uses string comparison:

```javascript
const studentIdStr = String(studentId);
const student = this.students.find(s => s.id === studentIdStr);
```

**Canvas Developer Key:**

Update all URLs to remove trailing slashes:
- Redirect URIs: `https://your-domain.com/lti/launch`
- Target Link URI: `https://your-domain.com/lti/launch`
- OpenID Connect Initiation URL: `https://your-domain.com/lti/login`
- JWK URL: `https://your-domain.com/lti/jwks`

---

## Upgrade Instructions

### From Any Version to Latest

```bash
# 1. Backup database
pg_dump -U attendance_user attendance > backup_$(date +%Y%m%d).sql

# 2. Pull latest code
git pull origin main

# 3. Install dependencies
npm install

# 4. Update .env (check .env.example for new variables)
cp .env .env.backup
# Manually merge new variables from .env.example

# 5. Run database migrations (if any)
psql -U attendance_user -d attendance -f migrations/2.0.0.sql

# 6. Restart application
pm2 restart sk-attendance

# 7. Test
curl https://your-domain.com/health
```

---

## Breaking Changes

### Version 2.0.0

1. **PUBLIC_URL Format Change**
   - **Before:** Accepted with or without trailing slash
   - **After:** Must NOT have trailing slash
   - **Action Required:** Update `.env` and Canvas Developer Key URLs

2. **Canvas API Token Required**
   - **Before:** Optional (enrollment sync not available)
   - **After:** Required for QR code enrollment sync
   - **Action Required:** Generate Canvas API token and add to `.env`

3. **Student ID Format**
   - **Before:** Mixed string/number handling
   - **After:** Always treated as strings
   - **Action Required:** No action needed (handled automatically)
   - **Impact:** Fixes modal functionality

4. **Database Schema Changes**
   - **Added:** `canvas_course_numeric_id` column to `courses` table
   - **Added:** Multiple indexes for performance
   - **Action Required:** Run migration SQL (see above)

---

## Support

- **Documentation:** README.md, ARCHITECTURE.md, DEPLOYMENT.md
- **Issues:** https://github.com/umkaru/sk-attendance-lti/issues
- **Email:** neumannsrb@gmail.com

---

## Contributors

- **Jens Neumann** - Project Lead & Development
- **Claude (Anthropic)** - Architecture, Implementation, Documentation

---

**Last Updated:** February 9, 2026  
**Current Version:** 2.0.0  
**License:** Proprietary (SK Internal Use)
