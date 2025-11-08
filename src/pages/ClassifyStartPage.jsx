// src/pages/ClassifyStartPage.jsx
import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import DashboardButton from '../components/DashboardButton';
import '../styles/ui.css';

const STORAGE_KEY = 'classify_start_draft_v1';
const FINISHED_KEY = 'classify_start_finished_v1';

function splitIntoSentences(raw) {
  // 1) 줄바꿈 우선
  const lines = (raw || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  // 2) 문장부호 기반 2차 분리 (.;:?! 뒤 공백 기준)
  const out = [];
  for (const line of lines) {
    const parts = line
      .split(/(?<=[\.!?;:])\s+/g)
      .map((s) => s.trim())
      .filter(Boolean);
    out.push(...(parts.length ? parts : [line]));
  }

  // 3) 공백/중복 정리
  const deduped = Array.from(
    new Set(out.map((s) => s.replace(/\s+/g, ' ').trim()))
  ).filter(Boolean);
  return deduped;
}

function buildTitle(grade, year, month, number) {
  const g = (grade || '').trim(); // '고1' | '고2' | '고3'
  const y = (year || '').toString().trim();
  const m = (month || '').toString().trim();
  const n = (number || '').toString().trim();
  const base = [y && `${y}년`, g, m && `${m}월`, '모의고사']
    .filter(Boolean)
    .join(' ');
  return [base || '무제 자료', n && `${n}번`].filter(Boolean).join(' ');
}

// 한 덩어리 텍스트의 공백을 예쁘게 정리하는 함수
function normalizeBlockText(raw) {
  return (raw || '')
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/\s+/g, ' ')
        .trim()
    )
    .filter(Boolean)
    .join('\n');
}

