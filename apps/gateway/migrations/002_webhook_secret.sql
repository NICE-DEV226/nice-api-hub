-- Per-account secret used to sign webhook deliveries (HMAC-SHA256). Built-in functions only.
ALTER TABLE accounts
  ADD COLUMN webhook_secret text NOT NULL
  DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
