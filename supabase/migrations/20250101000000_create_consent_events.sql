create table if not exists public.consent_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid null,
  clinician_id uuid null,
  patient_ref text null,
  source text not null,
  event_type text not null,
  session_id text null,
  tab_id text null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
