-- Additive domain access and conservative usage accounting. No grants or live enablement.
CREATE TABLE arcana_entitlements (
  principal_id text NOT NULL,
  entitlement text NOT NULL CHECK (entitlement = 'parlor'),
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (principal_id, entitlement)
);
CREATE TABLE arcana_entitlement_audit (
  operation_id uuid PRIMARY KEY,
  principal_id text NOT NULL,
  entitlement text NOT NULL CHECK (entitlement = 'parlor'),
  action text NOT NULL CHECK (action IN ('grant','revoke')),
  evidence_reference text NOT NULL,
  database_role text NOT NULL DEFAULT current_user,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);
CREATE TABLE arcana_parlor_usage (
  principal_id text NOT NULL,
  operation_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('narrate','converse','speech')),
  provider text NOT NULL CHECK (provider IN ('anthropic','openai','elevenlabs')),
  model text NOT NULL,
  reserved_microusd bigint NOT NULL CHECK (reserved_microusd > 0),
  input_bytes integer NOT NULL CHECK (input_bytes >= 0),
  output_limit integer NOT NULL CHECK (output_limit > 0),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','complete','uncertain')),
  created_at timestamptz NOT NULL DEFAULT now(),
  active_until timestamptz NOT NULL,
  PRIMARY KEY (principal_id, operation_id)
);
CREATE INDEX arcana_parlor_usage_day_idx ON arcana_parlor_usage (created_at);
CREATE INDEX arcana_parlor_usage_principal_day_idx ON arcana_parlor_usage (principal_id, created_at);
CREATE INDEX arcana_parlor_usage_active_idx ON arcana_parlor_usage (active_until);
