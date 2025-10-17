// 영어 문장 분리: 마침표/물음표/느낌표 + 따옴표/괄호 처리 (아주 단순 휴리스틱)
export function splitEnglishSentences(text) {
  if (!text) return [];
  const cleaned = text
    .replace(/\s+/g, ' ')
    .trim();

  // 약어 예외(간단)
  const ABBR = /\b(e\.g|i\.e|Mr|Mrs|Ms|Dr|Sr|Jr|vs)\.$/i;

  const out = [];
  let buf = '';
  for (const ch of cleaned) {
    buf += ch;
    if (/[.!?]/.test(ch)) {
      // 직전 토큰이 약어이면 계속
      const trimmed = buf.trim();
      const tokens = trimmed.split(' ');
      const last = tokens[tokens.length - 1] || '';
      if (ABBR.test(last)) continue;

      // 다음에 붙는 닫는 따옴표/괄호까지 포함
      out.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

// 한국어 문장 분리: 마침표/물음표/느낌표 기준
export function splitKoreanSentences(text) {
  if (!text) return [];
  const cleaned = text.replace(/\s+/g, ' ').trim();
  const out = [];
  let buf = '';
  for (const ch of cleaned) {
    buf += ch;
    if (/[.?!]/.test(ch)) {
      out.push(buf.trim());
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

// 페어 하나를 두 개로 나눌 때, 양쪽을 동시에 적당히 분리하는 휴리스틱
export function smartSplitPair(en, ko) {
  const cutByPunct = (s) => {
    // 중간 근처의 구두점(.?!;:)을 찾아 분리
    const mid = Math.floor(s.length / 2);
    let left = -1;
    let right = -1;
    for (let i = mid; i >= 0; i--) {
      if (/[.?!;:]/.test(s[i])) { left = i; break; }
    }
    for (let i = mid; i < s.length; i++) {
      if (/[.?!;:]/.test(s[i])) { right = i; break; }
    }
    const pos = (right !== -1 ? right : left);
    if (pos === -1) return null;
    const a = s.slice(0, pos + 1).trim();
    const b = s.slice(pos + 1).trim();
    if (!a || !b) return null;
    return { a, b };
  };

  const enSplit = cutByPunct(en) || cutByPunct(en.replace(/\s+/g, ' '));
  const koSplit = cutByPunct(ko) || cutByPunct(ko.replace(/\s+/g, ' '));

  if (!enSplit && !koSplit) {
    return { en1: en, en2: '', ko1: ko, ko2: '' };
  }
  return {
    en1: enSplit ? enSplit.a : en,
    en2: enSplit ? enSplit.b : '',
    ko1: koSplit ? koSplit.a : ko,
    ko2: koSplit ? koSplit.b : ''
  };
}
