// /api/recommend_ai.ts
export const config = { runtime: "edge" };

/** ====== 타입 ====== */
type ReqItem = { pair_id: number | string; en: string; ko?: string };
type Rec = { path: string; reason?: string; score?: number };

/** ====== CORS ====== */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** ====== 정적 fallback (동적 leafPaths가 없을 때만 사용) ====== */
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

/** ====== 튜닝 파라미터 ====== */
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 1000 * 20;
const MAX_TOKENS = 900;

const MIN_WORDS = 4;
const MIN_DEPTH = 2;
const DEFAULT_MIN_REC = 3;
const DEFAULT_MAX_REC = 6;
const DEFAULT_MIN_SCORE = 0.0;

/** 앙상블 샘플 파라미터 */
const ENSEMBLE_SAMPLES = 3;
const ENSEMBLE_TEMPS = [0.2, 0.4, 0.7];

/** ====== 프롬프트 ====== */
const SYS_PROMPT = `
너는 한국 중·고등 영어 교육과정 분류를 위한 문장 분석 보조 교사다.
- 가능한 경우 '리프(leaf)' 경로만 선택(중간 노드 단독 추천 금지)
- 결과는 JSON으로만 반환하고, 각 추천에 reason(간단 근거)과 score(0~1 확신도)를 포함
- 규칙: 경로 구분자는 " > " (양쪽 공백 포함), 화이트리스트에 **정확히 일치**하는 경로만
- 불확실하면 빈 배열 허용(단, 후속 검증 단계에서 보완될 수 있음)
`.trim();

