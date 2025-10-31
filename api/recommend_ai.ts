export const config = { runtime: "edge" };

/** ====== 타입 ====== */
type ReqItem = { pair_id: number | string; en: string; ko?: string };
type Rec = { path: string; reason?: string; score?: number };

/** ====== CORS ====== */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** ====== 화이트리스트(정적) — 동적 leafPaths가 없을 때 fallback ====== */
const TAXONOMY_FALLBACK: string[] = [
  "품사 > 대명사 > 재귀대명사",
  "품사 > 대명사 > 부정대명사",
  "품사 > 동사 > 구동사",
  "품사 > 형용사 > 비교급",
  "품사 > 형용사 > 최상급",
  "품사 > 부사 > 빈도부사",
  "품사 > 전치사 > 전치사 관용표현",
  "품사 > 접속사 > 등위접속사",
  "품사 > 접속사 > 종속접속사",
  "품사 > 접속사 > 상관접속사",
  "품사 > 접속사 > 접속부사",
  "문장의 형식 > 1형식",
  "문장의 형식 > 2형식",
  "문장의 형식 > 3형식",
  "문장의 형식 > 4형식",
  "문장의 형식 > 5형식",
  "구(Phrase) > 전치사구 > 형용사구",
  "구(Phrase) > 전치사구 > 부사구",
  "구(Phrase) > to부정사구 > 명사적 용법",
  "구(Phrase) > to부정사구 > 형용사적 용법",
  "구(Phrase) > to부정사구 > 부사적 용법",
  "구(Phrase) > 동명사구 > 주어 역할",
  "구(Phrase) > 동명사구 > 목적어 역할",
  "구(Phrase) > 동명사구 > 보어 역할",
  "구(Phrase) > 동명사구 > 전치사의 목적어 역할",
  "구(Phrase) > 동명사구 > 전치사 to와 to부정사의 구분",
  "구(Phrase) > 분사 > 현재분사",
  "구(Phrase) > 분사 > 과거분사",
  "구(Phrase) > 분사 > 분사구문",
  "구(Phrase) > 분사 > 독립분사구문",
  "구(Phrase) > 분사 > with A B",
  "구(Phrase) > 동격구",
  "구(Phrase) > 병렬구",
  "절(Clause) > 명사절 > that절",
  "절(Clause) > 명사절 > whether절 (if절)",
  "절(Clause) > 명사절 > 의문사절",
  "절(Clause) > 형용사절 > 관계대명사절",
  "절(Clause) > 형용사절 > 관계부사절",
  "절(Clause) > 부사절 > 시간의 부사절",
  "절(Clause) > 부사절 > 조건의 부사절",
  "절(Clause) > 부사절 > 이유의 부사절",
  "절(Clause) > 부사절 > 양보의 부사절",
  "절(Clause) > 부사절 > 결과의 부사절",
  "절(Clause) > 부사절 > 목적의 부사절",
  "절(Clause) > 동격절",
  "절(Clause) > 감탄문",
  "절(Clause) > 명령문",
  "특수 구문 > 비교급 구문",
  "특수 구문 > 강조 구문 > It is ~ that 강조구문",
  "특수 구문 > 강조 구문 > 동사 강조",
  "특수 구문 > 도치 구문",
  "특수 구문 > 가정법 구문 > 가정법 과거",
  "특수 구문 > 가정법 구문 > 가정법 과거완료",
  "특수 구문 > 가정법 구문 > 혼합 가정법",
  "특수 구문 > 가정법 구문 > as if 가정법",
  "특수 구문 > 가정법 구문 > I wish 가정법",
  "특수 구문 > 수동태 구문 > 3형식 수동태",
  "특수 구문 > 수동태 구문 > 4형식 수동태",
  "특수 구문 > 수동태 구문 > 5형식 수동태",
  "특수 구문 > 생략 구문",
];

