// src/pages/CategoryManagePage.jsx
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import DashboardButton from '../components/DashboardButton';
import '../styles/ui.css';

function byParent(nodes) {
  const map = new Map();
  nodes.forEach((n) => {
    const key = n.parent_id ?? 'ROOT';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(n);
  });
  for (const arr of map.values()) {
    arr.sort(
      (a, b) => a.sort - b.sort || a.created_at.localeCompare(b.created_at)
    );
  }
  return map;
}

export default function CategoryManagePage() {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [addRootName, setAddRootName] = useState('');

  const groups = useMemo(() => byParent(nodes), [nodes]);
  const roots = groups.get('ROOT') || [];

  async function fetchAll() {
    setLoading(true);
    setErr('');
    const { data, error } = await supabase
      .from('category_nodes')
      .select('*')
      .order('parent_id', { ascending: true, nullsFirst: true })
      .order('sort', { ascending: true });
    if (error) {
      setErr(`[불러오기 오류] ${error.message}`);
    } else {
      setNodes(data || []);
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchAll();
  }, []);

  // ---- RPC helpers ----
  async function addNode(name, level, parentId, index = null) {
    const { data, error } = await supabase.rpc('cat_create', {
      p_name: name,
      p_level: level,
      p_parent: parentId,
      p_index: index,
    });
    if (error) throw new Error(error.message);
    return data;
  }

  async function renameNode(id, name) {
    const { data, error } = await supabase.rpc('cat_rename', {
      p_id: id,
      p_name: name,
    });
    if (error) throw new Error(error.message);
    return data;
  }

  async function moveNode(id, newParentId, newLevel, newIndex) {
    const { data, error } = await supabase.rpc('cat_move', {
      p_id: id,
      p_new_parent: newParentId,
      p_new_level: newLevel,
      p_new_index: newIndex,
    });
    if (error) throw new Error(error.message);
    return data;
  }

  async function deleteNode(id) {
    const { error } = await supabase.rpc('cat_delete', { p_id: id });
    if (error) throw new Error(error.message);
  }

  // ---- UI actions ----
  const onAddRoot = async () => {
    const name = (addRootName || '').trim();
    if (!name) return;
    try {
      await addNode(name, 1, null, null);
      setAddRootName('');
      fetchAll();
    } catch (e) {
      setErr(`[추가 오류] ${e.message}`);
    }
  };

  const handleAddChild = async (parent, level) => {
    const name = prompt(
      `새 ${level === 2 ? '중분류' : '소분류'} 이름을 입력하세요:`,
      ''
    );
    if (!name) return;
    try {
      await addNode(name.trim(), level, parent.id, null);
      fetchAll();
    } catch (e) {
      setErr(`[추가 오류] ${e.message}`);
    }
  };

  const handleRename = async (node) => {
    const name = prompt('새 이름을 입력하세요:', node.name);
    if (!name || name.trim() === node.name) return;
    try {
      await renameNode(node.id, name.trim());
      fetchAll();
    } catch (e) {
      setErr(`[이름변경 오류] ${e.message}`);
    }
  };

  const handleDelete = async (node) => {
    if (
      !confirm(
        `'${node.name}' ${
          node.level === 1 ? '(대분류)' : node.level === 2 ? '(중분류)' : '(소분류)'
        }\n삭제하면 하위 항목도 모두 삭제됩니다. 진행할까요?`
      )
    ) {
      return;
    }
    try {
      await deleteNode(node.id);
      fetchAll();
    } catch (e) {
      setErr(`[삭제 오류] ${e.message}`);
    }
  };

  // 형제 내 순서 변경 (↑/↓)
  const handleReorder = async (node, dir) => {
    const siblings = (groups.get(node.parent_id ?? 'ROOT') || []).slice();
    const idx = siblings.findIndex((s) => s.id === node.id);
    const targetIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= siblings.length) return;

    try {
      await moveNode(node.id, node.parent_id, node.level, targetIdx);
      fetchAll();
    } catch (e) {
      setErr(`[순서변경 오류] ${e.message}`);
    }
  };

  // 부모/레벨 변경 (이동)
  const handleMove = async (node) => {
    try {
      if (node.level === 1) {
        alert('대분류는 다른 곳으로 이동할 수 없습니다. (부모가 없음)');
        return;
      }

      const validParents =
        node.level === 2
          ? (groups.get('ROOT') || []) // 중분류의 새 부모는 대분류
          : nodes.filter((n) => n.level === 2); // 소분류의 새 부모는 중분류

      if (validParents.length === 0) {
        alert('이동 가능한 부모가 없습니다.');
        return;
      }

      const menu = validParents
        .map((p, i) => `${i + 1}. ${p.name}`)
        .join('\n');

      const input = prompt(
        `새 부모를 선택하세요 (번호 입력)\n${menu}`,
        '1'
      );
      if (!input) return;
      const pick = parseInt(input, 10);
      if (!Number.isInteger(pick) || pick < 1 || pick > validParents.length)
        return;

      const newParent = validParents[pick - 1];
      const newSiblings = groups.get(newParent.id) || [];
      await moveNode(node.id, newParent.id, node.level, newSiblings.length);
      fetchAll();
    } catch (e) {
      setErr(`[이동 오류] ${e.message}`);
    }
  };

  return (
    <div className="ui-page">
      <div className="ui-wrap">
        <div className="ui-head">
          <div>
            <div className="ui-title">분류 관리</div>
            <div className="ui-sub">
              대·중·소 3단계 트리로 분류를 관리합니다. 항목 추가, 이름 변경, 삭제, 형제 간 순서(↑/↓) 변경과 부모 이동을 지원합니다.
            </div>
          </div>
          <DashboardButton />
        </div>

        {err && (
          <div className="ui-card" style={{ borderColor: '#ffd7db' }}>
            <span className="ui-badge danger" style={{ marginRight: 8 }}>
              오류
            </span>
            <span style={{ fontSize: 13 }}>{err}</span>
          </div>
        )}

        {/* 3-열 반응형 그리드 */}
        <div
          className="ui-row"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 16,
          }}
        >
          {/* 대분류 */}
          <div className="ui-card" style={{ alignSelf: 'start' }}>
            <h3 style={{ margin: 0, fontSize: 16, color: '#111' }}>대분류</h3>

            <ul style={{ listStyle: 'none', paddingLeft: 0, marginTop: 12 }}>
              {loading && <li className="ui-sub">불러오는 중…</li>}
              {!loading && roots.length === 0 && (
                <li className="ui-sub">아직 대분류가 없습니다.</li>
              )}
              {!loading &&
                roots.map((root) => (
                  <li
                    key={root.id}
                    className="ui-card"
                    style={{
                      padding: 12,
                      marginBottom: 10,
                      background: '#fafcff',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="ui-badge">대</span>
                        <span
                          style={{ fontWeight: 800, color: '#1f2937' }}
                          title={root.name}
                        >
                          {root.name}
                        </span>
                      </div>
                      <div className="ui-toolbar">
                        <button className="ui-btn sm" onClick={() => handleRename(root)}>
                          이름변경
                        </button>
                        <button className="ui-btn sm" onClick={() => handleReorder(root, 'up')}>
                          ↑
                        </button>
                        <button className="ui-btn sm" onClick={() => handleReorder(root, 'down')}>
                          ↓
                        </button>
                        <button
                          className="ui-btn primary sm"
                          onClick={() => handleAddChild(root, 2)}
                        >
                          + 중분류
                        </button>
                        <button className="ui-btn sm" onClick={() => handleDelete(root)}>
                          삭제
                        </button>
                      </div>
                    </div>

                    {/* 중분류 리스트 */}
                    <div
                      style={{
                        marginTop: 10,
                        paddingLeft: 12,
                        borderLeft: '2px dashed #e6e9ef',
                      }}
                    >
                      <MiddleList
                        parent={root}
                        groups={groups}
                        onRename={handleRename}
                        onReorder={handleReorder}
                        onAddChild={handleAddChild}
                        onDelete={handleDelete}
                        onMove={handleMove}
                      />
                    </div>
                  </li>
                ))}
            </ul>

            {/* 대분류 추가 */}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input
                placeholder="새 대분류 이름"
                value={addRootName}
                onChange={(e) => setAddRootName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && onAddRoot()}
                style={{
                  flex: 1,
                  padding: '10px 12px',
                  border: '1px solid #d5d9e2',
                  borderRadius: 10,
                  fontSize: 14,
                }}
              />
              <button className="ui-btn primary sm" onClick={onAddRoot}>
                + 추가
              </button>
            </div>
          </div>

          {/* 사용 팁 */}
          <div className="ui-card" style={{ alignSelf: 'start' }}>
            <h3 style={{ margin: 0, fontSize: 16, color: '#111' }}>사용 팁</h3>
            <ul style={{ marginTop: 10, paddingLeft: 16 }}>
              <li className="ui-sub">
                형제 간 순서는 <b>↑ / ↓</b> 버튼으로 조정합니다.
              </li>
              <li className="ui-sub">
                중분류/소분류는 <b>이동</b>으로 부모를 바꿀 수 있습니다.
              </li>
              <li className="ui-sub">삭제 시 하위 항목이 모두 함께 삭제됩니다.</li>
              <li className="ui-sub">
                이 페이지는 Supabase RPC(cat_create, cat_rename, cat_move, cat_delete)를 사용합니다.
              </li>
            </ul>
            <div style={{ marginTop: 8 }}>
              <button className="ui-btn sm" onClick={fetchAll}>
                ↺ 새로고침
              </button>
            </div>
          </div>

          {/* 트리 미리보기 */}
          <div className="ui-card" style={{ alignSelf: 'start' }}>
            <h3 style={{ margin: 0, fontSize: 16, color: '#111' }}>트리 미리보기</h3>
            <div style={{ marginTop: 10 }}>
              <PreviewTree nodes={nodes} groups={groups} />
            </div>
          </div>
        </div>

        {/* 모바일 반응형: 1열로 쌓이도록 */}
        <style>{`
          @media (max-width: 900px){
            .ui-row {
              display: grid !important;
              grid-template-columns: 1fr !important;
            }
          }
        `}</style>
      </div>
    </div>
  );
}

