import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';

export const config = { runtime: 'edge' };

/**
 * Search DuckDuckGo HTML lite for web results.
 * Returns up to `limit` results as "title — snippet" strings.
 */
async function searchDuckDuckGo(query, limit = 5) {
    try {
        const params = new URLSearchParams({ q: query, kl: 'wt-wt' });
        const resp = await fetch(`https://html.duckduckgo.com/html/?${params}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html',
            },
            signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok) return [];
        const html = await resp.text();

        const results = [];
        const titleRegex = /<a[^>]*class="result__a"[^>]*>(.*?)<\/a>/gs;
        const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gs;

        const titles = [];
        const snippets = [];
        let match;
        while ((match = titleRegex.exec(html)) !== null) {
            titles.push(match[1].replace(/<[^>]*>/g, '').trim());
        }
        while ((match = snippetRegex.exec(html)) !== null) {
            snippets.push(match[1].replace(/<[^>]*>/g, '').trim());
        }

        for (let i = 0; i < Math.min(titles.length, limit); i++) {
            const snippet = snippets[i] ? ` — ${snippets[i]}` : '';
            results.push(`${titles[i]}${snippet}`);
        }
        return results;
    } catch (err) {
        console.error('[chat] DuckDuckGo search error:', err);
        return [];
    }
}

export default async function handler(req) {
    if (isDisallowedOrigin(req))
        return new Response('Forbidden', { status: 403 });

    const cors = getCorsHeaders(req);
    if (req.method === 'OPTIONS')
        return new Response(null, { status: 204, headers: cors });

    if (req.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
            status: 405,
            headers: { ...cors, 'Content-Type': 'application/json' },
        });
    }

    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2025-12-01-preview';
    const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-5.2-chat';

    if (!endpoint || !apiKey) {
        return new Response(JSON.stringify({ error: 'Azure OpenAI not configured' }), {
            status: 500,
            headers: { ...cors, 'Content-Type': 'application/json' },
        });
    }

    let body;
    try {
        body = await req.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
            status: 400,
            headers: { ...cors, 'Content-Type': 'application/json' },
        });
    }

    const { messages, context } = body;
    if (!messages || !Array.isArray(messages)) {
        return new Response(JSON.stringify({ error: 'messages array is required' }), {
            status: 400,
            headers: { ...cors, 'Content-Type': 'application/json' },
        });
    }

    // Get the user's latest message for web search
    const latestUserMsg = [...messages].reverse().find((m) => m.role === 'user')?.text || '';

    // Search DuckDuckGo for latest web news (5s timeout)
    let webResults = [];
    if (latestUserMsg.length > 3) {
        webResults = await searchDuckDuckGo(`${latestUserMsg} latest news war conflict`);
    }

    const webSection = webResults.length > 0
        ? `\n\nWEB SEARCH RESULTS (from DuckDuckGo):\n${webResults.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
        : '';

    const systemPrompt = `You are GeoSentinel Assistant, an AI for a real-time global intelligence dashboard.
You ONLY answer questions about:
- Wars, armed conflicts, military operations
- Geopolitical tensions, sanctions, diplomacy related to conflicts
- News about ongoing wars and conflict zones
- Data visible on the dashboard (conflict zones, military flights, protests, etc.)

RULES:
- If a question is unrelated to wars, conflicts, or geopolitical news, politely decline.
- Keep answers concise but informative (3-6 sentences).
- The CONTEXT below contains LIVE dashboard data AND web search results. USE BOTH to give specific, detailed, up-to-date answers.
- If matched news items are provided, reference them directly in your answer.
- Do NOT say "the dashboard doesn't show this" — check the web search results too.
- If there truly is no relevant data anywhere, say so honestly.

FORMATTING:
- Use relevant emojis to make responses visually engaging (e.g. ⚔️ for war, 🚀 for missiles, 📰 for news, 🌍 for regions, ⚠️ for alerts, 🛡️ for defense, 💥 for strikes, 🏴 for groups).
- Use **bold** for key terms, country names, and important details.
- Use bullet points (- ) for listing multiple items.
- Add blank lines between sections for readability.
- Structure longer answers with clear sections.

LIVE CONTEXT (from dashboard):
${context || 'No live context available.'}${webSection}`;

    const apiMessages = [
        { role: 'system', content: systemPrompt },
        // Send only the last 6 conversation turns to keep context small
        ...messages.slice(-6).map((m) => ({
            role: m.role === 'bot' ? 'assistant' : 'user',
            content: m.text,
        })),
    ];

    const url = `${endpoint.replace(/\/$/, '')}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;

    let aiResp;
    try {
        aiResp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'api-key': apiKey,
            },
            body: JSON.stringify({
                messages: apiMessages,
                max_completion_tokens: 500,
            }),
            signal: AbortSignal.timeout(30000),
        });
    } catch (err) {
        console.error('[chat] Azure OpenAI fetch error:', err);
        return new Response(JSON.stringify({ error: 'Failed to reach Azure OpenAI' }), {
            status: 502,
            headers: { ...cors, 'Content-Type': 'application/json' },
        });
    }

    if (!aiResp.ok) {
        const errText = await aiResp.text().catch(() => 'unknown');
        console.error('[chat] Azure OpenAI error:', aiResp.status, errText);
        return new Response(JSON.stringify({ error: 'Azure OpenAI returned an error' }), {
            status: 502,
            headers: { ...cors, 'Content-Type': 'application/json' },
        });
    }

    const data = await aiResp.json();
    const reply = data.choices?.[0]?.message?.content || "I couldn't generate a response.";

    return new Response(JSON.stringify({ reply }), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
}