/** ====== 튜닝 파라미터(정확도/누락 개선) ====== */
const DEFAULT_MIN_REC = 3;
const DEFAULT_MAX_REC = 6;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 1000 * 18; // ↑ 약간 여유 (누락 방지)
const FIRST_TEMP = 0.3;  // ↑ 보수적으로 정확도 우선
const SECOND_TEMP = 0.6; // ↑ 부족 시 재시도는 다양성 조금 허용
const MAX_TOKENS = 800;  // ↑ 길이 여유 (누락↓)
const RETRY_THRESHOLD = 2; // 1차 결과가 2개 이하이면 재질의
const MIN_WORDS = 4;       // 너무 짧은 문장 제거 기준
const MIN_DEPTH = 2;       // "상위 > 하위" 이상만 허용
const DEFAULT_MIN_SCORE = 0.0;

/** ====== 프롬프트 ====== */
const SYS_PROMPT = `
너는 한국 중·고등 영어 교육과정 분류를 위한 문장 분석 보조 교사다.

목표:
- 입력된 EN/KO 문장을 보고 교육적으로 핵심적인 문법·구문 포인트를 추천한다.
- 가능한 경우 **리프(leaf) 경로**만 선택한다. (중간 노드 단독 추천 금지)
- 결과는 JSON으로만 반환하고, 각 추천에 간단한 근거(reason)와 확신도(score: 0~1)를 넣는다.
- 확신이 매우 낮으면 빈 배열([])도 허용하되, 2차 요청에서는 가능하면 채우도록 한다.
`.trim();

/** ====== few-shot (모델 힌트) ====== */
const FEW_SHOT: Array<{ en: string; ko: string; items: Rec[] }> = [
  {
    en: "I wish I could fly.",
    ko: "나는 날 수 있으면 좋겠다.",
    items: [
      { path: "특수 구문 > 가정법 구문 > I wish 가정법", reason: "I wish + 과거형", score: 0.9 },
      { path: "문장의 형식 > 3형식", reason: "동사 wish의 3형식 구조", score: 0.6 },
    ],
  },
  {
    en: "To live a happy life, you need to be grateful.",
    ko: "행복하게 살기 위해서는 감사할 줄 알아야 한다.",
    items: [
      { path: "구(Phrase) > to부정사구 > 부사적 용법", reason: "to 부정사 목적/이유", score: 0.9 },
      { path: "문장의 형식 > 1형식", reason: "you need to be ~", score: 0.6 },
    ],
  },
];

/** ====== 유틸 ====== */
function normalizeSpace(s: string) {
  return s.replace(/\s+/g, " ").trim();
}
function depthOfPath(p: string) {
  return normalizeSpace(p).split(">").length;
}
function uniq<T>(arr: T[], key: (v: T) => string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const v of arr) {
    const k = key(v);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  }
  return out;
}

/** JSON schema 강제 + enum(leaf)로 오출력 방지 */
function schemaDef(leafList: string[]) {
  return {
    type: "json_schema",
    json_schema: {
      name: "CategoryRecommendation",
      schema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            maxItems: DEFAULT_MAX_REC,
            items: {
              type: "object",
              required: ["path", "reason"],
              properties: {
                path: { type: "string", enum: leafList },  // 동적 leaf 강제
                reason: { type: "string", minLength: 2, maxLength: 200 },
                score: { type: "number", minimum: 0, maximum: 1 },
              },
              additionalProperties: false,
            },
          },
        },
        required: ["items"],
        additionalProperties: false,
      },
      strict: true,
    },
  } as const;
}

/** 안전 파서(모델이 코드블록으로 감쌓는 상황 포함) */
function safeParseItems(jsonText: string): Rec[] {
  try {
    const obj = JSON.parse(jsonText);
    if (obj && Array.isArray((obj as any).items)) return (obj as any).items;
  } catch {}
  const m =
    jsonText.match(/```json\s*([\s\S]*?)\s*```/) ??
    jsonText.match(/(\{[\s\S]*\})/);
  if (m) {
    try {
      const obj2 = JSON.parse(m[1]);
      if (obj2 && Array.isArray((obj2 as any).items)) return (obj2 as any).items;
    } catch {}
  }
  return [];
}

