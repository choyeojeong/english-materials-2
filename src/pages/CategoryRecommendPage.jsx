// src/pages/CategoryRecommendPage.jsx
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import DashboardButton from '../components/DashboardButton';
import '../styles/ui.css';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!materialId || !UUID_RE.test(materialId))
          throw new Error(`잘못된 materialId: ${materialId || '(없음)'}`);
        setLoading(true);

        const { data: pairRows, error: e1 } = await supabase
          .from('material_pairs')
          .select('id, en_sentence, ko_sentence, order_index')
          .eq('material_id', materialId)
          .order('order_index', { ascending: true });
        if (e1) throw e1;

        const { data: recRows, error: e2 } = await supabase.rpc(
          'category_recommend_for_material',
          { p_material_id: materialId }
        );
        if (e2) throw e2;

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

        if (!alive) return;
        const recMap = {};
        const allCatIds = new Set();
        for (const r of recRows ?? []) {
          if (!r?.pair_id || !r?.category_id) continue;
          (recMap[r.pair_id] ||= []).push({ category_id: r.category_id });
          allCatIds.add(r.category_id);
        }

        const selMap = {};
        for (const id of pairIds) selMap[id] = new Set();
        for (const s of selRows) {
          if (!s?.pair_id || !s?.category_id) continue;
          (selMap[s.pair_id] ||= new Set()).add(s.category_id);
          allCatIds.add(s.category_id);
        }

        const { meta, leaves } = await loadCategoryMetaWithLeaves(allCatIds);
        if (!alive) return;

        setPairs(pairRows ?? []);
        setRecs(recMap);
        setSelected(selMap);
        setCatMeta(meta);
        setLeafIds(leaves);
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

  async function loadCategoryMetaWithLeaves(initialIds) {
    const meta = {};
    const fetched = new Set();
    async function fetchByIds(ids) {
      if (ids.length === 0) return;
      const { data, error } = await supabase
        .from('category_nodes')
        .select('id, name, parent_id')
        .in('id', ids);
      if (error) throw error;
      for (const n of data ?? []) {
        meta[n.id] = { name: n.name, parent_id: n.parent_id };
        fetched.add(n.id);
      }
    }
    await fetchByIds(Array.from(initialIds ?? []));
    for (let depth = 0; depth < 2; depth++) {
      const needParents = [];
      for (const id of Object.keys(meta)) {
        const pid = meta[id]?.parent_id;
        if (pid && !fetched.has(pid)) needParents.push(pid);
      }
      if (needParents.length === 0) break;
      await fetchByIds(Array.from(new Set(needParents)));
    }
    const candidateIds = Object.keys(meta);
    const { data: children, error: eKids } = await supabase
      .from('category_nodes')
      .select('parent_id')
      .in('parent_id', candidateIds);
    if (eKids) throw eKids;
    const hasChild = new Set(
      (children ?? []).map((r) => r.parent_id).filter(Boolean)
    );
    const leaves = new Set(candidateIds.filter((id) => !hasChild.has(id)));
    return { meta, leaves };
  }

  const pathLabel = (categoryId, fallback) => {
    if (!categoryId) return fallback || '(이름 없음)';
    const names = [];
    let cur = categoryId;
    while (cur && catMeta[cur]) {
      names.unshift(catMeta[cur].name);
      cur = catMeta[cur].parent_id;
    }
    return names.join('→') || fallback || '(이름 없음)';
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
      const { error } = await supabase.rpc('material_save_pair_categories', {
        p_material_id: materialId,
        p_selections: selections,
      });
      if (error) throw error;
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
              추천은 <b>최하위 분류만</b> 표시하며, 라벨은 경로로 보여줍니다.
              (예: 품사→명사→보통명사)
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
              (v, i, a) =>
                a.findIndex((x) => x.category_id === v.category_id) === i
            );
            const leafOnly = baseRec.filter((r) => leafIds.has(r.category_id));
            return (
              <div key={p.id} className="ui-card" style={{ marginBottom: 20 }}>
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
                        추천 분류 <small>(최하위만)</small>
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
                              className={`ui-btn sm ${
                                on ? 'primary' : ''
                              }`}
                              onClick={() => toggle(p.id, cid)}
                            >
                              {pathLabel(cid)}
                            </button>
                          );
                        })}
                      </div>
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
                      <span className="ui-sub">
                        분류 검색 (기존 분류 · 복수 선택 가능)
                      </span>
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
