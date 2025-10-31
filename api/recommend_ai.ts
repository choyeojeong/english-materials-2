// api/recommend_ai.ts
export const config = {
  runtime: "edge",
};

type ReqItem = { pair_id: number; en: string; ko?: string };
type Rec = { path: string; reason?: string };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** 📚 화이트리스트(leaf 전용 경로들) */
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

const MIN_REC = 3;
const MAX_REC = 6;
const OPENAI_MODEL = "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 1000 * 12;
const RETRY_THRESHOLD = 2;

const SYS_PROMPT = `
너는 한국 중·고등 영어 교육과정 분류 보조 교사다.

목표:
- 입력된 EN/KO 문장을 보고 교육적으로 핵심적인 문법·구문 포인트를 **최소 3개, 최대 6개** 추천한다.
- 단, 정말 확신이 없으면 **빈 배열([])** 을 반환한다.

규칙:
- 추천 경로는 아래 '허용 경로(화이트리스트)' 내의 **리프 경로만** 사용한다.
- 경로 문자열은 **공백, 괄호, 기호까지 한 글자도 다르게 쓰지 말 것**.
- 경로 구분자는 항상 **" > "** (양쪽 한 칸 공백 포함)만 사용.
- **동일/유사 의미 중복을 피하고 다양하게** 제안한다.
- EN 문장 의미를 우선으로 판단하고, KO는 보조적으로만 사용.
- 출력은 오직 JSON(고정 스키마)로만.

허용 경로 목록:
${TAXONOMY.map((p) => `- ${p}`).join("\n")}
`.trim();

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

const allow = new Set(TAXONOMY);

function filterToAllowed(items: Rec[], max = MAX_REC): Rec[] {
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

function buildUserContent(en: string, ko?: string, pass: 1 | 2 = 1) {
  const lines = [
    `EN 우선으로 판단하고, KO는 보조적으로만 사용.`,
    `권장 개수: ${MIN_REC}~${MAX_REC}개.`,
    pass === 1
      ? `확신 없으면 빈 배열([]) 허용.`
      : `가능하면 빈 배열 대신, 가장 적절한 리프 경로들을 ${MIN_REC}~${MAX_REC}개 제시.`,
    `경로 구분자는 " > "를 사용하고, 화이트리스트에 **정확히 일치**해야 함.`,
    `중복/유사 포인트는 피하고 **다양성**을 확보할 것.`,
  ];
  const rows = [`영문: ${en}`, `한글: ${ko ? ko : "(없음)"}`].join("\n");

  const shot = FEW_SHOT.map((s) =>
    [
      `예시 문장: ${s.en}`,
      `예시 번역: ${s.ko}`,
      `예시 정답(JSON): ${JSON.stringify({
        items: s.paths.map((p) => ({ path: p, reason: "핵심 포인트" })),
      })}`,
    ].join("\n"),
  ).join("\n\n");

  return `${lines.join("\n")}\n\n${rows}\n\n${shot}`;
}

function safeParseArrayOrItems(jsonText: string): Rec[] {
  try {
    const obj: unknown = JSON.parse(jsonText);
    if (Array.isArray(obj) && obj.every(o => o && typeof o.path === "string")) return obj as Rec[];
    if (typeof obj === "object" && obj && Array.isArray((obj as any).items)) return (obj as any).items as Rec[];
  } catch {}
  const m =
    jsonText.match(/```json\s*([\s\S]*?)\s*```/) ??
    jsonText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (m) {
    try {
      const obj2: unknown = JSON.parse(m[1]);
      if (Array.isArray(obj2) && obj2.every(o => o && typeof (o as any).path === "string")) return obj2 as Rec[];
      if (typeof obj2 === "object" && obj2 && Array.isArray((obj2 as any).items)) return (obj2 as any).items as Rec[];
    } catch {}
  }
  return [];
}

async function callOpenAI(payload: Record<string, unknown>, timeoutMs = OPENAI_TIMEOUT_MS): Promise<any> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set on Vercel");

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    if (!r.ok) throw new Error(`OpenAI HTTP ${r.status}: ${await r.text()}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

function schemaDef() {
  return {
    type: "json_schema",
    json_schema: {
      name: "CategoryRecommendation",
      schema: {
        type: "object",
        properties: {
          items: {
            type: "array",
            maxItems: MAX_REC, // 빈 배열 허용
            items: {
              type: "object",
              required: ["path", "reason"],
              properties: {
                path: { type: "string", enum: TAXONOMY }, // 화이트리스트 강제
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
  } as const;
}

async function askOnce(en: string, ko: string | undefined, pass: 1 | 2, temperature: number): Promise<Rec[]> {
  const data = await callOpenAI({
    model: OPENAI_MODEL,
    temperature,
    max_tokens: 500,
    response_format: schemaDef(),
    messages: [
      { role: "system", content: SYS_PROMPT },
      { role: "user", content: buildUserContent(en, ko, pass) },
    ],
  });

  const text = data?.choices?.[0]?.message?.content ?? "";
  const arr = safeParseArrayOrItems(text);
  return filterToAllowed(arr);
}

function heuristic(en: string): Rec[] {
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

  const uniq = Array.from(new Set(picks)).filter(p => allow.has(p)).slice(0, MAX_REC);
  return uniq.map(p => ({ path: p, reason: "전형적 패턴(휴리스틱)" }));
}

async function recommendForSentence(en: string, ko?: string): Promise<Rec[]> {
  try {
    // 1차: 보수적 (빈 배열 허용)
    let recs = await askOnce(en, ko, 1, 0.7);

    // 2차: 너무 적으면 적극적으로 재요청
    if (recs.length <= RETRY_THRESHOLD) {
      const more = await askOnce(en, ko, 2, 0.9);
      recs = filterToAllowed([...recs, ...more]);
    }

    // 휴리스틱 보강
    if (recs.length < MIN_REC) {
      recs = filterToAllowed([...recs, ...heuristic(en)]);
    }
    return recs;
  } catch (e) {
    // OpenAI 실패 시에도 최소한의 결과 보장
    return heuristic(en);
  }
}

export default async function handler(req: Request) {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response("POST only", { status: 405, headers: corsHeaders });
  }
  try {
    const body = await req.json();
    const items: ReqItem[] = Array.isArray(body?.items) ? body.items : [];
    const results = await Promise.all(
      items.map(async (it) => ({
        pair_id: it.pair_id,
        recs: await recommendForSentence(it.en, it.ko),
      })),
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