/** OpenAI 호출 */
async function callOpenAI(payload: Record<string, unknown>, timeoutMs = OPENAI_TIMEOUT_MS): Promise<any> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  const ac = new AbortController();
  const tt = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}: ${await r.text()}`);
    return await r.json();
  } finally {
    clearTimeout(tt);
  }
}

/** 휴리스틱(백업) */
function heuristic(en: string, allow: Set<string>): Rec[] {
  const s = (en || "").toLowerCase();
  const picks: string[] = [];
  if (s.includes("i wish")) picks.push("특수 구문 > 가정법 구문 > I wish 가정법");
  if (/\b(if|unless|provided|as long as)\b/.test(s)) picks.push("절(Clause) > 부사절 > 조건의 부사절");
  if (/\b(because|since|as)\b/.test(s)) picks.push("절(Clause) > 부사절 > 이유의 부사절");
  if (/\b(when|while|after|before|until|once)\b/.test(s)) picks.push("절(Clause) > 부사절 > 시간의 부사절");
  if (/\b(though|although|even though|even if|whereas)\b/.test(s)) picks.push("절(Clause) > 부사절 > 양보의 부사절");
  if (/\bthat\b/.test(s)) picks.push("절(Clause) > 명사절 > that절");
  if (/\b(who|which|that)\b/.test(s)) picks.push("절(Clause) > 형용사절 > 관계대명사절");
  if (/\b(where|in which|at which|on which|to which)\b/.test(s)) picks.push("절(Clause) > 형용사절 > 관계부사절");
  if (/\bto\s+\w+/.test(s)) picks.push("구(Phrase) > to부정사구 > 부사적 용법");
  if (/\b(more|most|less|least|than|as\b.*\bas)\b/.test(s)) picks.push("특수 구문 > 비교급 구문");

  const uniqAllowed = uniq(
    picks.filter(p => allow.has(p)),
    (p) => p
  ).slice(0, DEFAULT_MAX_REC);

  return uniqAllowed.map((p) => ({ path: p, reason: "전형적 패턴(휴리스틱)", score: 0.55 }));
}

/** 1회 질의 */
async function askOnce(opts: {
  en: string; ko?: string; pass: 1 | 2; temperature: number;
  leafList: string[]; topN: number;
}): Promise<Rec[]> {
  const { en, ko, pass, temperature, leafList, topN } = opts;
  const hints = [
    `영문(EN)을 우선으로 판단하고, 한국어(KO)는 보조적으로만 사용.`,
    `권장 개수: ${DEFAULT_MIN_REC}~${topN}개.`,
    pass === 1 ? `불확실 시 빈 배열([]) 가능.` : `가능하면 빈 배열 대신 적절한 리프 경로를 채워라.`,
    `경로 구분자는 " > " (양쪽 공백 포함).`,
    `화이트리스트(leaf)와 **정확히 일치**하는 경로만 허용.`,
    `중복/유사 포인트는 피하고 다양성을 확보.`,
  ];

  const shot = FEW_SHOT.map(s => [
    `예시 EN: ${s.en}`,
    `예시 KO: ${s.ko}`,
    `예시 정답(JSON): ${JSON.stringify({ items: s.items })}`,
  ].join("\n")).join("\n\n");

  const userContent = `${hints.join("\n")}

영문: ${en}
한글: ${ko || "(없음)"}

[허용 리프 목록]
${leafList.slice(0, 400).map(p => `- ${p}`).join("\n")}

