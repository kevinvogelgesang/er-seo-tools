// app/api/parse/pillar-analysis-trigger.ts
// Fire-and-forget call to /api/pillar-analysis after a seo-parser session
// transitions to 'complete'. Failures are logged but never thrown.

export async function triggerPillarAnalysis(sessionId: string): Promise<void> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  try {
    const res = await fetch(`${baseUrl}/api/pillar-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error('[pillar-analysis] trigger non-2xx', res.status, text);
    }
  } catch (err) {
    console.error('[pillar-analysis] trigger error', err);
  }
}
