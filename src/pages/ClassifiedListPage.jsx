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
  const base = [y && `${y}년`, g, m && `${m}월`, '모의고사'].filter(Boolean).join(' ');
  return [base || '무제 자료', n && `${n}번`].filter(Boolean).join(' ');
}

// 학년 정렬용
const GRADE_ORDER = { 고1: 1, 고2: 2, 고3: 3 };

// ✅ 카테고리 경로 라벨 만들기 (부모→자식)
function buildPathLabel(categoryId, metaById) {
  if (!categoryId) return '';
  const names = [];
  let cur = categoryId;
  const guard = new Set();
  while (cur && metaById[cur] && !guard.has(cur)) {
    guard.add(cur);
    const node = metaById[cur];
    if (node?.name) names.push(node.name);
    cur = node?.parent_id ?? null;
  }
  return names.reverse().join(' > ');
}

// ✅ 페이지네이션으로 끝까지 가져오기
async function fetchAllPaged(makeQuery, pageSize = 1000, maxPages = 200) {
  const out = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data, error } = await makeQuery().range(from, to);
    if (error) throw error;
    const chunk = data ?? [];
    out.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return out;
}

export default function ClassifiedListPage() {
  const nav = useNavigate();

  const [tab, setTab] = useState('item');      // item | category
  const [status, setStatus] = useState('all'); // all | done | notdone
  const [rows, setRows] = useState([]);
  const [catRows, setCatRows] = useState([]);
  const [loading, setLoading] = useState(false);

  // 문장별 보기 검색
  const [q, setQ] = useState('');
  const [expanded, setExpanded] = useState({});

  // 자료별 보기 검색
  const [itemQ, setItemQ] = useState('');

  const [usedInMap, setUsedInMap] = useState({});
  const [difficultyMap, setDifficultyMap] = useState({});
  const saveTimersRef = useRef({});
  const diffTimersRef = useRef({});

  // 메타 수정
  const [editingMaterialId, setEditingMaterialId] = useState(null);
  const [editGrade, setEditGrade] = useState('고1');
  const [editYear, setEditYear] = useState(new Date().getFullYear());
  const [editMonth, setEditMonth] = useState('');
  const [editNumber, setEditNumber] = useState('');

  // 그룹 접기/펼치기
  const [groupOpen, setGroupOpen] = useState({});

  // 복사 표시
  const [copiedKey, setCopiedKey] = useState(null);

  useEffect(() => {
    if (tab === 'item') fetchMaterials();
    else fetchByCategory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, status]);

  // ✅ (핵심) 자료별 보기: v_materials_with_counts 기반으로 "분류완료/미분류"를 DB에서 계산해서 가져오기
  async function fetchMaterials() {
    setLoading(true);
    try {
      // v_materials_with_counts가 이미 있는 프로젝트 전제
      // (없으면 error 나니까, 그때 알려주면 뷰 생성 SQL로 바로 잡아줄게)
      const data = await fetchAllPaged(
        () => {
          let q = supabase
            .from('v_materials_with_counts')
            .select(
              'id, title, status, updated_at, grade, year, month, number,' +
                'pair_cnt, categorized_pair_cnt, uncategorized_pair_cnt, is_fully_categorized'
            )
            .order('updated_at', { ascending: false });

          if (status === 'done') q = q.eq('status', 'done');
          if (status === 'notdone') q = q.neq('status', 'done');

          return q;
        },
        1000,
        50
      );

      setRows(data || []);
    } catch (e) {
      console.error('[fetchMaterials]', e);
      alert(
        `자료 불러오기 오류: ${e.message}\n\n` +
          `※ v_materials_with_counts 뷰가 없거나 컬럼이 다르면 이 에러가 납니다.\n` +
          `그 경우, 뷰 정의를 맞춰주면 바로 해결됩니다.`
      );
    } finally {
      setLoading(false);
    }
  }

  /**
   * ✅ 문장별 보기 로직(기존 유지)
   * - pair_id 비교/Set/Map 키를 전부 String(...) 로 통일
   */
  async function fetchByCategory() {
    setLoading(true);
    try {
      // 1) category_nodes 전부
      const catMeta = await fetchAllPaged(
        () =>
          supabase
            .from('category_nodes')
            .select('id, name, parent_id')
            .order('created_at', { ascending: true }),
        2000,
        50
      );

      const metaById = {};
      (catMeta ?? []).forEach((n) => {
        metaById[n.id] = { id: n.id, name: n.name, parent_id: n.parent_id };
      });

      // 2) material_pairs(+materials join) 전부
      const pairs = await fetchAllPaged(
        () => {
          let q = supabase
            .from('material_pairs')
            .select(
              'id, en_sentence, ko_sentence, used_in, difficulty, material_id, materials!inner(title,status)'
            )
            .order('id', { ascending: true }); // paging 안정
          if (status === 'done') q = q.eq('materials.status', 'done');
          if (status === 'notdone') q = q.neq('materials.status', 'done');
          return q;
        },
        1000,
        200
      );

      const pairIds = (pairs ?? []).map((p) => String(p.id)).filter(Boolean);

      const pairMap = {};
      for (const p of pairs ?? []) {
        const pidKey = String(p.id);
        pairMap[pidKey] = {
          pair_id: p.id,
          pair_id_key: pidKey,
          material_id: p.material_id,
          material_title: p.materials?.title ?? null,
          material_status: p.materials?.status ?? null,
          en_sentence: p.en_sentence ?? '',
          ko_sentence: p.ko_sentence ?? '',
          used_in: p.used_in ?? '',
          difficulty: p.difficulty ?? '',
        };
      }

      // 3) material_pair_categories(해당 pairId 대상) 전부 — chunk in()
      const mappingsAll = [];
      const CHUNK = 500;
      for (let i = 0; i < pairIds.length; i += CHUNK) {
        const slice = pairIds.slice(i, i + CHUNK);
        const mapChunk = await fetchAllPaged(
          () =>
            supabase
              .from('material_pair_categories')
              .select('pair_id, category_id')
              .in('pair_id', slice)
              .order('pair_id', { ascending: true }),
          2000,
          50
        );
        mappingsAll.push(...(mapChunk ?? []));
      }

      const hasAnyCategory = new Set();
      const categorized = [];

      for (const m of mappingsAll) {
        const pidKey = String(m?.pair_id);
        const cid = m?.category_id;

        if (!pidKey) continue;
        hasAnyCategory.add(pidKey);

        const base = pairMap[pidKey];
        if (!base) continue;

        const path = cid && metaById[cid] ? buildPathLabel(cid, metaById) : '(삭제된 분류)';

        categorized.push({
          category_id: cid || 'MISSING_CAT',
          category_name: path,
          category_path_label: path,
          ...base,
        });
      }

      // 4) 미분류 = 매핑 0개
      const uncategorized = [];
      for (const p of pairs ?? []) {
        const pidKey = String(p.id);
        if (!pidKey) continue;
        if (hasAnyCategory.has(pidKey)) continue;

        const base = pairMap[pidKey];
        if (!base) continue;

        uncategorized.push({
          category_id: null,
          category_name: '(미분류)',
          category_path_label: '(미분류)',
          ...base,
        });
      }

      const merged = [...categorized, ...uncategorized];
      setCatRows(merged);

      const nextUsed = {};
      const nextDiff = {};
      for (const r of merged) {
        const k = String(r.pair_id);
        nextUsed[k] = r.used_in ?? '';
        nextDiff[k] = r.difficulty ?? '';
      }
      setUsedInMap(nextUsed);
      setDifficultyMap(nextDiff);
    } catch (e) {
      console.error('[fetchByCategory]', e);
      alert(`문장 불러오기 오류: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

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

  async function deleteSentence(pairId) {
    if (!window.confirm('이 문장을 정말 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('material_pairs').delete().eq('id', pairId);
    if (error) alert('삭제 실패: ' + error.message);
    else {
      alert('삭제 완료!');
      fetchByCategory();
    }
  }

  function toggleExpand(catId) {
    setExpanded((p) => ({ ...p, [catId]: !p[catId] }));
  }

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

  function onUsedInChange(pairId, value) {
    const key = String(pairId);
    setUsedInMap((prev) => ({ ...prev, [key]: value }));
    if (saveTimersRef.current[key]) clearTimeout(saveTimersRef.current[key]);
    saveTimersRef.current[key] = setTimeout(async () => {
      await supabase.rpc('material_update_pair_used_in', {
        p_pair_id: pairId,
        p_used_in: value?.trim() || null,
      });
    }, 600);
  }

  function onDifficultyChange(pairId, value) {
    const key = String(pairId);
    setDifficultyMap((prev) => ({ ...prev, [key]: value }));
    if (diffTimersRef.current[key]) clearTimeout(diffTimersRef.current[key]);
    diffTimersRef.current[key] = setTimeout(async () => {
      await supabase.rpc('material_update_pair_difficulty', {
        p_pair_id: pairId,
        p_difficulty: value || null,
      });
    }, 600);
  }

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

  const groupedCats = useMemo(() => {
    const qn = q.trim().toLowerCase();
    const map = new Map();

    for (const r of catRows) {
      const cid = r.category_id ?? 'UNCAT';
      const cname = r.category_path_label ?? r.category_name ?? '(미분류)';

      if (qn) {
        const cnameL = (cname || '').toLowerCase();
        const enL = (r.en_sentence || '').toLowerCase();
        const koL = (r.ko_sentence || '').toLowerCase();
        if (!cnameL.includes(qn) && !enL.includes(qn) && !koL.includes(qn)) continue;
      }

      if (!map.has(cid)) map.set(cid, { category_id: cid, category_name: cname, items: [] });
      map.get(cid).items.push(r);
    }

    return Array.from(map.values()).sort((a, b) => b.items.length - a.items.length);
  }, [catRows, q]);

  const groupedMaterials = useMemo(() => {
    const qn = itemQ.trim().toLowerCase();
    const tokens = qn ? qn.split(/\s+/) : [];

    const filteredRows = rows.filter((m) => {
      if (!tokens.length) return true;
      const title = (m.title || '').toLowerCase();
      const gradeStr = (m.grade || '').toLowerCase();
      const yearStr = m.year != null ? String(m.year) : '';
      const monthStr = m.month != null ? String(m.month) : '';
      const numberStr = m.number != null ? String(m.number) : '';
      const monthLabel = monthStr ? `${monthStr}월` : '';
      const joined = [title, gradeStr, yearStr, monthStr, monthLabel, numberStr].join(' ');
      return tokens.every((tok) => joined.includes(tok));
    });

    const map = new Map();
    for (const m of filteredRows) {
      const g = m.grade || '기타';
      const y = m.year || '';
      const mm = m.month || '';
      const key = `${g}|${y}|${mm}`;
      if (!map.has(key)) map.set(key, { key, grade: g, year: y, month: mm, items: [] });
      map.get(key).items.push(m);
    }

    const arr = Array.from(map.values());
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

    for (const g of arr) {
      g.items.sort((a, b) => {
        const an = a.number ?? 9999;
        const bn = b.number ?? 9999;
        if (an !== bn) return an - bn;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      });
    }

    return arr;
  }, [rows, itemQ]);

  function startEditMaterial(m) {
    alert('메타 수정 모드로 전환합니다.');
    setEditingMaterialId(m.id);
    setEditGrade(m.grade || '고1');
    setEditYear(m.year || new Date().getFullYear());
    setEditMonth(m.month || '');
    setEditNumber(m.number || '');
  }

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

    if (error) return alert('수정 실패: ' + error.message);
    alert('수정되었습니다.');
    setEditingMaterialId(null);
    fetchMaterials();
  }

  function toggleGroup(key) {
    setGroupOpen((prev) => ({ ...prev, [key]: !(prev[key] ?? false) }));
  }

  const statusBadge = (m) => {
    // ✅ DB 집계 기반
    const pairCnt = Number(m.pair_cnt ?? 0);
    const unc = Number(m.uncategorized_pair_cnt ?? 0);
    const ok = !!m.is_fully_categorized;

    if (!pairCnt) return <span className="ui-badge">문장 없음</span>;
    if (ok) return <span className="ui-badge" style={{ background: '#10b981', color: '#fff' }}>분류완료</span>;
    return (
      <span className="ui-badge" style={{ background: '#ef4444', color: '#fff' }}>
        미분류 {unc}문장
      </span>
    );
  };

  return (
    <div className="ui-page">
      <div className="ui-wrap">
        <div className="ui-head">
          <div>
            <div className="ui-title">분류 목록 관리</div>
            <div className="ui-sub">저장된 자료 및 문장을 삭제하거나 이어서 수정할 수 있습니다.</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <DashboardButton />
            <Link to="/category/manage" className="ui-btn sm">분류 관리로</Link>
            <Link to="/category/start" className="ui-btn sm">분류 시작하기</Link>
          </div>
        </div>

        <div className="ui-card">
          <div className="ui-tabs">
            <button className={`ui-tab ${tab === 'item' ? 'active' : ''}`} onClick={() => setTab('item')}>
              자료별 보기
            </button>
            <button className={`ui-tab ${tab === 'category' ? 'active' : ''}`} onClick={() => setTab('category')}>
              문장별 보기
            </button>
          </div>

          <div className="ui-toolbar" style={{ marginTop: 10, justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="ui-sub">필터:</span>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="ui-input" style={{ width: 160 }}>
                <option value="all">전체</option>
                <option value="done">done만</option>
                <option value="notdone">done 제외</option>
              </select>
            </div>
            <div className="ui-sub" style={{ fontSize: 12 }}>
              ※ “미분류”는 DB 기준(문장별 분류 1개 이상 여부)으로 계산됩니다.
            </div>
          </div>
        </div>

        {tab === 'item' && (
          <div className="ui-card" style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 10 }}>
              <input
                value={itemQ}
                onChange={(e) => setItemQ(e.target.value)}
                placeholder="학년/연도/월/제목/번호 검색 (예: 고2 2024 6월 3번)"
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #e3e8f2', borderRadius: 8, fontSize: 13 }}
              />
            </div>

            {loading ? (
              <div className="ui-sub">불러오는 중...</div>
            ) : groupedMaterials.length === 0 ? (
              <div className="ui-sub">자료가 없습니다.</div>
            ) : (
              groupedMaterials.map((grp) => {
                const open = groupOpen[grp.key] ?? false;
                return (
                  <div key={grp.key} className="ui-card" style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div>
                        <b>{buildTitle(grp.grade, grp.year, grp.month, null)}</b>
                      </div>
                      <button className="ui-btn sm" onClick={() => toggleGroup(grp.key)}>
                        {open ? '접기' : '펼치기'}
                      </button>
                    </div>

                    {open &&
                      grp.items.map((m) => (
                        <div key={m.id} className="ui-card" style={{ marginTop: 6, background: '#fff' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                            <div onClick={() => nav(`/category/recommend/${m.id}`)} style={{ cursor: 'pointer' }}>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                <b>{m.title || '(제목 없음)'}</b>
                                {statusBadge(m)}
                                <span className="ui-badge">총 {Number(m.pair_cnt ?? 0)}문장</span>
                              </div>
                              <div style={{ fontSize: 13, color: '#5d6b82' }}>
                                상태: {m.status || '저장됨'} / {new Date(m.updated_at).toLocaleString('ko-KR')}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="ui-btn sm" onClick={() => startEditMaterial(m)}>메타 수정</button>
                              <button className="ui-btn danger sm" onClick={() => deleteMaterial(m.id)}>삭제</button>
                            </div>
                          </div>

                          {editingMaterialId === m.id && (
                            <div className="ui-card" style={{ marginTop: 12, border: '1px solid #e2e8ff', background: '#f8f9ff' }}>
                              <div style={{ fontWeight: 700, marginBottom: 8 }}>메타 수정: {m.title || '(제목 없음)'}</div>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
                                <div>
                                  <div className="ui-sub" style={{ marginBottom: 4 }}>학년</div>
                                  <select value={editGrade} onChange={(e) => setEditGrade(e.target.value)} style={{ width: '100%' }}>
                                    <option value="고1">고1</option>
                                    <option value="고2">고2</option>
                                    <option value="고3">고3</option>
                                  </select>
                                </div>
                                <div>
                                  <div className="ui-sub" style={{ marginBottom: 4 }}>연도</div>
                                  <input type="number" value={editYear} onChange={(e) => setEditYear(e.target.value)} min={2000} max={2100} style={{ width: '100%' }} />
                                </div>
                                <div>
                                  <div className="ui-sub" style={{ marginBottom: 4 }}>월</div>
                                  <select value={editMonth} onChange={(e) => setEditMonth(e.target.value)} style={{ width: '100%' }}>
                                    <option value="">선택</option>
                                    {Array.from({ length: 12 }).map((_, i) => {
                                      const mm = i + 1;
                                      return <option key={mm} value={mm}>{mm}월</option>;
                                    })}
                                  </select>
                                </div>
                                <div>
                                  <div className="ui-sub" style={{ marginBottom: 4 }}>문항번호</div>
                                  <input type="number" value={editNumber} onChange={(e) => setEditNumber(e.target.value)} min={1} style={{ width: '100%' }} />
                                </div>
                              </div>
                              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                                <button className="ui-btn primary sm" onClick={saveMaterialMeta}>저장</button>
                                <button className="ui-btn sm" onClick={() => setEditingMaterialId(null)}>취소</button>
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

        {tab === 'category' && (
          <div className="ui-card" style={{ marginTop: 12 }}>
            <div style={{ marginBottom: 10 }}>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="분류(카테고리) 이름 / 문장 검색"
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #e3e8f2', borderRadius: 8 }}
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                          <div key={`${it.category_id ?? 'UNCAT'}-${String(it.pair_id)}`} className="ui-card" style={{ marginBottom: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                              <div style={{ fontWeight: 700, flex: 1 }}>{it.en_sentence}</div>
                              <button className="ui-btn sm" onClick={() => copyText(it.en_sentence, `en-${it.category_id}-${String(it.pair_id)}`)}>
                                복사
                              </button>
                              {copiedKey === `en-${it.category_id}-${String(it.pair_id)}` && (
                                <span style={{ fontSize: 12, color: '#10b981' }}>복사됨</span>
                              )}
                            </div>

                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 4 }}>
                              <div style={{ color: '#4b5563', flex: 1 }}>{it.ko_sentence}</div>
                              <button className="ui-btn sm" onClick={() => copyText(it.ko_sentence, `ko-${it.category_id}-${String(it.pair_id)}`)}>
                                복사
                              </button>
                              {copiedKey === `ko-${it.category_id}-${String(it.pair_id)}` && (
                                <span style={{ fontSize: 12, color: '#10b981' }}>복사됨</span>
                              )}
                            </div>

                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
                              <label style={{ fontSize: 12, color: '#555' }}>난이도:</label>
                              <select
                                value={difficultyMap[String(it.pair_id)] ?? ''}
                                onChange={(e) => onDifficultyChange(it.pair_id, e.target.value)}
                              >
                                <option value="">(선택)</option>
                                <option value="easy">쉬움</option>
                                <option value="normal">보통</option>
                                <option value="hard">어려움</option>
                              </select>
                              {renderDifficultyBadge(difficultyMap[String(it.pair_id)])}
                              <span style={{ fontSize: 13 }}>출처: {it.material_title ?? '-'}</span>
                              <button className="ui-btn sm" onClick={() => nav(`/category/recommend/${it.material_id}`)}>
                                이동
                              </button>
                              <button className="ui-btn danger sm" onClick={() => deleteSentence(it.pair_id)}>
                                삭제
                              </button>
                            </div>

                            <div style={{ marginTop: 8 }}>
                              <label style={{ fontSize: 12, color: '#5d6b82', display: 'block', marginBottom: 4 }}>
                                교재 메모
                              </label>
                              <input
                                value={usedInMap[String(it.pair_id)] ?? ''}
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