${shot}
`;

  const data = await callOpenAI({
    model: OPENAI_MODEL,
    temperature,
    max_tokens: MAX_TOKENS,
    response_format: schemaDef(leafList),
    messages: [
      { role: "system", content: SYS_PROMPT },
      { role: "user", content: userContent },
    ],
  });

  const raw = data?.choices?.[0]?.message?.content ?? "";
  let arr = safeParseItems(raw);

  // schema 강제여도 모델이 score 누락할 수 있어 기본값 보정
  arr = (Array.isArray(arr) ? arr : []).map((r) => ({
    path: normalizeSpace(r?.path || ""),
    reason: (r?.reason || "").toString().slice(0, 200),
    score: typeof r?.score === "number" ? r.score : 0.66,
  }));

  return arr;
}

/** 메인 추천 로직(재시도+필터+휴리스틱) */
async function recommendForSentence(
  en: string,
  ko: string | undefined,
  allowSet: Set<string>,
  leafList: string[],
  topN: number,
  minScore: number
): Promise<Rec[]> {
  const enNorm = normalizeSpace(en);
  const koNorm = ko ? normalizeSpace(ko) : undefined;

  // 입력 품질 보정: 너무 짧으면 KO와 합쳐 힌트 강화
  const useEN = enNorm;
  const tooShort = enNorm.split(/\s+/).length < MIN_WORDS;

  try {
    // 1차: 보수적 (빈배열 허용, 낮은 temp)
    let recs = await askOnce({
      en: tooShort && koNorm ? `${useEN}. ${koNorm}` : useEN,
      ko: koNorm,
      pass: 1,
      temperature: FIRST_TEMP,
      leafList,
      topN,
    });

    // 경로/깊이/허용/스코어 필터 + 중복 제거
    recs = uniq(
      recs.filter(r =>
        r.path &&
        depthOfPath(r.path) >= MIN_DEPTH &&
        allowSet.has(r.path) &&
        (typeof r.score === "number" ? r.score >= minScore : true)
      ),
      (r) => r.path
    ).slice(0, topN);

    // 2차: 결과가 너무 적을 때 적극 재질의
    if (recs.length <= RETRY_THRESHOLD) {
      const more = await askOnce({
        en: tooShort && koNorm ? `${useEN}. ${koNorm}` : useEN,
        ko: koNorm,
        pass: 2,
        temperature: SECOND_TEMP,
        leafList,
        topN,
      });
      const combined = uniq([...recs, ...more], (r) => r.path).filter(r =>
        r.path &&
        depthOfPath(r.path) >= MIN_DEPTH &&
        allowSet.has(r.path) &&
        (typeof r.score === "number" ? r.score >= minScore : true)
      );
      recs = combined.slice(0, topN);
    }

    // 휴리스틱 백업 (여전히 부족하면)
    if (recs.length < DEFAULT_MIN_REC) {
      const h = heuristic(useEN, allowSet);
      recs = uniq([...recs, ...h], (r) => r.path).slice(0, topN);
    }
    return recs;
  } catch {
    // OpenAI 실패 시 휴리스틱만이라도
    return heuristic(useEN, allowSet).slice(0, topN);
  }
}

/** ====== 핸들러 ====== */
export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: corsHeaders });

  try {
    const body = await req.json();
    const items: ReqItem[] = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 동적 leaf 목록 지원: 클라이언트가 DB에서 is_leaf 경로를 주면 그걸 사용
    // 없으면 기존 하드코드 화이트리스트 사용
    const leafPaths: string[] = Array.isArray(body?.leafPaths) && body.leafPaths.length
      ? body.leafPaths.map((s: any) => normalizeSpace(String(s)))
      : TAXONOMY_FALLBACK;

    const topN = Number.isFinite(body?.topN) ? Math.min(Math.max(1, body.topN), DEFAULT_MAX_REC) : DEFAULT_MAX_REC;
    const minScore = Number.isFinite(body?.minScore) ? Math.max(0, Math.min(1, body.minScore)) : DEFAULT_MIN_SCORE;

    const allowSet = new Set(leafPaths);

    const results = await Promise.all(
      items.map(async (it) => {
        const recs = await recommendForSentence(
          String(it.en || ""),
          it.ko ? String(it.ko) : undefined,
          allowSet,
          leafPaths,
          topN,
          minScore
        );
        return { pair_id: it.pair_id, recs };
      })
    );

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
