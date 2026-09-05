create table if not exists profiles (
  id uuid primary key,
  email text not null unique,
  name text not null,
  role text not null default 'Citizen' check (role in ('Citizen', 'Student', 'Mentor', 'Admin')),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists verification_codes (
  id uuid primary key,
  email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists refresh_tokens (
  id uuid primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists challenges (
  id uuid primary key,
  title text not null,
  description text not null,
  category text not null,
  location text not null,
  status text not null default 'Under review' check (status in ('Under review', 'Open', 'In progress', 'Submitted', 'Resolved', 'Denied')),
  priority text not null default 'Medium' check (priority in ('Low', 'Medium', 'High', 'Critical')),
  readiness integer not null default 0 check (readiness between 0 and 100),
  owner_id uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists challenge_status_history (
  id uuid primary key,
  challenge_id uuid not null references challenges(id) on delete cascade,
  from_status text,
  to_status text not null,
  reason text,
  changed_by uuid not null references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists challenge_evidence (
  id uuid primary key,
  challenge_id uuid not null references challenges(id) on delete cascade,
  uploaded_by uuid not null references profiles(id),
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  storage_key text not null unique,
  caption text,
  created_at timestamptz not null default now()
);

create table if not exists teams (
  id uuid primary key,
  name text not null,
  challenge_id uuid not null references challenges(id) on delete cascade,
  owner_id uuid not null references profiles(id),
  status text not null default 'Active' check (status in ('Active', 'Inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (challenge_id, name)
);

create table if not exists team_members (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  member_role text not null default 'Member' check (member_role in ('Owner', 'Member')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists solutions (
  id uuid primary key,
  title text not null,
  description text not null,
  repository_url text,
  demo_url text,
  team_id uuid not null references teams(id) on delete cascade,
  created_by uuid not null references profiles(id),
  status text not null default 'Draft' check (status in ('Draft', 'Mentor review', 'Approved', 'Changes requested')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists solution_reviews (
  id uuid primary key,
  solution_id uuid not null references solutions(id) on delete cascade,
  reviewer_id uuid not null references profiles(id),
  decision text not null check (decision in ('Approved', 'Changes requested')),
  feedback text not null,
  created_at timestamptz not null default now()
);

create table if not exists progress_updates (
  id uuid primary key,
  solution_id uuid not null references solutions(id) on delete cascade,
  author_id uuid not null references profiles(id),
  summary text not null,
  completion_percent integer not null check (completion_percent between 0 and 100),
  blockers text,
  milestone_date date,
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id uuid primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  body text not null,
  resource_type text,
  resource_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists verification_codes_email_idx on verification_codes(email, created_at desc);
create index if not exists challenges_status_idx on challenges(status);
create index if not exists challenges_priority_idx on challenges(priority);
create index if not exists teams_challenge_idx on teams(challenge_id);
create index if not exists solutions_team_idx on solutions(team_id);
create index if not exists solutions_status_idx on solutions(status);
create index if not exists notifications_user_idx on notifications(user_id, created_at desc);