export default function ClassifyStartPage() {
  const nav = useNavigate();
  const autosaveTimerRef = useRef(null);

  // 메타(학년/연도/월/문항번호)
  const [grade, setGrade] = useState('고1');
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState('');
  const [number, setNumber] = useState('');

  // 본문 입력(영문/한글)
  const [rawEN, setRawEN] = useState('');
  const [rawKO, setRawKO] = useState('');

  // 자동 저장 상태 표시
  const [autosaveStatus, setAutosaveStatus] = useState('idle'); // idle | saving | saved

  // 처음 들어올 때 로컬 저장된 초안 불러오기
  useEffect(() => {
    try {
      // ✅ 바로 직전에 "분류 완료"를 했다면 초안은 안 불러오고, 완료 플래그만 지운다
      const justFinished = localStorage.getItem(FINISHED_KEY);
      if (justFinished === '1') {
        localStorage.removeItem(FINISHED_KEY);
        // 여기서 return 하면 아래 초안 로딩은 안 함
        return;
      }

      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.grade) setGrade(parsed.grade);
        if (parsed.year) setYear(parsed.year);
        if (parsed.month !== undefined) setMonth(parsed.month);
        if (parsed.number !== undefined) setNumber(parsed.number);
        if (parsed.rawEN !== undefined) setRawEN(parsed.rawEN);
        if (parsed.rawKO !== undefined) setRawKO(parsed.rawKO);
      }
    } catch (e) {
      console.warn('failed to load draft', e);
    }
  }, []);

  // 입력이 바뀔 때마다 0.9초 후 자동 저장
  useEffect(() => {
    setAutosaveStatus('saving');
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      try {
        const payload = {
          grade,
          year,
          month,
          number,
          rawEN,
          rawKO,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
        setAutosaveStatus('saved');
      } catch (e) {
        console.warn('failed to autosave', e);
        setAutosaveStatus('idle');
      }
    }, 900);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [grade, year, month, number, rawEN, rawKO]);

  const enList = useMemo(() => splitIntoSentences(rawEN), [rawEN]);
  const koList = useMemo(() => splitIntoSentences(rawKO), [rawKO]);

  const pairCount = enList.length;
  const hasAny = pairCount > 0;

  const previewPairs = useMemo(() => {
    const n = Math.min(3, pairCount);
    const arr = [];
    for (let i = 0; i < n; i++) {
      arr.push({
        en: enList[i] ?? '',
        ko: koList[i] ?? '',
      });
    }
    return arr;
  }, [enList, koList, pairCount]);

  const onGo = () => {
    // 0) 메타 필수값 체크
    const gradeOk = (grade || '').toString().trim().length > 0;
    const yearOk = (year || '').toString().trim().length > 0;
    const monthOk = (month || '').toString().trim().length > 0;
    const numberOk = (number || '').toString().trim().length > 0;

    if (!gradeOk || !yearOk || !monthOk || !numberOk) {
      alert('학년, 연도, 월, 문항번호를 모두 입력하세요.');
      return;
    }

    if (!hasAny) {
      alert('분리할 문장이 없습니다. 왼쪽(영문) 입력 칸을 채워주세요.');
      return;
    }

    const meta = {
      grade,
      year: year ? Number(year) : null,
      month: month ? Number(month) : null,
      number: number ? Number(number) : null,
      title: buildTitle(grade, year, month, number),
    };

    const pairs = enList.map((en, i) => ({
      en,
      ko: koList[i] ?? '',
      cat_l: '',
      cat_m: '',
      cat_s: '',
      order_index: i,
    }));

    // ✅ 여기서 자동 저장된 초안은 지워버린다
    localStorage.removeItem(STORAGE_KEY);
    // ✅ 그리고 "방금 끝났어" 플래그를 잠깐 남겨둔다
    localStorage.setItem(FINISHED_KEY, '1');

    nav('/category/start/review', { state: { meta, pairs } });
  };

  const handleNormalizeEN = () => {
    setRawEN((prev) => normalizeBlockText(prev));
  };
  const handleNormalizeKO = () => {
    setRawKO((prev) => normalizeBlockText(prev));
  };

  return (
    <div className="ui-page">
      <div className="ui-wrap">
        {/* 헤더 */}
        <div className="ui-head">
          <div>
            <div className="ui-title">분류 시작하기</div>
            <div className="ui-sub">
              학년/연도/월/문항번호를 입력하고, 영문과 한국어 해석을 붙여넣으세요.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {autosaveStatus === 'saving' && (
              <span className="ui-sub" style={{ color: '#3b82f6', fontSize: 12 }}>
                자동 저장 중…
              </span>
            )}
            {autosaveStatus === 'saved' && (
              <span className="ui-sub" style={{ color: '#10b981', fontSize: 12 }}>
                자동 저장됨
              </span>
            )}
            <DashboardButton />
          </div>
        </div>

        {/* 본문 카드 */}
        <div className="ui-card">
          {/* 메타 입력 */}
          <div
            className="meta-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr 1fr',
              gap: 12,
            }}
          >
            <div>
              <div className="ui-sub" style={{ marginBottom: 6 }}>
                학년
              </div>
              <select
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #e8e8ef',
                  borderRadius: 10,
                  fontSize: 14,
                }}
                value={grade}
                onChange={(e) => setGrade(e.target.value)}
              >
                <option value="고1">고1</option>
                <option value="고2">고2</option>
                <option value="고3">고3</option>
              </select>
            </div>
            <div>
              <div className="ui-sub" style={{ marginBottom: 6 }}>
                연도
              </div>
              <input
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #e8e8ef',
                  borderRadius: 10,
                  fontSize: 14,
                }}
                type="number"
                placeholder="예) 2024"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                min={2000}
                max={2100}
              />
            </div>
            <div>
              <div className="ui-sub" style={{ marginBottom: 6 }}>
                월
              </div>
              <select
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #e8e8ef',
                  borderRadius: 10,
                  fontSize: 14,
                }}
                value={month}
                onChange={(e) => setMonth(e.target.value)}
              >
                <option value="">선택</option>
                {[...Array(12)].map((_, i) => {
                  const m = i + 1;
                  return (
                    <option key={m} value={m}>
                      {m}월
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <div className="ui-sub" style={{ marginBottom: 6 }}>
                문항 번호(몇 번)
              </div>
              <input
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  border: '1px solid #e8e8ef',
                  borderRadius: 10,
                  fontSize: 14,
                }}
                type="number"
                placeholder="예) 20"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                min={1}
              />
            </div>
          </div>

          {/* 본문 입력 */}
          <div
            className="dual-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              marginTop: 16,
            }}
          >
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 6,
                }}
              >
                <div className="ui-sub">영문 텍스트</div>
                <button className="ui-btn sm" onClick={handleNormalizeEN}>
                  공백 정리
                </button>
              </div>
              <textarea
                style={{
                  width: '100%',
                  minHeight: 240,
                  padding: '12px 14px',
                  border: '1px solid #e8e8ef',
                  borderRadius: 12,
                  fontSize: 14,
                  resize: 'vertical',
                }}
                placeholder={`여기에 영문 지문을 붙여넣으세요.\n줄바꿈과 . ? ! ; : 기준으로 문장을 나눕니다.`}
                value={rawEN}
                onChange={(e) => setRawEN(e.target.value)}
              />
              <p className="ui-sub" style={{ marginTop: 8 }}>
                예상 문장 수(EN): <b>{enList.length}</b>
              </p>
            </div>
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 6,
                }}
              >
                <div className="ui-sub">한국어 해석 (선택)</div>
                <button className="ui-btn sm" onClick={handleNormalizeKO}>
                  공백 정리
                </button>
              </div>
              <textarea
                style={{
                  width: '100%',
                  minHeight: 240,
                  padding: '12px 14px',
                  border: '1px solid #e8e8ef',
                  borderRadius: 12,
                  fontSize: 14,
                  resize: 'vertical',
                }}
                placeholder={`영문과 1:1로 대응되도록 한 줄/한 문장씩 입력하세요.\n비워두면 검수 화면에서 입력할 수 있어요.`}
                value={rawKO}
                onChange={(e) => setRawKO(e.target.value)}
              />
              <p className="ui-sub" style={{ marginTop: 8 }}>
                예상 문장 수(KO): <b>{koList.length}</b>
              </p>
            </div>
          </div>

          {/* 미리보기 */}
          {hasAny && (
            <div
              className="ui-card"
              style={{
                marginTop: 16,
                border: '1px solid #eef2f7',
                background: '#fbfdff',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                }}
              >
                <div className="ui-sub">미리보기 (앞 {previewPairs.length}개)</div>
                <div />
              </div>

              {previewPairs.map((p, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 12,
                    padding: '8px 0',
                    borderTop: '1px dashed #e9eef5',
                  }}
                >
                  <div style={{ fontSize: 14, color: '#1f2a44' }}>{p.en}</div>
                  <div style={{ fontSize: 14, color: '#1f2a44' }}>
                    {p.ko || <span style={{ color: '#9aa7b5' }}>(비어 있음)</span>}
                  </div>
                </div>
              ))}
              {pairCount > previewPairs.length && (
                <p className="ui-sub" style={{ marginTop: 8 }}>
                  … 외 {pairCount - previewPairs.length}개
                </p>
              )}
            </div>
          )}

          {/* 하단 버튼 */}
          <div
            className="ui-toolbar"
            style={{ justifyContent: 'space-between', marginTop: 14 }}
          >
            <Link to="/" className="ui-btn sm">
              ← 대시보드
            </Link>
            <button
              onClick={onGo}
              className="ui-btn primary"
              style={{
                opacity: hasAny ? 1 : 0.6,
                pointerEvents: hasAny ? 'auto' : 'none',
              }}
              title={hasAny ? '문장으로 분류하기' : '영문 텍스트를 입력하세요'}
            >
              문장으로 분류하기
            </button>
          </div>

          <p className="ui-sub" style={{ marginTop: 8 }}>
            • EN/KO 문장 수가 달라도 <b>영문(EN) 기준</b>으로 페어링합니다. <br />
            • 입력한 학년/연도/월/문항번호로 제목이 자동 생성됩니다. <br />
            • 입력 내용은 브라우저에 자동 저장돼요.
          </p>
        </div>

        {/* 반응형 */}
        <style>{`
          @media (max-width: 900px){
            .meta-grid { grid-template-columns: 1fr 1fr; }
          }
          @media (max-width: 640px){
            .meta-grid { grid-template-columns: 1fr; }
            .dual-grid { grid-template-columns: 1fr; }
          }
        `}</style>
      </div>
    </div>
  );
}
