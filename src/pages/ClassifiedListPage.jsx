// src/pages/ClassifiedListPage.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import DashboardButton from '../components/DashboardButton';
import '../styles/ui.css';

export default function ClassifiedListPage() {
  const nav = useNavigate();

  const [tab, setTab] = useState('item');     // 기본: 자료별 보기
  const [status, setStatus] = useState('all'); // all | done
  const [rows, setRows] = useState([]);
  const [catRows, setCatRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState({});
  const [usedInMap, setUsedInMap] = useState({});
  const [difficultyMap, setDifficultyMap] = useState({});
  const saveTimersRef = useRef({});
  const diffTimersRef = useRef({});

  // ===================== 데이터 로드 =====================
  useEffect(() => {
    if (tab === 'item') fetchMaterials();
    else fetchByCategory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, status]);

  async function fetchMaterials() {
    setLoading(true);
    const { data, error } = await supabase
      .from('materials')
      .select('id, title, status, updated_at')
      .order('updated_at', { ascending: false })
      .limit(200);
    if (!error) setRows(data || []);
    setLoading(false);
  }

  // ✅ 분류된 문장 + 미분류 문장 모두 포함
  async function fetchByCategory() {
    setLoading(true);

    // 1) 분류된 문장: 기존 뷰 사용
    const { data: viewData, error: viewErr } = await supabase
      .from('v_category_pair_sentences')
      .select('*')
      .limit(5000);
    if (viewErr) {
      console.error('[fetchByCategory:view]', viewErr.message);
    }
    // 상태 필터
    const categorized = (viewData ?? []).filter((r) =>
      status === 'done' ? r.material_status === 'done' : true
    );

    // 2) 미분류 문장: material_pair_categories가 없는 pair
    // LEFT JOIN 후 NULL인 것만 가져오기
    let uncReq = supabase
      .from('material_pairs')
      .select(
        'id, en_sentence, ko_sentence, used_in, difficulty, material_id, ' +
          'materials!inner(title,status), material_pair_categories!left(pair_id)'
      )
      .is('material_pair_categories.pair_id', null)
      .limit(5000);
    if (status === 'done') {
      uncReq = uncReq.eq('materials.status', 'done');
    }
    const { data: uncData, error: uncErr } = await uncReq;
    if (uncErr) {
      console.error('[fetchByCategory:uncategorized]', uncErr.message);
    }

    const uncategorized = (uncData ?? []).map((u) => ({
      category_id: null,
      category_name: '(미분류)',
      pair_id: u.id,
      material_id: u.material_id,
      material_title: u.materials?.title ?? null,
      material_status: u.materials?.status ?? null,
      en_sentence: u.en_sentence,
      ko_sentence: u.ko_sentence,
      used_in: u.used_in ?? '',
      difficulty: u.difficulty ?? '',
    }));

    // 3) 합치기
    const merged = [...categorized, ...uncategorized];
    setCatRows(merged);

    // 초기 입력값 맵
    const nextUsed = {};
    const nextDiff = {};
    for (const r of merged) {
      nextUsed[r.pair_id] = r.used_in ?? '';
      nextDiff[r.pair_id] = r.difficulty ?? '';
    }
    setUsedInMap(nextUsed);
    setDifficultyMap(nextDiff);

    setLoading(false);
  }

  // ===================== 가공 =====================
  const groupedCats = useMemo(() => {
    const qn = q.trim().toLowerCase();
    const map = new Map();
    for (const r of catRows) {
      const cid = r.category_id ?? 'UNCAT';
      const cname = r.category_name ?? '(미분류)';
      if (qn && !cname.toLowerCase().includes(qn)) continue;

      if (!map.has(cid)) {
        map.set(cid, { category_id: cid, category_name: cname, items: [] });
      }
      map.get(cid).items.push({
        pair_id: r.pair_id,
        en_sentence: r.en_sentence,
        ko_sentence: r.ko_sentence,
        material_id: r.material_id,
        material_title: r.material_title,
        used_in: r.used_in ?? '',
        difficulty: r.difficulty ?? '',
      });
    }
    return Array.from(map.values()).sort(
      (a, b) => b.items.length - a.items.length
    );
  }, [catRows, q]);

  // ===================== 저장 핸들러 =====================
  function onUsedInChange(pairId, value) {
    setUsedInMap((prev) => ({ ...prev, [pairId]: value }));
    if (saveTimersRef.current[pairId])
      clearTimeout(saveTimersRef.current[pairId]);
    saveTimersRef.current[pairId] = setTimeout(async () => {
      try {
        await supabase.rpc('material_update_pair_used_in', {
          p_pair_id: pairId,
          p_used_in: value?.trim() || null,
        });
      } catch (e) {
        console.error('saveUsedIn', e.message);
      } finally {
        delete saveTimersRef.current[pairId];
      }
    }, 600);
  }

  function onDifficultyChange(pairId, value) {
    setDifficultyMap((prev) => ({ ...prev, [pairId]: value }));
    if (diffTimersRef.current[pairId])
      clearTimeout(diffTimersRef.current[pairId]);
    diffTimersRef.current[pairId] = setTimeout(async () => {
      try {
        await supabase.rpc('material_update_pair_difficulty', {
          p_pair_id: pairId,
          p_difficulty: value || null,
        });
      } catch (e) {
        console.error('saveDifficulty', e.message);
      } finally {
        delete diffTimersRef.current[pairId];
      }
    }, 600);
  }

  function renderDifficultyBadge(code) {
    if (!code) return null;
    const text =
      code === 'easy' ? '쉬움' : code === 'normal' ? '보통' : '어려움';
    const color =
      code === 'easy'
        ? '#42b983'
        : code === 'normal'
        ? '#3b82f6'
        : '#ef4444';
    return (
      <span
        className="ui-badge"
        style={{ background: color, color: '#fff', fontWeight: 600 }}
      >
        {text}
      </span>
    );
  }

  function toggleExpand(catId) {
    setExpanded((p) => ({ ...p, [catId]: !p[catId] }));
  }

  // ===================== UI =====================
  return (
    <div className="ui-page">
      <div className="ui-wrap">
        {/* 헤더 */}
        <div className="ui-head">
          <div>
            <div className="ui-title">분류 완료 목록</div>
            <div className="ui-sub">
              완료되지 않은 자료도 포함해, 교재 메모와 난이도를 함께 관리합니다.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <DashboardButton />
            <Link to="/category/manage" className="ui-btn sm">분류 관리로</Link>
            <Link to="/category/start" className="ui-btn sm">분류 시작하기</Link>
          </div>
        </div>

        {/* 탭 + 상태 필터 + 검색 */}
        <div className="ui-card">
          <div className="ui-tabs">
            <button
              className={`ui-tab ${tab === 'item' ? 'active' : ''}`}
              onClick={() => setTab('item')}
            >
              자료별 보기
            </button>
            <button
              className={`ui-tab ${tab === 'category' ? 'active' : ''}`}
              onClick={() => setTab('category')}
            >
              분류별 보기
            </button>
          </div>

          <div className="ui-toolbar" style={{ justifyContent: 'space-between' }}>
            <div className="ui-toolbar" role="tablist">
              <button
                className={`ui-btn sm ${status === 'all' ? 'primary' : ''}`}
                onClick={() => setStatus('all')}
              >
                전체(all)
              </button>
              <button
                className={`ui-btn sm ${status === 'done' ? 'primary' : ''}`}
                onClick={() => setStatus('done')}
              >
                완료(done)만
              </button>
            </div>

            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="분류명 검색 (예: 품사, 구동사, 미분류)"
              style={{
                width: 260,
                padding: '8px 10px',
                border: '1px solid #e3e8f2',
                borderRadius: 8,
              }}
            />
          </div>
        </div>

        {/* 자료별 보기 */}
        {tab === 'item' && (
          <div className="ui-card" style={{ marginTop: 12 }}>
            {loading ? (
              <div className="ui-sub">불러오는 중...</div>
            ) : rows.length === 0 ? (
              <div className="ui-sub">저장된 자료가 없습니다.</div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {rows.map((m) => (
                  <div
                    key={m.id}
                    className="ui-card"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: 12,
                      cursor: 'pointer',
                    }}
                    onClick={() => nav(`/category/recommend/${m.id}`)}
                  >
                    <div>
                      <b>{m.title || '(제목 없음)'}</b>
                      <div style={{ fontSize: 13, color: '#5d6b82' }}>
                        상태: {m.status || '저장됨'}
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: '#888' }}>
                      {m.updated_at ? new Date(m.updated_at).toLocaleString('ko-KR') : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 분류별 보기 */}
        {tab === 'category' && (
          <div className="ui-card" style={{ marginTop: 12 }}>
            {loading ? (
              <div className="ui-sub">불러오는 중...</div>
            ) : groupedCats.length === 0 ? (
              <div className="ui-sub">표시할 데이터 없음</div>
            ) : (
              groupedCats.map((cat) => {
                const open = !!expanded[cat.category_id];
                return (
                  <div key={cat.category_id} className="ui-card" style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <b>{cat.category_name}</b>
                        <span className="ui-badge">{cat.items.length}문장</span>
                      </div>
                      <button className="ui-btn sm" onClick={() => toggleExpand(cat.category_id)}>
                        {open ? '접기' : '펼치기'}
                      </button>
                    </div>

                    {open && (
                      <div style={{ marginTop: 8, borderLeft: '3px solid #eef3ff', paddingLeft: 8 }}>
                        {cat.items.map((it) => (
                          <div key={it.pair_id} className="ui-card" style={{ marginBottom: 8 }}>
                            <div style={{ fontWeight: 700 }}>{it.en_sentence}</div>
                            <div style={{ color: '#4b5563' }}>{it.ko_sentence}</div>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 6 }}>
                              <label style={{ fontSize: 12, color: '#555' }}>난이도:</label>
                              <select
                                value={difficultyMap[it.pair_id] ?? ''}
                                onChange={(e) => onDifficultyChange(it.pair_id, e.target.value || null)}
                                style={{ border: '1px solid #ccc', borderRadius: 6, padding: '4px 6px', fontSize: 13 }}
                              >
                                <option value="">(선택)</option>
                                <option value="easy">쉬움</option>
                                <option value="normal">보통</option>
                                <option value="hard">어려움</option>
                              </select>
                              {renderDifficultyBadge(difficultyMap[it.pair_id])}
                              <span style={{ fontSize: 13 }}>출처: {it.material_title ?? '-'}</span>
                              <button
                                className="ui-btn sm"
                                onClick={() => nav(`/category/recommend/${it.material_id}`)}
                              >
                                이 자료로 이동
                              </button>
                            </div>

                            <div style={{ marginTop: 8 }}>
                              <label style={{ fontSize: 12, color: '#5d6b82', display: 'block', marginBottom: 4 }}>
                                교재 메모
                              </label>
                              <input
                                value={usedInMap[it.pair_id] ?? ''}
                                onChange={(e) => onUsedInChange(it.pair_id, e.target.value)}
                                placeholder="예) 능률보카 3과 / 자작 프린트 5회차"
                                style={{ width: '100%', padding: '8px 10px', border: '1px solid #e3e8f2', borderRadius: 8, fontSize: 13 }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
