-- A fresh production database runs migrations but not the development seed.
-- Ensure the default tenant has an initial administrator without overwriting
-- credentials that an operator may already have changed.
INSERT INTO "User" (
  "id",
  "organizationId",
  "email",
  "passwordHash",
  "name",
  "role",
  "emailVerifiedAt",
  "isActive",
  "createdAt",
  "updatedAt"
)
VALUES (
  'user_default_super_admin',
  'org_default',
  'admin@beingbrilliant.in',
  '$2a$12$avnxyzsxvKDhfadwXoI8MeedeJzapN7QAGe.AT/L8KoKhmvrFBb1e',
  'Academy Admin',
  'SUPER_ADMIN',
  CURRENT_TIMESTAMP,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("email") DO NOTHING;
