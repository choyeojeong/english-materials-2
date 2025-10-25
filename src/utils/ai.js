// src/utils/ai.js
import { supabase } from './supabaseClient';

/**
 * items: [{ pair_id:number, en:string, ko:string }]
 * returns: { results: [{ pair_id, recs: [{ path, reason }] }] }
 */
export async function recommendForPairs(items = []) {
  const { data, error } = await supabase.functions.invoke('recommend_ai', {
    body: { items },
  });
  if (error) {
    // supabase-js v2의 functions.invoke는 error 객체를 가질 수 있음
    throw new Error(`[recommend_ai] ${error.message || 'invoke failed'}`);
  }
  return data;
}
