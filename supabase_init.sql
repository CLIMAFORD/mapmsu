-- Supabase initialization SQL
-- Run this in Supabase SQL editor (SQL -> New query) or via psql connected to your Supabase DB.

-- 1) Create issues table
create table if not exists public.issues (
  id bigserial primary key,
  description text,
  image_path text,
  image_url text,
  lat double precision,
  lon double precision,
  session_id text,
  created_at timestamptz default now()
);

-- 2) Active users table (for realtime positions)
create table if not exists public.active_users (
  session_id text primary key,
  lat double precision,
  lon double precision,
  last_seen timestamptz default now()
);

-- 3) Tables for existing geo layers exported from qgis2web
-- Each table stores the original properties as jsonb and a PostGIS geometry column 'geom'

create extension if not exists postgis;

-- Example pattern for each layer -- adjust column names as needed
create table if not exists public.polygonfacilities (
  id bigserial primary key,
  properties jsonb,
  geom geometry(Geometry,4326)
);

create table if not exists public.collegecampus_2 (id bigserial primary key, properties jsonb, geom geometry(Geometry,4326));
create table if not exists public.siriba_3 (id bigserial primary key, properties jsonb, geom geometry(Geometry,4326));
create table if not exists public.niles_4 (id bigserial primary key, properties jsonb, geom geometry(Geometry,4326));
create table if not exists public.grass_5 (id bigserial primary key, properties jsonb, geom geometry(Geometry,4326));
create table if not exists public.coated_6 (id bigserial primary key, properties jsonb, geom geometry(Geometry,4326));
create table if not exists public.farm_7 (id bigserial primary key, properties jsonb, geom geometry(Geometry,4326));
create table if not exists public.field_8 (id bigserial primary key, properties jsonb, geom geometry(Geometry,4326));
create table if not exists public.flowers_9 (id bigserial primary key, properties jsonb, geom geometry(Geometry,4326));
create table if not exists public.amenity_10 (id bigserial primary key, properties jsonb, geom geometry(Geometry,4326));
create table if not exists public.buildings_11 (id bigserial primary key, properties jsonb, geom geometry(Geometry,4326));
create table if not exists public.trees_12 (id bigserial primary key, properties jsonb, geom geometry(Geometry,4326));

-- 7) Create tables for provided CSVs
create table if not exists public.halls (
  hall_id integer,
  name text,
  lecture_capacity integer,
  exam_capacity integer,
  available_seats integer,
  building_name text,
  new_bld_id text
);

create table if not exists public.bld_images (
  building_name text,
  exterior_image_url text,
  interior_image_url text,
  geopoint text,
  latitude double precision,
  longitude double precision,
  altitude double precision,
  new_bld_id text,
  submission_uuid text,
  meta_root_uuid text
);

-- Note: To import the local CSV files (`halls.csv` and `bld_images.csv`) you can
-- either use the Supabase SQL editor and upload/LOAD them, or run the
-- `scripts/import_csv.js` Node script included in this repo which will POST
-- rows into the corresponding tables using the Supabase REST API and a
-- service_role key (set SUPABASE_SERVICE_ROLE in your environment before running).

-- 4) Optional: create RLS policies if needed (for anon inserts into issues/active_users)
-- Allow anonymous inserts into issues and active_users if you want open reporting. Use with caution.
-- Example: (run in SQL editor)
-- create policy "anon_insert_issues" on public.issues for insert using (true);
-- grant insert on public.issues to anon;

-- 5) Storage: create a bucket named 'issue-photos' in the Supabase Storage dashboard and make it public or configure appropriate policies.

-- 6) After creating tables, you can populate geometry from your GeoJSON dataset by using the SQL editor and functions like ST_GeomFromGeoJSON.
