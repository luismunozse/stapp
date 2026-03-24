-- Add provider field and make password nullable for Google OAuth support
-- This allows users to sign in with Google without needing a password

-- Add provider column (default 'credentials' for existing users)
ALTER TABLE users ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'credentials';

-- Make password nullable (Google users won't have one)
ALTER TABLE users ALTER COLUMN password DROP NOT NULL;

-- Index for faster lookups by provider
CREATE INDEX IF NOT EXISTS idx_users_provider ON users(provider);

-- Comment
COMMENT ON COLUMN users.provider IS 'Auth provider: credentials or google';
