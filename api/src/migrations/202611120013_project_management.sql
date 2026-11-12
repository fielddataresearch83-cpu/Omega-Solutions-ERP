-- Company-scoped Project Management foundation.
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name VARCHAR(180) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','on_hold','completed','cancelled')),
  priority VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  start_date DATE,
  due_date DATE,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_projects_company_status ON projects(company_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS project_tasks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  title VARCHAR(200) NOT NULL,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'todo' CHECK (status IN ('pending','todo','in_progress','completed','cancelled')),
  category VARCHAR(30) NOT NULL DEFAULT 'task' CHECK (category IN ('task','bug','feature','documentation','improvement','refactor')),
  priority VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','minor','normal','important','high','critical','urgent')),
  assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_tasks_company_status ON project_tasks(company_id,status,due_at);
CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON project_tasks(company_id,project_id);
CREATE INDEX IF NOT EXISTS idx_project_tasks_assignee ON project_tasks(company_id,assigned_to);

CREATE TABLE IF NOT EXISTS project_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT,
  event_type VARCHAR(20) NOT NULL DEFAULT 'meeting' CHECK (event_type IN ('meeting','event','personal','task','reminder')),
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ,
  all_day BOOLEAN NOT NULL DEFAULT false,
  location VARCHAR(240),
  created_by UUID NOT NULL REFERENCES users(id),
  is_cancelled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_at IS NULL OR end_at >= start_at)
);
CREATE INDEX IF NOT EXISTS idx_project_events_company_start ON project_events(company_id,start_at) WHERE is_cancelled = false;

-- Explicit tenant policies are required for tables introduced after the general
-- company-RLS migration. No missing tenant context can read or write these rows.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['projects','project_tasks','project_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS omega_company_isolation ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY omega_company_isolation ON public.%I USING (
        company_id = NULLIF(current_setting(''app.company_id'', true), '''')::uuid
        AND EXISTS (SELECT 1 FROM public.company_memberships m
          WHERE m.company_id = %I.company_id
            AND m.user_id = NULLIF(current_setting(''app.user_id'', true), '''')::uuid
            AND m.is_active = true)
      ) WITH CHECK (
        company_id = NULLIF(current_setting(''app.company_id'', true), '''')::uuid
        AND EXISTS (SELECT 1 FROM public.company_memberships m
          WHERE m.company_id = %I.company_id
            AND m.user_id = NULLIF(current_setting(''app.user_id'', true), '''')::uuid
            AND m.is_active = true)
      )', t, t, t);
  END LOOP;
END $$;

INSERT INTO permissions (permission,description,category) VALUES
 ('projects:read','View projects, tasks and calendar events','projects'),
 ('projects:write','Create and update projects, tasks and calendar events','projects')
ON CONFLICT (permission) DO NOTHING;
INSERT INTO role_permissions (role,permission_id)
SELECT 'owner',id FROM permissions WHERE permission IN ('projects:read','projects:write')
ON CONFLICT (role,permission_id) DO NOTHING;
INSERT INTO role_permissions (role,permission_id)
SELECT 'admin',id FROM permissions WHERE permission IN ('projects:read','projects:write')
ON CONFLICT (role,permission_id) DO NOTHING;
INSERT INTO role_permissions (role,permission_id)
SELECT 'manager',id FROM permissions WHERE permission IN ('projects:read','projects:write')
ON CONFLICT (role,permission_id) DO NOTHING;
INSERT INTO role_permissions (role,permission_id)
SELECT 'staff',id FROM permissions WHERE permission='projects:read'
ON CONFLICT (role,permission_id) DO NOTHING;
INSERT INTO role_permissions (role,permission_id)
SELECT 'viewer',id FROM permissions WHERE permission='projects:read'
ON CONFLICT (role,permission_id) DO NOTHING;
