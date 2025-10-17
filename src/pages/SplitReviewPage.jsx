// src/pages/SplitReviewPage.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import DashboardButton from '../components/DashboardButton';
import '../styles/ui.css';

// 문장 경계(세미콜론 제외)
const SENT_SPLIT = /(?<=[.?!…]|[。．？！])\s+/g;
const SENT_SPLIT_TEST = /(?<=[.?!…]|[。．？！])\s+/;

const trim1 = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const hasText = (s) => trim1(s).length > 0;
const glue = (a = '', b = '') => {
  const A = trim1(a);
  const B = trim1(b);
  if (!A) return B;
  if (!B) return A;
  return `${A} ${B}`.replace(/\s+([,.;:?!…])/g, '$1').trim();
};

export default function SplitReviewPage() {
  const { state } = useLocation();
  const navigate = useNavigate();

  const seed = useMemo(() => {
    if (Array.isArray(state?.pairs) && state.pairs.length) {
      return {
        enRows: state.pairs.map((p) => p.en ?? ''),
        koRows: state.pairs.map((p) => p.ko ?? ''),
      };
    }
    const splitAuto = (raw) =>
      (raw ?? '').trim()
        ? raw.trim().split(SENT_SPLIT).map((s) => s.trim()).filter(Boolean)
        : [];
    return {
      enRows: splitAuto(state?.initialEn ?? ''),
      koRows: splitAuto(state?.initialKo ?? ''),
    };
  }, [state]);

  const [enRows, setEnRows] = useState(seed.enRows);
  const [koRows, setKoRows] = useState(seed.koRows);
  const rows = Math.max(enRows.length, koRows.length, 1);

  useEffect(() => {
    const max = Math.max(enRows.length, koRows.length);
    if (enRows.length < max) setEnRows((prev) => prev.concat(Array(max - prev.length).fill('')));
    if (koRows.length < max) setKoRows((prev) => prev.concat(Array(max - prev.length).fill('')));
  }, [enRows.length, koRows.length]);

  const [cur, setCur] = useState({ side: 'en', index: 0, start: 0, end: 0 });
  const enRefs = useRef({});
  const koRefs = useRef({});

  const onFocus = (side, i) => (e) =>
    setCur({
      side,
      index: i,
      start: e.target.selectionStart ?? 0,
      end: e.target.selectionEnd ?? 0,
    });
  const onCaret = (side, i) => (e) =>
    setCur({
      side,
      index: i,
      start: e.target.selectionStart ?? 0,
      end: e.target.selectionEnd ?? 0,
    });
  const focusCell = (side, i, pos = 0) =>
    setTimeout(() => {
      const ref = side === 'en' ? enRefs.current[i] : koRefs.current[i];
      if (ref) {
        ref.focus();
        ref.setSelectionRange(pos, pos);
      }
    }, 0);

  // Undo/Redo
  const STORAGE_KEY = useMemo(() => `split_session_${state?.meta?.title ?? 'untitled'}`, [state?.meta?.title]);
  const [hist, setHist] = useState([{ en: enRows, ko: koRows }]);
  const [hIdx, setHIdx] = useState(0);
  const commit = (nextEN, nextKO) => {
    const next = { en: nextEN, ko: nextKO };
    const newHist = hist.slice(0, hIdx + 1).concat([next]);
    setHist(newHist);
    setHIdx(hIdx + 1);
    setEnRows(nextEN);
    setKoRows(nextKO);
  };
  const undo = () => { if (hIdx > 0) { const prev = hist[hIdx - 1]; setHIdx(hIdx - 1); setEnRows(prev.en); setKoRows(prev.ko); } };
  const redo = () => { if (hIdx < hist.length - 1) { const nx = hist[hIdx + 1]; setHIdx(hIdx + 1); setEnRows(nx.en); setKoRows(nx.ko); } };
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify({ en: enRows, ko: koRows })); }, [STORAGE_KEY, enRows, koRows]);

  // 나눔/합침
  const splitActive = () => {
    const { side, index, start, end } = cur;
    const srcList = side === 'en' ? enRows : koRows;
    const src = srcList[index] ?? '';
    const a = Math.min(start, end);
    const b = Math.max(start, end);
    const left = src.slice(0, a);
    const mid = src.slice(a, b);
    const right = src.slice(b);

    let parts = [];
    if (a !== b && SENT_SPLIT_TEST.test(mid)) {
      parts = [left, ...mid.split(SENT_SPLIT), right].map(trim1).filter(Boolean);
    } else {
      const L = trim1(left);
      const R = trim1(right);
      if (!L || !R) return;
      parts = [L, R];
    }

    const srcNext = [...srcList];
    srcNext.splice(index, 1, ...parts);

    if (side === 'en') commit(srcNext, koRows);
    else commit(enRows, srcNext);

    focusCell(side, index + parts.length - 1, 0);
  };

  const mergeWithNext = () => {
    const { side, index } = cur;
    const srcList = side === 'en' ? enRows : koRows;
    if (index >= srcList.length - 1) return;
    const merged = glue(srcList[index], srcList[index + 1]);
    const srcNext = [...srcList];
    srcNext.splice(index, 2, merged);
    if (side === 'en') commit(srcNext, koRows);
    else commit(enRows, srcNext);
    focusCell(side, index, merged.length);
  };

  const mergeWithPrev = () => {
    const { side, index } = cur;
    if (index <= 0) return;
    const srcList = side === 'en' ? enRows : koRows;
    const merged = glue(srcList[index - 1], srcList[index]);
    const srcNext = [...srcList];
    srcNext.splice(index - 1, 2, merged);
    if (side === 'en') commit(srcNext, koRows);
    else commit(enRows, srcNext);
    focusCell(side, index - 1, merged.length);
  };

  // 추가/삭제
  const addRow = (i) => {
    const nextEN = [...enRows];
    const nextKO = [...koRows];
    nextEN.splice(i + 1, 0, '');
    nextKO.splice(i + 1, 0, '');
    commit(nextEN, nextKO);
  };
  const removeRow = (i) => {
    if (enRows.length <= 1) return;
    const nextEN = [...enRows];
    const nextKO = [...koRows];
    nextEN.splice(i, 1);
    nextKO.splice(i, 1);
    commit(nextEN, nextKO);
    focusCell(cur.side, Math.max(0, i - 1), 0);
  };

  // 저장
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    try {
      setSaving(true);
      const n = Math.max(enRows.length, koRows.length);

      const pairsPayload = Array.from({ length: n }).map((_, i) => ({
        order_index: i,
        en_sentence: trim1(enRows[i] ?? ''),
        ko_sentence: trim1(koRows[i] ?? ''),
      }));
      if (!pairsPayload.some((p) => hasText(p.en_sentence))) {
        alert('저장할 영문 문장이 없습니다.');
        setSaving(false);
        return;
      }

      const materialId =
        state?.meta?.material_id ||
        state?.materialId ||
        (await (async () => {
          const baseRow = {
            title: state?.meta?.title ?? '무제 자료',
            grade: state?.meta?.grade ?? null,
            year: state?.meta?.year ?? null,
            month: state?.meta?.month ?? null,
            number: state?.meta?.number ?? null,
            status: 'review',
          };
          const { data, error } = await supabase
            .from('materials')
            .insert([baseRow])
            .select('id')
            .single();
          if (error) throw new Error(`[materials.insert] ${error.message}`);
          return data.id;
        })());

      const { error } = await supabase.rpc('material_overwrite_pairs', {
        p_material_id: materialId,
        p_pairs: pairsPayload, // en_sentence / ko_sentence로 전달
      });
      if (error) throw new Error(`[material_overwrite_pairs] ${error.message}`);

      const { error: stErr } = await supabase.rpc('material_update_status', {
        p_material_id: materialId,
        p_status: 'done',
      });
      if (stErr) throw new Error(`[material_update_status] ${stErr.message}`);

      navigate(`/category/recommend/${materialId}`, { replace: true });
    } catch (err) {
      console.error(err);
      alert(`저장 중 오류가 발생했습니다.\n${err?.message ?? err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ui-page">
      <div className="ui-wrap">
        {/* 헤더 */}
        <div className="ui-head">
          <div>
            <div className="ui-title">문장 분할 검수</div>
            <div className="ui-sub">
              커서 위치 기준으로 <b>나누기·합치기</b>를 적용하고, Undo/Redo로 되돌릴 수 있어요.
            </div>
          </div>
          <DashboardButton />
        </div>

        {/* 툴바 */}
        <div className="ui-card" style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span className="ui-badge">행 {rows}</span>
          <div style={{ flex:1 }} />
          <button className="ui-btn sm" onClick={undo} disabled={hIdx === 0}>↶ Undo</button>
          <button className="ui-btn sm" onClick={redo} disabled={hIdx === hist.length - 1}>↷ Redo</button>
        </div>

        {/* 본문 표 */}
        <div className="ui-card" style={{ marginTop:12 }}>
          <div className="ui-table-wrap">
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>본문(EN)</th>
                  <th style={S.th}>해석(KO)</th>
                  <th style={{ ...S.th, width: 120 }}>도구</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rows }).map((_, i) => (
                  <tr key={i} style={{ height:'100%' }}>
                    {/* EN */}
                    <td style={S.td}>
                      <div style={S.cell}>
                        <div style={S.tools}>
                          <button
                            className="ui-badge"
                            onClick={() => { setCur({ side: 'en', index: i }); mergeWithPrev(); }}
                          >
                            ⟵ 합침
                          </button>
                          <button
                            className="ui-badge"
                            onClick={() => {
                              const ref = enRefs.current[i];
                              setCur({
                                side: 'en',
                                index: i,
                                start: ref?.selectionStart ?? 0,
                                end: ref?.selectionEnd ?? 0,
                              });
                              splitActive();
                            }}
                          >
                            나눔
                          </button>
                          <button
                            className="ui-badge"
                            onClick={() => { setCur({ side: 'en', index: i }); mergeWithNext(); }}
                          >
                            합침 ⟶
                          </button>
                        </div>
                        <textarea
                          ref={(el) => (enRefs.current[i] = el)}
                          value={enRows[i] ?? ''}
                          onFocus={onFocus('en', i)}
                          onClick={onCaret('en', i)}
                          onKeyUp={onCaret('en', i)}
                          onChange={(e) => {
                            const next = [...enRows];
                            next[i] = e.target.value;
                            commit(next, koRows);
                          }}
                          style={S.ta}
                        />
                      </div>
                    </td>

                    {/* KO */}
                    <td style={S.td}>
                      <div style={S.cell}>
                        <div style={S.tools}>
                          <button
                            className="ui-badge"
                            onClick={() => { setCur({ side: 'ko', index: i }); mergeWithPrev(); }}
                          >
                            ⟵ 합침
                          </button>
                          <button
                            className="ui-badge"
                            onClick={() => {
                              const ref = koRefs.current[i];
                              setCur({
                                side: 'ko',
                                index: i,
                                start: ref?.selectionStart ?? 0,
                                end: ref?.selectionEnd ?? 0,
                              });
                              splitActive();
                            }}
                          >
                            나눔
                          </button>
                          <button
                            className="ui-badge"
                            onClick={() => { setCur({ side: 'ko', index: i }); mergeWithNext(); }}
                          >
                            합침 ⟶
                          </button>
                        </div>
                        <textarea
                          ref={(el) => (koRefs.current[i] = el)}
                          value={koRows[i] ?? ''}
                          onFocus={onFocus('ko', i)}
                          onClick={onCaret('ko', i)}
                          onKeyUp={onCaret('ko', i)}
                          onChange={(e) => {
                            const next = [...koRows];
                            next[i] = e.target.value;
                            commit(enRows, next);
                          }}
                          style={S.ta}
                        />
                        {!koRows[i] && <div style={S.hintEmpty}>⟡ 비어 있음</div>}
                      </div>
                    </td>

                    {/* 도구: 추가/삭제 */}
                    <td style={S.tdTool}>
                      <div style={S.vtools}>
                        <button className="ui-btn sm" onClick={() => addRow(i)}>＋</button>
                        <button className="ui-btn sm" onClick={() => removeRow(i)}>－</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 하단 버튼 + 단축키 안내 */}
          <div className="ui-toolbar" style={{ justifyContent:'space-between', marginTop:12 }}>
            <div className="ui-sub">
              <b>단축키</b> · Enter=나누기 · Ctrl+Backspace(맨앞)=위와 합침 · Ctrl+Delete(맨끝)=다음과 합침
            </div>
            <button
              className="ui-btn primary"
              style={{ opacity: saving ? 0.7 : 1, pointerEvents: saving ? 'none' : 'auto' }}
              onClick={handleSave}
            >
              {saving ? '저장 중…' : '검수완료(저장)'}
            </button>
          </div>
        </div>

        {/* 반응형 */}
        <style>{`
          @media (max-width: 860px){
            .ui-table-wrap { overflow-x: auto; }
            textarea { min-height: 140px; }
          }
        `}</style>
      </div>
    </div>
  );
}

// 로컬 스타일(구조 유지, UI 토큰과 조화)
const S = {
  table: { width: '100%', borderCollapse: 'separate', borderSpacing: '0 12px', minWidth: 720 },
  th: { textAlign: 'left', padding: '10px 12px', background: '#f3f6fb', color: '#3b4b66', fontWeight: 800, border: '1px solid #e5e8ef', borderRadius: 8, fontSize: 13 },
  td: { verticalAlign: 'top', padding: '0 10px' },
  tdTool: { verticalAlign: 'top', paddingTop: 6, width: 120 },
  cell: { position: 'relative', background: '#fff', border: '1px solid #e6e9f1', borderRadius: 10, padding: 10, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' },
  tools: { position: 'absolute', top: -11, left: 10, display: 'flex', gap: 6 },
  ta: { width: '100%', minHeight: 110, resize: 'vertical', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 12px', outline: 'none', fontSize: 15, lineHeight: 1.55, background:'#fff' },
  vtools: { display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' },
  hintEmpty: { position: 'absolute', right: 10, bottom: 10, fontSize: 12, color: '#999' },
};