function MiddleList({ parent, groups, onRename, onReorder, onAddChild, onDelete, onMove }) {
  const mids = groups.get(parent.id) || [];
  return (
    <ul style={{ listStyle: 'none', paddingLeft: 0, margin: 0 }}>
      {mids.length === 0 && <li className="ui-sub">중분류가 없습니다.</li>}
      {mids.map((mid) => (
        <li
          key={mid.id}
          className="ui-card"
          style={{ padding: 10, marginBottom: 8, background: '#ffffff' }}
        >
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="ui-badge success">중</span>
              <span style={{ fontWeight: 800, color: '#1f2937' }} title={mid.name}>
                {mid.name}
              </span>
            </div>
            <div className="ui-toolbar">
              <button className="ui-btn sm" onClick={() => onRename(mid)}>
                이름변경
              </button>
              <button className="ui-btn sm" onClick={() => onReorder(mid, 'up')}>
                ↑
              </button>
              <button className="ui-btn sm" onClick={() => onReorder(mid, 'down')}>
                ↓
              </button>
              <button className="ui-btn sm" onClick={() => onMove(mid)}>
                이동
              </button>
              <button
                className="ui-btn primary sm"
                onClick={() => onAddChild(mid, 3)}
              >
                + 소분류
              </button>
              <button className="ui-btn sm" onClick={() => onDelete(mid)}>
                삭제
              </button>
            </div>
          </div>

          {/* 소분류 */}
          <div
            style={{
              marginTop: 10,
              paddingLeft: 12,
              borderLeft: '2px dashed #e6e9ef',
            }}
          >
            <SmallList
              parent={mid}
              groups={groups}
              onRename={onRename}
              onReorder={onReorder}
              onDelete={onDelete}
              onMove={onMove}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function SmallList({ parent, groups, onRename, onReorder, onDelete, onMove }) {
  const smalls = groups.get(parent.id) || [];
  return (
    <ul style={{ listStyle: 'none', paddingLeft: 0, margin: 0 }}>
      {smalls.length === 0 && <li className="ui-sub">소분류가 없습니다.</li>}
      {smalls.map((sm) => (
        <li
          key={sm.id}
          className="ui-card"
          style={{ padding: 10, marginBottom: 8, background: '#ffffff' }}
        >
          <div
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="ui-badge warn">소</span>
              <span style={{ fontWeight: 800, color: '#1f2937' }} title={sm.name}>
                {sm.name}
              </span>
            </div>
            <div className="ui-toolbar">
              <button className="ui-btn sm" onClick={() => onRename(sm)}>
                이름변경
              </button>
              <button className="ui-btn sm" onClick={() => onReorder(sm, 'up')}>
                ↑
              </button>
              <button className="ui-btn sm" onClick={() => onReorder(sm, 'down')}>
                ↓
              </button>
              <button className="ui-btn sm" onClick={() => onMove(sm)}>
                이동
              </button>
              <button className="ui-btn sm" onClick={() => onDelete(sm)}>
                삭제
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// 오른쪽 "트리 미리보기" — 간단 텍스트 트리
function PreviewTree({ nodes, groups }) {
  const roots = groups.get('ROOT') || [];
  if (nodes.length === 0) return <div className="ui-sub">아직 데이터가 없습니다.</div>;
  return (
    <div
      style={{
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 12,
        lineHeight: 1.6,
      }}
    >
      {roots.map((r) => (
        <div key={r.id} style={{ marginBottom: 6 }}>
          <b>• {r.name}</b>
          {(groups.get(r.id) || []).map((m) => (
            <div key={m.id} style={{ paddingLeft: 16 }}>
              ├─ {m.name}
              {(groups.get(m.id) || []).map((s) => (
                <div key={s.id} style={{ paddingLeft: 32 }}>
                  └─ {s.name}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
