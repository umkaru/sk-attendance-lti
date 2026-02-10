# TODO & Roadmap

**SK Attendance LTI Tool - Future Features & Known Issues**

This document tracks planned features, improvements, known issues, and the development roadmap for the SK Attendance tool.

---

## 📋 Table of Contents

- [Priority Features](#priority-features)
- [Known Issues](#known-issues)
- [Feature Backlog](#feature-backlog)
- [Technical Debt](#technical-debt)
- [Performance Improvements](#performance-improvements)
- [Security Enhancements](#security-enhancements)
- [UI/UX Improvements](#uiux-improvements)
- [Integration Ideas](#integration-ideas)
- [Development Roadmap](#development-roadmap)

---

## 🔥 Priority Features

### 1. Canvas Webhooks for Real-Time Enrollment Sync

**Status:** Planned  
**Priority:** High  
**Complexity:** Medium  
**Estimated Effort:** 2-3 days

**Current Problem:**
- Enrollment sync only happens when instructor generates QR code
- No automatic updates when students are added/removed from Canvas course
- Potential for outdated student lists

**Solution:**
Subscribe to Canvas webhooks for real-time enrollment updates.

**Implementation:**

```javascript
// Webhook endpoint
app.post('/webhooks/canvas/enrollment', async (req, res) => {
  const event = req.body;
  
  if (event.type === 'enrollment.created') {
    await addStudentToDatabase(event.data.user);
  } else if (event.type === 'enrollment.deleted') {
    await removeStudentFromDatabase(event.data.user);
  }
  
  res.status(200).send('OK');
});
```

**Setup Required:**
1. Canvas Admin → Developer Keys → Enable webhook subscriptions
2. Configure webhook URL: `https://your-domain.com/webhooks/canvas/enrollment`
3. Subscribe to events: `enrollment.created`, `enrollment.deleted`, `enrollment.updated`

**Benefits:**
- ✅ Always up-to-date student lists
- ✅ No manual sync needed
- ✅ Better user experience

---

### 2. Email Notifications

**Status:** Planned  
**Priority:** High  
**Complexity:** Medium  
**Estimated Effort:** 2 days

**Use Cases:**
- Notify students when marked absent
- Remind students to upload excuses
- Notify instructor when excuse uploaded
- Weekly attendance summary emails

**Implementation Stack:**
- **SendGrid** (free tier: 100 emails/day)
- **Mailgun** (free tier: 5000 emails/month)
- **AWS SES** (pay-as-you-go)

**Example:**

```javascript
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

async function notifyAbsence(student, session) {
  const msg = {
    to: student.email,
    from: 'attendance@sk-karriere.de',
    subject: 'Abwesenheit verzeichnet - Entschuldigung erforderlich',
    html: `
      <h2>Abwesenheit in ${session.name}</h2>
      <p>Hallo ${student.name},</p>
      <p>Du wurdest als abwesend markiert am ${session.date}.</p>
      <p>Bitte lade eine Entschuldigung hoch.</p>
      <a href="https://attendance.sk.de/upload-excuse?session=${session.id}">
        Entschuldigung hochladen
      </a>
    `
  };
  
  await sgMail.send(msg);
}
```

**Configuration:**

```env
# .env
SENDGRID_API_KEY=your_api_key
EMAIL_FROM=attendance@sk-karriere.de
ENABLE_EMAIL_NOTIFICATIONS=true
```

---

### 3. Bulk Operations

**Status:** Planned  
**Priority:** Medium  
**Complexity:** Low  
**Estimated Effort:** 1 day

**Features:**
- Select multiple students (checkboxes)
- Bulk mark as present/absent/excused
- Bulk delete attendance records
- Bulk export selected students

**UI Mockup:**

```
[✓] Alina Vogt          Present    7.50h
[✓] Giulia Bianchi      Absent     -h
[ ] Larissa Huber       Late       6.25h

Actions: [Mark as Present ▼] [Export Selected] [Delete]
```

**Implementation:**

```javascript
// API endpoint
app.post('/api/attendance/bulk-update', requireAuth, async (req, res) => {
  const { studentIds, status, sessionId } = req.body;
  
  for (const studentId of studentIds) {
    await markAttendance(sessionId, studentId, status);
  }
  
  res.json({ success: true, updated: studentIds.length });
});
```

---

### 4. Attendance Reports & Analytics

**Status:** Planned  
**Priority:** Medium  
**Complexity:** Medium  
**Estimated Effort:** 3 days

**Features:**
- **Graphs & Charts:** Attendance trends over time
- **Comparison:** Compare courses, cohorts, time periods
- **Risk Analysis:** Identify students at risk of failing attendance requirements
- **Export:** PDF reports with visualizations

**Visualizations:**
- Line chart: Attendance rate over semester
- Bar chart: Individual student attendance
- Pie chart: Status distribution (present/absent/late/excused)
- Heat map: Which days have lowest attendance

**Technology:**
- **Chart.js** for frontend charts
- **PDFKit** for report generation
- **PostgreSQL aggregate queries** for data

**Example Query:**

```sql
-- Attendance trend by week
SELECT 
  DATE_TRUNC('week', session_date) as week,
  COUNT(DISTINCT ar.user_id) FILTER (WHERE ar.status IN ('present', 'late', 'partial')) as present_count,
  COUNT(DISTINCT u.id) as total_students,
  ROUND(COUNT(DISTINCT ar.user_id) FILTER (WHERE ar.status IN ('present', 'late', 'partial'))::numeric / 
        COUNT(DISTINCT u.id) * 100, 2) as attendance_rate
FROM sessions s
LEFT JOIN attendance_records ar ON ar.session_id = s.id
CROSS JOIN (SELECT id FROM users WHERE role = 'student') u
WHERE s.canvas_course_id = 'course-id'
GROUP BY week
ORDER BY week;
```

---

## 🐛 Known Issues

### 1. Modal Type Mismatch Bug (FIXED)

**Status:** ✅ Fixed  
**Priority:** Critical  
**Fixed In:** 2.0.0  

**Problem:** Student IDs stored as strings, but JavaScript parsed as numbers, causing modals not to appear.

**Solution:** Convert student IDs to strings before comparison.

```javascript
const studentIdStr = String(studentId);
const student = this.students.find(s => s.id === studentIdStr);
```

---

### 2. Duplicate Students in Course Overview

**Status:** ⚠️ Partially Fixed  
**Priority:** Medium  
**Workaround Available:** Yes

**Problem:** When Canvas API user IDs differ from LTI user IDs, students appear twice.

**Current Workaround:**
```sql
-- Use DISTINCT ON to show only one entry per user
SELECT DISTINCT ON (u.canvas_user_id) ...
```

**Proper Solution (TODO):**
- Map Canvas API numeric IDs to LTI UUIDs
- Store both IDs in users table
- Use consistent ID for lookups

**Implementation:**

```sql
ALTER TABLE users ADD COLUMN canvas_user_numeric_id TEXT;
CREATE INDEX idx_users_numeric_id ON users(canvas_user_numeric_id);
```

---

### 3. QR Code URL Changes Break Old Codes

**Status:** Known Limitation  
**Priority:** Low  
**Impact:** Development only

**Problem:** When using `trycloudflare.com`, URL changes on each restart, invalidating old QR codes.

**Solution:** Use Named Cloudflare Tunnel or permanent domain.

**Status:** Documented in DEPLOYMENT.md

---

### 4. File Upload Progress Indicator Missing

**Status:** Open  
**Priority:** Low  
**Complexity:** Low

**Problem:** No visual feedback during file uploads (especially large PDFs).

**Solution:** Add progress bar using XHR/fetch progress events.

**Example:**

```javascript
async function uploadExcuse(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percentComplete = (e.loaded / e.total) * 100;
        updateProgressBar(percentComplete);
      }
    });
    
    xhr.addEventListener('load', () => {
      resolve(JSON.parse(xhr.responseText));
    });
    
    xhr.open('POST', '/api/excuses/upload');
    xhr.send(formData);
  });
}
```

---

### 5. Session Expiration Not User-Friendly

**Status:** Open  
**Priority:** Low  
**Complexity:** Low

**Problem:** When LTI session expires (after 24h), user gets confusing error instead of re-launch prompt.

**Solution:** Detect expired session and show user-friendly message with re-launch button.

```javascript
// Frontend
if (error.status === 401 && error.message.includes('Session expired')) {
  showModal({
    title: 'Sitzung abgelaufen',
    message: 'Deine Sitzung ist abgelaufen. Bitte öffne das Tool erneut aus Canvas.',
    actions: [
      { text: 'OK', action: () => window.parent.location.reload() }
    ]
  });
}
```

---

## 📦 Feature Backlog

### User Management

**Priority:** Low  
**Effort:** Medium

**Features:**
- Manual student registration (for non-Canvas users)
- Guest instructors / co-teachers
- Student groups / cohorts
- Transfer students between courses

---

### Advanced Time Tracking

**Priority:** Medium  
**Effort:** Medium

**Features:**
- **Break tracking:** Multiple breaks per session
- **Overtime:** Track hours beyond scheduled time
- **Time adjustments:** Instructor can manually adjust times
- **Rounding rules:** Round to nearest 15 minutes (configurable)

**Example Schema:**

```sql
CREATE TABLE breaks (
  id SERIAL PRIMARY KEY,
  attendance_record_id INTEGER REFERENCES attendance_records(id),
  break_start TIMESTAMP NOT NULL,
  break_end TIMESTAMP NOT NULL,
  minutes INTEGER NOT NULL
);
```

---

### Geofencing / Location Verification

**Priority:** Low (Privacy concerns)  
**Effort:** High

**Feature:** Verify students are physically on campus when checking in.

**Implementation:**
- Use browser Geolocation API
- Define allowed coordinates (campus boundaries)
- Validate distance from campus center

**Privacy Considerations:**
- ⚠️ Requires user consent
- ⚠️ GDPR compliance needed
- ⚠️ May exclude legitimate remote students

**Recommendation:** Only enable if explicitly required by institution.

---

### Multi-Language Support (i18n)

**Priority:** Medium  
**Effort:** High

**Current:** German only  
**Target:** German, English, (Turkish, Arabic)

**Implementation:**
- Use `i18next` library
- Extract all strings to translation files
- Add language selector in UI

**Example:**

```javascript
// translations/de.json
{
  "attendance.mark_present": "Als anwesend markieren",
  "attendance.mark_absent": "Als abwesend markieren"
}

// translations/en.json
{
  "attendance.mark_present": "Mark as present",
  "attendance.mark_absent": "Mark as absent"
}
```

---

### Mobile App

**Priority:** Low  
**Effort:** Very High

**Features:**
- Native iOS/Android app
- Push notifications
- Offline mode
- Faster QR scanning

**Technology Stack:**
- **React Native** or **Flutter**
- **Expo** for rapid development

**Considerations:**
- Maintenance burden (3 codebases: web, iOS, Android)
- App store approval process
- Canvas mobile app already exists (can use LTI tool inside)

**Recommendation:** Optimize mobile web experience instead.

---

### Calendar Integration

**Priority:** Low  
**Effort:** Medium

**Features:**
- Export sessions to iCal/Google Calendar
- Sync attendance records with personal calendar
- Reminders for upcoming sessions

**Implementation:**

```javascript
// Generate iCal file
app.get('/api/calendar/export/:courseId', requireAuth, async (req, res) => {
  const sessions = await getSessions(courseId);
  
  const ical = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//SK Attendance//EN
${sessions.map(s => `
BEGIN:VEVENT
UID:${s.id}@attendance.sk.de
DTSTAMP:${formatDate(s.created_at)}
DTSTART:${formatDate(s.session_date, s.start_time)}
DTEND:${formatDate(s.session_date, s.end_time)}
SUMMARY:${s.name}
END:VEVENT
`).join('')}
END:VCALENDAR`;

  res.setHeader('Content-Type', 'text/calendar');
  res.setHeader('Content-Disposition', 'attachment; filename=attendance.ics');
  res.send(ical);
});
```

---

## 🏗️ Technical Debt

### 1. Frontend Framework Migration

**Current:** Vanilla JavaScript  
**Proposed:** React or Vue.js  
**Effort:** Very High (2-3 weeks)

**Benefits:**
- Component reusability
- State management (Redux/Vuex)
- Better testing
- Faster development of new features

**Drawbacks:**
- Build step required
- Larger bundle size
- Learning curve for maintainers

**Recommendation:** Only migrate if adding many complex features.

---

### 2. TypeScript Migration

**Current:** JavaScript  
**Proposed:** TypeScript  
**Effort:** High (1-2 weeks)

**Benefits:**
- Type safety (catch bugs at compile time)
- Better IDE autocomplete
- Self-documenting code
- Easier refactoring

**Example:**

```typescript
// Before (JavaScript)
async function markAttendance(sessionId, userId, status) {
  // ...
}

// After (TypeScript)
interface AttendanceRecord {
  sessionId: number;
  userId: string;
  status: 'present' | 'absent' | 'late' | 'partial' | 'excused';
  presentFrom?: Date;
  presentTo?: Date;
  minutes?: number;
}

async function markAttendance(
  sessionId: number, 
  userId: string, 
  status: AttendanceRecord['status']
): Promise<AttendanceRecord> {
  // Type-safe implementation
}
```

---

### 3. Separation of Concerns

**Current:** Monolithic server file  
**Proposed:** Separate modules  
**Effort:** Medium (3-5 days)

**Current Structure:**
```
server-simplified.js (1500+ lines)
routes/attendance.js (500+ lines)
```

**Proposed Structure:**
```
server.js (Express setup, middleware)
routes/
  ├── lti.js (LTI authentication)
  ├── attendance.js (Attendance management)
  ├── qr-code.js (QR code system)
  ├── exports.js (Excel/CSV/PDF)
  └── canvas.js (Canvas API integration)
services/
  ├── database.js (Database queries)
  ├── canvas-api.js (Canvas API client)
  └── pdf-generator.js (PDF generation)
middleware/
  ├── auth.js (Authentication)
  └── error-handler.js (Error handling)
```

**Benefits:**
- Easier to navigate codebase
- Better testability
- Clear separation of concerns
- Multiple developers can work simultaneously

---

### 4. Unit Testing

**Current:** No tests  
**Target:** 80% code coverage  
**Effort:** High (ongoing)

**Framework:** Jest + Supertest

**Example:**

```javascript
// tests/attendance.test.js
const request = require('supertest');
const app = require('../server');

describe('Attendance API', () => {
  test('POST /api/attendance/mark creates record', async () => {
    const response = await request(app)
      .post('/api/attendance/mark?sid=test-session-id')
      .send({
        sessionId: 1,
        studentId: '123',
        status: 'present'
      });
    
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
  });
  
  test('POST /api/attendance/mark validates required fields', async () => {
    const response = await request(app)
      .post('/api/attendance/mark?sid=test-session-id')
      .send({ sessionId: 1 }); // Missing studentId
    
    expect(response.status).toBe(400);
  });
});
```

---

### 5. API Documentation with Swagger

**Current:** Manual documentation in ARCHITECTURE.md  
**Proposed:** Interactive API docs with Swagger/OpenAPI  
**Effort:** Medium (2 days)

**Implementation:**

```javascript
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'SK Attendance API',
      version: '2.0.0',
      description: 'API documentation for SK Attendance LTI tool'
    }
  },
  apis: ['./routes/*.js']
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
```

**Access at:** `https://attendance.sk.de/api-docs`

---

## ⚡ Performance Improvements

### 1. Redis Caching Layer

**Priority:** Medium  
**Effort:** Medium (2-3 days)

**What to Cache:**
- Course information (rarely changes)
- Session lists (cache for 5 minutes)
- Student lists (cache for 15 minutes)
- Canvas API responses (cache for 1 hour)

**Implementation:**

```javascript
const redis = require('redis');
const client = redis.createClient();

async function getCourseInfo(courseId) {
  // Check cache first
  const cached = await client.get(`course:${courseId}`);
  if (cached) return JSON.parse(cached);
  
  // Fetch from database
  const course = await pool.query(
    'SELECT * FROM courses WHERE canvas_course_id = $1',
    [courseId]
  );
  
  // Cache for 1 hour
  await client.setEx(`course:${courseId}`, 3600, JSON.stringify(course.rows[0]));
  
  return course.rows[0];
}
```

**Benefits:**
- Faster page loads
- Reduced database queries
- Lower database load

---

### 2. Database Query Optimization

**Priority:** Medium  
**Effort:** Ongoing

**Current Issue:** Some queries fetch unnecessary data

**Example Optimization:**

```sql
-- Before: Fetches all columns
SELECT * FROM users WHERE role = 'student';

-- After: Fetches only needed columns
SELECT id, canvas_user_id, name, email FROM users WHERE role = 'student';
```

**Composite Indexes:**

```sql
-- Frequently queried together
CREATE INDEX idx_attendance_session_user ON attendance_records(session_id, user_id);

-- For reports
CREATE INDEX idx_sessions_course_date ON sessions(canvas_course_id, session_date);
```

---

### 3. Lazy Loading for Course Overview

**Priority:** Low  
**Effort:** Low (1 day)

**Current:** Loads all students and all sessions at once (slow for large courses)

**Proposed:** Load visible rows only, fetch more on scroll (infinite scroll)

**Implementation:**

```javascript
// API endpoint with pagination
app.get('/api/attendance/course-overview/:courseId', async (req, res) => {
  const { offset = 0, limit = 20 } = req.query;
  
  const students = await pool.query(`
    SELECT * FROM users 
    WHERE role = 'student'
    LIMIT $1 OFFSET $2
  `, [limit, offset]);
  
  res.json({ students: students.rows, hasMore: students.rows.length === limit });
});
```

---

### 4. Background Jobs for Heavy Operations

**Priority:** Medium  
**Effort:** Medium (3 days)

**Use Cases:**
- Excel export for large courses (1000+ students)
- PDF generation for BAföG certificates
- Bulk email sending
- Canvas enrollment sync

**Technology:** Bull (Redis-based job queue)

**Implementation:**

```javascript
const Queue = require('bull');
const exportQueue = new Queue('export-jobs', {
  redis: { port: 6379, host: 'localhost' }
});

// Producer (API endpoint)
app.get('/api/attendance/export/excel/:courseId', async (req, res) => {
  const job = await exportQueue.add({
    courseId: req.params.courseId,
    userId: req.session.ltiClaims.userId
  });
  
  res.json({ jobId: job.id, status: 'processing' });
});

// Consumer (background worker)
exportQueue.process(async (job) => {
  const { courseId } = job.data;
  const filePath = await generateExcelReport(courseId);
  return { filePath };
});

// Check job status
app.get('/api/jobs/:jobId', async (req, res) => {
  const job = await exportQueue.getJob(req.params.jobId);
  res.json({ status: job.status, result: job.returnvalue });
});
```

---

## 🔒 Security Enhancements

### 1. Rate Limiting

**Priority:** High  
**Effort:** Low (1 day)

**Implementation:**

```javascript
const rateLimit = require('express-rate-limit');

// General rate limit
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Zu viele Anfragen von dieser IP'
});

// Strict limit for check-in (prevent abuse)
const checkinLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 check-ins per minute
  message: 'Zu viele Check-In Versuche'
});

app.use('/api/', generalLimiter);
app.use('/api/checkin/submit', checkinLimiter);
```

---

### 2. CSRF Token Protection

**Priority:** Medium  
**Effort:** Low (1 day)

**Current:** Session ID in query parameter provides some protection

**Enhanced:** Use CSRF tokens for all state-changing operations

**Implementation:**

```javascript
const csrf = require('csurf');
const csrfProtection = csrf({ cookie: true });

app.use(csrfProtection);

// Add token to all forms
app.get('/attendance/:sessionId', (req, res) => {
  res.send(renderView({ csrfToken: req.csrfToken() }));
});

// Verify on POST
app.post('/api/attendance/mark', csrfProtection, async (req, res) => {
  // CSRF token automatically verified by middleware
});
```

---

### 3. Input Sanitization

**Priority:** High  
**Effort:** Low (1 day)

**Current:** Basic validation  
**Enhanced:** Strict sanitization with validator.js

**Implementation:**

```javascript
const validator = require('validator');

function sanitizeInput(input) {
  if (typeof input === 'string') {
    return validator.escape(validator.trim(input));
  }
  return input;
}

// Middleware
app.use((req, res, next) => {
  if (req.body) {
    for (const key in req.body) {
      req.body[key] = sanitizeInput(req.body[key]);
    }
  }
  next();
});
```

---

### 4. Audit Logging

**Priority:** Medium  
**Effort:** Medium (2 days)

**Feature:** Log all important actions for compliance and debugging.

**Schema:**

```sql
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,  -- 'attendance.marked', 'session.created', etc.
  entity_type TEXT,       -- 'attendance_record', 'session', etc.
  entity_id INTEGER,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
```

**Example Usage:**

```javascript
async function logAction(userId, action, details) {
  await pool.query(`
    INSERT INTO audit_logs (user_id, action, entity_type, entity_id, new_values, ip_address)
    VALUES ($1, $2, $3, $4, $5, $6)
  `, [userId, action, details.entityType, details.entityId, JSON.stringify(details.data), details.ip]);
}

// In attendance marking endpoint
await markAttendance(sessionId, studentId, status);
await logAction(instructorId, 'attendance.marked', {
  entityType: 'attendance_record',
  entityId: recordId,
  data: { sessionId, studentId, status }
});
```

---

## 🎨 UI/UX Improvements

### 1. Dark Mode

**Priority:** Low  
**Effort:** Medium (2 days)

**Implementation:**
- CSS custom properties
- Toggle in user preferences
- Respect system preference (`prefers-color-scheme`)

---

### 2. Keyboard Shortcuts

**Priority:** Low  
**Effort:** Low (1 day)

**Shortcuts:**
- `N` - New session
- `Q` - Generate QR code
- `E` - Export Excel
- `Esc` - Close modal
- `Ctrl+S` - Save attendance

---

### 3. Drag & Drop File Upload

**Priority:** Low  
**Effort:** Low (1 day)

**Current:** Browse button only  
**Enhanced:** Drag file onto upload area

---

### 4. Toast Notifications

**Priority:** Low  
**Effort:** Low (1 day)

**Current:** `alert()` dialogs (blocking)  
**Enhanced:** Non-blocking toast notifications (top-right corner)

**Library:** toastr or custom implementation

---

## 🔗 Integration Ideas

### 1. Microsoft Teams Integration

**Effort:** High  
**Benefit:** Expand to non-Canvas users

**Features:**
- LTI tool also works in Teams
- Post attendance reminders to Teams channels
- Check-in via Teams bot

---

### 2. Zoom Integration

**Effort:** Medium  
**Benefit:** Hybrid/remote teaching support

**Features:**
- Automatic attendance for Zoom meetings
- Detect who attended Zoom session
- Sync with attendance records

---

### 3. LDAP/Active Directory Integration

**Effort:** Medium  
**Benefit:** Enterprise SSO

**Use Case:** Larger institutions with existing user directory

---

## 📅 Development Roadmap

### Version 2.1 (Q2 2026) - Stability & Polish

**Focus:** Bug fixes, performance, documentation

- [ ] Fix remaining duplicate student issues
- [ ] Add rate limiting
- [ ] Implement audit logging
- [ ] Performance optimization (Redis cache)
- [ ] Comprehensive unit tests (50% coverage)

---

### Version 2.2 (Q3 2026) - User Experience

**Focus:** UI/UX improvements, usability

- [ ] Email notifications
- [ ] Bulk operations
- [ ] File upload progress indicators
- [ ] Toast notifications
- [ ] Keyboard shortcuts
- [ ] Dark mode

---

### Version 2.3 (Q4 2026) - Analytics & Reporting

**Focus:** Data insights, reporting

- [ ] Attendance analytics dashboard
- [ ] Charts and graphs
- [ ] Risk analysis (students at risk)
- [ ] PDF reports with visualizations
- [ ] Export to multiple formats (XLSX, CSV, PDF)

---

### Version 3.0 (Q1 2027) - Platform & Integrations

**Focus:** Scalability, integrations

- [ ] Canvas webhooks (real-time sync)
- [ ] TypeScript migration
- [ ] API documentation (Swagger)
- [ ] Multi-language support (i18n)
- [ ] Microsoft Teams integration
- [ ] Background job processing

---

## 💡 Community Contributions Welcome

We welcome contributions in these areas:

### Easy (Good First Issues)
- [ ] Add more translations (English, Turkish, Arabic)
- [ ] Improve error messages
- [ ] Add keyboard shortcuts
- [ ] Write additional unit tests
- [ ] Improve documentation

### Medium
- [ ] Implement bulk operations
- [ ] Add toast notifications
- [ ] Create Swagger API docs
- [ ] Implement rate limiting
- [ ] Add drag & drop file upload

### Advanced
- [ ] Canvas webhooks integration
- [ ] TypeScript migration
- [ ] Redis caching layer
- [ ] Background job queue
- [ ] React/Vue.js migration

---

## 📝 How to Contribute

1. **Check existing issues:** https://github.com/umkaru/sk-attendance-lti/issues
2. **Discuss first:** Comment on issue or create new one
3. **Fork repository:** Create your own branch
4. **Follow code style:** Match existing patterns
5. **Write tests:** For new features
6. **Update docs:** README, ARCHITECTURE, etc.
7. **Submit PR:** Reference issue number

---

## 📞 Feature Requests

Have an idea not listed here?

1. **Open GitHub Issue:** https://github.com/umkaru/sk-attendance-lti/issues/new
2. **Use template:** Feature Request
3. **Describe:**
   - Problem you're trying to solve
   - Proposed solution
   - Alternatives considered
   - Additional context

---

## 🎯 Priority Legend

- **Critical:** Security issues, data loss risks
- **High:** Significantly improves user experience
- **Medium:** Nice to have, improves workflow
- **Low:** Polish, edge cases, niche features

---

## 📊 Progress Tracking

Track progress on GitHub Projects:
https://github.com/umkaru/sk-attendance-lti/projects

Or check milestones:
https://github.com/umkaru/sk-attendance-lti/milestones

---

**Last Updated:** February 9, 2026  
**Version:** 2.0.0  
**Maintainer:** neumannsrb@gmail.com
