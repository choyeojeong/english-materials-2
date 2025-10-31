// /api/learn.ts
export const config = { runtime: "edge" };

type LearnItem = {
  material_id?: string | null;
  pair_id: number;
  en: string;
  ko?: string | null;
  paths: string[];      // 리프 경로 문자열들
  teacher_name?: string | null;
};

type EmbeddingResponse = {
  data: Array<{ embedding: number[] }>;
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EMB_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function buildHeaders(base?: HeadersInit): Headers {
  const h = new Headers(base ?? {});
  h.set("Content-Type", "application/json");
  if (SUPABASE_ANON) {
    h.set("apikey", SUPABASE_ANON);
    h.set("Authorization", `Bearer ${SUPABASE_ANON}`);
  }
  return h;
}

async function embed(text: string): Promise<number[]> {
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not set");
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMB_MODEL, input: text }),
  });
  if (!r.ok) throw new Error(`OpenAI Embeddings HTTP ${r.status}: ${await r.text()}`);
  const j = (await r.json()) as EmbeddingResponse;
  const vec = j?.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error("Invalid embedding response");
  return vec;
}

async function supa(path: string, init: RequestInit = {}): Promise<Response> {
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    throw new Error("Supabase env not set (VITE/NEXT_PUBLIC URL & ANON KEY)");
  }
  const headers = buildHeaders(init.headers as HeadersInit | undefined);
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")
    return new Response("POST only", { status: 405, headers: corsHeaders });

  try {
    const body = (await req.json()) as { items?: LearnItem[] };
    const items: LearnItem[] = Array.isArray(body?.items) ? body!.items! : [];
    if (items.length === 0) {
      return new Response(JSON.stringify({ ok: true, inserted: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let count = 0;

    for (const it of items) {
      const en = (it.en || "").trim();
      const paths = Array.isArray(it.paths) ? it.paths.filter(Boolean) : [];
      if (!en || paths.length === 0) continue;

      // 1) ai_feedback insert
      {
        const r = await supa("ai_feedback", {
          method: "POST",
          body: JSON.stringify([
            {
              material_id: it.material_id ?? null,
              pair_id: it.pair_id,
              en,
              ko: it.ko ?? null,
              paths,
              teacher_name: it.teacher_name ?? null,
            },
          ]),
        });
        if (!r.ok) throw new Error(`ai_feedback insert ${r.status}: ${await r.text()}`);
      }

      // 2) 임베딩 생성(EN+KO 합쳐서 컨텍스트 풍부화)
      const embText = it.ko ? `${en}\n${it.ko}` : en;
      const vec = await embed(embText);

      // 3) ai_feedback_embeddings upsert (PostgREST는 vector에 number[] JSON 허용)
      {
        const r = await supa("ai_feedback_embeddings", {
          method: "POST",
          body: JSON.stringify([
            {
              pair_id: it.pair_id,
              model: EMB_MODEL,
              embedding: vec,
            },
          ]),
        });
        if (!r.ok)
          throw new Error(
            `ai_feedback_embeddings upsert ${r.status}: ${await r.text()}`
          );
      }

      // 4) 경로 통계 갱신(RPC)
      {
        if (!SUPABASE_URL || !SUPABASE_ANON) {
          throw new Error("Supabase env not set");
        }
        const rpcHeaders = buildHeaders();
        const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/ai_path_stats_upsert`, {
          method: "POST",
          headers: rpcHeaders,
          body: JSON.stringify({ p_paths: paths }),
        });
        if (!r.ok)
          throw new Error(`ai_path_stats_upsert ${r.status}: ${await r.text()}`);
      }

      count++;
    }

    return new Response(JSON.stringify({ ok: true, inserted: count }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
