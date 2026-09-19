-- Plans define limits. Quotas are enforced per ACCOUNT (not per key), so creating
-- more keys never multiplies a customer's allowance.
CREATE TABLE plans (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  rps          numeric(10, 4) NOT NULL CHECK (rps > 0),   -- sustained requests / second
  burst        integer NOT NULL CHECK (burst >= 1),        -- max instantaneous burst
  daily_quota  bigint CHECK (daily_quota IS NULL OR daily_quota >= 0),  -- NULL = unlimited
  max_keys     integer NOT NULL DEFAULT 5 CHECK (max_keys >= 1),
  platforms    text[],                                     -- NULL = every platform
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  contact_email  text,
  plan_id        text NOT NULL REFERENCES plans (id),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE api_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  label         text NOT NULL,
  prefix        text NOT NULL,
  key_hash      text NOT NULL UNIQUE,
  environment   text NOT NULL CHECK (environment IN ('live', 'test')),
  platforms     text[],                                    -- NULL = inherit from plan
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,
  revoked_at    timestamptz,
  last_used_at  timestamptz
);
CREATE INDEX api_keys_account_idx ON api_keys (account_id);

-- Pre-aggregated usage: one row per account / day / platform, updated in batches.
CREATE TABLE usage_daily (
  account_id    uuid NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  day           date NOT NULL,
  platform      text NOT NULL,
  requests      bigint NOT NULL DEFAULT 0,
  errors        bigint NOT NULL DEFAULT 0,
  cache_hits    bigint NOT NULL DEFAULT 0,
  rate_limited  bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, day, platform)
);
CREATE INDEX usage_daily_day_idx ON usage_daily (day);

CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  actor        text NOT NULL,
  action       text NOT NULL,
  target_type  text NOT NULL,
  target_id    text,
  detail       jsonb
);

-- Default plans (tune freely through the admin API).
INSERT INTO plans (id, name, rps, burst, daily_quota, max_keys) VALUES
  ('free',       'Free',       0.0833,   5,   100,   2),
  ('basic',      'Basic',      0.3333,  20,  1000,   5),
  ('pro',        'Pro',        1.6667, 100, 10000,  20),
  ('enterprise', 'Enterprise', 16.6667, 500, NULL, 100);
