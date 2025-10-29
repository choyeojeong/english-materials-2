// src/pages/ClassifiedListPage.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import DashboardButton from '../components/DashboardButton';
import '../styles/ui.css';

export default function ClassifiedListPage() {
  const nav = useNavigate();

  const [tab, setTab] = useState('category');
  const [status, setStatus] = useState('all'); // ✅ 기본값 all
  const [rows, setRows] = useState([]);
  const [catRows, setCatRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState({});
  const [usedInMap, setUsedInMap] = useState({});
  const [difficultyMap, setDifficultyMap] = useState({});
  const saveTimersRef = useRef({});
  const diffTimersRef = useRef({});

  // ✅ 데이터 로드
  useEffect(() => {
    if (tab === 'item') fetchMaterials();
    else fetchByCategory();
  }, [tab, status]);

  async function fetchMaterials() {
    setLoading(true);
    // ✅ 완료 여부와 관계없이 모든 자료 불러오기
    const { data, error } = await supabase
      .from('materials')
      .select('id, title, status, updated_at')
      .order('updated_at', { ascending: false })
      .limit(200);
    if (!error) setRows(data || []);
    setLoading(false);
  }

  async function fetchByCategory() {
    setLoading(true);
    const { data, error } = await supabase
      .from('v_category_pair_sentences')
      .select('*')
      .limit(5000);
    if (error) {
      console.error('[fetchByCategory]', error.message);
      setCatRows([]);
      setLoading(false);
      return;
    }

    // ✅ status 필터가 'done'일 때만 done만 표시, 아니면 전체
    const filtered =
      status === 'done'
        ? (data ?? []).filter((r) => r.material_status === 'done')
        : data ?? [];

    setCatRows(filtered);

    // 초기 맵 세팅
    const nextUsed = {};
    const nextDiff = {};
    for (const r of filtered) {
      nextUsed[r.pair_id] = r.used_in ?? '';
      nextDiff[r.pair_id] = r.difficulty ?? '';
    }
    setUsedInMap(nextUsed);
    setDifficultyMap(nextDiff);
    setLoading(false);
  }

  const groupedCats = useMemo(() => {
    const qn = q.trim().toLowerCase();
    const map = new Map();
    for (const r of catRows) {
      if (qn && !(r.category_name ?? '').toLowerCase().includes(qn)) continue;
      const key = r.category_id;
      if (!map.has(key))
        map.set(key, {
          category_id: r.category_id,
          category_name: r.category_name,
          items: [],
        });
      map.get(key).items.push({
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

  // ✅ 교재 메모 자동 저장
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

  // ✅ 난이도 자동 저장
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

  const renderDifficultyBadge = (code) => {
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
        style={{
          background: color,
          color: '#fff',
          fontWeight: 600,
        }}
      >
        {text}
      </span>
    );
  };

  function toggleExpand(catId) {
    setExpanded((p) => ({ ...p, [catId]: !p[catId] }));
  }

  return (
    <div className="ui-page">
      <div className="ui-wrap">
        <div className="ui-head">
          <div>
            <div className="ui-title">분류 완료 목록</div>
            <div className="ui-sub">
              완료되지 않은 자료도 포함하여, 교재 메모와 난이도를 함께 관리합니다.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <DashboardButton />
            <Link to="/category/manage" className="ui-btn sm">
              분류 관리로
            </Link>
            <Link to="/category/start" className="ui-btn sm">
              분류 시작하기
            </Link>
          </div>
        </div>

        {/* 필터 */}
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
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="분류명 검색"
            style={{
              width: 240,
              padding: '8px 10px',
              border: '1px solid #e3e8f2',
              borderRadius: 8,
            }}
          />
        </div>

        {/* 내용 */}
        {tab === 'category' && (
          <div className="ui-card" style={{ marginTop: 12 }}>
            {loading ? (
              <div className="ui-sub">불러오는 중...</div>
            ) : groupedCats.length === 0 ? (
              <div className="ui-sub">표시할 데이터 없음</div>
            ) : (
              groupedCats.map((cat) => {
                const open = expanded[cat.category_id];
                return (
                  <div key={cat.category_id} className="ui-card" style={{ marginBottom: 10 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
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

                            {/* 난이도 선택 + 출처 + 이동 */}
                            <div
                              style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                gap: 10,
                                alignItems: 'center',
                                marginTop: 6,
                              }}
                            >
                              <label style={{ fontSize: 12, color: '#555' }}>난이도:</label>
                              <select
                                value={difficultyMap[it.pair_id] ?? ''}
                                onChange={(e) =>
                                  onDifficultyChange(it.pair_id, e.target.value || null)
                                }
                                style={{
                                  border: '1px solid #ccc',
                                  borderRadius: 6,
                                  padding: '4px 6px',
                                  fontSize: 13,
                                }}
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

                            {/* 교재 메모 입력 */}
                            <div style={{ marginTop: 8 }}>
                              <label
                                style={{
                                  fontSize: 12,
                                  color: '#5d6b82',
                                  display: 'block',
                                  marginBottom: 4,
                                }}
                              >
                                교재 메모
                              </label>
                              <input
                                value={usedInMap[it.pair_id] ?? ''}
                                onChange={(e) => onUsedInChange(it.pair_id, e.target.value)}
                                placeholder="예) 능률보카 3과 / 자작 프린트 5회차"
                                style={{
                                  width: '100%',
                                  padding: '8px 10px',
                                  border: '1px solid #e3e8f2',
                                  borderRadius: 8,
                                  fontSize: 13,
                                }}
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
