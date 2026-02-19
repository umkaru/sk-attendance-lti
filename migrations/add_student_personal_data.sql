-- Migration: Add personal data fields to users table for BAföG

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS familienname TEXT,
ADD COLUMN IF NOT EXISTS vorname TEXT,
ADD COLUMN IF NOT EXISTS geburtsdatum DATE,
ADD COLUMN IF NOT EXISTS strasse TEXT,
ADD COLUMN IF NOT EXISTS hausnummer TEXT,
ADD COLUMN IF NOT EXISTS plz TEXT,
ADD COLUMN IF NOT EXISTS wohnort TEXT;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_personal_data ON users(canvas_user_id) WHERE familienname IS NOT NULL;

COMMENT ON COLUMN users.familienname IS 'Familienname für BAföG Formblatt F';
COMMENT ON COLUMN users.vorname IS 'Vorname(n) für BAföG Formblatt F';
COMMENT ON COLUMN users.geburtsdatum IS 'Geburtsdatum für BAföG Formblatt F';
COMMENT ON COLUMN users.strasse IS 'Straße für BAföG Formblatt F';
COMMENT ON COLUMN users.hausnummer IS 'Hausnummer für BAföG Formblatt F';
COMMENT ON COLUMN users.plz IS 'Postleitzahl für BAföG Formblatt F';
COMMENT ON COLUMN users.wohnort IS 'Wohnort für BAföG Formblatt F';
