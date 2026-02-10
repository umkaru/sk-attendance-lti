# SK Attendance LTI Tool

**BAföG-compliant attendance tracking system for Canvas LMS with QR-code self-check-in**

A production-ready LTI 1.3 tool for tracking student attendance in Canvas courses with precise time tracking, self-check-in via QR codes, automated enrollment synchronization, and BAföG-compliant reporting.

---

## 🎯 Features

### Core Functionality
- ✅ **LTI 1.3 Integration** - Seamless Canvas LMS integration with OAuth2 authentication
- ✅ **Multi-Tenant Support** - Account-level installation for all courses
- ✅ **PostgreSQL Database** - Robust data persistence with session management
- ✅ **BAföG-Compliant Time Tracking** - Precise minute-level attendance recording

### Instructor Features
- ✅ **Session Management** - Create, edit, and delete course sessions
- ✅ **QR-Code Generation** - Time-limited self-check-in tokens (15-minute validity)
- ✅ **Canvas Enrollment Sync** - Automatic student list synchronization from Canvas API
- ✅ **Individual Time Recording** - Modals for "Late Arrival" and "Early Departure"
- ✅ **Course Overview Matrix** - Attendance visualization across all sessions
- ✅ **Excel/CSV Export** - Comprehensive attendance reports
- ✅ **Excuse Management** - View and download student excuse documents

### Student Features
- ✅ **QR-Code Self-Check-In** - Mobile-friendly attendance confirmation
- ✅ **Security Validation** - Only Canvas-enrolled students can check in
- ✅ **Personal Dashboard** - Real-time attendance statistics
- ✅ **BAföG PDF Certificate** - Official attendance documentation
- ✅ **Excuse Upload** - Submit absence justifications with file attachments

### Security & Compliance
- ✅ **Whitelist-Based Check-In** - Prevents unauthorized attendance recording
- ✅ **Session-Based Authentication** - Secure LTI token validation
- ✅ **Time-Limited QR Codes** - Automatic expiration after configured period
- ✅ **BAföG Requirements** - Meets German federal student aid standards

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** 18+ and npm
- **PostgreSQL** 12+
- **Canvas LMS** with admin access
- **Cloudflare Tunnel** or ngrok (for development)

### Installation

1. **Clone the repository:**

```bash
git clone https://github.com/umkaru/sk-attendance-lti.git
cd sk-attendance-lti
```

2. **Install dependencies:**

```bash
npm install
```

3. **Set up PostgreSQL database:**

```bash
# Create database
createdb attendance

# Create user
psql -c "CREATE USER attendance_user WITH PASSWORD 'your_password';"
psql -c "GRANT ALL PRIVILEGES ON DATABASE attendance TO attendance_user;"

# Run schema
psql -U attendance_user -d attendance -f schema.sql
```

4. **Configure environment variables:**

```bash
cp .env.example .env
# Edit .env with your configuration (see Configuration section)
```

5. **Start the server:**

```bash
npm start
```

6. **Start Cloudflare Tunnel (development):**

```bash
# In a separate terminal
cloudflared tunnel --url http://localhost:3001
```

---

## ⚙️ Configuration

### Environment Variables

Create a `.env` file with the following configuration:

```env
# Server Configuration
PORT=3001
NODE_ENV=development
PUBLIC_URL=https://your-tunnel-url.trycloudflare.com

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=attendance
DB_USER=attendance_user
DB_PASSWORD=your_secure_password

# Canvas API Integration (for enrollment sync)
CANVAS_API_TOKEN=your_canvas_admin_token
CANVAS_BASE_URL=https://your-canvas-instance.instructure.com

# Canvas LTI Configuration
CANVAS_PLATFORM_URL=https://canvas.instructure.com
CANVAS_CLIENT_ID=your_developer_key_client_id
CANVAS_DEPLOYMENT_ID=your_deployment_id

# Session Configuration
SESSION_SECRET=your_random_secure_session_secret_here
```

**Important:** Never commit `.env` to version control!

---

## 🔧 Canvas Developer Key Setup

### Step 1: Create Developer Key

1. Navigate to **Admin → Developer Keys** in Canvas
2. Click **+ Developer Key → + LTI Key**
3. Configure the key:

**Key Settings:**
- **Key Name:** SK Attendance
- **Redirect URIs:** `https://your-url.com/lti/launch`
- **Method:** Manual Entry
- **Title:** SK Attendance - Anwesenheitstool
- **Target Link URI:** `https://your-url.com/lti/launch`
- **OpenID Connect Initiation URL:** `https://your-url.com/lti/login`
- **JWK Method:** Public JWK URL
- **Public JWK URL:** `https://your-url.com/lti/jwks`

**Placements:**
- ☑️ **Course Navigation** (Main placement)

