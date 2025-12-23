// src/pages/CategoryRecommendPage.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import DashboardButton from '../components/DashboardButton';
import '../styles/ui.css';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// --- 공통 유틸 ---------------------------------------------------------------

// 카테고리 ID로 경로 라벨 구성 (상위→하위, 화면 표시는 →)
function pathLabelLocal(categoryId, fallback, metaObj) {
  if (!categoryId) return fallback || '(이름 없음)';
  const names = [];
  let cur = categoryId;
  while (cur && metaObj[cur]) {
    names.unshift(metaObj[cur].name);
    cur = metaObj[cur].parent_id;
  }
  return names.join('→') || fallback || '(이름 없음)';
}

// 카테고리 ID로 'DB 경로 문자열( > 구분자 )' 생성 (학습 저장용/AI용 leaf 목록)
function pathStringForDB(categoryId, metaObj) {
  if (!categoryId) return null;
  const names = [];
  let cur = categoryId;
  while (cur && metaObj[cur]) {
    names.unshift(metaObj[cur].name);
    cur = metaObj[cur].parent_id;
  }
  return names.length ? names.join(' > ') : null;
}

// 동일 출처(relative 경로) Vercel 함수 호출
async function callRecommendAPI(
  pairs,
  leafPaths,
  { topN = 6, minScore = 0.5, quality = 'high' } = {}
) {
  const res = await fetch('/api/recommend_ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: pairs, leafPaths, topN, minScore, quality }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[recommend_ai] HTTP ${res.status} ${text}`);
  }
  const json = await res.json();
  return Array.isArray(json?.results) ? json.results : [];
}

