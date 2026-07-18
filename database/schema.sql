-- =============================================================================
-- InternLoom — PostgreSQL DDL
-- Standalone custom auth (JWT + bcrypt); not Supabase Auth.
-- Run once against your database: psql $DATABASE_URL -f database/schema.sql
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- ENUM types
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  CREATE TYPE user_role AS ENUM ('student', 'company');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE job_location AS ENUM ('remote', 'hybrid', 'on-site');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE job_status AS ENUM ('Draft', 'Active', 'Closed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE application_status AS ENUM (
    'Submitted',
    'Under Review',
    'Shortlisted',
    'Rejected',
    'Offer Extended'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  password      VARCHAR(255) NOT NULL,
  role          user_role NOT NULL,
  is_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  otp           VARCHAR(6),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Defense-in-depth; primary validation remains at the API layer.
  CONSTRAINT chk_student_college_email CHECK (
    role <> 'student'
    OR (
      (email ILIKE '%.edu' OR email ILIKE '%.ac.in')
      AND email NOT ILIKE '%@gmail.com'
      AND email NOT ILIKE '%@yahoo.com'
      AND email NOT ILIKE '%@outlook.com'
    )
  )
);

CREATE TABLE IF NOT EXISTS student_profiles (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  name             VARCHAR(255),
  college          VARCHAR(255),
  branch           VARCHAR(255),
  graduation_year  INT,
  cgpa             NUMERIC(4, 2),
  skills           JSONB NOT NULL DEFAULT '[]'::JSONB,
  github_url       VARCHAR(500),
  linkedin_url     VARCHAR(500),
  bio              TEXT,
  resume_url       VARCHAR(500),

  CONSTRAINT chk_student_profiles_skills_array CHECK (jsonb_typeof(skills) = 'array'),
  CONSTRAINT chk_student_profiles_graduation_year CHECK (
    graduation_year IS NULL
    OR (graduation_year >= 1950 AND graduation_year <= 2100)
  ),
  CONSTRAINT chk_student_profiles_cgpa CHECK (
    cgpa IS NULL OR (cgpa >= 0 AND cgpa <= 10)
  )
);

CREATE TABLE IF NOT EXISTS job_listings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title                 VARCHAR(255) NOT NULL,
  description           TEXT NOT NULL,
  required_skills       JSONB NOT NULL DEFAULT '[]'::JSONB,
  preferred_skills      JSONB NOT NULL DEFAULT '[]'::JSONB,
  stipend               NUMERIC(12, 2),
  location              job_location NOT NULL,
  application_deadline  TIMESTAMPTZ NOT NULL,
  max_applicant_cap     INT NOT NULL CHECK (max_applicant_cap > 0),
  current_applicants    INT NOT NULL DEFAULT 0 CHECK (current_applicants >= 0),
  status                job_status NOT NULL DEFAULT 'Draft',
  is_approved           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_job_listings_required_skills_array CHECK (jsonb_typeof(required_skills) = 'array'),
  CONSTRAINT chk_job_listings_preferred_skills_array CHECK (jsonb_typeof(preferred_skills) = 'array'),
  CONSTRAINT chk_job_listings_applicant_cap CHECK (current_applicants <= max_applicant_cap),
  CONSTRAINT chk_job_listings_deadline_future_at_creation CHECK (
    application_deadline > created_at
  )
);

