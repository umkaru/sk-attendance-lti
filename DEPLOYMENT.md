# Production Deployment Guide

**SK Attendance LTI Tool - Production Deployment**

This guide covers deploying the SK Attendance LTI tool to production environments with best practices for security, scalability, and reliability.

---

## 📋 Table of Contents

- [Pre-Deployment Checklist](#pre-deployment-checklist)
- [Hosting Options](#hosting-options)
- [Cloudflare Tunnel Setup](#cloudflare-tunnel-setup)
- [Traditional Server Deployment](#traditional-server-deployment)
- [Environment Configuration](#environment-configuration)
- [SSL/HTTPS Setup](#sslhttps-setup)
- [Database Management](#database-management)
- [Process Management](#process-management)
- [Monitoring & Logging](#monitoring--logging)
- [Backup Strategy](#backup-strategy)
- [Performance Optimization](#performance-optimization)
- [Security Hardening](#security-hardening)
- [Scaling Considerations](#scaling-considerations)
- [Troubleshooting](#troubleshooting)

---

## ✅ Pre-Deployment Checklist

Before deploying to production, ensure you have:

### Infrastructure
- [ ] Production server or cloud hosting account
- [ ] PostgreSQL database (12+ recommended)
- [ ] Domain name (optional but recommended)
- [ ] SSL certificate (Let's Encrypt or commercial)
- [ ] Backup storage solution

### Canvas Setup
- [ ] Canvas Developer Key created and enabled
- [ ] Canvas API token generated (for enrollment sync)
- [ ] LTI tool installed at account/course level
- [ ] Test launches successful in development

### Configuration
- [ ] Production `.env` file configured
- [ ] Database credentials secured
- [ ] Session secret generated (strong random string)
- [ ] Public URL confirmed and stable

### Security
- [ ] All secrets in environment variables (not hardcoded)
- [ ] `.env` added to `.gitignore`
- [ ] Database backups configured
- [ ] Firewall rules configured
- [ ] SSL/HTTPS enabled

---

## 🏢 Hosting Options

### Option 1: Cloudflare Tunnel (Recommended for Quick Start)

**Best for:** Development, testing, small deployments

**Pros:**
- ✅ No server configuration needed
- ✅ Automatic HTTPS
- ✅ Fixed URL with Named Tunnel
- ✅ Free for basic use
- ✅ DDoS protection included

**Cons:**
- ❌ Requires Cloudflare account
- ❌ Dependent on Cloudflare infrastructure
- ❌ Limited customization

**Setup:** See [Cloudflare Tunnel Setup](#cloudflare-tunnel-setup)

---

### Option 2: DigitalOcean App Platform

**Best for:** Small to medium deployments, managed infrastructure

**Pros:**
- ✅ Managed PostgreSQL included
- ✅ Auto-scaling
- ✅ Built-in monitoring
- ✅ Git-based deployments
- ✅ Free SSL certificates

**Cons:**
- ❌ Cost: ~$12-25/month
- ❌ Less control than VPS

**Deployment:**

```bash
# 1. Install doctl CLI
brew install doctl

# 2. Authenticate
doctl auth init

# 3. Create app spec
cat > .do/app.yaml << EOF
name: sk-attendance-lti
services:
- name: web
  github:
    repo: umkaru/sk-attendance-lti
    branch: main
  build_command: npm install
  run_command: npm start
  envs:
  - key: NODE_ENV
    value: production
  - key: PORT
    value: "8080"
  http_port: 8080
databases:
- name: attendance-db
  engine: PG
  version: "14"
EOF

# 4. Deploy
doctl apps create --spec .do/app.yaml
```

**Cost Estimate:**
- App: $12/month (Basic)
- Database: $15/month (1GB RAM)
- **Total: ~$27/month**

---

### Option 3: Heroku

**Best for:** Rapid deployment, minimal DevOps

**Pros:**
- ✅ Easy Git-based deployment
- ✅ Add-ons marketplace
- ✅ Free tier available
- ✅ Good documentation

**Cons:**
- ❌ Dyno sleep on free tier
- ❌ More expensive than alternatives
- ❌ File storage ephemeral (need S3 for excuses)

**Deployment:**

```bash
# 1. Install Heroku CLI
brew install heroku

# 2. Login
heroku login

# 3. Create app
heroku create sk-attendance-lti

# 4. Add PostgreSQL
heroku addons:create heroku-postgresql:mini

# 5. Set environment variables
heroku config:set NODE_ENV=production
heroku config:set SESSION_SECRET=$(openssl rand -hex 32)
heroku config:set CANVAS_API_TOKEN=your_token
# ... (set all variables from .env)

# 6. Deploy
git push heroku main

# 7. Run migrations
heroku run bash
psql $DATABASE_URL -f schema.sql
```

**Cost Estimate:**
- Dyno: $7/month (Eco)
- PostgreSQL: $5/month (Mini)
- **Total: ~$12/month**

---

### Option 4: AWS Elastic Beanstalk

**Best for:** Enterprise deployments, AWS ecosystem

**Pros:**
- ✅ Auto-scaling
- ✅ Load balancing
- ✅ Integration with other AWS services
- ✅ RDS PostgreSQL option

**Cons:**
- ❌ More complex setup
- ❌ Higher cost
- ❌ Steeper learning curve

---

### Option 5: Traditional VPS (DigitalOcean Droplet, Linode, etc.)

**Best for:** Maximum control, custom requirements

**Pros:**
- ✅ Full control over environment
- ✅ Cost-effective for scale
- ✅ Can host multiple apps
- ✅ SSH access

**Cons:**
- ❌ Manual server management
- ❌ You handle security updates
- ❌ No managed database

**Setup:** See [Traditional Server Deployment](#traditional-server-deployment)

---

## ☁️ Cloudflare Tunnel Setup

### Named Tunnel (Production)

**Step 1: Install cloudflared**

```bash
# macOS
brew install cloudflare/cloudflare/cloudflared

# Linux
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
sudo mv cloudflared-linux-amd64 /usr/local/bin/cloudflared
sudo chmod +x /usr/local/bin/cloudflared

# Verify installation
cloudflared --version
```

---

**Step 2: Authenticate with Cloudflare**

```bash
cloudflared tunnel login
```

This opens a browser window. Select your domain and authorize.

---

**Step 3: Create Named Tunnel**

```bash
# Create tunnel
cloudflared tunnel create sk-attendance

# Output:
# Tunnel credentials written to: ~/.cloudflared/<TUNNEL-ID>.json
# Created tunnel sk-attendance with id <TUNNEL-ID>
```

**Save the Tunnel ID!** You'll need it.

---

**Step 4: Configure DNS**

**Option A: Cloudflare-managed domain**

```bash
# Route subdomain to tunnel
cloudflared tunnel route dns sk-attendance attendance.yourdomain.com
```

**Option B: Manual DNS setup**

Add CNAME record in Cloudflare dashboard:
```
Type: CNAME
Name: attendance
Target: <TUNNEL-ID>.cfargotunnel.com
Proxy: On (orange cloud)
```

---

**Step 5: Create Configuration File**

```bash
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml << EOF
tunnel: sk-attendance
credentials-file: ~/.cloudflared/<TUNNEL-ID>.json

ingress:
  - hostname: attendance.yourdomain.com
    service: http://localhost:3001
  - service: http_status:404
EOF
```

---

**Step 6: Update Canvas Developer Key**

Update all URLs in Canvas:
- **Redirect URIs:** `https://attendance.yourdomain.com/lti/launch`
- **Target Link URI:** `https://attendance.yourdomain.com/lti/launch`
- **OpenID Connect Initiation URL:** `https://attendance.yourdomain.com/lti/login`
- **JWK URL:** `https://attendance.yourdomain.com/lti/jwks`

---

**Step 7: Update `.env`**

```bash
PUBLIC_URL=https://attendance.yourdomain.com
```

**No trailing slash!**

---

**Step 8: Start Services**

**Terminal 1: Application**
```bash
cd ~/sk-attendance-lti
npm start
```

**Terminal 2: Tunnel**
```bash
cloudflared tunnel run sk-attendance
```

---

**Step 9: Verify Connection**

```bash
# Check tunnel status
cloudflared tunnel info sk-attendance

# Test endpoint
curl https://attendance.yourdomain.com/health
```

---

### Systemd Service (Auto-Start on Boot)

**Create service file:**

```bash
sudo nano /etc/systemd/system/cloudflared-sk-attendance.service
```

**Content:**

```ini
[Unit]
Description=Cloudflare Tunnel for SK Attendance
After=network.target

[Service]
Type=simple
User=youruser
ExecStart=/usr/local/bin/cloudflared tunnel run sk-attendance
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

**Enable and start:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable cloudflared-sk-attendance
sudo systemctl start cloudflared-sk-attendance

# Check status
sudo systemctl status cloudflared-sk-attendance
```

---

## 🖥️ Traditional Server Deployment

### Step 1: Provision Server

**Recommended Specs:**
- **CPU:** 2 cores minimum
- **RAM:** 2 GB minimum
- **Storage:** 20 GB SSD
- **OS:** Ubuntu 22.04 LTS

**Providers:**
- DigitalOcean Droplet: $12/month
- Linode: $12/month
- Vultr: $12/month
- Hetzner: €4.50/month

---

### Step 2: Initial Server Setup

```bash
# SSH into server
ssh root@your-server-ip

# Update system
apt update && apt upgrade -y

# Create non-root user
adduser skattendance
usermod -aG sudo skattendance

# Setup SSH key authentication
mkdir -p /home/skattendance/.ssh
cp ~/.ssh/authorized_keys /home/skattendance/.ssh/
chown -R skattendance:skattendance /home/skattendance/.ssh
chmod 700 /home/skattendance/.ssh
chmod 600 /home/skattendance/.ssh/authorized_keys

# Disable root SSH login
nano /etc/ssh/sshd_config
# Set: PermitRootLogin no
systemctl restart sshd

# Switch to new user
su - skattendance
```

---

### Step 3: Install Dependencies

```bash
# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # Should be v18.x
npm --version

# Install PostgreSQL
sudo apt install -y postgresql postgresql-contrib

# Install Nginx (reverse proxy)
sudo apt install -y nginx

# Install certbot (SSL certificates)
sudo apt install -y certbot python3-certbot-nginx

# Install PM2 (process manager)
sudo npm install -g pm2
```

---

### Step 4: Configure PostgreSQL

```bash
# Switch to postgres user
sudo -i -u postgres

# Create database and user
createdb attendance
createuser attendance_user

# Set password and permissions
psql
```

```sql
ALTER USER attendance_user WITH PASSWORD 'secure_random_password_here';
GRANT ALL PRIVILEGES ON DATABASE attendance TO attendance_user;
\q
```

```bash
# Exit postgres user
exit
```

---

### Step 5: Clone Repository

```bash
# Create app directory
cd /home/skattendance
git clone https://github.com/umkaru/sk-attendance-lti.git
cd sk-attendance-lti

# Install dependencies
npm install --production

# Create .env file
cp .env.example .env
nano .env
```

---

### Step 6: Configure Environment

**Edit `.env`:**

```bash
# Server
PORT=3001
NODE_ENV=production
PUBLIC_URL=https://attendance.yourdomain.com

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=attendance
DB_USER=attendance_user
DB_PASSWORD=your_secure_password

# Canvas API
CANVAS_API_TOKEN=your_canvas_admin_token
CANVAS_BASE_URL=https://your-canvas-instance.instructure.com

# Canvas LTI
CANVAS_PLATFORM_URL=https://canvas.instructure.com
CANVAS_CLIENT_ID=your_developer_key_id
CANVAS_DEPLOYMENT_ID=your_deployment_id

# Session
SESSION_SECRET=$(openssl rand -hex 32)
```

---

### Step 7: Initialize Database

```bash
psql -U attendance_user -d attendance -f schema.sql
```

---

### Step 8: Configure Nginx Reverse Proxy

```bash
sudo nano /etc/nginx/sites-available/sk-attendance
```

**Content:**

```nginx
server {
    listen 80;
    server_name attendance.yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Increase timeouts for LTI
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
}
```

**Enable site:**

```bash
sudo ln -s /etc/nginx/sites-available/sk-attendance /etc/nginx/sites-enabled/
sudo nginx -t  # Test configuration
sudo systemctl restart nginx
```

---

### Step 9: Setup SSL with Let's Encrypt

```bash
# Obtain certificate
sudo certbot --nginx -d attendance.yourdomain.com

# Follow prompts to:
# - Enter email address
# - Agree to terms
# - Choose redirect HTTP to HTTPS (recommended)

# Verify certificate
sudo certbot certificates

# Test auto-renewal
sudo certbot renew --dry-run
```

**Certificate auto-renews via systemd timer.**

---

### Step 10: Configure PM2 Process Manager

```bash
# Start application
pm2 start npm --name "sk-attendance" -- start

# Configure to start on boot
pm2 startup systemd
# Run the command it outputs

# Save PM2 process list
pm2 save

# Check status
pm2 status
pm2 logs sk-attendance --lines 50
```

---

### Step 11: Configure Firewall

```bash
# Enable UFW firewall
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable

# Verify rules
sudo ufw status
```

---

### Step 12: Test Deployment

```bash
# Test health endpoint
curl https://attendance.yourdomain.com/health

# Test LTI endpoints
curl https://attendance.yourdomain.com/lti/jwks

# Check PM2 logs
pm2 logs sk-attendance
```

---

## ⚙️ Environment Configuration

### Production `.env` Template

```bash
# ======================
# Server Configuration
# ======================
PORT=3001
NODE_ENV=production
PUBLIC_URL=https://attendance.yourdomain.com

# ======================
# Database Configuration
# ======================
DB_HOST=localhost
DB_PORT=5432
DB_NAME=attendance
DB_USER=attendance_user
DB_PASSWORD=CHANGE_ME_STRONG_PASSWORD

# ======================
# Canvas API Integration
# ======================
CANVAS_API_TOKEN=CHANGE_ME_CANVAS_ADMIN_TOKEN
CANVAS_BASE_URL=https://your-canvas-instance.instructure.com

# ======================
# Canvas LTI Configuration
# ======================
CANVAS_PLATFORM_URL=https://canvas.instructure.com
CANVAS_CLIENT_ID=CHANGE_ME_DEVELOPER_KEY_ID
CANVAS_DEPLOYMENT_ID=CHANGE_ME_DEPLOYMENT_ID

# ======================
# Session Configuration
# ======================
SESSION_SECRET=CHANGE_ME_RANDOM_64_CHARS

# ======================
# Optional: File Upload Limits
# ======================
MAX_FILE_SIZE=5242880  # 5 MB in bytes
```

### Generating Secure Secrets

```bash
# Session secret (64 characters)
openssl rand -hex 32

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 🔒 SSL/HTTPS Setup

### Why HTTPS is Required

- **LTI 1.3 Requirement:** Canvas requires HTTPS for all LTI tools
- **Cookie Security:** Session cookies need `secure` flag
- **Data Protection:** Protects sensitive student data in transit

### Let's Encrypt (Free)

**Already covered in Traditional Server Deployment Section 9.**

**Certificate location:**
```
/etc/letsencrypt/live/attendance.yourdomain.com/fullchain.pem
/etc/letsencrypt/live/attendance.yourdomain.com/privkey.pem
```

**Auto-renewal:** Runs via systemd timer, no action needed.

---

### Commercial SSL Certificate

If using commercial SSL (e.g., from domain registrar):

**1. Generate CSR:**

```bash
openssl req -new -newkey rsa:2048 -nodes \
  -keyout attendance.key \
  -out attendance.csr
```

**2. Submit CSR to certificate authority**

**3. Download certificate files**

**4. Configure Nginx:**

```nginx
server {
    listen 443 ssl http2;
    server_name attendance.yourdomain.com;

    ssl_certificate /path/to/attendance.crt;
    ssl_certificate_key /path/to/attendance.key;
    ssl_trusted_certificate /path/to/ca-bundle.crt;

    # Modern SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # ... rest of configuration
}
```

---

## 💾 Database Management

### Backup Strategy

**Daily Automated Backups:**

```bash
# Create backup script
nano /home/skattendance/backup-db.sh
```

```bash
#!/bin/bash
BACKUP_DIR="/home/skattendance/backups"
DATE=$(date +%Y-%m-%d_%H-%M-%S)
FILENAME="attendance_backup_${DATE}.sql"

mkdir -p $BACKUP_DIR

# Create backup
pg_dump -U attendance_user attendance > "${BACKUP_DIR}/${FILENAME}"

# Compress
gzip "${BACKUP_DIR}/${FILENAME}"

# Delete backups older than 30 days
find $BACKUP_DIR -name "attendance_backup_*.sql.gz" -mtime +30 -delete

echo "Backup completed: ${FILENAME}.gz"
```

```bash
# Make executable
chmod +x /home/skattendance/backup-db.sh

# Add to crontab (daily at 2 AM)
crontab -e
```

```
0 2 * * * /home/skattendance/backup-db.sh >> /home/skattendance/backup.log 2>&1
```

---

### Restore from Backup

```bash
# Decompress
gunzip attendance_backup_2026-02-09_02-00-00.sql.gz

# Stop application
pm2 stop sk-attendance

# Drop and recreate database
dropdb -U attendance_user attendance
createdb -U attendance_user attendance

# Restore
psql -U attendance_user attendance < attendance_backup_2026-02-09_02-00-00.sql

# Restart application
pm2 start sk-attendance
```

---

### Database Migrations

**For schema changes:**

```bash
# 1. Create migration file
cat > migrations/001_add_column.sql << EOF
-- Add new column
ALTER TABLE attendance_records 
ADD COLUMN IF NOT EXISTS custom_field TEXT;

-- Add index
CREATE INDEX IF NOT EXISTS idx_custom_field 
ON attendance_records(custom_field);
EOF

# 2. Apply migration
psql -U attendance_user -d attendance -f migrations/001_add_column.sql

# 3. Test application
pm2 restart sk-attendance
pm2 logs sk-attendance
```

---

## 🔄 Process Management

### PM2 Commands

```bash
# Start application
pm2 start npm --name "sk-attendance" -- start

# Stop application
pm2 stop sk-attendance

# Restart application
pm2 restart sk-attendance

# View logs
pm2 logs sk-attendance
pm2 logs sk-attendance --lines 100

# Monitor resources
pm2 monit

# Show process info
pm2 show sk-attendance

# List all processes
pm2 list

# Delete process
pm2 delete sk-attendance

# Save current process list
pm2 save

# Resurrect saved processes after reboot
pm2 resurrect
```

---

### PM2 Ecosystem File

**For more control, use ecosystem file:**

```bash
nano ecosystem.config.js
```

```javascript
module.exports = {
  apps: [{
    name: 'sk-attendance',
    script: 'server-simplified.js',
    instances: 2,  // Run 2 instances (cluster mode)
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    max_memory_restart: '500M',
    autorestart: true,
    watch: false
  }]
};
```

```bash
# Start with ecosystem file
pm2 start ecosystem.config.js

# Reload (zero-downtime)
pm2 reload ecosystem.config.js
```

---

## 📊 Monitoring & Logging

### Application Logs

**PM2 logs location:**
```
~/.pm2/logs/sk-attendance-out.log
~/.pm2/logs/sk-attendance-error.log
```

**View logs:**
```bash
# Real-time logs
pm2 logs sk-attendance

# Last 100 lines
pm2 logs sk-attendance --lines 100

# Only errors
pm2 logs sk-attendance --err

# Clear logs
pm2 flush
```

---

### Nginx Access Logs

```bash
# Access log
tail -f /var/log/nginx/access.log

# Error log
tail -f /var/log/nginx/error.log

# Filter for errors only
grep "error" /var/log/nginx/error.log

# Today's 404 errors
grep "404" /var/log/nginx/access.log | grep $(date +%d/%b/%Y)
```

---

### PostgreSQL Logs

```bash
# Find log location
sudo -u postgres psql -c "SHOW log_directory;"
sudo -u postgres psql -c "SHOW log_filename;"

# View logs
sudo tail -f /var/log/postgresql/postgresql-14-main.log
```

---

### System Monitoring

**Install monitoring tools:**

```bash
# htop - interactive process viewer
sudo apt install htop

# iotop - I/O monitoring
sudo apt install iotop

# netdata - real-time monitoring dashboard
bash <(curl -Ss https://my-netdata.io/kickstart.sh)
# Access at: http://your-server-ip:19999
```

---

### Uptime Monitoring

**External services (recommended):**

- **UptimeRobot:** https://uptimerobot.com (Free tier: 50 monitors)
- **Pingdom:** https://pingdom.com
- **StatusCake:** https://statuscake.com

**Setup:**
1. Add URL: `https://attendance.yourdomain.com/health`
2. Check interval: 5 minutes
3. Email alerts on downtime

---

## 🔐 Security Hardening

### Firewall Configuration

```bash
# Only allow necessary ports
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

---

### SSH Hardening

```bash
sudo nano /etc/ssh/sshd_config
```

**Recommended settings:**

```
# Disable root login
PermitRootLogin no

# Disable password authentication (use SSH keys only)
PasswordAuthentication no
PubkeyAuthentication yes

# Disable empty passwords
PermitEmptyPasswords no

# Limit authentication attempts
MaxAuthTries 3

# Disconnect idle sessions
ClientAliveInterval 300
ClientAliveCountMax 2
```

```bash
sudo systemctl restart sshd
```

---

### Fail2Ban (Brute Force Protection)

```bash
# Install
sudo apt install fail2ban

# Create local config
sudo cp /etc/fail2ban/jail.conf /etc/fail2ban/jail.local
sudo nano /etc/fail2ban/jail.local
```

**Enable SSH protection:**

```ini
[sshd]
enabled = true
port = ssh
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
```

```bash
# Start service
sudo systemctl enable fail2ban
sudo systemctl start fail2ban

# Check status
sudo fail2ban-client status
sudo fail2ban-client status sshd
```

---

### Automatic Security Updates

```bash
# Install unattended-upgrades
sudo apt install unattended-upgrades

# Enable automatic updates
sudo dpkg-reconfigure --priority=low unattended-upgrades

# Configure
sudo nano /etc/apt/apt.conf.d/50unattended-upgrades
```

**Ensure these lines are uncommented:**

```
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
};
Unattended-Upgrade::Automatic-Reboot "false";
```

---

### Environment Variable Security

**Never commit `.env` to Git:**

```bash
# Add to .gitignore
echo ".env" >> .gitignore
echo "*.env" >> .gitignore
```

**Set restrictive permissions:**

```bash
chmod 600 .env
```

---

## 📈 Performance Optimization

### Node.js Performance

**Cluster mode with PM2:**

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'sk-attendance',
    script: 'server-simplified.js',
    instances: 'max',  // Use all CPU cores
    exec_mode: 'cluster'
  }]
};
```

---

### PostgreSQL Optimization

**Tune PostgreSQL settings:**

```bash
sudo nano /etc/postgresql/14/main/postgresql.conf
```

**For 2GB RAM server:**

```ini
# Memory
shared_buffers = 512MB
effective_cache_size = 1536MB
maintenance_work_mem = 128MB
work_mem = 16MB

# Connections
max_connections = 100

# Checkpoint
checkpoint_completion_target = 0.9
wal_buffers = 16MB

# Query Planning
random_page_cost = 1.1  # For SSD
effective_io_concurrency = 200
```

```bash
sudo systemctl restart postgresql
```

---

### Nginx Caching

**Enable static file caching:**

```nginx
server {
    # ... existing config ...

    # Cache static files
    location ~* \.(jpg|jpeg|png|gif|ico|css|js)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}
```

---

### Connection Pooling

**Already configured in code, but verify:**

```javascript
// server-simplified.js
const pool = new Pool({
  max: 20,                    // Max connections
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});
```

**Monitor pool usage:**

```javascript
// Add to server startup
setInterval(() => {
  console.log('Pool stats:', {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount
  });
}, 60000);  // Log every minute
```

---

## 📈 Scaling Considerations

### Horizontal Scaling (Multiple Servers)

**Requirements:**
1. **Load Balancer** (Nginx, HAProxy, AWS ALB)
2. **Shared Database** (Single PostgreSQL instance)
3. **Shared Session Store** (Redis recommended)
4. **Shared File Storage** (NFS or S3 for excuses)

**Redis Session Store:**

```bash
# Install Redis
sudo apt install redis-server

# Install Node.js Redis client
npm install connect-redis redis
```

```javascript
// Update server-simplified.js
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');

const redisClient = createClient({
  host: 'localhost',
  port: 6379
});

redisClient.connect();

app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: SESSION_SECRET,
  // ... rest of config
}));
```

---

### Vertical Scaling (Bigger Server)

**Upgrade path:**

| Users | RAM | CPU | Storage | Est. Cost |
|-------|-----|-----|---------|-----------|
| 0-100 | 2GB | 2 core | 20GB | $12/month |
| 100-500 | 4GB | 2 core | 40GB | $24/month |
| 500-1000 | 8GB | 4 core | 80GB | $48/month |
| 1000+ | 16GB+ | 8 core | 160GB+ | $96/month+ |

---

### CDN for Static Assets

**If scaling globally, use CDN:**

1. **Cloudflare** (Free tier available)
2. **AWS CloudFront**
3. **Fastly**

**Benefits:**
- Faster static file delivery
- Reduced server load
- DDoS protection

---

## 🐛 Troubleshooting

### Application Won't Start

**Check logs:**
```bash
pm2 logs sk-attendance --lines 50
```

**Common issues:**

1. **Port already in use**
```bash
# Find process using port 3001
sudo lsof -i :3001
# Kill process
sudo kill -9 <PID>
```

2. **Database connection failed**
```bash
# Test database connection
psql -U attendance_user -d attendance -h localhost

# Check PostgreSQL status
sudo systemctl status postgresql
```

3. **Missing environment variables**
```bash
# Verify .env exists and is readable
ls -la .env
cat .env | grep -v PASSWORD  # View without showing passwords
```

---

### Canvas LTI Launch Fails

**Symptom:** "Bad request" or "Invalid launch"

**Debugging:**

```bash
# Check server logs
pm2 logs sk-attendance

# Look for these errors:
# - "Cannot verify token - public key not found"
# - "Missing id_token"
# - "JWT verification failed"
```

**Solutions:**

1. **Verify URLs in Canvas Developer Key**
   - Check for trailing slashes (should be NONE)
   - Ensure HTTPS (not HTTP)
   - Confirm PUBLIC_URL in .env matches URLs

2. **Check JWKS endpoint**
```bash
curl https://attendance.yourdomain.com/lti/jwks
# Should return: {"keys": [...]}
```

3. **Verify Canvas Platform URL**
```bash
# .env should have:
CANVAS_PLATFORM_URL=https://canvas.instructure.com
# NOT your specific Canvas instance!
```

---

### QR Code Check-In Not Working

**Symptom:** "Nicht registriert" error for enrolled students

**Debugging:**

```bash
# Check enrollment sync logs
pm2 logs sk-attendance | grep "Enrollment"

# Manually test sync
psql -U attendance_user -d attendance
```

```sql
-- Check if students exist
SELECT * FROM users WHERE role = 'student';

-- Check course mapping
SELECT * FROM courses WHERE canvas_course_id = 'your-course-id';
```

**Solutions:**

1. **Canvas API token missing/invalid**
```bash
# Verify token in .env
grep CANVAS_API_TOKEN .env

# Test API access
curl -H "Authorization: Bearer YOUR_TOKEN" \
  https://your-canvas.instructure.com/api/v1/courses/235/enrollments
```

2. **Numeric course ID not set**
```sql
-- Update course with numeric ID
UPDATE courses 
SET canvas_course_numeric_id = '235' 
WHERE canvas_course_id = 'your-hash-id';
```

---

### High Memory Usage

**Check memory:**
```bash
free -h
pm2 monit
```

**Solutions:**

1. **Restart application periodically**
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'sk-attendance',
    max_memory_restart: '500M',  // Restart at 500 MB
    // ...
  }]
};
```

2. **Increase server RAM**

3. **Optimize database queries**
```bash
# Check slow queries
psql -U attendance_user -d attendance
```

```sql
-- Enable slow query logging
ALTER SYSTEM SET log_min_duration_statement = 1000;  -- Log queries > 1s
SELECT pg_reload_conf();

-- View logs
SELECT * FROM pg_stat_statements ORDER BY total_time DESC LIMIT 10;
```

---

### SSL Certificate Issues

**Symptom:** "Certificate expired" or "Not secure"

**Check certificate:**
```bash
# View certificate info
sudo certbot certificates

# Test renewal
sudo certbot renew --dry-run

# Force renewal
sudo certbot renew --force-renewal
```

**If renewal fails:**
```bash
# Check if port 80 is blocked
sudo ufw status

# Ensure Nginx is running
sudo systemctl status nginx

# Check DNS propagation
nslookup attendance.yourdomain.com
```

---

### Database Connection Pool Exhausted

**Symptom:** "Sorry, too many clients already"

**Solutions:**

1. **Increase pool size**
```javascript
// server-simplified.js
const pool = new Pool({
  max: 40,  // Increase from 20
  // ...
});
```

2. **Increase PostgreSQL max connections**
```bash
sudo nano /etc/postgresql/14/main/postgresql.conf
```

```ini
max_connections = 200  # Increase from 100
```

```bash
sudo systemctl restart postgresql
```

---

## 📞 Support & Resources

### Getting Help

1. **Check logs first**
```bash
pm2 logs sk-attendance --lines 100
tail -f /var/log/nginx/error.log
```

2. **Search GitHub Issues**
   - https://github.com/umkaru/sk-attendance-lti/issues

3. **Contact maintainer**
   - Email: neumannsrb@gmail.com

---

### Useful Commands Cheat Sheet

```bash
# Application
pm2 start sk-attendance
pm2 restart sk-attendance
pm2 logs sk-attendance
pm2 monit

# Database
psql -U attendance_user -d attendance
pg_dump attendance > backup.sql
psql attendance < backup.sql

# Nginx
sudo nginx -t
sudo systemctl restart nginx
sudo tail -f /var/log/nginx/error.log

# SSL
sudo certbot renew
sudo certbot certificates

# System
sudo ufw status
sudo systemctl status postgresql
htop
df -h
```

---

**Last Updated:** February 9, 2026  
**Version:** 2.0.0  
**Maintainer:** neumannsrb@gmail.com