/** few-shot */
const FEW_SHOT: Array<{ en: string; ko: string; items: Rec[] }> = [
  {
    en: "I wish I could fly.",
    ko: "나는 날 수 있으면 좋겠다.",
    items: [
      { path: "특수 구문 > 가정법 구문 > I wish 가정법", reason: "I wish + 과거형", score: 0.9 },
      { path: "문장의 형식 > 3형식", reason: "wish의 3형식 문형", score: 0.6 },
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
function uniqBy<T>(arr: T[], key: (v: T) => string) {
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

/** JSON schema (leaf enum 강제) */
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
                path: { type: "string", enum: leafList },
                reason: { type: "string", minLength: 2, maxLength: 220 },
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

/** 안전 파서 */
function safeParseItems(jsonText: string): Rec[] {
  try {
    const obj = JSON.parse(jsonText as string);
    if (obj && Array.isArray((obj as any).items)) return (obj as any).items as Rec[];
  } catch {}
  const m =
    jsonText.match(/```json\s*([\s\S]*?)\s*```/) ??
    jsonText.match(/(\{[\s\S]*\})/);
  if (m) {
    try {
      const obj2 = JSON.parse(m[1]);
      if (obj2 && Array.isArray((obj2 as any).items)) return (obj2 as any).items as Rec[];
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

  const uniqAllowed = uniqBy(
    picks.filter(p => allow.has(p)),
    (p) => p
  ).slice(0, DEFAULT_MAX_REC);

  return uniqAllowed.map((p) => ({ path: p, reason: "전형적 패턴(휴리스틱)", score: 0.55 }));
}

/** 1회 질의(샘플) */
async function askOnce(opts: {
  en: string; ko?: string;
  temperature: number; leafList: string[]; topN: number;
  minScore: number;
}): Promise<Rec[]> {
  const { en, ko, temperature, leafList, topN, minScore } = opts;

  const hints = [
    `EN을 우선으로 판단하고 KO는 보조적으로만 사용.`,
    `권장 개수: ${DEFAULT_MIN_REC}~${topN}개.`,
    `경로 구분자는 " > " (양쪽 공백).`,
    `화이트리스트(leaf)에 **정확히 일치**하는 경로만.`,
    `중복/유사 포인트는 피하고 다양성을 확보.`,
    `score는 0~1 실수로 추정치라도 반드시 포함.`,
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
    response_format: { type: "json_schema", json_schema: schemaDef(leafList).json_schema },
    messages: [
      { role: "system", content: SYS_PROMPT },
      { role: "user", content: userContent },
    ],
  });

  const raw = data?.choices?.[0]?.message?.content ?? "";
  const arr = safeParseItems(raw);
  const mapped = (Array.isArray(arr) ? arr : []).map((r) => ({
    path: normalizeSpace((r as Rec)?.path || ""),
    reason: ((r as Rec)?.reason || "").toString().slice(0, 220),
    score: typeof (r as Rec)?.score === "number" ? (r as Rec).score : 0.66,
  }));

  // 1차 필터: 형식/깊이/스코어
  return mapped.filter(r =>
    r.path &&
    depthOfPath(r.path) >= MIN_DEPTH &&
    (typeof r.score === "number" ? r.score >= minScore : true)
  ).slice(0, topN);
}

/** Verifier 패스: 후보를 검증/정제 */
async function verifyAndRefine(
  en: string,
  ko: string | undefined,
  leafList: string[],
  candidates: Rec[],
  topN: number,
  minScore: number
): Promise<Rec[]> {
  const verifierSys = `너는 문장 분류 결과를 검증하는 교사다. 주어진 후보들에서 규칙 위반(리프가 아님, 중복, 논리 불충분)을 제거하고 최적의 상위 ${topN}개를 JSON으로만 반환하라.`;
  const verifierUser = `
[문장]
EN: ${en}
KO: ${ko || "(없음)"}

[허용 리프 목록]
${leafList.slice(0, 400).map(p => `- ${p}`).join("\n")}

[후보 목록(JSON)]
${JSON.stringify({ items: candidates }, null, 2)}

[규칙]
- 허용 목록에 없는 경로 제거
- 중간 노드 단독 제거(리프만)
- 중복 제거
- reason이 빈약한 항목은 낮은 점수
- score는 0~1 사이로 보정
- minScore=${minScore} 미만은 제외
- 상위 ${topN}개만 남김

[출력 형식] { "items": [ { "path": string, "reason": string, "score": number } ] }
  `.trim();

  const data = await callOpenAI({
    model: OPENAI_MODEL,
    temperature: 0.2,
    max_tokens: 500,
    response_format: { type: "json_schema", json_schema: schemaDef(leafList).json_schema },
    messages: [
      { role: "system", content: verifierSys },
      { role: "user", content: verifierUser },
    ],
  });

  const raw = data?.choices?.[0]?.message?.content ?? "";
  const arr = safeParseItems(raw);
  const mapped = (Array.isArray(arr) ? arr : []).map((r) => ({
    path: normalizeSpace((r as Rec)?.path || ""),
    reason: ((r as Rec)?.reason || "").toString().slice(0, 220),
    score: typeof (r as Rec)?.score === "number" ? (r as Rec).score : 0.66,
  }));

  return mapped.filter(r =>
    r.path &&
    depthOfPath(r.path) >= MIN_DEPTH &&
    (typeof r.score === "number" ? r.score >= minScore : true)
  ).slice(0, topN);
}

/** 앙상블 집계 */
function aggregateEnsemble(
  buckets: Rec[][],
  allowSet: Set<string>,
  topN: number,
  minScore: number
): Rec[] {
  type Acc = { path: string; reasons: string[]; votes: number; scoreSum: number };
  const acc: Record<string, Acc> = {};
  for (const sample of buckets) {
    for (const r of sample) {
      const key = r.path;
      if (!allowSet.has(key)) continue;
      const slot = acc[key] || { path: key, reasons: [], votes: 0, scoreSum: 0 };
      slot.votes += 1;
      slot.scoreSum += r.score ?? 0.66;
      if (r.reason) slot.reasons.push(r.reason);
      acc[key] = slot;
    }
  }
  const merged = Object.values(acc).map(a => {
    const avg = a.scoreSum / Math.max(1, a.votes);
    const calibrated = Math.min(1, avg + Math.min(0.25, (a.votes - 1) * 0.12));
    return {
      path: a.path,
      reason: uniqBy(a.reasons, (x) => x).join(" / ").slice(0, 220),
      score: calibrated,
      votes: a.votes,
    } as Rec & { votes: number };
  });

  return merged
    .filter(r => (r.score ?? 0) >= minScore)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, topN)
    .map(({ votes, ...rest }) => rest);
}

/** 메인 추천 로직 */
async function recommendForSentence(
  en: string,
  ko: string | undefined,
  leafList: string[],
  quality: "high" | "fast",
  topN: number,
  minScore: number
): Promise<Rec[]> {
  const allowSet = new Set(leafList);
  const enNorm = normalizeSpace(en);
  const koNorm = ko ? normalizeSpace(ko) : undefined;

  const tooShort = enNorm.split(/\s+/).length < MIN_WORDS;
  const baseEN = tooShort && koNorm ? `${enNorm}. ${koNorm}` : enNorm;

  try {
    if (quality === "high") {
      // 1) 앙상블
      const buckets: Rec[][] = [];
      for (let i = 0; i < ENSEMBLE_SAMPLES; i++) {
        const temp = ENSEMBLE_TEMPS[Math.min(i, ENSEMBLE_TEMPS.length - 1)];
        const out = await askOnce({
          en: baseEN, ko: koNorm, temperature: temp, leafList, topN, minScore,
        });
        buckets.push(out);
      }
      // 2) 집계
      let combined = aggregateEnsemble(buckets, allowSet, topN * 2, Math.min(0, minScore - 0.05));
      // 3) 검증
      combined = await verifyAndRefine(enNorm, koNorm, leafList, combined, topN, minScore);
      // 4) 부족하면 휴리스틱 보강
      if (combined.length < DEFAULT_MIN_REC) {
        const h = heuristic(enNorm, allowSet);
        combined = uniqBy([...combined, ...h], (r) => r.path).slice(0, topN);
      }
      return combined;
    } else {
      // 빠른 경로
      let recs = await askOnce({
        en: baseEN, ko: koNorm, temperature: 0.3, leafList, topN, minScore,
      });
      if (recs.length < DEFAULT_MIN_REC) {
        const more = await askOnce({
          en: baseEN, ko: koNorm, temperature: 0.6, leafList, topN, minScore,
        });
        recs = uniqBy([...recs, ...more], (r) => r.path).slice(0, topN);
      }
      if (recs.length < DEFAULT_MIN_REC) {
        recs = uniqBy([...recs, ...heuristic(enNorm, allowSet)], (r) => r.path).slice(0, topN);
      }
      return recs;
    }
  } catch {
    return heuristic(enNorm, new Set(leafList)).slice(0, topN);
  }
}

/** ====== 안전 파싱 유틸 ====== */
function isNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function readNumberOr<T extends number>(v: unknown, fallback: T): number {
  return isNumber(v) ? v : fallback;
}
function readStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.map(x => normalizeSpace(String(x))).filter(Boolean);
  return out.length ? out : null;
}
function readItems(v: unknown): ReqItem[] {
  if (!Array.isArray(v)) return [];
  const out: ReqItem[] = [];
  for (const it of v) {
    const en = it?.en;
    const pid = it?.pair_id;
    if (typeof en === "string" && (typeof pid === "string" || typeof pid === "number")) {
      out.push({ pair_id: pid, en, ko: typeof it?.ko === "string" ? it.ko : undefined });
    }
  }
  return out;
}

/** ====== 핸들러 ====== */
export default async function handler(req: Request) {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: corsHeaders });

  try {
    const body = (await req.json()) as unknown;

    const items = readItems((body as any)?.items);
    if (!items.length) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const leafPaths =
      readStringArray((body as any)?.leafPaths) ?? TAXONOMY_FALLBACK;

    const topNRaw = readNumberOr((body as any)?.topN, DEFAULT_MAX_REC);
    const topN = Math.min(Math.max(1, Math.floor(topNRaw)), DEFAULT_MAX_REC);

    const minScoreRaw = readNumberOr((body as any)?.minScore, DEFAULT_MIN_SCORE);
    const minScore = Math.max(0, Math.min(1, minScoreRaw));

    const q = (body as any)?.quality;
    const quality: "high" | "fast" = q === "high" ? "high" : "fast";

    const results = await Promise.all(
      items.map(async (it) => ({
        pair_id: it.pair_id,
        recs: await recommendForSentence(
          String(it.en || ""),
          it.ko ? String(it.ko) : undefined,
          leafPaths,
          quality,
          topN,
          minScore
        ),
      }))
    );

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
