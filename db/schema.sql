-- Portal de procesamiento INEGI · Esquema (Supabase / PostgreSQL 15+). Idempotente.
-- Aplicar en Supabase > SQL Editor, o con `npm run db:setup` si tu red permite el puerto 5432.

-- Una serie es una variable, un indicador o un dato capturado a mano, con sus valores por
-- unidad (entidad o institución). Los valores van en JSONB: cada serie se guarda y se lee
-- completa, en una sola operación atómica.
create table if not exists public.series (
  id              uuid primary key default gen_random_uuid(),
  tipo            text not null check (tipo in ('variable', 'indicador', 'manual')),
  nombre          text not null check (char_length(nombre) between 1 and 500),
  nivel           text not null check (nivel in ('Estatal', 'Federal', 'Mixto')),
  anio            smallint check (anio between 1900 and 2100),
  periodo         text,
  fuente          text,
  formula         text,
  desagregacion   text,
  filas           jsonb not null check (jsonb_typeof(filas) = 'array'),
  n_filas         integer not null,
  guardado_por    uuid references auth.users (id) on delete set null,
  actualizado_en  timestamptz not null default now(),
  -- Guardar de nuevo la misma serie la reemplaza
  constraint series_unica unique nulls not distinct (nombre, nivel, anio, desagregacion)
);

create index if not exists series_actualizado_idx on public.series (actualizado_en desc);

-- RLS activado y sin políticas: las llaves públicas (anon/publishable) no pueden leer ni
-- escribir. Solo el backend, con la llave service_role, accede a la tabla.
alter table public.series enable row level security;
revoke all on public.series from anon, authenticated;
