-- Mandanten (Canvas Instanzen / Deployments)
CREATE TABLE tenants (
  id SERIAL PRIMARY KEY,
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  deployment_id TEXT NOT NULL
);

-- Kurse
CREATE TABLE courses (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER REFERENCES tenants(id),
  canvas_course_id TEXT NOT NULL,
  course_name TEXT
);

-- Sitzungen (z. B. Samstag Vormittag)
CREATE TABLE sessions (
  id SERIAL PRIMARY KEY,
  course_id INTEGER REFERENCES courses(id),
  start_ts TIMESTAMPTZ NOT NULL,
  end_ts TIMESTAMPTZ NOT NULL,
  expected_minutes INTEGER NOT NULL
);

-- Anwesenheitsdaten
CREATE TABLE attendance_records (
  id SERIAL PRIMARY KEY,
  session_id INTEGER REFERENCES sessions(id),
  canvas_user_id TEXT NOT NULL,
  present_from TIMESTAMPTZ NOT NULL,
  present_to TIMESTAMPTZ NOT NULL,
  minutes INTEGER NOT NULL,
  note TEXT
);

-- Änderungsprotokoll (wichtig für Nachweise)
CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  performed_by TEXT NOT NULL,
  performed_at TIMESTAMPTZ DEFAULT now()
);