export default function CategoryRecommendPage() {
  const params = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const materialId = useMemo(
    () =>
      params.materialId ||
      params.id ||
      sp.get('materialId') ||
      sp.get('id') ||
      '',
    [params, sp]
  );

  // 🔐 자동 저장 키
  const STORAGE_KEY = materialId
    ? `category_recommend_${materialId}`
    : 'category_recommend_tmp';

  const [pairs, setPairs] = useState([]);
  const [recs, setRecs] = useState({});
  const [selected, setSelected] = useState({});
  const [catMeta, setCatMeta] = useState({});
  const [leafIds, setLeafIds] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState({});
  const [results, setResults] = useState({});
  const [unmatched, setUnmatched] = useState({});
  const [nonLeaf, setNonLeaf] = useState({});

  // 🔹 난이도 상태 + 디바운서
  const [difficultyMap, setDifficultyMap] = useState({});
  const diffTimersRef = useRef({});

  // 🔹 자동 저장 디바운서
  const autosaveTimerRef = useRef(null);
  const [autosaveStatus, setAutosaveStatus] = useState('idle'); // idle | saving | saved

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!materialId || !UUID_RE.test(materialId))
          throw new Error(`잘못된 materialId: ${materialId || '(없음)'}`);
        setLoading(true);

        // 1) 문장/순서/한영/난이도
        const { data: pairRows, error: e1 } = await supabase
          .from('material_pairs')
          .select('id, en_sentence, ko_sentence, order_index, difficulty')
          .eq('material_id', materialId)
          .order('order_index', { ascending: true });
        if (e1) throw e1;

        // 2) 카테고리 전체 로드
        const { meta: allMeta, leaves: allLeaves, resolvePath } =
          await loadAllCategories();
        if (!alive) return;
        setCatMeta(allMeta);
        setLeafIds(allLeaves);

        // 2-1) leafPaths → 추천 API에 전달
        const leafPathList = Array.from(allLeaves)
          .map((cid) => pathStringForDB(cid, allMeta))
          .filter(Boolean);

        // 3) 추천 요청
        const payload = (pairRows ?? []).map((p) => ({
          pair_id: p.id,
          en: p.en_sentence || '',
          ko: p.ko_sentence ?? null,
        }));

        const apiResults =
          payload.length > 0
            ? await callRecommendAPI(payload, leafPathList, {
                topN: 6,
                minScore: 0.5,
                quality: 'high',
              })
            : [];

        const recMap = {};
        const rawUnmatched = {};
        const rawNonLeaf = {};

        for (const r of apiResults) {
          const pid = r?.pair_id;
          if (!pid) continue;
          const items = Array.isArray(r?.recs) ? r.recs : [];
          const arr = [];
          for (const it of items) {
            const path = (it?.path ?? '').trim();
            if (!path) continue;

            const cid = resolvePath(path);
            if (!cid) {
              (rawUnmatched[pid] ||= []).push(path);
              continue;
            }
            if (!allLeaves.has(cid)) {
              (rawNonLeaf[pid] ||= []).push(pathLabelLocal(cid, path, allMeta));
              continue;
            }
            if (arr.findIndex((x) => x.category_id === cid) === -1) {
              arr.push({
                category_id: cid,
                reason: it?.reason ?? '',
                score: typeof it?.score === 'number' ? it.score : null,
                support_count: it?.support_count ?? null,
                example_sim: it?.example_sim ?? null,
              });
            }
          }
          arr.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
          if (arr.length > 0) recMap[pid] = arr;
        }

        // 4) 기존 선택값 DB에서
        const pairIds = (pairRows ?? []).map((p) => p.id).filter(Boolean);
        let selRows = [];
        if (pairIds.length > 0) {
          const { data, error: e3 } = await supabase
            .from('material_pair_categories')
            .select('pair_id, category_id')
            .in('pair_id', pairIds);
          if (e3) throw e3;
          selRows = data ?? [];
        }

        // ✅ 중요: pairId는 문자열 키로 통일해서 map 구성
        const selMap = {};
        for (const id of pairIds) selMap[String(id)] = new Set();
        for (const s of selRows) {
          const pid = s?.pair_id;
          const cid = s?.category_id;
          if (!pid || !cid) continue;
          (selMap[String(pid)] ||= new Set()).add(cid);
        }

        // 5) 난이도 초기화
        const nextDiff = {};
        for (const p of pairRows ?? []) nextDiff[String(p.id)] = p.difficulty ?? '';

        // 6) 🔁 로컬 자동 저장돼 있던 거 있으면 합치기
        let restoredSelected = selMap;
        try {
          const saved = localStorage.getItem(STORAGE_KEY);
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && parsed.selected) {
              const merged = {};
              for (const pidRaw of pairIds) {
                const pid = String(pidRaw);
                const dbSet = selMap[pid] ? new Set(selMap[pid]) : new Set();
                const localArr = parsed.selected[pid];
                if (Array.isArray(localArr)) {
                  for (const cid of localArr) dbSet.add(cid);
                }
                merged[pid] = dbSet;
              }
              restoredSelected = merged;
            }
          }
        } catch (err) {
          console.warn('[autosave restore failed]', err);
        }

        if (!alive) return;
        setPairs(pairRows ?? []);
        setRecs(recMap);
        setUnmatched(rawUnmatched);
        setNonLeaf(rawNonLeaf);
        setSelected(restoredSelected);
        setDifficultyMap(nextDiff);
      } catch (err) {
        console.error('[CategoryRecommendPage] init error', err);
        alert(`불러오기 오류: ${err.message}`);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [materialId, STORAGE_KEY]);

  // --- Helpers --------------------------------------------------------------
  async function loadAllCategories() {
    const { data, error } = await supabase
      .from('category_nodes')
      .select('id, name, parent_id');
    if (error) throw error;

    const norm = (s = '') =>
      s
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .replace(/\s*>\s*/g, '>')
        .replace(/\s*\(\s*/g, '(')
        .replace(/\s*\)\s*/g, ')')
        .trim();

    const meta = {};
    const childrenByParent = new Map();
    const byParentName = new Map();
    const childCount = new Map();

    for (const n of data ?? []) {
      meta[n.id] = { name: n.name, parent_id: n.parent_id ?? null };
      const pid = n.parent_id ?? 'root';
      const arr = childrenByParent.get(pid) || [];
      arr.push(n);
      childrenByParent.set(pid, arr);

      const key = `${pid}|||${norm(n.name)}`;
      byParentName.set(key, n.id);

      if (n.parent_id) childCount.set(n.parent_id, (childCount.get(n.parent_id) || 0) + 1);
    }

    const leaves = new Set(Object.keys(meta).filter((id) => !childCount.has(id)));

    function resolvePath(path) {
      const raw = (path ?? '').toString();
      if (!raw) return null;

      const parts = raw.split('>').map((s) => s.trim()).filter(Boolean);
      if (parts.length === 0) return null;

      let parent = 'root';
      let curId = null;

      for (const part of parts) {
        const p0 = norm(part);
        const exactKey = `${parent}|||${p0}`;
        let found = byParentName.get(exactKey);

        if (!found) {
          const candidates = childrenByParent.get(parent) || [];
          const pick = (fn) => candidates.find(fn);
          const c1 = pick((n) => norm(n.name) === p0);
          const c2 = c1 || pick((n) => norm(n.name).startsWith(p0) || p0.startsWith(norm(n.name)));
          const c3 = c2 || pick((n) => norm(n.name).includes(p0) || p0.includes(norm(n.name)));
          if (c1 || c2 || c3) found = (c1 || c2 || c3).id;
        }

        if (!found) return null;
        curId = found;
        parent = found;
      }

      return curId;
    }

    return { meta, leaves, resolvePath };
  }

  const pathLabel = (categoryId, fallback) => pathLabelLocal(categoryId, fallback, catMeta);

  const isOn = (pairId, categoryId) => {
    const set = selected[String(pairId)];
    return set ? set.has(categoryId) : false;
  };

  const toggle = (pairId, categoryId) => {
    if (!pairId || !categoryId) return;
    const pid = String(pairId);
    setSelected((prev) => {
      const next = { ...prev };
      const set = new Set(next[pid] ?? []);
      set.has(categoryId) ? set.delete(categoryId) : set.add(categoryId);
      next[pid] = set;
      return next;
    });
  };

  const searchCats = async (pairId, text) => {
    const pid = String(pairId);
    setQuery((q) => ({ ...q, [pid]: text }));
    if (!text?.trim()) {
      setResults((r) => ({ ...r, [pid]: [] }));
      return;
    }
    const { data, error } = await supabase
      .from('category_nodes')
      .select('id, name, parent_id')
      .ilike('name', `%${text.trim()}%`)
      .limit(20);
    if (error) return;
    const patch = {};
    for (const n of data ?? []) patch[n.id] = { name: n.name, parent_id: n.parent_id };
    setCatMeta((p) => ({ ...p, ...patch }));
    setResults((r) => ({ ...r, [pid]: data ?? [] }));
  };

  // 🔁 검색 결과 버튼도 토글 동작
  const addFromSearch = (pairId, cat) => {
    if (!pairId || !cat?.id) return;
    setCatMeta((prev) => ({
      ...prev,
      [cat.id]: { name: cat.name, parent_id: cat.parent_id ?? null },
    }));
    toggle(pairId, cat.id);
  };

  // ✅ 저장 (핵심 수정: pairs 기준으로 payload 생성 + 저장 후 검증)
  const saveAll = async () => {
    try {
      if (!materialId || !UUID_RE.test(materialId)) {
        alert('materialId가 올바르지 않습니다.');
        return;
      }

      // 0) 현재 material의 pairIds(문장 목록) 기준으로만 저장한다
      const pairIdList = (pairs ?? []).map((p) => String(p.id)).filter(Boolean);

      // selections 만들기: 반드시 pairIdList 기준
      const selections = pairIdList.map((pid) => {
        const set = selected[pid] ?? new Set();
        const raw = Array.from(set || []);

        // uuid만 남기기 (혹시 이상값 섞였을 때 전체 저장이 꼬이는 거 방지)
        const category_ids = raw.filter((cid) => UUID_RE.test(String(cid)));

        // RPC에는 int8로 안전하게
        const n = Number(pid);
        const pair_id = Number.isFinite(n) ? n : pid; // 매우 큰 bigint 대비(혹시라도)

        return { pair_id, category_ids };
      });

      // (선택) 디버그: 저장 직전 요약
      const totalChosen = selections.reduce((acc, s) => acc + (s.category_ids?.length || 0), 0);
      console.log('[saveAll] selections', selections);
      console.log('[saveAll] pairs=', pairIdList.length, 'chosen(total)=', totalChosen);

      // 1) 분류 저장
      const { error: e1 } = await supabase.rpc('material_save_pair_categories', {
        p_material_id: materialId,
        p_selections: selections,
      });
      if (e1) throw e1;

      // 2) 학습 데이터 누적
      await Promise.all(
        (pairs ?? []).map(async (p) => {
          const pid = String(p.id);
          const chosenIds = Array.from(selected[pid] ?? []).filter((cid) => leafIds.has(cid));
          if (chosenIds.length === 0) return;
          const paths = chosenIds.map((cid) => pathStringForDB(cid, catMeta)).filter(Boolean);
          if (paths.length === 0) return;

          const { error } = await supabase.rpc('save_pair_feedback', {
            p_material_id: materialId ?? null,
            p_pair_id: p.id,
            p_en: p.en_sentence,
            p_ko: p.ko_sentence ?? null,
            p_paths: paths,
          });
          if (error) console.warn('[save_pair_feedback]', p.id, error.message);
        })
      );

      // 3) ✅ 저장 후 검증: “진짜로 미분류가 남았는지” 체크
      const { data: uncRows, error: eCheck } = await supabase
        .from('material_pairs')
        .select('id')
        .eq('material_id', materialId)
        .not('id', 'is', null);

      if (!eCheck) {
        const ids = (uncRows ?? []).map((r) => r.id);
        if (ids.length) {
          const { data: pcRows, error: ePC } = await supabase
            .from('material_pair_categories')
            .select('pair_id')
            .in('pair_id', ids);

          if (!ePC) {
            const has = new Set((pcRows ?? []).map((r) => String(r.pair_id)));
            const stillUncat = ids.map(String).filter((pid) => !has.has(pid));

            // 아직도 미분류가 남아있으면 즉시 알려줌(원인추적 쉬워짐)
            if (stillUncat.length > 0) {
              console.warn('[saveAll] still uncategorized pair_ids:', stillUncat.slice(0, 30));
              alert(
                `저장은 완료됐지만, 아직 분류가 없는 문장이 ${stillUncat.length}개 남아있어요.\n` +
                  `콘솔에 pair_id 목록을 찍어뒀습니다.\n` +
                  `(대부분은 "선택이 0개"인 문장일 수 있어요)`
              );
            } else {
              alert('저장되었습니다.');
            }
          } else {
            alert('저장되었습니다. (검증 조회 실패)');
          }
        } else {
          alert('저장되었습니다.');
        }
      } else {
        alert('저장되었습니다. (검증 조회 실패)');
      }

      // 저장 성공했으면 로컬도 제거
      localStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      alert(`저장 오류: ${err.message}`);
    }
  };

  // 🔹 난이도 변경 시 자동 저장 (0.5s 디바운스)
  function onChangeDifficulty(pairId, value) {
    const pid = String(pairId);
    setDifficultyMap((prev) => ({ ...prev, [pid]: value ?? '' }));
    const timers = diffTimersRef.current;
    if (timers[pid]) clearTimeout(timers[pid]);
    timers[pid] = setTimeout(async () => {
      try {
        const { error } = await supabase.rpc('material_update_pair_difficulty', {
          p_pair_id: pairId,
          p_difficulty: value || null,
        });
        if (error) throw error;
      } catch (e) {
        console.error('[difficulty save]', e?.message || e);
      } finally {
        delete timers[pid];
      }
    }, 500);
  }

  const difficultyLabel = (code) =>
    code === 'easy' ? '쉬움' : code === 'normal' ? '보통' : code === 'hard' ? '어려움' : '(선택)';

  // 🔁 🔁 🔁 선택 상태 로컬 자동 저장
  useEffect(() => {
    setAutosaveStatus('saving');
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);

    autosaveTimerRef.current = setTimeout(() => {
      try {
        const plainSelected = {};
        for (const [pid, set] of Object.entries(selected)) {
          plainSelected[String(pid)] = Array.from(set || []);
        }
        const payload = { selected: plainSelected, ts: Date.now() };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        setAutosaveStatus('saved');
      } catch (e) {
        console.warn('[autosave failed]', e);
        setAutosaveStatus('idle');
      }
    }, 800);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [selected, STORAGE_KEY]);

  // --------------------------------------------------------------------
  return (
    <div className="ui-page">
      <div className="ui-wrap">
        <div className="ui-head">
          <div>
            <div className="ui-title">문장별 자동 분류 추천</div>
            <div className="ui-sub">
              추천은 <b>최하위 분류만</b> 표시하며, <b>영문(en_sentence) 기준</b> + <b>누적 학습 데이터</b>로 계산됩니다.
              각 추천에는 <b>이유(reason)</b>와 <b>확신도(score)</b>가 함께 제공됩니다.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {autosaveStatus === 'saving' && (
              <span className="ui-sub" style={{ fontSize: 12, color: '#3b82f6' }}>
                자동 저장 중…
              </span>
            )}
            {autosaveStatus === 'saved' && (
              <span className="ui-sub" style={{ fontSize: 12, color: '#10b981' }}>
                자동 저장됨
              </span>
            )}
            <DashboardButton />
            <Link to="/category/done" className="ui-btn sm">분류 완료 목록으로</Link>
          </div>
        </div>

        <div className="ui-card" style={{ marginBottom: 16 }}>
          <div className="ui-toolbar" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="ui-btn primary" onClick={saveAll}>저장</button>
          </div>
        </div>

        {loading && <div className="ui-card">불러오는 중…</div>}

        {!loading && pairs.map((p) => {
          const pid = String(p.id);
          const checked = selected[pid] ?? new Set();
          const baseRec = (recs[p.id] ?? []).filter(
            (v, i, a) => a.findIndex((x) => x.category_id === v.category_id) === i
          );
          const leafOnly = baseRec.filter((r) => leafIds.has(r.category_id));

          return (
            <div key={p.id} className="ui-card" style={{ marginBottom: 20 }}>
              <div className="ui-sub" style={{ borderBottom: '1px dashed #e6edf7', paddingBottom: 6, marginBottom: 8 }}>
                문장 ID: <b>{String(p.id).slice(0, 8)}</b>
              </div>

              <div className="pair-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* 좌측: 영문 + 추천 */}
                <div>
                  <span className="ui-sub">영문</span>
                  <div className="ui-card" style={{ background: '#f9fbff', marginTop: 6 }}>
                    {p.en_sentence || <i className="ui-sub">영문이 비어 있습니다</i>}
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <span className="ui-sub">추천 분류 <small>(최하위만, 메모리 기반 + EN 기준)</small></span>
                    <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
                      {leafOnly.length === 0 && (
                        <span className="ui-sub">
                          추천이 없습니다. <b>분류 검색</b>으로 직접 선택 후 저장하면, 다음부터 더 잘 학습됩니다.
                        </span>
                      )}
                      {leafOnly.map((r) => {
                        const cid = r.category_id;
                        const on = checked.has(cid);
                        const scoreTxt = typeof r.score === 'number' ? ` · score ${r.score.toFixed(2)}` : '';
                        return (
                          <div key={cid} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <button
                              type="button"
                              className={`ui-btn sm ${on ? 'primary' : ''}`}
                              title={r.reason || ''}
                              onClick={() => toggle(pid, cid)}
                            >
                              {pathLabel(cid)}
                              <span className="ui-sub" style={{ marginLeft: 6 }}>{scoreTxt}</span>
                            </button>
                            {r.reason && (
                              <div className="ui-sub" style={{ fontSize: 12, lineHeight: 1.4 }}>
                                {r.reason}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {(nonLeaf[p.id] ?? []).length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <span className="ui-sub">리프가 아닌 추천(경로 확인 필요)</span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                          {(nonLeaf[p.id] ?? []).map((lbl, i) => (
                            <span key={i} className="ui-badge" title="DB 트리에서 이 경로가 최하위가 아닙니다.">{lbl}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {(unmatched[p.id] ?? []).length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <span className="ui-sub">미등록/미매핑 경로</span>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                          {(unmatched[p.id] ?? []).map((raw, idx) => (
                            <span key={idx} className="ui-badge" title="DB 트리와 문자열이 달라 매핑 실패">{raw}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* 우측: 한글 + 난이도 + 검색 */}
                <div style={{ display: 'grid', gap: 10 }}>
                  <div>
                    <span className="ui-sub">한국어 해석</span>
                    <div className="ui-card" style={{ background: '#f9fbff', marginTop: 6 }}>
                      {p.ko_sentence ?? <i className="ui-sub">(없음)</i>}
                    </div>
                  </div>

                  {/* 🔹 난이도 드롭다운 */}
                  <div>
                    <span className="ui-sub">난이도</span>
                    <select
                      className="ui-input"
                      style={{ width: '100%', marginTop: 4 }}
                      value={difficultyMap[pid] ?? ''}
                      onChange={(e) => onChangeDifficulty(pid, e.target.value)}
                    >
                      <option value="">{difficultyLabel('')}</option>
                      <option value="easy">쉬움</option>
                      <option value="normal">보통</option>
                      <option value="hard">어려움</option>
                    </select>
                  </div>

                  {/* 🔎 분류 검색 (토글) */}
                  <div>
                    <span className="ui-sub">분류 검색 (기존 분류 · 복수 선택 가능)</span>
                    <input
                      className="ui-input"
                      placeholder="예: 품사, 보통명사"
                      value={query[pid] ?? ''}
                      onChange={(e) => searchCats(pid, e.target.value)}
                    />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                      {(results[pid] ?? []).map((cat) => {
                        const on = isOn(pid, cat.id);
                        return (
                          <button
                            type="button"
                            key={cat.id}
                            className={`ui-btn sm ${on ? 'primary' : ''}`}
                            onClick={() => addFromSearch(pid, cat)}
                          >
                            {pathLabel(cat.id, cat.name)}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* ✅ 현재 선택 (클릭 시 해제) */}
                  <div>
                    <span className="ui-sub">현재 선택</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                      {Array.from(checked).length === 0 && <span className="ui-sub">선택된 분류가 없습니다.</span>}
                      {Array.from(checked).map((cid) => (
                        <button
                          key={cid}
                          type="button"
                          className="ui-badge"
                          title="클릭하면 해제됩니다"
                          style={{ cursor: 'pointer' }}
                          onClick={() => toggle(pid, cid)}
                        >
                          {pathLabel(cid)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        <div className="ui-toolbar" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="ui-btn" onClick={() => nav(-1)}>검수 편집으로 돌아가기</button>
          <button type="button" className="ui-btn primary" onClick={saveAll}>저장</button>
        </div>

        <style>{`
          @media (max-width: 800px) {
            .pair-grid { grid-template-columns: 1fr !important; }
          }
        `}</style>
      </div>
    </div>
  );
}
