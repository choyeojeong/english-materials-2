import { serve } from "std/http/server";

/** 입력/출력 타입 */
type ReqItem = { pair_id: number; en: string; ko?: string };
type Rec = { path: string; reason?: string };

/** ✅ 공통 CORS */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** 📚 화이트리스트(leaf 전용 경로들) — 사용자가 지정한 목록으로 제한 */
const TAXONOMY: string[] = [
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

/** 🔧 파라미터 */
const MIN_REC = 3;
const MAX_REC = 6;
// ⚠️ Edge Functions 기본 타임아웃(10초) 고려 → 8초로 제한
const OPENAI_TIMEOUT_MS = 8_000;
const OPENAI_MODEL = "gpt-4o-mini";

/** 🧠 시스템 프롬프트(강화) */
const SYS_PROMPT = `
너는 한국 중·고등 영어 교육과정 분류 보조 교사다.
반드시 아래 '허용 경로(화이트리스트)'에 포함된 경로만 추천한다. 존재하지 않는 경로는 절대 만들지 말 것.
각 입력(영문/번역)을 보고 교육적으로 핵심적인 문법·구문 포인트를 **최소 3개, 최대 6개** 선택한다.
각 항목은 {"path":"허용경로 그대로","reason":"간단 근거(한국어)"} 형식이며, **반드시 고정된 JSON 스키마**로만 출력한다.

중요 규칙:
- 'path'는 아래 목록의 문자열을 **한 글자도 다르지 않게 그대로** 사용한다(공백/괄호/하이픈 포함).
- 목록에 없는 표현(유사어/축약/영문 표기) 금지.
- 동일 의미라도 문자열이 다르면 잘못된 것으로 간주한다.
- 가능한 한 문장 내 핵심 포인트끼리 **중복되지 않도록** 다양하게 선택한다.

유효한 경로 목록(정확히 동일 문자열만 유효):
${TAXONOMY.map((p) => `- ${p}`).join("\n")}
`.trim();

/** 🎯 few-shot */
const FEW_SHOT: Array<{ en: string; ko: string; paths: string[] }> = [
  {
    en: "I wish I could fly.",
    ko: "나는 날 수 있으면 좋겠다.",
    paths: [
      "특수 구문 > 가정법 구문 > I wish 가정법",
      "문장의 형식 > 3형식",
      "절(Clause) > 명사절 > that절",
    ],
  },
  {
    en: "To live a happy life, you need to be grateful.",
    ko: "행복하게 살기 위해서는 감사할 줄 알아야 한다.",
    paths: [
      "구(Phrase) > to부정사구 > 부사적 용법",
      "문장의 형식 > 1형식",
      "품사 > 형용사 > 비교급",
    ],
  },
];

/** ---------- 타입 가드 & 유틸 ---------- */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function isRec(v: unknown): v is Rec {
  return isRecord(v) && typeof v.path === "string" && (v.reason === undefined || typeof v.reason === "string");
}
function isRecArray(v: unknown): v is Rec[] {
  return Array.isArray(v) && v.every(isRec);
}
function hasItemsArray(v: unknown): v is { items: Rec[] } {
  return isRecord(v) && Array.isArray((v as any).items) && (v as any).items.every(isRec);
}

/** OpenAI 최소 응답 타입 */
interface ChatMessage { content?: string }
interface ChatChoice { message?: ChatMessage }
interface ChatCompletion { choices?: ChatChoice[] }

/** 🧹 화이트리스트/중복/길이 필터 */
function filterToAllowed(items: Rec[], _min = MIN_REC, max = MAX_REC): Rec[] {
  const allow = new Set(TAXONOMY);
  const out: Rec[] = [];
  for (const it of items ?? []) {
    const path = String(it?.path ?? "").replace(/\s+/g, " ").trim();
    if (!path) continue;
    if (allow.has(path) && !out.find((x) => x.path === path)) {
      out.push({ path, reason: (it?.reason ?? "").toString().slice(0, 160) });
    }
    if (out.length >= max) break;
  }
  return out;
}

/** 👤 유저 메시지 구성 */
function buildUserContent(en: string, ko?: string) {
  const lines = [
    `영문: ${en}`,
    `한글: ${ko ? ko : "(없음)"}`,
    `요구사항:`,
    `- 추천 개수는 ${MIN_REC}~${MAX_REC}개.`,
    `- 경로는 반드시 '허용 경로' 중에서만 선택.`,
    `- 동일/유사 포인트 중복 추천 금지.`,
  ];
  const shot = FEW_SHOT.map((s) =>
    [
      `예시 문장: ${s.en}`,
      `예시 번역: ${s.ko}`,
      `예시 정답: ${JSON.stringify({ items: s.paths.map((p) => ({ path: p, reason: "핵심 포인트" })) })}`,
    ].join("\n"),
  ).join("\n\n");
  return lines.join("\n") + "\n\n" + shot;
}

/** 🧩 JSON 파서(코드블록/문장 중 포함 케이스까지 긁어오기) */
function safeParseArrayOrItems(jsonText: string): Rec[] {
  try {
    const obj: unknown = JSON.parse(jsonText);
    if (isRecArray(obj)) return obj;
    if (hasItemsArray(obj)) return (obj as { items: Rec[] }).items;
  } catch {/* ignore */}
  const m =
    jsonText.match(/```json\s*([\s\S]*?)\s*```/) ??
    jsonText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (m) {
    try {
      const obj2: unknown = JSON.parse(m[1]);
      if (isRecArray(obj2)) return obj2;
      if (hasItemsArray(obj2)) return (obj2 as { items: Rec[] }).items;
    } catch {/* ignore */}
  }
  return [];
}

/** ⏱️ OpenAI 호출 with timeout + 상세 오류 */
async function callOpenAI(payload: Record<string, unknown>, timeoutMs = OPENAI_TIMEOUT_MS): Promise<unknown> {
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`OpenAI HTTP ${r.status}: ${body}`);
    }
    const json: unknown = await r.json();
    return json;
  } finally {
    clearTimeout(t);
  }
}

