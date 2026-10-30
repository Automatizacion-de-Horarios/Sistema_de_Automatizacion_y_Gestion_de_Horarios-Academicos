import { createClient } from '@supabase/supabase-js';

// Parcel reemplaza estas variables al compilar leyendo el archivo .env (o las de Vercel).
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;

// Cliente ÚNICO compartido por todos los módulos (principio DRY).
export const supabase = url && key ? createClient(url, key) : null;

// Si faltan las variables, la app funciona en MODO DEMO con datos en memoria.
export const MODO_DEMO = !supabase;
