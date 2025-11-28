// src/pages/ClassifiedListPage.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import DashboardButton from '../components/DashboardButton';
import '../styles/ui.css';

// 제목 만드는 함수
function buildTitle(grade, year, month, number) {
  const g = (grade || '').trim();
  const y = (year || '').toString().trim();
  const m = (month || '').toString().trim();
  const n = (number || '').toString().trim();
  const base = [y && `${y}년`, g, m && `${m}월`, '모의고사']
    .filter(Boolean)
    .join(' ');
  return [base || '무제 자료', n && `${n}번`].filter(Boolean).join(' ');
}

// 학년 정렬용
const GRADE_ORDER = {
  고1: 1,
  고2: 2,
  고3: 3,
};

export default function ClassifiedListPage() {
  const nav = useNavigate();

  const [tab, setTab] = useState('item');
  const [status, setStatus] = useState('all');
  const [rows, setRows] = useState([]);
  const [catRows, setCatRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState({});
  const [usedInMap, setUsedInMap] = useState({});
  const [difficultyMap, setDifficultyMap] = useState({});
  const saveTimersRef = useRef({});
  const diffTimersRef = useRef({});

  // 🔴 어떤 자료를 수정 중인지 (id로)
  const [editingMaterialId, setEditingMaterialId] = useState(null);
  const [editGrade, setEditGrade] = useState('고1');
  const [editYear, setEditYear] = useState(new Date().getFullYear());
  const [editMonth, setEditMonth] = useState('');
  const [editNumber, setEditNumber] = useState('');

  // 🔴 그룹 접기/펼치기 상태 (자료별 보기용)
  const [groupOpen, setGroupOpen] = useState({});

  // 🔴 복사 상태 표시용
  const [copiedKey, setCopiedKey] = useState(null);

  useEffect(() => {
    if (tab === 'item') fetchMaterials();
    else fetchByCategory();
  }, [tab, status]);

  // ✅ 자료 불러오기 (메타까지)
  async function fetchMaterials() {
    setLoading(true);
    const { data, error } = await supabase
      .from('materials')
      .select('id, title, status, updated_at, grade, year, month, number')
      .order('updated_at', { ascending: false })
      .limit(1000);
    if (!error) setRows(data || []);
    setLoading(false);
  }

  // ✅ 카테고리/문장 불러오기
  async function fetchByCategory() {
    setLoading(true);

    const { data: viewData } = await supabase
      .from('v_category_pair_sentences')
      .select('*')
      .limit(5000);

    const categorized = (viewData ?? []).filter((r) =>
      status === 'done' ? r.material_status === 'done' : true
    );

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
    const { data: uncData } = await uncReq;

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

    const merged = [...categorized, ...uncategorized];
    setCatRows(merged);

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

  // ✅ 자료 삭제
  async function deleteMaterial(id) {
    if (!window.confirm('이 자료를 정말 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('materials').delete().eq('id', id);
    if (error) alert('삭제 실패: ' + error.message);
    else {
      alert('삭제 완료!');
      fetchMaterials();
      if (editingMaterialId === id) setEditingMaterialId(null);
    }
  }

  // ✅ 문장 삭제
  async function deleteSentence(pairId) {
    if (!window.confirm('이 문장을 정말 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('material_pairs').delete().eq('id', pairId);
    if (error) alert('삭제 실패: ' + error.message);
    else {
      alert('삭제 완료!');
      fetchByCategory();
    }
  }

  // ✅ 문장별 보기 펼치기
  function toggleExpand(catId) {
    setExpanded((p) => ({ ...p, [catId]: !p[catId] }));
  }

  // ✅ 난이도 뱃지
  function renderDifficultyBadge(code) {
    if (!code) return null;
    const text = code === 'easy' ? '쉬움' : code === 'normal' ? '보통' : '어려움';
    const color = code === 'easy' ? '#42b983' : code === 'normal' ? '#3b82f6' : '#ef4444';
    return (
      <span className="ui-badge" style={{ background: color, color: '#fff', fontWeight: 600 }}>
        {text}
      </span>
    );
  }

  // ✅ 자동 저장 - used_in
  function onUsedInChange(pairId, value) {
    setUsedInMap((prev) => ({ ...prev, [pairId]: value }));
    if (saveTimersRef.current[pairId]) clearTimeout(saveTimersRef.current[pairId]);
    saveTimersRef.current[pairId] = setTimeout(async () => {
      await supabase.rpc('material_update_pair_used_in', {
        p_pair_id: pairId,
        p_used_in: value?.trim() || null,
      });
    }, 600);
  }

  // ✅ 자동 저장 - difficulty
  function onDifficultyChange(pairId, value) {
    setDifficultyMap((prev) => ({ ...prev, [pairId]: value }));
    if (diffTimersRef.current[pairId]) clearTimeout(diffTimersRef.current[pairId]);
    diffTimersRef.current[pairId] = setTimeout(async () => {
      await supabase.rpc('material_update_pair_difficulty', {
        p_pair_id: pairId,
        p_difficulty: value || null,
      });
    }, 600);
  }

  // ✅ 클립보드 복사 (복사됨 표시)
  async function copyText(text, key) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1000);
    } catch (e) {
      alert('복사에 실패했습니다. 브라우저 권한을 확인해주세요.');
      console.error(e);
    }
  }

  // ✅ 문장 그룹화 (문장별 보기 탭)
  const groupedCats = useMemo(() => {
    const qn = q.trim().toLowerCase();
    const map = new Map();
    for (const r of catRows) {
      const cid = r.category_id ?? 'UNCAT';
      const cname = r.category_name ?? '(미분류)';
      if (qn && !cname.toLowerCase().includes(qn)) continue;
      if (!map.has(cid)) map.set(cid, { category_id: cid, category_name: cname, items: [] });
      map.get(cid).items.push(r);
    }
    return Array.from(map.values()).sort((a, b) => b.items.length - a.items.length);
  }, [catRows, q]);

  // ✅ 자료별 보기용: 학년+연도+월로 그룹화
  const groupedMaterials = useMemo(() => {
    const map = new Map();
    for (const m of rows) {
      const g = m.grade || '기타';
      const y = m.year || '';
      const mm = m.month || '';
      const key = `${g}|${y}|${mm}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          grade: g,
          year: y,
          month: mm,
          items: [],
        });
      }
      map.get(key).items.push(m);
    }

    const arr = Array.from(map.values());
    // 그룹 정렬: 연도 ↓, 월 ↓, 학년 순
    arr.sort((a, b) => {
      const ay = Number(a.year) || 0;
      const by = Number(b.year) || 0;
      if (ay !== by) return by - ay;
      const am = Number(a.month) || 0;
      const bm = Number(b.month) || 0;
      if (am !== bm) return bm - am;
      const ag = GRADE_ORDER[a.grade] || 99;
      const bg = GRADE_ORDER[b.grade] || 99;
      return ag - bg;
    });

    // 그룹 안 정렬: 문항번호 ↑, 그다음 최근 수정 ↓
    for (const g of arr) {
      g.items.sort((a, b) => {
        const an = a.number ?? 9999;
        const bn = b.number ?? 9999;
        if (an !== bn) return an - bn;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      });
    }

    return arr;
  }, [rows]);

  // 🔴 메타 수정 시작
  function startEditMaterial(m) {
    alert('메타 수정 모드로 전환합니다.');
    setEditingMaterialId(m.id);
    setEditGrade(m.grade || '고1');
    setEditYear(m.year || new Date().getFullYear());
    setEditMonth(m.month || '');
    setEditNumber(m.number || '');
  }

  // 🔴 메타 저장
  async function saveMaterialMeta() {
    if (!editingMaterialId) return;

    if (!editGrade || !editYear || !editMonth || !editNumber) {
      alert('학년, 연도, 월, 문항번호를 모두 입력하세요.');
      return;
    }

    const newTitle = buildTitle(editGrade, editYear, editMonth, editNumber);

    const { error } = await supabase
      .from('materials')
      .update({
        grade: editGrade,
        year: Number(editYear),
        month: Number(editMonth),
        number: Number(editNumber),
        title: newTitle,
      })
      .eq('id', editingMaterialId);

    if (error) {
      alert('수정 실패: ' + error.message);
      return;
    }

    alert('수정되었습니다.');
    setEditingMaterialId(null);
    fetchMaterials();
  }

  // ✅ 그룹 토글
  function toggleGroup(key) {
    setGroupOpen((prev) => ({
      ...prev,
      [key]: !(prev[key] ?? true),
    }));
  }

  return (
    <div className="ui-page">
      <div className="ui-wrap">
        {/* 헤더 */}
        <div className="ui-head">
          <div>
            <div className="ui-title">분류 목록 관리</div>
            <div className="ui-sub">저장된 자료 및 문장을 삭제하거나 이어서 수정할 수 있습니다.</div>
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

        {/* 탭 */}
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
              문장별 보기
            </button>
          </div>
        </div>

        {/* ✅ 자료별 보기 */}
        {tab === 'item' && (
          <div className="ui-card" style={{ marginTop: 12 }}>
            {loading ? (
              <div className="ui-sub">불러오는 중...</div>
            ) : groupedMaterials.length === 0 ? (
              <div className="ui-sub">자료가 없습니다.</div>
            ) : (
              groupedMaterials.map((grp) => {
                const open = groupOpen[grp.key] ?? true;
                return (
                  <div key={grp.key} className="ui-card" style={{ marginBottom: 14 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <div>
                        <b>{buildTitle(grp.grade, grp.year, grp.month, null)}</b>
                        {!grp.grade && !grp.year && !grp.month && (
                          <span style={{ marginLeft: 6, color: '#999' }}>(메타 미입력 자료)</span>
                        )}
                      </div>
                      <button className="ui-btn sm" onClick={() => toggleGroup(grp.key)}>
                        {open ? '접기' : '펼치기'}
                      </button>
                    </div>

                    {open &&
                      grp.items.map((m) => (
                        <div key={m.id} className="ui-card" style={{ marginTop: 6, background: '#fff' }}>
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              gap: 12,
                            }}
                          >
                            <div
                              onClick={() => nav(`/category/recommend/${m.id}`)}
                              style={{ cursor: 'pointer' }}
                            >
                              <b>{m.title || '(제목 없음)'}</b>
                              <div style={{ fontSize: 13, color: '#5d6b82' }}>
                                상태: {m.status || '저장됨'} /{' '}
                                {new Date(m.updated_at).toLocaleString('ko-KR')}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="ui-btn sm" onClick={() => startEditMaterial(m)}>
                                메타 수정
                              </button>
                              <button className="ui-btn danger sm" onClick={() => deleteMaterial(m.id)}>
                                삭제
                              </button>
                            </div>
                          </div>

                          {/* 메타 수정 폼 */}
                          {editingMaterialId === m.id && (
                            <div
                              className="ui-card"
                              style={{
                                marginTop: 12,
                                border: '1px solid #e2e8ff',
                                background: '#f8f9ff',
                              }}
                            >
                              <div style={{ fontWeight: 700, marginBottom: 8 }}>
                                메타 수정: {m.title || '(제목 없음)'}
                              </div>
                              <div
                                style={{
                                  display: 'grid',
                                  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                                  gap: 10,
                                }}
                              >
                                <div>
                                  <div className="ui-sub" style={{ marginBottom: 4 }}>
                                    학년
                                  </div>
                                  <select
                                    value={editGrade}
                                    onChange={(e) => setEditGrade(e.target.value)}
                                    style={{ width: '100%' }}
                                  >
                                    <option value="고1">고1</option>
                                    <option value="고2">고2</option>
                                    <option value="고3">고3</option>
                                  </select>
                                </div>
                                <div>
                                  <div className="ui-sub" style={{ marginBottom: 4 }}>
                                    연도
                                  </div>
                                  <input
                                    type="number"
                                    value={editYear}
                                    onChange={(e) => setEditYear(e.target.value)}
                                    min={2000}
                                    max={2100}
                                    style={{ width: '100%' }}
                                  />
                                </div>
                                <div>
                                  <div className="ui-sub" style={{ marginBottom: 4 }}>
                                    월
                                  </div>
                                  <select
                                    value={editMonth}
                                    onChange={(e) => setEditMonth(e.target.value)}
                                    style={{ width: '100%' }}
                                  >
                                    <option value="">선택</option>
                                    {Array.from({ length: 12 }).map((_, i) => {
                                      const mm = i + 1;
                                      return (
                                        <option key={mm} value={mm}>
                                          {mm}월
                                        </option>
                                      );
                                    })}
                                  </select>
                                </div>
                                <div>
                                  <div className="ui-sub" style={{ marginBottom: 4 }}>
                                    문항번호
                                  </div>
                                  <input
                                    type="number"
                                    value={editNumber}
                                    onChange={(e) => setEditNumber(e.target.value)}
                                    min={1}
                                    style={{ width: '100%' }}
                                  />
                                </div>
                              </div>
                              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                                <button className="ui-btn primary sm" onClick={saveMaterialMeta}>
                                  저장
                                </button>
                                <button className="ui-btn sm" onClick={() => setEditingMaterialId(null)}>
                                  취소
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ✅ 문장별 보기 */}
        {tab === 'category' && (
          <div className="ui-card" style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 10 }}>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="분류(카테고리) 이름 검색"
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  border: '1px solid #e3e8f2',
                  borderRadius: 8,
                }}
              />
            </div>
            {loading ? (
              <div className="ui-sub">불러오는 중...</div>
            ) : groupedCats.length === 0 ? (
              <div className="ui-sub">표시할 문장이 없습니다.</div>
            ) : (
              groupedCats.map((cat) => {
                const open = expanded[cat.category_id];
                return (
                  <div key={cat.category_id} className="ui-card" style={{ marginBottom: 10 }}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
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
                            {/* 영어 문장 + 복사 */}
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                              <div style={{ fontWeight: 700, flex: 1 }}>{it.en_sentence}</div>
                              <button
                                className="ui-btn sm"
                                onClick={() => copyText(it.en_sentence, `en-${it.pair_id}`)}
                                title="영어 문장 복사"
                              >
                                복사
                              </button>
                              {copiedKey === `en-${it.pair_id}` && (
                                <span style={{ fontSize: 12, color: '#10b981' }}>복사됨</span>
                              )}
                            </div>
                            {/* 한국어 문장 + 복사 */}
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 6,
                                marginTop: 4,
                              }}
                            >
                              <div style={{ color: '#4b5563', flex: 1 }}>{it.ko_sentence}</div>
                              <button
                                className="ui-btn sm"
                                onClick={() => copyText(it.ko_sentence, `ko-${it.pair_id}`)}
                                title="한국어 문장 복사"
                              >
                                복사
                              </button>
                              {copiedKey === `ko-${it.pair_id}` && (
                                <span style={{ fontSize: 12, color: '#10b981' }}>복사됨</span>
                              )}
                            </div>

                            <div
                              style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}
                            >
                              <label style={{ fontSize: 12, color: '#555' }}>난이도:</label>
                              <select
                                value={difficultyMap[it.pair_id] ?? ''}
                                onChange={(e) => onDifficultyChange(it.pair_id, e.target.value)}
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
                                이동
                              </button>
                              <button
                                className="ui-btn danger sm"
                                onClick={() => deleteSentence(it.pair_id)}
                              >
                                삭제
                              </button>
                            </div>

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