CREATE TABLE IF NOT EXISTS applications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  job_id      UUID NOT NULL REFERENCES job_listings (id) ON DELETE CASCADE,
  status      application_status NOT NULL DEFAULT 'Submitted',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_applications_student_job UNIQUE (student_id, job_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE INDEX IF NOT EXISTS idx_student_profiles_user_id ON student_profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_student_profiles_skills_gin ON student_profiles USING GIN (skills);

CREATE INDEX IF NOT EXISTS idx_job_listings_company_id ON job_listings (company_id);
CREATE INDEX IF NOT EXISTS idx_job_listings_status ON job_listings (status);
CREATE INDEX IF NOT EXISTS idx_job_listings_required_skills_gin ON job_listings USING GIN (required_skills);
CREATE INDEX IF NOT EXISTS idx_job_listings_preferred_skills_gin ON job_listings USING GIN (preferred_skills);

CREATE INDEX IF NOT EXISTS idx_applications_student_id ON applications (student_id);
CREATE INDEX IF NOT EXISTS idx_applications_job_id ON applications (job_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON applications (status);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (user_id, is_read) WHERE is_read = FALSE;

-- ---------------------------------------------------------------------------
-- Helper: profile completeness (computed at query time — not stored)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION student_profile_completeness(profile_row student_profiles)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  score NUMERIC := 0;
  normalized_bio_length INT := 0;
BEGIN
  IF profile_row.name IS NOT NULL AND btrim(profile_row.name) <> '' THEN
    score := score + 10;
  END IF;
  IF profile_row.college IS NOT NULL AND btrim(profile_row.college) <> '' THEN
    score := score + 10;
  END IF;
  IF profile_row.branch IS NOT NULL AND btrim(profile_row.branch) <> '' THEN
    score := score + 10;
  END IF;
  IF profile_row.graduation_year IS NOT NULL THEN
    score := score + 10;
  END IF;
  IF profile_row.cgpa IS NOT NULL THEN
    score := score + 10;
  END IF;
  IF profile_row.skills IS NOT NULL AND jsonb_array_length(profile_row.skills) > 0 THEN
    score := score + 20;
  END IF;
  IF profile_row.github_url IS NOT NULL AND btrim(profile_row.github_url) <> '' THEN
    score := score + 10;
  END IF;
  IF profile_row.linkedin_url IS NOT NULL AND btrim(profile_row.linkedin_url) <> '' THEN
    score := score + 10;
  END IF;
  IF profile_row.bio IS NOT NULL AND btrim(profile_row.bio) <> '' THEN
    normalized_bio_length := LEAST(20, GREATEST(0, LENGTH(btrim(profile_row.bio)) / 5));
    score := score + normalized_bio_length;
  END IF;
  IF profile_row.resume_url IS NOT NULL AND btrim(profile_row.resume_url) <> '' THEN
    score := score + 10;
  END IF;

  RETURN ROUND(LEAST(100, score), 2);
END;
$$;

CREATE OR REPLACE FUNCTION calculate_skill_match_score(
  student_skills JSONB,
  required_skills JSONB,
  preferred_skills JSONB
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  required_count   INT := COALESCE(jsonb_array_length(required_skills), 0);
  preferred_count  INT := COALESCE(jsonb_array_length(preferred_skills), 0);
  matched_required INT := 0;
  matched_preferred INT := 0;
  skill_text       TEXT;
  required_score   NUMERIC := 0;
  preferred_score  NUMERIC := 0;
BEGIN
  IF required_count > 0 THEN
    FOR skill_text IN
      SELECT jsonb_array_elements_text(required_skills)
    LOOP
      IF student_skills @> jsonb_build_array(skill_text) THEN
        matched_required := matched_required + 1;
      END IF;
    END LOOP;
    required_score := matched_required::NUMERIC / required_count::NUMERIC;
  END IF;

  IF preferred_count > 0 THEN
    FOR skill_text IN
      SELECT jsonb_array_elements_text(preferred_skills)
    LOOP
      IF student_skills @> jsonb_build_array(skill_text) THEN
        matched_preferred := matched_preferred + 1;
      END IF;
    END LOOP;
    preferred_score := matched_preferred::NUMERIC / preferred_count::NUMERIC;
  END IF;

  IF required_count = 0 AND preferred_count = 0 THEN
    RETURN 0;
  ELSIF required_count = 0 THEN
    RETURN ROUND(preferred_score * 100, 2);
  ELSIF preferred_count = 0 THEN
    RETURN ROUND(required_score * 100, 2);
  END IF;

  RETURN ROUND(((required_score * 0.7) + (preferred_score * 0.3)) * 100, 2);
END;
$$;

-- Convenience view for API queries.
CREATE OR REPLACE VIEW student_profiles_with_completeness AS
SELECT
  sp.*,
  student_profile_completeness(sp.*) AS profile_completeness_score
FROM student_profiles sp;

-- ---------------------------------------------------------------------------
-- Session flag for system-managed job status changes (cap / withdraw reopen)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_auto_job_status(enabled BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.auto_job_status', CASE WHEN enabled THEN 'true' ELSE 'false' END, TRUE);
END;
$$;

CREATE OR REPLACE FUNCTION is_auto_job_status()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN COALESCE(current_setting('app.auto_job_status', TRUE), 'false') = 'true';
END;
$$;

-- ---------------------------------------------------------------------------
-- Role / ownership guards
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_user_role_for_fk()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'student_profiles' THEN
    IF NOT EXISTS (
      SELECT 1 FROM users u WHERE u.id = NEW.user_id AND u.role = 'student'
    ) THEN
      RAISE EXCEPTION 'student_profiles.user_id must reference a student account';
    END IF;
  ELSIF TG_TABLE_NAME = 'job_listings' THEN
    IF NOT EXISTS (
      SELECT 1 FROM users u WHERE u.id = NEW.company_id AND u.role = 'company'
    ) THEN
      RAISE EXCEPTION 'job_listings.company_id must reference a company account';
    END IF;
  ELSIF TG_TABLE_NAME = 'applications' THEN
    IF NOT EXISTS (
      SELECT 1 FROM users u WHERE u.id = NEW.student_id AND u.role = 'student'
    ) THEN
      RAISE EXCEPTION 'applications.student_id must reference a student account';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Job listing state machine
-- Allowed manual transitions: Draft -> Active -> Closed
-- Closed -> Active is allowed only via set_auto_job_status(true) (withdraw reopen)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_job_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF is_auto_job_status() THEN
    IF OLD.status = 'Closed' AND NEW.status = 'Active' THEN
      RETURN NEW;
    END IF;
    IF NEW.status = 'Closed' AND NEW.current_applicants >= NEW.max_applicant_cap THEN
      RETURN NEW;
    END IF;
  END IF;

  IF OLD.status = 'Draft' AND NEW.status <> 'Active' THEN
    RAISE EXCEPTION 'Invalid job status transition: Draft may only move to Active';
  END IF;

  IF OLD.status = 'Active' AND NEW.status <> 'Closed' THEN
    RAISE EXCEPTION 'Invalid job status transition: Active may only move to Closed';
  END IF;

  IF OLD.status = 'Closed' THEN
    RAISE EXCEPTION 'Invalid job status transition: Closed jobs cannot be changed manually';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION sync_job_applicant_count_and_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_job_id UUID;
  applicant_count INT;
  job_row job_listings%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    target_job_id := NEW.job_id;
  ELSIF TG_OP = 'DELETE' THEN
    target_job_id := OLD.job_id;
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COUNT(*)::INT
  INTO applicant_count
  FROM applications
  WHERE job_id = target_job_id;

  SELECT *
  INTO job_row
  FROM job_listings
  WHERE id = target_job_id
  FOR UPDATE;

  PERFORM set_auto_job_status(TRUE);

  IF applicant_count >= job_row.max_applicant_cap THEN
    UPDATE job_listings
    SET
      current_applicants = applicant_count,
      status = 'Closed'
    WHERE id = target_job_id;
  ELSIF applicant_count < job_row.max_applicant_cap AND job_row.status = 'Closed' THEN
    UPDATE job_listings
    SET
      current_applicants = applicant_count,
      status = 'Active'
    WHERE id = target_job_id;
  ELSE
    UPDATE job_listings
    SET current_applicants = applicant_count
    WHERE id = target_job_id;
  END IF;

  PERFORM set_auto_job_status(FALSE);

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Application constraints
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_application_withdraw_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status <> 'Submitted' THEN
    RAISE EXCEPTION 'Applications can only be withdrawn while status is Submitted';
  END IF;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION touch_application_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_student_profile_delete_with_active_apps()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM applications a
    WHERE a.student_id = OLD.user_id
      AND a.status IN ('Submitted', 'Under Review', 'Shortlisted', 'Offer Extended')
  ) THEN
    RAISE EXCEPTION 'Cannot delete student profile while pending or active applications exist';
  END IF;

  RETURN OLD;
END;
$$;

-- ---------------------------------------------------------------------------
-- Notification helpers / triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION notify_application_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  job_title TEXT;
  company_user_id UUID;
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  SELECT jl.title, jl.company_id
  INTO job_title, company_user_id
  FROM job_listings jl
  WHERE jl.id = NEW.job_id;

  INSERT INTO notifications (user_id, message)
  VALUES (
    NEW.student_id,
    format(
      'Your application for "%s" was updated from %s to %s.',
      job_title,
      OLD.status,
      NEW.status
    )
  );

  INSERT INTO notifications (user_id, message)
  VALUES (
    company_user_id,
    format(
      'Application status for job "%s" changed from %s to %s.',
      job_title,
      OLD.status,
      NEW.status
    )
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION notify_new_applicant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  job_title TEXT;
  company_user_id UUID;
  student_name TEXT;
BEGIN
  SELECT jl.title, jl.company_id
  INTO job_title, company_user_id
  FROM job_listings jl
  WHERE jl.id = NEW.job_id;

  SELECT sp.name
  INTO student_name
  FROM student_profiles sp
  WHERE sp.user_id = NEW.student_id;

  INSERT INTO notifications (user_id, message)
  VALUES (
    company_user_id,
    format(
      'New applicant%s for "%s".',
      CASE
        WHEN student_name IS NULL OR btrim(student_name) = '' THEN ''
        ELSE ' ' || student_name
      END,
      job_title
    )
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION notify_job_structural_closure()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'Closed' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO notifications (user_id, message)
    SELECT
      a.student_id,
      format('The job listing "%s" has been closed.', NEW.title)
    FROM applications a
    WHERE a.job_id = NEW.id
      AND a.status IN ('Submitted', 'Under Review', 'Shortlisted', 'Offer Extended');
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION notify_skill_matches_for_job(p_job_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  job_row job_listings%ROWTYPE;
  profile_row student_profiles%ROWTYPE;
  match_score NUMERIC;
BEGIN
  SELECT *
  INTO job_row
  FROM job_listings
  WHERE id = p_job_id;

  IF job_row.status <> 'Active' OR job_row.is_approved IS DISTINCT FROM TRUE THEN
    RETURN;
  END IF;

  FOR profile_row IN
    SELECT sp.*
    FROM student_profiles sp
    INNER JOIN users u ON u.id = sp.user_id
    WHERE u.role = 'student'
      AND u.is_verified = TRUE
  LOOP
    match_score := calculate_skill_match_score(
      profile_row.skills,
      job_row.required_skills,
      job_row.preferred_skills
    );

    IF match_score > 70 THEN
      INSERT INTO notifications (user_id, message)
      VALUES (
        profile_row.user_id,
        format(
          'You are a %.0f%% match for "%s". Consider applying before the deadline.',
          match_score,
          job_row.title
        )
      );
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION notify_skill_matches_for_student(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  profile_row student_profiles%ROWTYPE;
  job_row job_listings%ROWTYPE;
  match_score NUMERIC;
BEGIN
  SELECT *
  INTO profile_row
  FROM student_profiles
  WHERE user_id = p_user_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  FOR job_row IN
    SELECT jl.*
    FROM job_listings jl
    WHERE jl.status = 'Active'
      AND jl.is_approved = TRUE
      AND jl.application_deadline > NOW()
  LOOP
    match_score := calculate_skill_match_score(
      profile_row.skills,
      job_row.required_skills,
      job_row.preferred_skills
    );

    IF match_score > 70 THEN
      INSERT INTO notifications (user_id, message)
      VALUES (
        profile_row.user_id,
        format(
          'You are a %.0f%% match for "%s". Consider applying before the deadline.',
          match_score,
          job_row.title
        )
      );
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_notify_skill_matches_for_job()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'Active'
     AND NEW.is_approved = TRUE
     AND (
       TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM NEW.status
       OR OLD.is_approved IS DISTINCT FROM NEW.is_approved
       OR OLD.required_skills IS DISTINCT FROM NEW.required_skills
       OR OLD.preferred_skills IS DISTINCT FROM NEW.preferred_skills
     ) THEN
    PERFORM notify_skill_matches_for_job(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION trigger_notify_skill_matches_for_student()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR OLD.skills IS DISTINCT FROM NEW.skills THEN
    PERFORM notify_skill_matches_for_student(NEW.user_id);
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Attach triggers
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_student_profiles_user_role ON student_profiles;
CREATE TRIGGER trg_student_profiles_user_role
BEFORE INSERT OR UPDATE OF user_id ON student_profiles
FOR EACH ROW
EXECUTE PROCEDURE enforce_user_role_for_fk();

DROP TRIGGER IF EXISTS trg_job_listings_company_role ON job_listings;
CREATE TRIGGER trg_job_listings_company_role
BEFORE INSERT OR UPDATE OF company_id ON job_listings
FOR EACH ROW
EXECUTE PROCEDURE enforce_user_role_for_fk();

DROP TRIGGER IF EXISTS trg_applications_student_role ON applications;
CREATE TRIGGER trg_applications_student_role
BEFORE INSERT OR UPDATE OF student_id ON applications
FOR EACH ROW
EXECUTE PROCEDURE enforce_user_role_for_fk();

DROP TRIGGER IF EXISTS trg_job_listings_status_transition ON job_listings;
CREATE TRIGGER trg_job_listings_status_transition
BEFORE UPDATE OF status ON job_listings
FOR EACH ROW
EXECUTE PROCEDURE enforce_job_status_transition();

DROP TRIGGER IF EXISTS trg_applications_sync_job_count_insert ON applications;
CREATE TRIGGER trg_applications_sync_job_count_insert
AFTER INSERT ON applications
FOR EACH ROW
EXECUTE PROCEDURE sync_job_applicant_count_and_status();

DROP TRIGGER IF EXISTS trg_applications_sync_job_count_delete ON applications;
CREATE TRIGGER trg_applications_sync_job_count_delete
AFTER DELETE ON applications
FOR EACH ROW
EXECUTE PROCEDURE sync_job_applicant_count_and_status();

DROP TRIGGER IF EXISTS trg_applications_withdraw_delete ON applications;
CREATE TRIGGER trg_applications_withdraw_delete
BEFORE DELETE ON applications
FOR EACH ROW
EXECUTE PROCEDURE enforce_application_withdraw_rules();

DROP TRIGGER IF EXISTS trg_applications_updated_at ON applications;
CREATE TRIGGER trg_applications_updated_at
BEFORE UPDATE ON applications
FOR EACH ROW
EXECUTE PROCEDURE touch_application_updated_at();

DROP TRIGGER IF EXISTS trg_student_profiles_delete_guard ON student_profiles;
CREATE TRIGGER trg_student_profiles_delete_guard
BEFORE DELETE ON student_profiles
FOR EACH ROW
EXECUTE PROCEDURE prevent_student_profile_delete_with_active_apps();

DROP TRIGGER IF EXISTS trg_applications_status_notify ON applications;
CREATE TRIGGER trg_applications_status_notify
AFTER UPDATE OF status ON applications
FOR EACH ROW
EXECUTE PROCEDURE notify_application_status_change();

DROP TRIGGER IF EXISTS trg_applications_new_applicant_notify ON applications;
CREATE TRIGGER trg_applications_new_applicant_notify
AFTER INSERT ON applications
FOR EACH ROW
EXECUTE PROCEDURE notify_new_applicant();

DROP TRIGGER IF EXISTS trg_job_listings_closure_notify ON job_listings;
CREATE TRIGGER trg_job_listings_closure_notify
AFTER UPDATE OF status ON job_listings
FOR EACH ROW
EXECUTE PROCEDURE notify_job_structural_closure();

DROP TRIGGER IF EXISTS trg_job_listings_skill_match_notify ON job_listings;
CREATE TRIGGER trg_job_listings_skill_match_notify
AFTER INSERT OR UPDATE ON job_listings
FOR EACH ROW
EXECUTE PROCEDURE trigger_notify_skill_matches_for_job();

DROP TRIGGER IF EXISTS trg_student_profiles_skill_match_notify ON student_profiles;
CREATE TRIGGER trg_student_profiles_skill_match_notify
AFTER INSERT OR UPDATE OF skills ON student_profiles
FOR EACH ROW
EXECUTE PROCEDURE trigger_notify_skill_matches_for_student();

-- ---------------------------------------------------------------------------
-- Seed: pre-approved company account + one Active, approved job listing
-- Company login: hr@techcorp.com / password123
-- ---------------------------------------------------------------------------

INSERT INTO users (email, password, role, is_verified)
VALUES (
  'hr@techcorp.com',
  '$2b$10$j6z8Wp/9PX9Bic4YRv28FOKzM77YCd5yWhSelY7MBm4WYOyb96CBW',
  'company',
  TRUE
)
ON CONFLICT (email) DO NOTHING;

INSERT INTO job_listings (
  company_id,
  title,
  description,
  required_skills,
  preferred_skills,
  stipend,
  location,
  application_deadline,
  max_applicant_cap,
  status,
  is_approved
)
SELECT
  u.id,
  'Full Stack Developer Intern',
  'Build and ship features for our intern-matching platform using React, Node.js, and PostgreSQL. You will pair with senior engineers, participate in code reviews, and own a small end-to-end feature during the internship.',
  '["JavaScript", "React.js", "Node.js", "PostgreSQL"]'::JSONB,
  '["TypeScript", "Express.js", "REST APIs"]'::JSONB,
  25000.00,
  'remote',
  NOW() + INTERVAL '30 days',
  50,
  'Active',
  TRUE
FROM users u
WHERE u.email = 'hr@techcorp.com'
  AND NOT EXISTS (
    SELECT 1
    FROM job_listings jl
    WHERE jl.company_id = u.id
      AND jl.title = 'Full Stack Developer Intern'
  );

COMMIT;
