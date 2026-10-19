create schema auth; create schema storage;
create function auth.uid() returns uuid language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create publication supabase_realtime;
alter table storage.objects add column if not exists metadata jsonb, add column if not exists owner uuid;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to anon, authenticated; grant all on storage.objects to authenticated; grant select on storage.objects to anon;
grant execute on function storage.foldername(text) to anon, authenticated;
alter table auth.users add column if not exists created_at timestamptz default now();
-- Script 035 (comptes sans email) : colonnes et table d'authentification utilisées, pgcrypto dans « extensions »
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
alter table auth.users add column if not exists instance_id uuid, add column if not exists aud text, add column if not exists role text,
  add column if not exists encrypted_password text, add column if not exists email_confirmed_at timestamptz,
  add column if not exists raw_app_meta_data jsonb, add column if not exists updated_at timestamptz,
  add column if not exists confirmation_token text, add column if not exists email_change text,
  add column if not exists email_change_token_new text, add column if not exists recovery_token text;
create table if not exists auth.identities (id uuid primary key, user_id uuid references auth.users(id) on delete cascade, provider_id text not null, identity_data jsonb not null, provider text not null, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz, unique (provider_id, provider));
