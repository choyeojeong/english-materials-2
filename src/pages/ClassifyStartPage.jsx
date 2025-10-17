// src/pages/ClassifyStartPage.jsx
import { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import DashboardButton from '../components/DashboardButton';
import '../styles/ui.css';

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
  // 예: "2024년 고1 9월 모의고사 20번"
  const base = [y && `${y}년`, g, m && `${m}월`, '모의고사']
    .filter(Boolean)
    .join(' ');
  return [base || '무제 자료', n && `${n}번`].filter(Boolean).join(' ');
}

export default function ClassifyStartPage() {
  const nav = useNavigate();

  // 메타(학년/연도/월/문항번호)
  const [grade, setGrade] = useState('고1');
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState('');
  const [number, setNumber] = useState('');

  // 본문 입력(영문/한글)
  const [rawEN, setRawEN] = useState('');
  const [rawKO, setRawKO] = useState('');

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
    if (!hasAny) {
      alert('분리할 문장이 없습니다. 왼쪽(영문) 입력 칸을 채워주세요.');
      return;
    }

    const meta = {
      grade, // '고1' | '고2' | '고3'
      year: year ? Number(year) : null,
      month: month ? Number(month) : null,
      number: number ? Number(number) : null,
      title: buildTitle(grade, year, month, number),
    };

    // EN/KO 길이가 달라도 EN 기준으로 페어링 (KO 없으면 빈칸)
    const pairs = enList.map((en, i) => ({
      en,
      ko: koList[i] ?? '',
      cat_l: '',
      cat_m: '',
      cat_s: '',
      order_index: i,
    }));

    nav('/category/start/review', { state: { meta, pairs } });
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
          <DashboardButton />
        </div>

        {/* 본문 카드 */}
        <div className="ui-card">
          {/* 메타: 학년 / 연도 / 월 / 문항번호 */}
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

          {/* 본문 입력: 영문 / 한국어 해석 */}
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
              <div className="ui-sub" style={{ marginBottom: 6 }}>
                영문 텍스트
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
              <div className="ui-sub" style={{ marginBottom: 6 }}>
                한국어 해석 (선택)
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
            • 입력한 학년/연도/월/문항번호로 제목이 자동 생성됩니다.
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
