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
async function callRecommendAPI(pairs, leafPaths, { topN = 6, minScore = 0.5 } = {}) {
  const res = await fetch('/api/recommend_ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: pairs, leafPaths, topN, minScore }),
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

        // 2) 카테고리 전체 로드(경로(path) → id 매핑 강화)
        const { meta: allMeta, leaves: allLeaves, resolvePath } =
          await loadAllCategories();
        if (!alive) return;
        setCatMeta(allMeta);
        setLeafIds(allLeaves);

        // 2-1) leafPaths(문자열) 구성 → Vercel 함수에 전달해 리프만 허용
        const leafPathList = Array.from(allLeaves)
          .map((cid) => pathStringForDB(cid, allMeta))
          .filter(Boolean);

        // 3) Vercel 함수로 한 번에 추천 요청(배치)
        const payload = (pairRows ?? []).map((p) => ({
          pair_id: p.id,
          en: p.en_sentence,
          ko: p.ko_sentence ?? null,
        }));

        const apiResults =
          payload.length > 0
            ? await callRecommendAPI(payload, leafPathList, { topN: 6, minScore: 0.5 })
            : [];

        // API 결과 → pair_id별 + DB 리프 매핑
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
                score: it?.score ?? null,
                support_count: it?.support_count ?? null,
                example_sim: it?.example_sim ?? null,
              });
            }
          }
          if (arr.length > 0) recMap[pid] = arr;
        }

        // 4) 기존 선택값 불러오기
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

        const selMap = {};
        for (const id of pairIds) selMap[id] = new Set();
        for (const s of selRows) {
          if (!s?.pair_id || !s?.category_id) continue;
          (selMap[s.pair_id] ||= new Set()).add(s.category_id);
        }

        // 5) 난이도 초기화
        const nextDiff = {};
        for (const p of pairRows ?? []) nextDiff[p.id] = p.difficulty ?? '';

        if (!alive) return;
        setPairs(pairRows ?? []);
        setRecs(recMap);
        setUnmatched(rawUnmatched);
        setNonLeaf(rawNonLeaf);
        setSelected(selMap);
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
  }, [materialId]);

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
    const set = selected[pairId];
    return set ? set.has(categoryId) : false;
  };

  const toggle = (pairId, categoryId) => {
    if (!pairId || !categoryId) return;
    setSelected((prev) => {
      const next = { ...prev };
      const set = new Set(next[pairId] ?? []);
      set.has(categoryId) ? set.delete(categoryId) : set.add(categoryId);
      next[pairId] = set;
      return next;
    });
  };

  const searchCats = async (pairId, text) => {
    setQuery((q) => ({ ...q, [pairId]: text }));
    if (!text?.trim()) {
      setResults((r) => ({ ...r, [pairId]: [] }));
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
    setResults((r) => ({ ...r, [pairId]: data ?? [] }));
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

  const saveAll = async () => {
    try {
      // 1) 분류 저장
      const selections = Object.entries(selected).map(([pairId, set]) => ({
        pair_id: Number(pairId),
        category_ids: Array.from(set || []),
      }));
      const { error: e1 } = await supabase.rpc('material_save_pair_categories', {
        p_material_id: materialId,
        p_selections: selections,
      });
      if (e1) throw e1;

      // 2) 학습 데이터 누적 (선택된 분류를 텍스트 경로로 저장)
      await Promise.all(
        (pairs ?? []).map(async (p) => {
          const chosenIds = Array.from(selected[p.id] ?? []).filter((cid) => leafIds.has(cid));
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

      alert('저장되었습니다.');
    } catch (err) {
      alert(`저장 오류: ${err.message}`);
    }
  };

  // 🔹 난이도 변경 시 자동 저장 (0.5s 디바운스)
  function onChangeDifficulty(pairId, value) {
    setDifficultyMap((prev) => ({ ...prev, [pairId]: value ?? '' }));
    const timers = diffTimersRef.current;
    if (timers[pairId]) clearTimeout(timers[pairId]);
    timers[pairId] = setTimeout(async () => {
      try {
        const { error } = await supabase.rpc('material_update_pair_difficulty', {
          p_pair_id: pairId,
          p_difficulty: value || null,
        });
        if (error) throw error;
      } catch (e) {
        console.error('[difficulty save]', e?.message || e);
      } finally {
        delete timers[pairId];
      }
    }, 500);
  }

  const difficultyLabel = (code) =>
    code === 'easy' ? '쉬움' : code === 'normal' ? '보통' : code === 'hard' ? '어려움' : '(선택)';

  // --------------------------------------------------------------------
  return (
    <div className="ui-page">
      <div className="ui-wrap">
        <div className="ui-head">
          <div>
            <div className="ui-title">문장별 자동 분류 추천</div>
            <div className="ui-sub">
              추천은 <b>최하위 분류만</b> 표시하며, <b>영문(en_sentence) 기준</b> + <b>누적 학습 데이터</b>로 계산됩니다. 각 추천에는 <b>한국어 이유</b>가 함께 제공됩니다.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
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
          const checked = selected[p.id] ?? new Set();
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
                    {p.en_sentence}
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <span className="ui-sub">추천 분류 <small>(최하위만, 메모리 기반 + EN 기준)</small></span>
                    <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
                      {leafOnly.length === 0 && <span className="ui-sub">추천이 없습니다.</span>}
                      {leafOnly.map((r) => {
                        const cid = r.category_id;
                        const on = checked.has(cid);
                        return (
                          <div key={cid} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <button
                              type="button"
                              className={`ui-btn sm ${on ? 'primary' : ''}`}
                              title={r.reason || ''}
                              onClick={() => toggle(p.id, cid)}
                            >
                              {pathLabel(cid)}
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
                      {p.ko_sentence}
                    </div>
                  </div>

                  {/* 🔹 난이도 드롭다운 */}
                  <div>
                    <span className="ui-sub">난이도</span>
                    <select
                      className="ui-input"
                      style={{ width: '100%', marginTop: 4 }}
                      value={difficultyMap[p.id] ?? ''}
                      onChange={(e) => onChangeDifficulty(p.id, e.target.value)}
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
                      value={query[p.id] ?? ''}
                      onChange={(e) => searchCats(p.id, e.target.value)}
                    />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                      {(results[p.id] ?? []).map((cat) => {
                        const on = isOn(p.id, cat.id);
                        return (
                          <button
                            type="button"
                            key={cat.id}
                            className={`ui-btn sm ${on ? 'primary' : ''}`}
                            onClick={() => addFromSearch(p.id, cat)}
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
                          onClick={() => toggle(p.id, cid)}
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
