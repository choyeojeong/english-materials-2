// src/pages/ClassifiedListPage.jsx
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import DashboardButton from '../components/DashboardButton';
import '../styles/ui.css';

const VIEW_SQL_HINT = `
필요한 뷰가 없다면 Supabase SQL에서 아래를 실행하세요:

create or replace view v_category_pair_sentences as
select
  c.id        as category_id,
  c.name      as category_name,
  mp.id       as pair_id,
  mp.material_id,
  m.title     as material_title,
  m.status    as material_status,
  mp.en_sentence,
  mp.ko_sentence
from material_pair_categories mpc
join category_nodes c  on c.id = mpc.category_id
join material_pairs mp on mp.id = mpc.pair_id
join materials m       on m.id = mp.material_id;

create index if not exists idx_m_status on materials(status);
`;

export default function ClassifiedListPage() {
  const nav = useNavigate();

  // 탭: item(자료별) | category(분류별)
  const [tab, setTab] = useState('item');

  // 공통: 상태 필터 all | done
  const [status, setStatus] = useState('done');

  // ===== 자료별 =====
  const [rows, setRows] = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [q, setQ] = useState('');

  // ===== 분류별 =====
  const [catRows, setCatRows] = useState([]);       // view raw rows
  const [loadingCats, setLoadingCats] = useState(false);
  const [catQ, setCatQ] = useState('');             // category name search
  const [viewMissing, setViewMissing] = useState(false);
  const [expanded, setExpanded] = useState({});     // category_id: boolean

  useEffect(() => {
    if (tab === 'item') {
      fetchMaterials();
    } else {
      fetchByCategory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, status]);

  async function fetchMaterials() {
    try {
      setLoadingItems(true);
      let query = supabase
        .from('materials')
        .select('id, title, status, updated_at')
        .order('updated_at', { ascending: false })
        .limit(200);

      if (status === 'done') query = query.eq('status', 'done');

      const { data, error } = await query;
      if (error) throw error;
      setRows(data ?? []);
    } catch (err) {
      console.error('[fetchMaterials]', err);
      setRows([]);
    } finally {
      setLoadingItems(false);
    }
  }

  async function fetchByCategory() {
    try {
      setLoadingCats(true);
      setViewMissing(false);

      const { data, error } = await supabase
        .from('v_category_pair_sentences')
        .select('*')
        .limit(5000);
      if (error) {
        console.warn('[fetchByCategory] view missing?', error.message);
        setViewMissing(true);
        setCatRows([]);
        return;
      }
      const filtered = (data ?? []).filter(r =>
        status === 'all' ? true : (r.material_status === 'done')
      );
      setCatRows(filtered);
    } catch (err) {
      console.error('[fetchByCategory]', err);
      setCatRows([]);
    } finally {
      setLoadingCats(false);
    }
  }

  const filteredItems = useMemo(() => {
    const qn = q.trim().toLowerCase();
    if (!qn) return rows;
    return rows.filter(r => (r.title ?? '').toLowerCase().includes(qn));
  }, [rows, q]);

  // 분류별 그룹
  const groupedCats = useMemo(() => {
    const qn = catQ.trim().toLowerCase();
    const map = new Map();
    for (const r of catRows) {
      if (qn && !(r.category_name ?? '').toLowerCase().includes(qn)) continue;
      const key = r.category_id;
      if (!map.has(key)) {
        map.set(key, {
          category_id: r.category_id,
          category_name: r.category_name,
          items: [],
        });
      }
      map.get(key).items.push({
        pair_id: r.pair_id,
        en_sentence: r.en_sentence,
        ko_sentence: r.ko_sentence,
        material_id: r.material_id,
        material_title: r.material_title,
      });
    }
    return Array.from(map.values()).sort((a, b) => b.items.length - a.items.length);
  }, [catRows, catQ]);

  function toggleExpand(catId) {
    setExpanded(prev => ({ ...prev, [catId]: !prev[catId] }));
  }

  return (
    <div className="ui-page">
      <div className="ui-wrap">
        {/* 헤더 */}
        <div className="ui-head">
          <div>
            <div className="ui-title">분류 완료 목록</div>
            <div className="ui-sub">완료된 자료를 보거나, 분류별로 문장들을 모아 볼 수 있어요.</div>
          </div>
          <div style={{ display:'flex', gap:8 }}>
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

          <div className="ui-toolbar" style={{ justifyContent:'space-between' }}>
            <div className="ui-toolbar" role="tablist">
              <button
                className={`ui-btn sm ${status === 'done' ? 'primary' : ''}`}
                onClick={() => setStatus('done')}
              >
                완료(done)
              </button>
              <button
                className={`ui-btn sm ${status === 'all' ? 'primary' : ''}`}
                onClick={() => setStatus('all')}
              >
                전체(all)
              </button>
            </div>

            {tab === 'item' ? (
              <input
                style={{ width: 260, padding:'10px 12px', border:'1px solid #e3e8f2', borderRadius:10 }}
                placeholder="제목 검색"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            ) : (
              <input
                style={{ width: 260, padding:'10px 12px', border:'1px solid #e3e8f2', borderRadius:10 }}
                placeholder="분류명 검색"
                value={catQ}
                onChange={(e) => setCatQ(e.target.value)}
              />
            )}
          </div>
        </div>

        {/* 본문 */}
        {tab === 'item' ? (
          <div className="ui-card" style={{ marginTop: 12 }}>
            {loadingItems ? (
              <div className="ui-sub">불러오는 중…</div>
            ) : (
              <div className="ui-table-wrap">
                <table className="ui-table">
                  <thead>
                    <tr>
                      <th>제목</th>
                      <th>상태</th>
                      <th>작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((r) => (
                      <tr key={r.id}>
                        <td>{r.title ?? '-'}</td>
                        <td>
                          <span className="ui-badge">{r.status}</span>
                        </td>
                        <td>
                          <button
                            className="ui-btn primary sm"
                            onClick={() => nav(`/category/recommend/${r.id}`)}
                          >
                            추천/분류 열람
                          </button>
                        </td>
                      </tr>
                    ))}
                    {filteredItems.length === 0 && (
                      <tr>
                        <td colSpan={3} style={{ padding:14 }}>
                          표시할 항목이 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="ui-card" style={{ marginTop: 12 }}>
            {loadingCats ? (
              <div className="ui-sub">분류별 데이터를 불러오는 중…</div>
            ) : viewMissing ? (
              <div className="ui-sub" style={{ whiteSpace:'pre-wrap' }}>
                <b>v_category_pair_sentences</b> 뷰가 없어 분류별 보기를 사용할 수 없습니다.
                {VIEW_SQL_HINT}
              </div>
            ) : groupedCats.length === 0 ? (
              <div className="ui-sub">표시할 분류가 없습니다.</div>
            ) : (
              groupedCats.map((cat) => {
                const open = !!expanded[cat.category_id];
                return (
                  <div key={cat.category_id} className="ui-card" style={{ marginBottom: 12 }}>
                    <div
                      style={{
                        display:'flex', alignItems:'center', justifyContent:'space-between'
                      }}
                    >
                      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <div style={{ fontWeight:800, color:'#1f2a44' }}>{cat.category_name}</div>
                        <span className="ui-badge">{cat.items.length}문장</span>
                      </div>
                      <div className="ui-toolbar">
                        <button className="ui-btn sm" onClick={() => toggleExpand(cat.category_id)}>
                          {open ? '접기' : '펼치기'}
                        </button>
                      </div>
                    </div>

                    {open && (
                      <div style={{ marginTop:10, borderLeft:'3px solid #eef3ff', paddingLeft:10 }}>
                        {cat.items.map((it) => (
                          <div key={it.pair_id} className="ui-card" style={{ marginBottom:8 }}>
                            <div style={{ fontSize:14, color:'#111827', fontWeight:800, marginBottom:6 }}>
                              {it.en_sentence}
                            </div>
                            <div style={{ fontSize:13, color:'#4b5563' }}>
                              {it.ko_sentence}
                            </div>
                            <div className="ui-sub" style={{ marginTop:6 }}>
                              출처: {it.material_title ?? '-'}
                              <button
                                className="ui-btn sm"
                                style={{ marginLeft:8 }}
                                onClick={() => nav(`/category/recommend/${it.material_id}`)}
                              >
                                이 자료로 이동
                              </button>
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
