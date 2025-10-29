// src/utils/materials.js
import { supabase } from './supabaseClient';

/**
 * 새 자료(material) 생성
 * meta: { title, grade, year, month, number, source?, notes? }
 * @returns {Promise<string>} material_id
 */
export async function createMaterial(meta = {}) {
  const { data, error } = await supabase.rpc('material_create', {
    p_title:  meta.title  ?? null,
    p_grade:  meta.grade  ?? null,
    p_year:   meta.year   ?? null,
    p_month:  meta.month  ?? null,
    p_number: meta.number ?? null,
    p_source: meta.source ?? null,
    p_notes:  meta.notes  ?? null,
  });

  if (error) throw new Error(`[material_create] ${error.message}`);
  // PostgREST가 rows 배열/단일 객체로 반환할 수 있어 둘 다 대응
  const id = data?.[0]?.id ?? data?.id ?? null;
  if (!id) throw new Error('[material_create] no id returned');
  return id;
}

/**
 * 문장/해석 페어 전체 덮어쓰기
 * 🔸 RPC가 en_sentence / ko_sentence를 받도록 수정됨
 * pairs: [{ en_sentence, ko_sentence, order_index }]
 */
export async function overwritePairs(materialId, pairs) {
  const normalized = (pairs ?? []).map((p, idx) => ({
    en_sentence: (p.en_sentence ?? p.en ?? '').trim(),
    ko_sentence: (p.ko_sentence ?? p.ko ?? '').trim(),
    order_index: Number.isFinite(p.order_index) ? p.order_index : idx,
  }));

  const { error } = await supabase.rpc('material_overwrite_pairs', {
    p_material_id: materialId,
    p_pairs: normalized,
  });
  if (error) throw new Error(`[material_overwrite_pairs] ${error.message}`);
}

/**
 * en_text(원문 전체) 업데이트
 * - DB에 material_update_en_text(uuid, text) RPC가 있어야 합니다.
 */
export async function updateMaterialEnText(materialId, enText) {
  const { error } = await supabase.rpc('material_update_en_text', {
    p_material_id: materialId,
    p_en_text: enText ?? '',
  });
  if (error) throw new Error(`[material_update_en_text] ${error.message}`);
}

/**
 * ko_text(번역 전체) 업데이트
 * - DB에 material_update_ko_text(uuid, text) RPC가 있어야 합니다.
 */
export async function updateMaterialKoText(materialId, koText) {
  const { error } = await supabase.rpc('material_update_ko_text', {
    p_material_id: materialId,
    p_ko_text: koText ?? '',
  });
  if (error) throw new Error(`[material_update_ko_text] ${error.message}`);
}

/**
 * 상태 변경 (draft | review | done)
 */
export async function updateMaterialStatus(materialId, status) {
  const { error } = await supabase.rpc('material_update_status', {
    p_material_id: materialId,
    p_status: status,
  });
  if (error) throw new Error(`[material_update_status] ${error.message}`);
}

/** 내부: 문장 배열을 개행으로 합치기 (키: en_sentence / ko_sentence 우선) */
function joinLines(arr, key) {
  return (arr ?? [])
    .map((p) => (p?.[key] ?? '').toString().trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * 일괄 저장 파이프라인
 * 1) material 생성
 * 2) 페어 저장 (en_sentence/ko_sentence)
 * 3) en_text / ko_text 업데이트
 * 4) 상태 done
 */
export async function saveMaterialWithPairs(payload) {
  const { meta = {}, pairs = [] } = payload ?? {};

  // 1) 생성
  const materialId = await createMaterial(meta);

  // 2) 페어 저장
  await overwritePairs(materialId, pairs);

  // 3) en_text / ko_text 갱신
  const normalized = pairs.map(p => ({
    en_sentence: p.en_sentence ?? p.en ?? '',
    ko_sentence: p.ko_sentence ?? p.ko ?? '',
  }));
  const enText = joinLines(normalized, 'en_sentence');
  const koText = joinLines(normalized, 'ko_sentence');
  await updateMaterialEnText(materialId, enText);
  await updateMaterialKoText(materialId, koText);

  // 4) 상태 완료
  await updateMaterialStatus(materialId, 'done');

  return materialId;
}

/* =========================
 *  👇 CategoryRecommend 단계용 유틸
 * ========================= */

/**
 * 자료 + 문장쌍 조회
 * - materials: 단건
 * - material_pairs: en_sentence / ko_sentence / order_index / used_in / difficulty
 */
export async function fetchMaterialWithPairs(materialId) {
  const { data: material, error: e1 } = await supabase
    .from('materials')
    .select('*')
    .eq('id', materialId)
    .single();
  if (e1) throw new Error(`[fetchMaterialWithPairs] ${e1.message}`);

  const { data: pairs, error: e2 } = await supabase
    .from('material_pairs')
    .select('id, material_id, en_sentence, ko_sentence, order_index, used_in, difficulty')
    .eq('material_id', materialId)
    .order('order_index', { ascending: true });
  if (e2) throw new Error(`[fetchMaterialWithPairs] ${e2.message}`);

  return { material, pairs };
}

/**
 * ✍️ 교재 메모(used_in) 저장 RPC
 * - material_update_pair_used_in(bigint, text)
 */
export async function updatePairUsedIn(pairId, usedIn) {
  const { error } = await supabase.rpc('material_update_pair_used_in', {
    p_pair_id: pairId,
    p_used_in: usedIn ?? null,
  });
  if (error) throw new Error(`[material_update_pair_used_in] ${error.message}`);
}

/**
 * (옵션) 여러 문장 메모를 한 번에 저장
 * updates: Array<{ pair_id: number, used_in: string | null }>
 */
export async function bulkUpdatePairUsedIn(updates = []) {
  for (const u of updates) {
    await updatePairUsedIn(u.pair_id, u.used_in ?? null);
  }
}

/**
 * ✍️ 난이도 저장 RPC
 * - material_update_pair_difficulty(bigint, text|null)
 *   difficulty ∈ ('easy','normal','hard') 또는 null
 */
export async function updatePairDifficulty(pairId, difficulty) {
  const { error } = await supabase.rpc('material_update_pair_difficulty', {
    p_pair_id: pairId,
    p_difficulty: difficulty ?? null,
  });
  if (error) throw new Error(`[material_update_pair_difficulty] ${error.message}`);
}

/**
 * (옵션) 여러 문장 난이도 일괄 저장
 * updates: Array<{ pair_id: number, difficulty: 'easy'|'normal'|'hard'|null }>
 */
export async function bulkUpdatePairDifficulty(updates = []) {
  for (const u of updates) {
    await updatePairDifficulty(u.pair_id, u.difficulty ?? null);
  }
}

/**
 * 분류 저장 RPC
 * - material_save_pair_categories(uuid, jsonb)
 * - payloadArray: [{ pair_id, en_category_ids: uuid[], ko_category_ids: uuid[] }, ...]
 */
export async function savePairCategories(materialId, payloadArray) {
  const { error } = await supabase.rpc('material_save_pair_categories', {
    p_material_id: materialId,
    p_pairs: payloadArray,
  });
  if (error) throw new Error(`[material_save_pair_categories] ${error.message}`);
}

/**
 * 분류 완료 목록 조회
 * - v_materials_with_counts 뷰에서 status='done'만
 */
export async function listMaterialsDone() {
  const { data, error } = await supabase
    .from('v_materials_with_counts')
    .select('*')
    .eq('status', 'done')
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`[listMaterialsDone] ${error.message}`);
  return data ?? [];
}
