# Architecture Documentation

**SK Attendance LTI Tool - Technical Architecture**

This document provides detailed technical information about the system architecture, database design, LTI integration flow, API endpoints, and implementation details.

---

## 📋 Table of Contents

- [System Overview](#system-overview)
- [Technology Stack](#technology-stack)
- [Database Schema](#database-schema)
- [LTI 1.3 Integration Flow](#lti-13-integration-flow)
- [API Documentation](#api-documentation)
- [Frontend Architecture](#frontend-architecture)
- [Security Implementation](#security-implementation)
- [Canvas API Integration](#canvas-api-integration)
- [QR Code System](#qr-code-system)
- [File Storage](#file-storage)
- [Session Management](#session-management)

---

## 🏗️ System Overview

### Architecture Pattern

**Monolithic Web Application** with server-side rendering and AJAX interactions.

```
┌─────────────────────────────────────────────────────────────┐
│                       Canvas LMS                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              LTI 1.3 Launch (OAuth 2.0)              │  │
│  └────────────────────────┬─────────────────────────────┘  │
└───────────────────────────┼─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                 SK Attendance LTI Tool                      │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │            Express.js Server (Node.js)              │    │
│  │                                                      │    │
│  │  ┌──────────────┐    ┌──────────────────────────┐  │    │
│  │  │ LTI Handler  │    │   Attendance Routes      │  │    │
│  │  │ (Auth)       │    │   (/api/attendance/*)    │  │    │
│  │  └──────────────┘    └──────────────────────────┘  │    │
│  │                                                      │    │
│  │  ┌──────────────┐    ┌──────────────────────────┐  │    │
│  │  │ Canvas API   │    │   QR Code Generator      │  │    │
│  │  │ Integration  │    │   (Check-In System)      │  │    │
│  │  └──────────────┘    └──────────────────────────┘  │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │               PostgreSQL Database                   │    │
│  │  • Users  • Sessions  • Attendance Records          │    │
│  │  • Courses  • Tokens  • Excuses                     │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Request Flow

1. **LTI Launch:** Canvas → OAuth 2.0 → Express Server
2. **Authentication:** JWT verification → Session creation
3. **Role Detection:** Instructor vs. Student view
4. **Data Access:** PostgreSQL queries via pg driver
5. **Response:** Server-rendered HTML with inline JavaScript

---

## 🛠️ Technology Stack

### Backend

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| **Runtime** | Node.js | 18+ | JavaScript execution environment |
| **Framework** | Express.js | 4.x | Web server and routing |
| **Database** | PostgreSQL | 12+ | Relational data storage |
| **DB Driver** | pg | 8.x | PostgreSQL client for Node.js |
| **LTI Auth** | jsonwebtoken | 9.x | JWT token verification |
| **Sessions** | express-session | 1.x | Session management |
| **Session Store** | connect-pg-simple | 9.x | PostgreSQL session storage |

### Frontend

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **JavaScript** | Vanilla ES6+ | No framework - direct DOM manipulation |
| **CSS** | Custom responsive | Mobile-first design |
| **AJAX** | Fetch API | Asynchronous API calls |

### Libraries & Utilities

| Library | Purpose |
|---------|---------|
| **qrcode** | QR code generation for check-in |
| **pdfkit** | BAföG certificate PDF generation |
| **xlsx** | Excel export functionality |
| **axios** | Canvas API HTTP requests |
| **crypto** (built-in) | RSA key pair generation for LTI |

---

## 💾 Database Schema

### Complete Entity-Relationship Diagram

```
┌──────────────────────┐         ┌──────────────────────┐
│      courses         │         │       users          │
├──────────────────────┤         ├──────────────────────┤
│ id (SERIAL PK)       │         │ id (SERIAL PK)       │
│ canvas_course_id     │◄────────│ (no direct FK)       │
│ course_name          │         │ canvas_user_id       │
│ canvas_course_       │         │ name                 │
│   numeric_id         │         │ email                │
│ created_at           │         │ role                 │
│ updated_at           │         │ created_at           │
└──────────────────────┘         │ updated_at           │
         │                        └──────────────────────┘
         │                                  │
         │                                  │
         ▼                                  ▼
┌──────────────────────┐         ┌──────────────────────┐
│      sessions        │         │  attendance_records  │
├──────────────────────┤         ├──────────────────────┤
│ id (SERIAL PK)       │         │ id (SERIAL PK)       │
│ canvas_course_id ────┼────┐    │ session_id (FK) ─────┼──┐
│ session_date         │    │    │ user_id (FK) ────────┼──┼──┐
│ start_time           │    │    │ status               │  │  │
│ end_time             │    │    │ present_from         │  │  │
│ break_minutes        │    │    │ present_to           │  │  │
│ created_at           │    │    │ minutes              │  │  │
│ updated_at           │    │    │ break_minutes        │  │  │
│ created_by_user_id   │    │    │ net_minutes          │  │  │
└──────────────────────┘    │    │ notes                │  │  │
         │                  │    │ created_at           │  │  │
         │                  │    │ updated_at           │  │  │
         │                  │    └──────────────────────┘  │  │
         │                  └────────────────┬─────────────┘  │
         │                                   └────────────────┘
         │
         ▼
┌──────────────────────┐         ┌──────────────────────┐
│   checkin_tokens     │         │      excuses         │
├──────────────────────┤         ├──────────────────────┤
│ id (SERIAL PK)       │         │ id (SERIAL PK)       │
│ session_id (FK) ─────┤         │ user_id (FK)         │
│ token                │         │ session_id (FK)      │
│ expires_at           │         │ filename             │
│ active               │         │ uploaded_at          │
│ created_at           │         └──────────────────────┘
└──────────────────────┘
```

### Table Definitions

#### **users**

Stores both instructors and students from Canvas.

```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    canvas_user_id TEXT UNIQUE NOT NULL,  -- Canvas UUID (e.g., "104db362-...")
    name TEXT NOT NULL,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'student', -- 'student' or 'instructor'
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_canvas_id ON users(canvas_user_id);
CREATE INDEX idx_users_role ON users(role);
```

**Note:** `canvas_user_id` is stored as **TEXT (String)** to match Canvas LTI claims format.

---

#### **courses**

Stores Canvas course metadata.

```sql
CREATE TABLE courses (
    id SERIAL PRIMARY KEY,
    canvas_course_id TEXT UNIQUE NOT NULL,         -- Canvas context ID (hash)
    course_name TEXT NOT NULL,
    canvas_course_numeric_id TEXT,                 -- Numeric ID (e.g., "235")
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_courses_canvas_id ON courses(canvas_course_id);
```

**Two Canvas IDs:**
- `canvas_course_id`: Hash from LTI claims (e.g., `762d422e53d42a5b...`)
- `canvas_course_numeric_id`: Numeric ID for Canvas API (e.g., `235`)

---

#### **sessions**

Individual class sessions within courses.

```sql
CREATE TABLE sessions (
    id SERIAL PRIMARY KEY,
    canvas_course_id TEXT NOT NULL,                -- Links to courses
    session_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    break_minutes INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    created_by_user_id INTEGER REFERENCES users(id)
);

CREATE INDEX idx_sessions_course ON sessions(canvas_course_id);
CREATE INDEX idx_sessions_date ON sessions(session_date);
```

**Time Tracking:**
- `session_date`: Date of class (YYYY-MM-DD)
- `start_time`: Session start (HH:MM:SS)
- `end_time`: Session end (HH:MM:SS)
- `break_minutes`: Unpaid break time (integer)

---

#### **attendance_records**

Individual attendance entries with precise time tracking.

```sql
CREATE TABLE attendance_records (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL,                          -- 'present', 'late', 'partial', 'absent', 'excused'
    present_from TIMESTAMP,                        -- Actual arrival time
    present_to TIMESTAMP,                          -- Actual departure time
    minutes INTEGER,                               -- Total minutes (including break)
    break_minutes INTEGER DEFAULT 0,               -- Break deduction
    net_minutes INTEGER,                           -- Payable minutes (minutes - break_minutes)
    notes TEXT,                                    -- Optional notes (e.g., "Verspätet wegen Stau")
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(session_id, user_id)                    -- One record per student per session
);

CREATE INDEX idx_attendance_session ON attendance_records(session_id);
CREATE INDEX idx_attendance_user ON attendance_records(user_id);
CREATE INDEX idx_attendance_status ON attendance_records(status);
```

**Status Values:**
- `present`: Full attendance (present_from = session start, present_to = session end)
- `late`: Late arrival (present_from > session start)
- `partial`: Early departure (present_to < session end)
- `absent`: Did not attend
- `excused`: Absent with valid excuse

**BAföG Compliance:**
- Timestamps stored in `present_from` and `present_to`
- Net minutes calculated: `net_minutes = minutes - break_minutes`
- Notes field for documentation

---

#### **checkin_tokens**

Time-limited tokens for QR code self-check-in.

```sql
CREATE TABLE checkin_tokens (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,                    -- Random secure token
    expires_at TIMESTAMP NOT NULL,                 -- Expiration time (15 minutes)
    active BOOLEAN DEFAULT TRUE,                   -- Manual deactivation flag
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_tokens_token ON checkin_tokens(token);
CREATE INDEX idx_tokens_session ON checkin_tokens(session_id);
CREATE INDEX idx_tokens_expires ON checkin_tokens(expires_at);
```

**Token Lifecycle:**
1. Instructor clicks "QR-Code generieren"
2. Server generates random 64-character token
3. Stored with `expires_at = NOW() + 15 minutes`
4. QR code contains check-in URL with token
5. After expiration or manual deactivation: `active = FALSE`

---

#### **excuses**

Student absence justification files.

```sql
CREATE TABLE excuses (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    session_id INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,                        -- Stored filename (UUID-based)
    uploaded_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_excuses_user ON excuses(user_id);
CREATE INDEX idx_excuses_session ON excuses(session_id);
```

**File Storage:**
- Files stored in `uploads/` directory
- Filename format: `{UUID}_{originalname}`
- Supported formats: PDF, JPG, PNG
- Max size: 5 MB (configurable)

---

#### **session** (express-session table)

Automatically created by `connect-pg-simple`.

```sql
CREATE TABLE "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);

ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid");
CREATE INDEX "IDX_session_expire" ON "session" ("expire");
```

**Session Data Stored:**
- `ltiClaims`: User info, roles, course context
- `isAuthenticated`: Boolean flag
- `sessionID`: Express session ID

---

## 🔐 LTI 1.3 Integration Flow

### Complete Authentication Flow

```
┌──────────────┐                                    ┌──────────────┐
│   Canvas     │                                    │  SK Tool     │
└──────┬───────┘                                    └──────┬───────┘
       │                                                   │
       │ 1. User clicks tool link                         │
       │ ──────────────────────────────────────────────►  │
       │    GET /courses/235/external_tools/250           │
       │                                                   │
       │ 2. Canvas initiates LTI login                    │
       │ ──────────────────────────────────────────────►  │
       │    POST /lti/login                               │
       │    Body: {                                       │
       │      iss: "https://canvas.instructure.com"       │
       │      login_hint: "...",                          │
       │      client_id: "289220...",                     │
       │      lti_deployment_id: "...",                   │
       │      target_link_uri: "https://.../lti/launch"   │
       │    }                                             │
       │                                                   │
       │                                   3. Server responds with redirect
       │  ◄─────────────────────────────────────────────  │
       │    302 Redirect                                  │
       │    Location: https://canvas.instructure.com      │
       │      /api/lti/authorize?                         │
       │        client_id=...&                            │
       │        login_hint=...&                           │
       │        redirect_uri=.../lti/launch&              │
       │        state=...&                                │
       │        nonce=...                                 │
       │                                                   │
       │ 4. Canvas authorizes and issues JWT              │
       │    (Includes user, roles, course context)        │
       │                                                   │
       │ 5. Canvas redirects back with JWT                │
       │ ──────────────────────────────────────────────►  │
       │    POST /lti/launch                              │
       │    Body: {                                       │
       │      id_token: "eyJhbGc...",  (JWT)             │
       │      state: "..."                                │
       │    }                                             │
       │                                                   │
       │                           6. Server verifies JWT │
       │                              - Fetch Canvas JWKS │
       │                              - Verify signature  │
       │                              - Extract claims    │
       │                              - Create session    │
       │                              - Upsert user/course│
       │                                                   │
       │  ◄─────────────────────────────────────────────  │
       │    200 OK - HTML Response                        │
       │    (Instructor or Student view)                  │
       │    + Session cookie set                          │
       │                                                   │
```

### LTI Claims Structure

**Decoded JWT Payload Example:**

```json
{
  "iss": "https://canvas.instructure.com",
  "sub": "104db362-b565-47f6-b3d9-486c64362023",
  "aud": "289220000000000001",
  "exp": 1770670592,
  "iat": 1770667592,
  "nonce": "...",
  "name": "Jens Neumann",
  "email": "neumannsrb@gmail.com",
  "https://purl.imsglobal.org/spec/lti/claim/roles": [
    "http://purl.imsglobal.org/vocab/lis/v2/institution/person#Instructor",
    "http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor"
  ],
  "https://purl.imsglobal.org/spec/lti/claim/context": {
    "id": "762d422e53d42a5b9fe2e474f78b737fb01752c8",
    "label": "KPM | Ausbilder IHK (4T)",
    "title": "Ausbildung der Ausbilder (IHK) in 4 Kurstagen",
    "type": ["http://purl.imsglobal.org/vocab/lis/v2/course#CourseOffering"]
  },
  "https://purl.imsglobal.org/spec/lti/claim/custom": {
    "canvas_course_id": "235"  // Optional - requires custom field setup
  }
}
```

### JWT Verification Process

```javascript
// 1. Fetch Canvas public keys
const jwksResponse = await axios.get(CANVAS_CONFIG.jwksUrl);
const canvasKeys = jwksResponse.data.keys;

// 2. Extract kid from token header
const tokenHeader = JSON.parse(
  Buffer.from(id_token.split('.')[0], 'base64').toString()
);

// 3. Find matching public key
const canvasPublicKey = canvasKeys.find(k => k.kid === tokenHeader.kid);

// 4. Convert JWK to PEM format
const publicKeyPem = crypto.createPublicKey({
  key: canvasPublicKey,
  format: 'jwk'
}).export({ type: 'spki', format: 'pem' });

// 5. Verify JWT signature
const payload = jwt.verify(id_token, publicKeyPem, { 
  algorithms: ['RS256'] 
});
```

### Session Creation

```javascript
// Extract claims
const ltiClaims = {
  userId: payload.sub,
  userName: payload.name || 'User',
  userEmail: payload.email,
  roles: payload['https://purl.imsglobal.org/spec/lti/claim/roles'] || [],
  context: payload['https://purl.imsglobal.org/spec/lti/claim/context'] || {},
  custom: payload['https://purl.imsglobal.org/spec/lti/claim/custom'] || {}
};

// Store in session
req.session.ltiClaims = ltiClaims;
req.session.isAuthenticated = true;

// Save to database
await saveUserToDatabase(ltiClaims);
await saveCourseToDatabase(ltiClaims.context);
```

---

## 🌐 API Documentation

### Authentication

All API endpoints require:
1. Valid Express session cookie
2. `sid` query parameter (Canvas session ID) for CSRF protection

**Example:**
```
GET /api/attendance/session/26?sid=aL2MmEkObalXuSacdpQUXBLzRc3aUGJQ
Cookie: sk.attendance.sid=s%3A...
```

### Endpoints

#### **Attendance Management**

**GET /api/attendance/session/:sessionId**

Load attendance data for a session.

```javascript
// Response
{
  "students": [
    {
      "id": "124",
      "name": "Alina Vogt",
      "email": "alina@example.com",
      "status": "present",
      "present_from": "2026-02-09T09:00:00Z",
      "present_to": "2026-02-09T16:30:00Z",
      "minutes": 450,
      "break_minutes": 0,
      "net_minutes": 450,
      "excuse_filename": null
    }
  ]
}
```

---

**POST /api/attendance/mark**

Record attendance for a single student.

```javascript
// Request
{
  "sessionId": 26,
  "studentId": "124",
  "status": "late",
  "presentFrom": "2026-02-09T09:30:00",
  "presentTo": "2026-02-09T16:30:00",
  "minutes": 420,
  "breakMinutes": 0,
  "netMinutes": 420,
  "note": "Verspätet wegen Stau"
}

// Response
{
  "success": true,
  "recordId": 567
}
```

---

**POST /api/attendance/bulk**

Mark multiple students with same status (e.g., "Alle als anwesend").

```javascript
// Request
{
  "sessionId": 26,
  "studentIds": ["124", "116", "134", "128", "121"],
  "status": "present",
  "presentFrom": "2026-02-09T09:00:00",
  "presentTo": "2026-02-09T16:30:00",
  "breakMinutes": 0
}

// Response
{
  "success": true,
  "recordsCreated": 5
}
```

---

#### **QR Code Check-In**

**POST /api/checkin/generate/:sessionId**

Generate time-limited QR code token.

```javascript
// Request Body
{
  "validMinutes": 15
}

// Response
{
  "token": "fa6b12671636cc8ebd14a3c5d7f8e92a...",
  "expiresAt": "2026-02-09T16:45:12.910Z",
  "validMinutes": 15,
  "qrCodeDataUrl": "data:image/png;base64,iVBORw0KG...",
  "checkinUrl": "https://.../checkin?token=fa6b126716..."
}
```

**Canvas Enrollment Sync:**
- Automatically called before token generation
- Syncs all active StudentEnrollments from Canvas API
- Upserts students into `users` table

---

**GET /api/checkin?token=...**

Student check-in page (QR code destination).

**Query Parameters:**
- `token`: QR code token

**Response:** HTML page with check-in form

---

**POST /api/checkin/submit**

Submit student check-in.

```javascript
// Request Body
{
  "token": "fa6b12671636cc8ebd14a3c5d7f8e92a...",
  "name": "Alina Vogt",
  "email": "alina@example.com"
}

// Response (Success)
{
  "success": true,
  "message": "Erfolgreich eingecheckt!",
  "sessionInfo": {
    "name": "AdA Tag 2",
    "date": "2026-02-09",
    "time": "09:00 - 16:30"
  }
}

// Response (Not Enrolled)
{
  "success": false,
  "error": "Du bist nicht für diesen Kurs registriert. Bitte kontaktiere den Dozenten."
}
```

**Security Validation:**
1. Token valid and not expired?
2. User exists in `users` table? (Canvas-enrolled)
3. Name/email match database?
4. If all checks pass → Record attendance

---

**DELETE /api/checkin/deactivate/:sessionId**

Manually deactivate QR code.

```javascript
// Response
{
  "success": true,
  "message": "Token deaktiviert"
}
```

---

#### **Course Overview**

**GET /api/attendance/course-overview/:courseId**

Matrix view of all students across all sessions.

```javascript
// Response
{
  "courseName": "KPM | Ausbilder IHK (4T)",
  "sessions": [
    { "id": 23, "date": "2026-02-02", "name": "Tag 1" },
    { "id": 24, "date": "2026-02-03", "name": "Tag 2" }
  ],
  "students": [
    {
      "id": "124",
      "name": "Alina Vogt",
      "records": [
        { "sessionId": 23, "status": "present", "netMinutes": 450 },
        { "sessionId": 24, "status": "late", "netMinutes": 420 }
      ],
      "totalHours": 14.5,
      "attendanceRate": 96.7
    }
  ]
}
```

---

#### **Export**

**GET /api/attendance/export/excel/:courseId**

Download Excel attendance report.

**Response:** Binary XLSX file with headers:
```
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename=Anwesenheit_Kurs_2026-02-09.xlsx
```

---

**GET /api/attendance/export/csv/:courseId**

Download CSV attendance report.

**Response:** Text CSV file

---

#### **Excuses**

**POST /api/excuses/upload**

Upload excuse file.

```javascript
// Request (multipart/form-data)
{
  "sessionId": "26",
  "file": <binary PDF/image>
}

// Response
{
  "success": true,
  "filename": "a7b3c4d5-e6f7-8901-2345-6789abcdef01_excuse.pdf"
}
```

---

**GET /api/excuses/:filename**

Download excuse file.

**Response:** Binary file with original content-type

---

#### **BAföG Certificate**

**GET /api/bafoeg/pdf**

Generate official BAföG attendance certificate PDF.

**Response:** Binary PDF file with:
- Student name and course details
- Session-by-session attendance breakdown
- Total hours calculation
- Official formatting per BAföG requirements

---

## 🎨 Frontend Architecture

### JavaScript Architecture

**Single-Page AJAX Application** within LTI iframe.

```javascript
// Main class for attendance management
class AttendanceManager {
  constructor(sessionId, canvasSessionId) {
    this.sessionId = sessionId;
    this.canvasSessionId = canvasSessionId;
    this.students = [];
    this.qrRefreshInterval = null;
  }

  // Load students via AJAX
  async loadStudents() { ... }

  // Render student table
  renderStudents() { ... }

  // Handle dropdown status change
  async handleStatusChange(studentId, status) {
    if (status === 'late') {
      this.showLateModal(student);
      return;
    }
    if (status === 'partial') {
      this.showPartialModal(student);
      return;
    }
    await this.updateAttendance(student, status);
  }

  // Show modal for individual time entry
  showLateModal(student) { ... }
  showPartialModal(student) { ... }

  // Generate QR code
  async generateQRCode() { ... }
}

// Global instance (initialized on page load)
let attendanceManager;
```

### Modal System

**Dynamic modal creation** using DOM manipulation:

```javascript
showLateModal(student) {
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.display = 'block';
  modal.innerHTML = `
    <div class="modal-content">
      <span class="close" onclick="this.closest('.modal').remove()">&times;</span>
      <h2>⏰ Verspätet angekommen</h2>
      <p><strong>${student.name}</strong></p>
      
      <div class="form-group">
        <label>Ankunftszeit:</label>
        <input type="time" id="late-arrival-time" value="${currentTime}">
      </div>

      <div class="form-group">
        <label>Notiz (optional):</label>
        <input type="text" id="late-note" placeholder="z.B. Stau, Arzttermin">
      </div>

      <div class="form-actions">
        <button class="btn btn-danger" onclick="this.closest('.modal').remove()">Abbrechen</button>
        <button class="btn" onclick="attendanceManager.saveLateArrival(${student.id})">Speichern</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}
```

### Event Handling

**Event delegation** for dynamically created elements:

```javascript
renderStudents() {
  container.innerHTML = `<table>...</table>`;
  
  // Attach event listeners after rendering
  container.querySelectorAll('select').forEach(select => {
    select.addEventListener('change', (e) => {
      const studentId = e.target.getAttribute('data-student-id');
      const status = e.target.value;
      if (status && studentId) {
        this.handleStatusChange(studentId, status);
      }
    });
  });
}
```

**Why not inline `onchange`?**
- Canvas CSP may block inline event handlers
- Better separation of concerns
- Easier debugging and testing

---

## 🔒 Security Implementation

### Whitelist-Based Check-In

**Problem:** Anyone with QR code could check in (even non-students)

**Solution:** Validate against Canvas enrollment list

```javascript
// In /api/checkin/submit
const student = await pool.query(
  'SELECT * FROM users WHERE name ILIKE $1 OR email ILIKE $2',
  [name, email]
);

if (student.rows.length === 0) {
  return res.status(403).json({
    success: false,
    error: 'Du bist nicht für diesen Kurs registriert. Bitte kontaktiere den Dozenten.'
  });
}
```

**How students get in whitelist:**
1. Instructor generates QR code
2. System calls `syncCourseEnrollments(canvasCourseId)`
3. Fetches all active StudentEnrollments from Canvas API
4. Upserts each student into `users` table

**Result:** Only Canvas-enrolled students can check in ✅

---

### Session Authentication

**Middleware:** `requireAuth`

```javascript
function requireAuth(req, res, next) {
  const canvasSessionId = req.query.sid;
  
  if (!canvasSessionId) {
    return res.status(401).json({ error: 'No session ID provided' });
  }

  // Load session from PostgreSQL
  const session = await loadSessionFromStore(canvasSessionId);
  
  if (!session || !session.isAuthenticated) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  req.canvasSession = session;
  next();
}
```

**Applied to all instructor routes:**
- Session creation/editing
- Attendance marking
- QR code generation
- Export functions

---

### CSRF Protection

**Query-based session ID** prevents CSRF attacks:

```javascript
// All AJAX requests include sid parameter
fetch(`/api/attendance/mark?sid=${canvasSessionId}`, {
  method: 'POST',
  credentials: 'include',  // Send cookies
  body: JSON.stringify(data)
});
```

**Why this works:**
- Attacker cannot guess session ID
- CORS prevents cross-origin requests
- Session cookie alone is insufficient

---

### Input Validation

**Database queries use parameterized statements:**

```javascript
// GOOD: Parameterized query
await pool.query(
  'SELECT * FROM users WHERE name = $1',
  [userInput]
);

// BAD: String concatenation (NEVER DO THIS)
await pool.query(
  `SELECT * FROM users WHERE name = '${userInput}'`
);
```

**File uploads validated:**
```javascript
const allowedMimeTypes = ['application/pdf', 'image/jpeg', 'image/png'];
const maxFileSize = 5 * 1024 * 1024; // 5 MB

if (!allowedMimeTypes.includes(file.mimetype)) {
  return res.status(400).json({ error: 'Ungültiger Dateityp' });
}

if (file.size > maxFileSize) {
  return res.status(400).json({ error: 'Datei zu groß (max 5 MB)' });
}
```

---

## 🔄 Canvas API Integration

### Enrollment Synchronization

**Automatic sync** when QR code generated:

```javascript
async function syncCourseEnrollments(canvasCourseId) {
  if (!CANVAS_API_TOKEN) {
    console.warn('⚠️ CANVAS_API_TOKEN nicht konfiguriert');
    return;
  }

  try {
    // 1. Get numeric course ID from database
    const courseQuery = 'SELECT canvas_course_numeric_id FROM courses WHERE canvas_course_id = $1';
    const courseResult = await pool.query(courseQuery, [canvasCourseId]);
    
    const numericCourseId = courseResult.rows[0].canvas_course_numeric_id;

    // 2. Fetch enrollments from Canvas API
    const url = `${CANVAS_BASE_URL}/api/v1/courses/${numericCourseId}/enrollments?type[]=StudentEnrollment&state[]=active&per_page=100`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${CANVAS_API_TOKEN}`
      }
    });

    const enrollments = await response.json();
    console.log(`📋 ${enrollments.length} aktive Studenten gefunden in Canvas`);

    // 3. Upsert each student
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
      `;

      await pool.query(upsertQuery, [
        String(user.id),  // Canvas API returns numeric ID - convert to string
        user.name,
        user.login_id || user.email || ''
      ]);
    }

    console.log(`✅ ${enrollments.length} Enrollments synchronisiert`);
    return enrollments.length;

  } catch (error) {
    console.error('❌ Enrollment Sync Fehler:', error.message);
  }
}
```

**Canvas API Endpoint:**
```
GET /api/v1/courses/{id}/enrollments
  ?type[]=StudentEnrollment
  &state[]=active
  &per_page=100
```

**Response format:**
```json
[
  {
    "id": 1234,
    "user_id": 5678,
    "user": {
      "id": 5678,
      "name": "Alina Vogt",
      "sortable_name": "Vogt, Alina",
      "short_name": "Alina",
      "login_id": "alina@example.com",
      "email": "alina@example.com"
    },
    "type": "StudentEnrollment",
    "enrollment_state": "active"
  }
]
```

**Important ID Mapping:**
- **Canvas API** returns numeric user ID (e.g., `5678`)
- **LTI Launch** provides UUID user ID (e.g., `104db362-...`)
- **Solution:** Convert API ID to string, store as canvas_user_id

---

### Rate Limiting

Canvas API limits:
- **3000 requests/hour** per access token
- Enrollment sync typically uses **1 request** per course
- For courses with >100 students: Pagination required

**Pagination handling:**
```javascript
let allEnrollments = [];
let page = 1;
let hasMore = true;

while (hasMore) {
  const url = `${CANVAS_BASE_URL}/api/v1/courses/${courseId}/enrollments?type[]=StudentEnrollment&state[]=active&per_page=100&page=${page}`;
  const response = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` }});
  const enrollments = await response.json();
  
  allEnrollments = allEnrollments.concat(enrollments);
  
  // Check if there are more pages
  const linkHeader = response.headers.get('Link');
  hasMore = linkHeader && linkHeader.includes('rel="next"');
  page++;
}
```

---

## 📱 QR Code System

### Token Generation

**Cryptographically secure random token:**

```javascript
const crypto = require('crypto');

function generateToken() {
  return crypto.randomBytes(32).toString('hex'); // 64 characters
}
```

**Token storage:**
```javascript
const token = generateToken();
const expiresAt = new Date(Date.now() + validMinutes * 60 * 1000);

await pool.query(
  'INSERT INTO checkin_tokens (session_id, token, expires_at, active) VALUES ($1, $2, $3, TRUE)',
  [sessionId, token, expiresAt]
);
```

### QR Code Creation

**Using `qrcode` library:**

```javascript
const QRCode = require('qrcode');

const checkinUrl = `${PUBLIC_URL}/checkin?token=${token}`;

const qrCodeDataUrl = await QRCode.toDataURL(checkinUrl, {
  width: 400,
  margin: 2,
  errorCorrectionLevel: 'M'
});
```

**Result:** Base64-encoded PNG image

**Display:**
```html
<img src="data:image/png;base64,iVBORw0KG..." alt="QR Code">
```

### Token Validation

**On check-in submission:**

```javascript
// 1. Find token
const tokenResult = await pool.query(
  'SELECT * FROM checkin_tokens WHERE token = $1 AND active = TRUE',
  [token]
);

if (tokenResult.rows.length === 0) {
  return res.status(400).json({ error: 'Ungültiger Token' });
}

const tokenData = tokenResult.rows[0];

// 2. Check expiration
if (new Date() > new Date(tokenData.expires_at)) {
  return res.status(400).json({ error: 'Token abgelaufen' });
}

// 3. Validate student (whitelist check)
const studentResult = await pool.query(
  'SELECT * FROM users WHERE (name ILIKE $1 OR email ILIKE $2) AND role = \'student\'',
  [name, email]
);

if (studentResult.rows.length === 0) {
  return res.status(403).json({ 
    error: 'Du bist nicht für diesen Kurs registriert.' 
  });
}

// 4. Record attendance
const student = studentResult.rows[0];
await recordAttendance(tokenData.session_id, student.id, 'present');
```

---

## 💾 File Storage

### Directory Structure

```
sk-attendance-lti/
├── uploads/               # Student excuse files
│   ├── a7b3c4d5-e6f7-8901-2345-6789abcdef01_excuse.pdf
│   ├── b8c4d5e6-f7g8-9012-3456-789abcdef012_note.jpg
│   └── ...
├── public/               # Static assets
│   ├── js/
│   ├── css/
│   └── ...
└── ...
```

### File Upload Handling

**Using `multer` middleware:**

```javascript
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueName = `${crypto.randomUUID()}_${file.originalname}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Ungültiger Dateityp'));
    }
  }
});

app.post('/api/excuses/upload', upload.single('file'), async (req, res) => {
  // File available as req.file
  const filename = req.file.filename;
  // Store in database...
});
```

### File Download

**Secure file serving:**

```javascript
app.get('/api/excuses/:filename', requireAuth, async (req, res) => {
  const { filename } = req.params;
  
  // Validate filename exists in database (prevent directory traversal)
  const excuseResult = await pool.query(
    'SELECT * FROM excuses WHERE filename = $1',
    [filename]
  );
  
  if (excuseResult.rows.length === 0) {
    return res.status(404).json({ error: 'Datei nicht gefunden' });
  }
  
  const filePath = path.join(__dirname, 'uploads', filename);
  res.download(filePath);
});
```

---

## 🗂️ Session Management

### Session Store Configuration

**Using `connect-pg-simple` for PostgreSQL session storage:**

```javascript
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

app.use(session({
  store: new pgSession({
    pool: pool,                      // PostgreSQL connection pool
    tableName: 'session',            // Table name
    createTableIfMissing: true       // Auto-create table
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,                   // Set to true in production with HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,    // 24 hours
    sameSite: 'none'                 // Required for LTI iframe
  },
  name: 'sk.attendance.sid'          // Custom cookie name
}));
```

**Why PostgreSQL session store?**
- ✅ Persistent across server restarts
- ✅ Supports multiple server instances (horizontal scaling)
- ✅ Automatic cleanup of expired sessions
- ✅ Better security than in-memory store

### Session Data Structure

```javascript
req.session = {
  ltiClaims: {
    userId: "104db362-b565-47f6-b3d9-486c64362023",
    userName: "Jens Neumann",
    userEmail: "neumannsrb@gmail.com",
    roles: ["Instructor", "Administrator"],
    context: {
      id: "762d422e53d42a5b9fe2e474f78b737fb01752c8",
      label: "KPM | Ausbilder IHK (4T)",
      title: "Ausbildung der Ausbilder (IHK) in 4 Kurstagen"
    }
  },
  isAuthenticated: true,
  sessionID: "aL2MmEkObalXuSacdpQUXBLzRc3aUGJQ"
};
```

### Cross-Domain Session Handling

**Challenge:** LTI tool runs in iframe, cookies may be blocked

**Solution:** Session ID passed via query parameter

```javascript
// After LTI launch, redirect with session ID
const redirectUrl = `/attendance?sid=${req.sessionID}`;
res.send(renderInstructorView(ltiClaims, req.sessionID));

// On subsequent requests, load session by ID
const canvasSessionId = req.query.sid;
const sessionData = await loadSessionFromStore(canvasSessionId);
```

---

## 🚀 Performance Considerations

### Database Indexing

**Critical indexes for performance:**

```sql
-- User lookups
CREATE INDEX idx_users_canvas_id ON users(canvas_user_id);
CREATE INDEX idx_users_role ON users(role);

-- Session queries
CREATE INDEX idx_sessions_course ON sessions(canvas_course_id);
CREATE INDEX idx_sessions_date ON sessions(session_date);

-- Attendance lookups
CREATE INDEX idx_attendance_session ON attendance_records(session_id);
CREATE INDEX idx_attendance_user ON attendance_records(user_id);

-- Token validation
CREATE INDEX idx_tokens_token ON checkin_tokens(token);
CREATE INDEX idx_tokens_expires ON checkin_tokens(expires_at);
```

### Connection Pooling

**PostgreSQL connection pool:**

```javascript
const { Pool } = require('pg');

const pool = new Pool({
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
  max: 20,                    // Maximum connections
  idleTimeoutMillis: 30000,   // Close idle connections after 30s
  connectionTimeoutMillis: 2000
});
```

**Why pooling matters:**
- Creating new connections is expensive (~50-100ms)
- Pool reuses existing connections
- Concurrent requests handled efficiently

### Query Optimization

**Use prepared statements for frequent queries:**

```javascript
// Instead of string templates
const result = await pool.query(
  'SELECT * FROM users WHERE canvas_user_id = $1',
  [userId]
);
```

**Benefit:** PostgreSQL caches query plan, faster execution

---

## 🔄 Future Architecture Improvements

### Recommended Enhancements

1. **Redis Session Store**
   - Faster than PostgreSQL for session data
   - Better for high-traffic scenarios
   - Simple integration with `connect-redis`

2. **Canvas Webhooks**
   - Real-time enrollment updates
   - No polling or manual sync needed
   - Requires Canvas admin configuration

3. **Background Job Queue**
   - Use Bull/BullMQ for async tasks
   - PDF generation, email sending
   - Enrollment sync in background

4. **Caching Layer**
   - Redis for frequently accessed data
   - Course information, session lists
   - Reduce database load

5. **TypeScript Migration**
   - Type safety for large codebase
   - Better IDE support
   - Catch bugs at compile time

---

## 📖 Additional Resources

- **LTI 1.3 Specification:** https://www.imsglobal.org/spec/lti/v1p3/
- **Canvas LTI Documentation:** https://canvas.instructure.com/doc/api/file.lti_dev_key_config.html
- **PostgreSQL Documentation:** https://www.postgresql.org/docs/
- **Express.js Guide:** https://expressjs.com/
- **Node.js Best Practices:** https://github.com/goldbergyoni/nodebestpractices

---

**Last Updated:** February 9, 2026  
**Version:** 2.0.0  
**Maintainer:** neumannsrb@gmail.com