**Custom Fields:**
```
canvas_course_id=$Canvas.course.id
```

### Step 2: Enable the Developer Key

1. Set state to **ON**
2. Copy the **Client ID** (looks like `289220000000000001`)
3. Add to your `.env` file as `CANVAS_CLIENT_ID`

### Step 3: Install in Course/Account

1. **Account-Level (Recommended):**
   - Navigate to **Admin → Settings → Apps**
   - Click **+ App**
   - Choose **By Client ID**
   - Enter the Client ID
   - Click **Submit**

2. **Course-Level:**
   - Navigate to **Course → Settings → Apps**
   - Follow same steps as above

### Step 4: Canvas API Token (for Enrollment Sync)

1. Navigate to **Account → Settings → Approved Integrations**
2. Click **+ Access Token**
3. **Purpose:** "SK Attendance - Enrollment Sync"
4. **Expiration:** 1 year or permanent
5. Copy token to `.env` as `CANVAS_API_TOKEN`

---

## 📊 Database Schema

The tool uses PostgreSQL with the following main tables:

- **users** - Students and instructors (Canvas user data)
- **courses** - Canvas course information
- **sessions** - Individual class sessions with date/time
- **attendance_records** - Time-tracked attendance entries
- **checkin_tokens** - Time-limited QR-code tokens
- **excuses** - Student absence justifications with file uploads

See `ARCHITECTURE.md` for detailed schema documentation.

---

## 🎓 Usage Workflow

### For Instructors

1. **Open SK Attendance** tool in Canvas course navigation
2. **Create Session:**
   - Click "+ Neue Session erstellen"
   - Enter date, start time, end time, and break duration
   - Save

3. **Generate QR-Code:**
   - Click "📱 QR-Code generieren" on session
   - Canvas enrollments sync automatically
   - Display QR code to students (valid 15 minutes)

4. **Manual Attendance:**
   - Click "📝 Anwesenheit" on session
   - Use dropdowns to mark status:
     - **Anwesend (volle Zeit)** - Present full time
     - **Verspätet angekommen** - Late arrival (opens time modal)
     - **Früher gegangen** - Early departure (opens time modal)
     - **Abwesend** - Absent
     - **Entschuldigt** - Excused (if excuse uploaded)

5. **Export Reports:**
   - Click "📊 Excel Export" or "📄 CSV Export"
   - Download attendance data for all sessions

6. **Course Overview:**
   - Click "📊 Kurs-Übersicht anzeigen"
   - View attendance matrix for all students

### For Students

1. **Self Check-In:**
   - Scan QR code with smartphone
   - Enter full name and email
   - Submit (only works if enrolled in Canvas course)

2. **View Statistics:**
   - Open SK Attendance tool
   - See personal attendance percentage and hours

3. **BAföG Certificate:**
   - Click "📄 BAföG-Bescheinigung generieren"
   - Download official PDF certificate

4. **Upload Excuse:**
   - Click "📎 Entschuldigung hochladen"
   - Select session and upload file (PDF/JPG/PNG)

---

## 🔒 Security Features

### Whitelist-Based Check-In

Only students enrolled in the Canvas course can check in via QR code. This prevents:
- ❌ Unauthorized attendance recording
- ❌ "Proxy attendance" by non-students
- ❌ Check-ins for wrong courses

**How it works:**
1. Instructor generates QR code
2. System syncs all active Canvas enrollments
3. Student scans QR and enters name/email
4. System validates: Is this person in the Canvas enrollment list?
5. If yes → Check-in allowed ✅
6. If no → Rejected with error message ❌

### Time-Limited QR Codes

QR codes automatically expire after 15 minutes (configurable). This prevents:
- ❌ Students checking in from home after class
- ❌ QR codes being shared outside class time
- ❌ Old QR codes being reused

### Session-Based Authentication

All instructor actions require valid LTI session with Canvas authentication:
- ✅ Session creation/editing
- ✅ Manual attendance marking
- ✅ Report generation
- ✅ QR code generation

---

## 🌐 Production Deployment

For production environments, use a permanent tunnel solution instead of `trycloudflare.com`:

### Option 1: Cloudflare Named Tunnel (Recommended)

```bash
# Install cloudflared
brew install cloudflare/cloudflare/cloudflared

# Login to Cloudflare
cloudflared tunnel login

# Create named tunnel
cloudflared tunnel create sk-attendance

# Configure tunnel
cat > ~/.cloudflared/config.yml << EOF
tunnel: sk-attendance
credentials-file: ~/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: attendance.your-domain.com
    service: http://localhost:3001
  - service: http_status:404
EOF

# Run tunnel
cloudflared tunnel run sk-attendance
```

**Benefits:**
- ✅ Fixed URL (never changes)
- ✅ 99.9% uptime guarantee
- ✅ Free with Cloudflare account
- ✅ Auto-restart on crashes

