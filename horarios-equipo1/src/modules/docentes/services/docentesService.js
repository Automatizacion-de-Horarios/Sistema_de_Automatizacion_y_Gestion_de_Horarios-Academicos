import { MODO_DEMO } from '../../../lib/supabaseClient';
import { docentesApiSupabase } from './docentesApi.supabase';
import { docentesApiDemo } from './docentesApi.demo';

// Punto único de acceso a datos del módulo. Los componentes nunca llaman a Supabase directamente.
export const docentesService = MODO_DEMO ? docentesApiDemo : docentesApiSupabase;
export { MODO_DEMO };
