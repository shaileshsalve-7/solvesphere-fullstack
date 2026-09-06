alter table profiles add column if not exists password_hash text;
alter table profiles add column if not exists email_verified_at timestamptz;

-- Accounts created by the earlier passwordless-email release already proved
-- control of their address. Preserve that state when adding credentials.
update profiles
   set email_verified_at = coalesce(email_verified_at, created_at)
 where email_verified_at is null;

-- Sessions from the passwordless release cannot outlive the credential
-- migration. Users re-enroll through the verified signup flow.
update refresh_tokens rt
   set revoked_at = coalesce(rt.revoked_at, now())
 where exists (
   select 1 from profiles p where p.id = rt.user_id and p.password_hash is null
 );

alter table verification_codes add column if not exists purpose text not null default 'sign-in';
create index if not exists verification_codes_lookup_idx
  on verification_codes(email, purpose, created_at desc);
