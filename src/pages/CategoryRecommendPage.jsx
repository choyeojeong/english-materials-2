// src/pages/CategoryRecommendPage.jsx
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import DashboardButton from '../components/DashboardButton';
import '../styles/ui.css';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ✅ 에지 함수 호출 헬퍼: DEV=로컬 우선, 실패 시 원격
async function invokeRecommendAI(body) {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const LOCAL = 'http://127.0.0.1:54321/functions/v1';
  const REMOTE = `${supabaseUrl}/functions/v1`;

  const targets = import.meta.env.DEV ? [LOCAL, REMOTE] : [REMOTE];
  let lastErr;

  for (const base of targets) {
    try {
      const res = await fetch(`${base}/recommend_ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // 원격 호출 시 필요한 공개키(클라이언트에서 노출되어도 되는 anon key)
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status} ${t}`);
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      // 로컬이 안 뜬 경우 다음 후보(원격)로 폴백
    }
  }
  throw lastErr || new Error('Failed to call recommend_ai');
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

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!materialId || !UUID_RE.test(materialId))
          throw new Error(`잘못된 materialId: ${materialId || '(없음)'}`);
        setLoading(true);

        // 1) 문장/순서/한영
        const { data: pairRows, error: e1 } = await supabase
          .from('material_pairs')
          .select('id, en_sentence, ko_sentence, order_index')
          .eq('material_id', materialId)
          .order('order_index', { ascending: true });
        if (e1) throw e1;

        // 2) 카테고리 전체 로드(경로(path) → id 매핑 강화)
        const { meta: allMeta, leaves: allLeaves, resolvePath } =
          await loadAllCategories();
        setCatMeta(allMeta);
        setLeafIds(allLeaves);

        // 3) AI 추천 호출 (직접 fetch 사용)
        const invokeBody = {
          items: (pairRows ?? []).map((p) => ({
            pair_id: p.id,
            en: p.en_sentence,
            ko: p.ko_sentence,
          })),
        };

        const efData = await invokeRecommendAI(invokeBody);
        console.log('[recommend_ai] response', efData);
        const efResults = efData?.results ?? [];

        // 4) 추천 결과(path)를 category_id로 변환 + leaf만 유지
        const recMap = {};
        const rawUnmatched = {};
        const rawNonLeaf = {};
        for (const r of efResults) {
          const pid = r?.pair_id;
          const items = r?.recs ?? [];
          if (!pid) continue;
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
              arr.push({ category_id: cid, score: null, rank: null });
            }
          }
          if (arr.length > 0) recMap[pid] = arr;
        }

        // 5) 기존 선택값 불러오기
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

        if (!alive) return;

        setPairs(pairRows ?? []);
        setRecs(recMap);
        setUnmatched(rawUnmatched);
        setNonLeaf(rawNonLeaf);
        setSelected(selMap);
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

      if (n.parent_id) {
        childCount.set(n.parent_id, (childCount.get(n.parent_id) || 0) + 1);
      }
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

  const pathLabelLocal = (categoryId, fallback, metaObj) => {
    if (!categoryId) return fallback || '(이름 없음)';
    const names = [];
    let cur = categoryId;
    while (cur && metaObj[cur]) {
      names.unshift(metaObj[cur].name);
      cur = metaObj[cur].parent_id;
    }
    return names.join('→') || fallback || '(이름 없음)';
  };

  const pathLabel = (categoryId, fallback) => pathLabelLocal(categoryId, fallback, catMeta);

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
    for (const n of data ?? [])
      patch[n.id] = { name: n.name, parent_id: n.parent_id };
    setCatMeta((p) => ({ ...p, ...patch }));
    setResults((r) => ({ ...r, [pairId]: data ?? [] }));
  };

  const addFromSearch = (pairId, cat) => {
    if (!pairId || !cat?.id) return;
    setSelected((prev) => {
      const next = { ...prev };
      const set = new Set(next[pairId] ?? []);
      set.add(cat.id);
      next[pairId] = set;
      return next;
    });
    setCatMeta((prev) => ({
      ...prev,
      [cat.id]: { name: cat.name, parent_id: cat.parent_id ?? null },
    }));
  };

  const saveAll = async () => {
    try {
      const selections = Object.entries(selected).map(([pairId, set]) => ({
        pair_id: pairId,
        category_ids: Array.from(set || []),
      }));
      const { error: e1 } = await supabase.rpc('material_save_pair_categories', {
        p_material_id: materialId,
        p_selections: selections,
      });
      if (e1) throw e1;
      alert('저장되었습니다.');
    } catch (err) {
      alert(`저장 오류: ${err.message}`);
    }
  };

  return (
    <div className="ui-page">
      <div className="ui-wrap">
        <div className="ui-head">
          <div>
            <div className="ui-title">문장별 자동 분류 추천</div>
            <div className="ui-sub">
              추천은 <b>최하위 분류만</b> 표시하며,{' '}
              <b>영문(en_sentence) 기준</b>으로 계산됩니다.
              라벨은 경로로 보여줘요 (예: 품사→명사→보통명사).
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <DashboardButton />
            <Link to="/category/done" className="ui-btn sm">
              분류 완료 목록으로
            </Link>
          </div>
        </div>

        <div className="ui-card" style={{ marginBottom: 16 }}>
          <div className="ui-toolbar" style={{ justifyContent: 'flex-end' }}>
            <button className="ui-btn primary" onClick={saveAll}>
              저장
            </button>
          </div>
        </div>

        {loading && <div className="ui-card">불러오는 중…</div>}

        {!loading &&
          pairs.map((p) => {
            const checked = selected[p.id] ?? new Set();
            const baseRec = (recs[p.id] ?? []).filter(
              (v, i, a) => a.findIndex((x) => x.category_id === v.category_id) === i
            );
            const leafOnly = baseRec.filter((r) => leafIds.has(r.category_id));

            return (
              <div key={p.id} className="ui-card" style={{ marginBottom: 20 }}>
                <div
                  className="ui-sub"
                  style={{
                    borderBottom: '1px dashed #e6edf7',
                    paddingBottom: 6,
                    marginBottom: 8,
                  }}
                >
                  문장 ID: <b>{String(p.id).slice(0, 8)}</b>
                </div>

                <div
                  className="pair-grid"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 16,
                  }}
                >
                  <div>
                    <span className="ui-sub">영문</span>
                    <div
                      className="ui-card"
                      style={{
                        border: '1px solid #e9eef5',
                        background: '#f9fbff',
                        fontSize: 14,
                        marginTop: 6,
                      }}
                    >
                      {p.en_sentence}
                    </div>

                    <div style={{ marginTop: 12 }}>
                      <span className="ui-sub">
                        추천 분류 <small>(최하위만, EN 기준)</small>
                      </span>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 8,
                          marginTop: 6,
                        }}
                      >
                        {leafOnly.length === 0 && (
                          <span className="ui-sub">추천이 없습니다.</span>
                        )}
                        {leafOnly.map((r) => {
                          const cid = r.category_id;
                          const on = checked.has(cid);
                          return (
                            <button
                              key={cid}
                              className={`ui-btn sm ${on ? 'primary' : ''}`}
                              onClick={() => toggle(p.id, cid)}
                            >
                              {pathLabel(cid)}
                            </button>
                          );
                        })}
                      </div>

                      {(nonLeaf[p.id] ?? []).length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <span className="ui-sub">리프가 아닌 추천(경로 확인 필요)</span>
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: 8,
                              marginTop: 4,
                            }}
                          >
                            {(nonLeaf[p.id] ?? []).map((lbl, i) => (
                              <span key={i} className="ui-badge" title="DB 트리에서 이 경로가 최하위가 아닙니다.">
                                {lbl}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {(unmatched[p.id] ?? []).length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <span className="ui-sub">미등록/미매핑 경로</span>
                          <div
                            style={{
                              display: 'flex',
                              flexWrap: 'wrap',
                              gap: 8,
                              marginTop: 4,
                            }}
                          >
                            {(unmatched[p.id] ?? []).map((raw, idx) => (
                              <span key={idx} className="ui-badge" title="DB 트리와 문자열이 달라 매핑 실패">
                                {raw}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: 10 }}>
                    <div>
                      <span className="ui-sub">한국어 해석</span>
                      <div
                        className="ui-card"
                        style={{
                          border: '1px solid #e9eef5',
                          background: '#f9fbff',
                          fontSize: 14,
                          marginTop: 6,
                        }}
                      >
                        {p.ko_sentence}
                      </div>
                    </div>

                    <div>
                      <span className="ui-sub">분류 검색 (기존 분류 · 복수 선택 가능)</span>
                      <input
                        className="ui-input"
                        style={{
                          width: '100%',
                          padding: '10px 12px',
                          border: '1px solid #d8e2ef',
                          borderRadius: 10,
                          marginTop: 4,
                        }}
                        placeholder="예: 품사, 보통명사"
                        value={query[p.id] ?? ''}
                        onChange={(e) => searchCats(p.id, e.target.value)}
                      />
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 8,
                          marginTop: 6,
                        }}
                      >
                        {(results[p.id] ?? []).map((cat) => (
                          <button
                            key={cat.id}
                            className="ui-btn sm"
                            onClick={() => addFromSearch(p.id, cat)}
                          >
                            {pathLabel(cat.id, cat.name)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <span className="ui-sub">현재 선택</span>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 8,
                          marginTop: 6,
                        }}
                      >
                        {Array.from(checked).length === 0 && (
                          <span className="ui-sub">선택된 분류가 없습니다.</span>
                        )}
                        {Array.from(checked).map((cid) => (
                          <span key={cid} className="ui-badge">
                            {pathLabel(cid)}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

        <div className="ui-toolbar" style={{ justifyContent: 'space-between' }}>
          <button className="ui-btn" onClick={() => nav(-1)}>
            검수 편집으로 돌아가기
          </button>
          <button className="ui-btn primary" onClick={saveAll}>
            저장
          </button>
        </div>

        <style>{`
          @media (max-width: 800px){
            .pair-grid {
              display: grid !important;
              grid-template-columns: 1fr !important;
            }
          }
        `}</style>
      </div>
    </div>
  );
}
