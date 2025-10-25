// src/utils/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  // ✅ DEV에선 로컬 함수 URL 고정
  functions: import.meta.env.DEV
    ? { url: 'http://127.0.0.1:54321/functions/v1' }
    : undefined,
});

// 임시 진단 로그
if (import.meta.env.DEV) {
  console.info('[supabase] DEV mode with local functions URL');
}