/** 🧪 OpenAI 질의: 1회 시도(스키마) → 실패 시 휴리스틱 */
async function askOpenAI(en: string, ko?: string): Promise<Rec[]> {
  try {
    const data = await callOpenAI({
      model: OPENAI_MODEL,
      temperature: 0.2,
      max_tokens: 300, // 빠른 응답 유도
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "CategoryRecommendation",
          schema: {
            type: "object",
            properties: {
              items: {
                type: "array",
                minItems: MIN_REC,
                maxItems: MAX_REC,
                items: {
                  type: "object",
                  required: ["path", "reason"],
                  properties: {
                    path: { type: "string", enum: TAXONOMY },
                    reason: { type: "string", minLength: 2, maxLength: 160 },
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
      },
      messages: [
        { role: "system", content: SYS_PROMPT },
        { role: "user", content: buildUserContent(en, ko) },
      ],
    }, 8_000); // 시도당 8초
    const cc = data as ChatCompletion;
    const text = cc.choices?.[0]?.message?.content ?? "";
    const arr = safeParseArrayOrItems(text);
    const filtered = filterToAllowed(arr);
    if (filtered.length >= MIN_REC) return filtered;
  } catch (e) {
    console.error("[recommend_ai] OpenAI call failed:", e instanceof Error ? e.message : String(e));
  }

  // 🔦 휴리스틱 폴백(화이트리스트만)
  const heuristics: string[] = [];
  const s = en.toLowerCase();
  if (s.includes("i wish")) heuristics.push("특수 구문 > 가정법 구문 > I wish 가정법");
  if (/\b(if|unless|provided|as long as)\b/.test(s)) heuristics.push("절(Clause) > 부사절 > 조건의 부사절");
  if (/\bthat\b/.test(s)) heuristics.push("절(Clause) > 명사절 > that절");
  if (/\bto\s+\w+/.test(s)) heuristics.push("구(Phrase) > to부정사구 > 부사적 용법");
  if (/\b(who|which|that)\b/.test(s)) heuristics.push("절(Clause) > 형용사절 > 관계대명사절");
  if (/\b(more|most|less|least|than|as\b.*\bas)\b/.test(s)) heuristics.push("특수 구문 > 비교급 구문");

  const uniq = Array.from(new Set(heuristics)).filter((p) => TAXONOMY.includes(p)).slice(0, MAX_REC);
  if (uniq.length >= MIN_REC) return uniq.map((p) => ({ path: p, reason: "전형적 패턴(휴리스틱)" }));
  return uniq.map((p) => ({ path: p, reason: "전형적 패턴(휴리스틱)" }));
}

/** ▶️ HTTP 핸들러 */
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("POST only", { status: 405, headers: corsHeaders });
  }

  try {
    const parsed = (await req.json()) as unknown;
    const items = (isRecord(parsed) && Array.isArray((parsed as any).items) ? (parsed as any).items : []) as ReqItem[];

    if (!Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: { pair_id: number; recs: Rec[] }[] = [];
    for (const it of items) {
      const recs = await askOpenAI(it.en, it.ko);
      results.push({ pair_id: it.pair_id, recs });
    }

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[recommend_ai] handler error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
