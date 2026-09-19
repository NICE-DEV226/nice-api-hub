-- Key scopes, device binding and provenance.
--   media   : resolve / download / jobs / usage / account (default: every existing key keeps working)
--   keys    : manage the account's own keys and create link codes (what a personal device key has)
--   recover : ONLY mint a new device key (the offline recovery key)
ALTER TABLE api_keys ADD COLUMN scopes text[] NOT NULL DEFAULT '{media}';

-- Peppered hash of the machine fingerprint the key was issued to (never the raw identifier).
ALTER TABLE api_keys ADD COLUMN device_hash text;
CREATE INDEX api_keys_device_idx ON api_keys (device_hash) WHERE device_hash IS NOT NULL AND revoked_at IS NULL;

-- How the key came to exist: admin | register | link | recover | self
ALTER TABLE api_keys ADD COLUMN created_via text NOT NULL DEFAULT 'admin';

-- One active self-registered account per machine. A unique index (not a check-then-insert) so two
-- simultaneous registrations from the same machine cannot both succeed.
CREATE UNIQUE INDEX api_keys_one_registration_per_device
  ON api_keys (device_hash)
  WHERE created_via = 'register' AND device_hash IS NOT NULL AND revoked_at IS NULL;

-- A person has a laptop, a desktop and a phone: three device keys for the free plan.
UPDATE plans SET max_keys = 3 WHERE id = 'free' AND max_keys = 2;
