-- Ensure contract permissions exist before the API guards and role catalog use them.
-- Contract management was introduced without seeding its permissions, so a fresh
-- database (and existing databases applying that migration) could deny all users.
INSERT INTO permissions(permission, description, category) VALUES
  ('contracts:read', 'View company contracts and linked requisitions', 'contracts'),
  ('contracts:write', 'Create and manage company contracts', 'contracts')
ON CONFLICT (permission) DO NOTHING;

-- Owners and admins administer the full contract workflow.
INSERT INTO role_permissions(role, permission_id)
SELECT roles.role, p.id
FROM permissions p
CROSS JOIN (VALUES ('owner'::user_role), ('admin'::user_role)) AS roles(role)
WHERE p.permission IN ('contracts:read', 'contracts:write')
ON CONFLICT (role, permission_id) DO NOTHING;

-- Managers can operate contracts; staff and viewers can only read them.
INSERT INTO role_permissions(role, permission_id)
SELECT 'manager'::user_role, p.id
FROM permissions p
WHERE p.permission IN ('contracts:read', 'contracts:write')
ON CONFLICT (role, permission_id) DO NOTHING;

INSERT INTO role_permissions(role, permission_id)
SELECT roles.role, p.id
FROM permissions p
CROSS JOIN (VALUES ('staff'::user_role), ('viewer'::user_role)) AS roles(role)
WHERE p.permission = 'contracts:read'
ON CONFLICT (role, permission_id) DO NOTHING;