### Option 2: ngrok Pro

```bash
# Install ngrok
brew install ngrok

# Authenticate
ngrok config add-authtoken <your-token>

# Start with fixed domain
ngrok http 3001 --domain=sk-attendance.ngrok.app
```

### Option 3: Traditional Hosting

Deploy to:
- **DigitalOcean App Platform**
- **Heroku**
- **AWS Elastic Beanstalk**
- **Azure App Service**

See `DEPLOYMENT.md` for detailed production deployment guide.

---

## 🛠️ Development

### Project Structure

```
sk-attendance-lti/
├── server-simplified.js       # Main Express server + LTI handlers
├── routes/
│   └── attendance.js          # Attendance API routes
├── public/
│   ├── js/
│   │   └── attendance.js      # Frontend JavaScript
│   └── css/
│       └── styles.css         # Responsive CSS
├── schema.sql                 # PostgreSQL database schema
├── .env.example              # Environment variables template
├── package.json              # Dependencies
└── README.md                 # This file
```

### Key Technologies

- **Backend:** Node.js + Express
- **Database:** PostgreSQL with pg driver
- **LTI:** Canvas LTI 1.3 with JWT verification
- **QR Codes:** qrcode library
- **PDFs:** PDFKit for BAföG certificates
- **Excel:** xlsx library
- **Sessions:** express-session with PostgreSQL store

### Adding Features

1. **Database Changes:** Update `schema.sql` and migrate
2. **API Routes:** Add endpoints in `routes/attendance.js`
3. **Frontend:** Update `public/js/attendance.js` and render functions
4. **LTI Views:** Modify `renderInstructorView()` or `renderStudentView()` in main server

---

## 🐛 Troubleshooting

### Common Issues

**Problem:** LTI Launch fails with "bad request"

**Solution:**
- Verify all URLs in Developer Key match your tunnel URL
- Ensure no trailing slashes: `https://example.com` not `https://example.com/`
- Check `PUBLIC_URL` in `.env` has no trailing slash

---

**Problem:** QR code check-in returns "Nicht registriert"

**Solution:**
- Ensure Canvas API token is configured
- Check student is actually enrolled in Canvas course
- Verify enrollment sync completed (check terminal logs)
- Run manual sync test: `await syncCourseEnrollments('course-id')`

---

**Problem:** Modals for "Verspätet/Früher gegangen" don't appear

**Solution:**
- Hard reload browser (Cmd+Shift+R)
- Check browser console for JavaScript errors
- Verify `attendance.js` is loaded (check Network tab)
- Ensure you're in correct iframe context (select `tool_content_XXX` in Console dropdown)

---

**Problem:** Students appear twice in course overview

**Solution:**
- This happens when LTI user IDs differ from Canvas API user IDs
- Clean up duplicates: `DELETE FROM users WHERE role = 'student'`
- Regenerate QR code to re-sync enrollments

---

**Problem:** Database connection fails

**Solution:**
- Verify PostgreSQL is running: `brew services list`
- Check credentials in `.env` match database user
- Ensure database exists: `psql -l | grep attendance`
- Grant permissions: `GRANT ALL PRIVILEGES ON DATABASE attendance TO attendance_user;`

---

## 📝 License

This project is proprietary software developed for SK (Süddeutsche Karriere).

**Restrictions:**
- ❌ Not open source
- ❌ No redistribution
- ❌ No commercial use without permission
- ✅ Internal use within SK organization
- ✅ Modifications for internal purposes

For licensing inquiries, contact: neumannsrb@gmail.com

---

## 🤝 Contributing

This is an internal project. For external developers interested in contributing:

1. **Read** `ARCHITECTURE.md` for technical details
2. **Check** `TODO.md` for open features
3. **Contact** project maintainer before starting work
4. **Follow** existing code style and patterns
5. **Test** thoroughly before submitting changes

---

## 📚 Additional Documentation

- **ARCHITECTURE.md** - Technical architecture and database schema
- **DEPLOYMENT.md** - Production deployment guide
- **TODO.md** - Planned features and known issues
- **CHANGELOG.md** - Version history and changes

---

## 📞 Support

For issues, questions, or feature requests:

- **Email:** neumannsrb@gmail.com
- **GitHub Issues:** https://github.com/umkaru/sk-attendance-lti/issues

---

## 🙏 Acknowledgments

Built with assistance from Claude (Anthropic) for:
- Architecture design and implementation
- Bug fixing and optimization
- Documentation and deployment guidance

Developed for **Süddeutsche Karriere (SK)** to modernize attendance tracking for Canvas LMS courses with BAföG compliance requirements.

---

**Version:** 2.0.0  
**Last Updated:** February 9, 2026  
**Status:** Production Ready ✅
