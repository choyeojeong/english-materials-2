export async function fetchRecommendations(pairs) {
  const res = await fetch('/api/recommend_ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: pairs }),
  });
  if (!res.ok) throw new Error(`[recommend_ai] HTTP ${res.status}`);
  const json = await res.json();
  return json.results; // [{ pair_id, recs: [{path,reason}...] }, ...]
}
