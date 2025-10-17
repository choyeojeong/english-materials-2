import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 기본 옵션: 필요에 따라 auth나 schema 옵션 추가 가능
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
