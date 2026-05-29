const DEFAULT_MODEL = 'demo';
const DEFAULT_PROVIDER = 'mock';
const DEFAULT_FORGE_SYSTEM_PROMPT = `You are FORGE, a ruthless founder decision engine.
Return exactly one JSON object and nothing else. Do not use markdown, bullets, code fences, or extra commentary.
Use this schema:
{
  "score": number,
  "verdict": string,
  "strengths": [string, string],
  "weaknesses": [string, string, string],
  "moves": [string, string, string]
}
Rules:
- Score must be an integer from 0 to 100.
- Make the verdict blunt, specific, and grounded in the idea's customer pain, payment story, and evidence gap.
- Name the first customer, what they are buying, and what evidence is missing.
- If the idea is weak, say it plainly and do not soften the language.
- Strengths should be the two strongest parts of the idea, not generic praise.
- Weaknesses should be the three biggest blockers, tied to the exact idea.
- Moves should be three concrete experiments or customer conversations that test the idea and reduce risk.
- Each string must be a short plain-English sentence with no markdown, bullets, links, or citations.
- Do not invent facts that are not implied by the idea unless you clearly label them as assumptions.`;
const DEFAULT_TRUSTED_DOMAINS = [
  'google.com',
  'news.google.com',
  'producthunt.com',
  'crunchbase.com',
  'linkedin.com',
  'statista.com',
  'microsoft.com',
  'ycombinator.com',
  'techcrunch.com',
  'patents.google.com',
];

function parseTrustedDomains(rawValue) {
  const values = (rawValue || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return values.length ? values : DEFAULT_TRUSTED_DOMAINS;
}

const TRUSTED_DOMAINS = parseTrustedDomains(process.env.FORGE_TRUSTED_DOMAINS);

function extractText(data) {
  return data?.choices?.[0]?.message?.content || data?.choices?.[0]?.delta?.content || data?.choices?.[0]?.message?.reasoning || '';
}

function cleanStructuredText(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/^\s*[-*•]\s*/, '')
    .replace(/^\s*\d+[.)\-]\s*/, '')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStringArray(value, fallback = [], maxItems = Infinity) {
  if (!Array.isArray(value)) {
    return fallback.slice(0, maxItems);
  }

  const cleaned = value
    .map((item) => cleanStructuredText(typeof item === 'string' ? item : ''))
    .filter(Boolean);

  return (cleaned.length ? cleaned : fallback.slice()).slice(0, maxItems);
}

function normalizeStructuredResult(result) {
  const score = typeof result?.score === 'number'
    ? Math.max(0, Math.min(100, Math.round(result.score)))
    : 45;

  const fallbackVerdict = 'The idea is not defensible yet without a sharper customer pain, a real payment story, and evidence that people will buy.';

  return {
    score,
    verdict: cleanStructuredText(result?.verdict) || fallbackVerdict,
    strengths: normalizeStringArray(result?.strengths, ['The idea is specific enough to test quickly.'], 2),
    weaknesses: normalizeStringArray(result?.weaknesses, ['The first customer, proof path, and monetization story still need to be pinned down.'], 3),
    moves: normalizeStringArray(result?.moves, ['Interview 5 buyers who match the target customer.', 'Define the exact offer and what they would pay for.', 'Run one real-world experiment before adding any more features.'], 3),
  };
}

function buildFallbackResponse(payload = {}, note = '') {
  const userText = typeof payload.user === 'string' ? payload.user.toLowerCase() : '';
  const hasProblem = /problem|pain|friction|fatigue|manual|cost|time|waste|inefficient|boring|painful/i.test(userText);
  const hasCustomer = /customer|buyer|founder|user|operator|team|pm|ceo|sales|marketing|ops|finance|revenue/i.test(userText);
  const hasMarket = /market|b2b|b2c|saas|industry|pricing|growth|channel|competitor|startup|segment/i.test(userText);
  const hasProof = /proof|validate|survey|interview|pilot|beta|mvp|waitlist|trial|data|metric|experiment/i.test(userText);

  let score = 44;
  if (hasProblem) score += 12;
  if (hasCustomer) score += 10;
  if (hasMarket) score += 8;
  if (hasProof) score += 6;
  if (!hasCustomer) score -= 8;
  if (!hasMarket) score -= 10;
  if (!hasProof) score -= 12;
  score = Math.max(16, Math.min(84, score));

  const verdict = score >= 70
    ? 'This is a real founder bet, but the proof stack still has to be earned.'
    : score >= 50
      ? 'There is a believable concept here, but the customer and evidence gaps are still too large to ignore.'
      : 'This is not defensible yet. The idea is still too vague on customer pain, market proof, or how it gets paid.';

  const strengths = [
    hasProblem ? 'The core pain is named and plausible.' : 'The pain point is not yet specific enough to anchor the idea.',
    hasMarket ? 'There is at least some market context in the prompt.' : 'The market context is still thin and needs sharper validation.',
  ];

  const weaknesses = [
    !hasCustomer ? 'The first customer is not pinned down strongly enough.' : 'The first customer exists in the prompt, but the buying motion still needs to be made explicit.',
    !hasProof ? 'There is no evidence path yet for customer demand or willingness to pay.' : 'The proof plan is hinted at, but it still needs a concrete experiment.',
    'There is no substitute for talking to real buyers before committing to build.',
  ];

  const moves = [
    'Interview 5 buyers who match the target customer profile.',
    'Write the offer in one sentence and test whether they would pay for it.',
    'Run one low-cost experiment to prove demand before expanding the scope.',
  ];

  if (note) {
    moves.push(note);
  }

  return normalizeStructuredResult({ score, verdict, strengths, weaknesses, moves });
}

function extractStructuredSectionsFromText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const scoreMatch = text.match(/score[:\s-]*([0-9]{1,3})\s*%?/i);
  const detectedScore = scoreMatch ? Number(scoreMatch[1]) : 45;
  const verdict = lines.find((line) => /^verdict[:\-\s]/i.test(line))?.replace(/^verdict[:\-\s]*/i, '').trim() ||
    lines.find((line) => /not defensible|too vague|too thin|real founder|credible concept|not yet|weak|strong|believable/i.test(line)) ||
    'The idea is not defensible without sharper customer pain and proof.';

  const strengths = lines
    .filter((line) => /strong|good|clear|specific|credible|valuable|useful|distinct|real/i.test(line))
    .slice(0, 3);

  const weaknesses = lines
    .filter((line) => /weak|missing|unclear|vague|not enough|no proof|no customer|no market|hard|crowded|unclear/i.test(line))
    .slice(0, 3);

  const moves = lines
    .filter((line) => /interview|test|pilot|survey|validate|talk|experiment|beta|ship|measure|price|buyer/i.test(line))
    .slice(0, 3);

  return normalizeStructuredResult({
    score: detectedScore,
    verdict,
    strengths: strengths.length ? strengths : ['The idea has a concrete enough angle to test quickly.'],
    weaknesses: weaknesses.length ? weaknesses : ['The first customer, proof path, and monetization story still need to be pinned down.'],
    moves: moves.length ? moves : ['Interview 5 buyers who match the target customer profile.', 'Write the offer in one sentence and test whether they would pay for it.', 'Run one low-cost experiment before building more.'],
  });
}

function unwrapStructuredPayload(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const candidate = fenced ? fenced[1].trim() : trimmed;

    try {
      return unwrapStructuredPayload(JSON.parse(candidate));
    } catch {
      return candidate;
    }
  }

  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') {
      return unwrapStructuredPayload(value.text);
    }

    if (typeof value.content === 'string') {
      return unwrapStructuredPayload(value.content);
    }

    if (value.parsed && typeof value.parsed === 'object') {
      return value.parsed;
    }

    return value;
  }

  return value;
}

function parseStructuredResponse(rawText, payload = {}) {
  const unwrapped = unwrapStructuredPayload(rawText);

  if (typeof unwrapped === 'string') {
    const trimmed = unwrapped.trim();

    if (!trimmed) {
      return buildFallbackResponse(payload, 'Provider returned no usable content.');
    }

    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') {
        return normalizeStructuredResult(parsed);
      }
      return buildFallbackResponse(payload, 'Provider returned non-object JSON.');
    } catch {
      return extractStructuredSectionsFromText(trimmed);
    }
  }

  if (unwrapped && typeof unwrapped === 'object') {
    return normalizeStructuredResult(unwrapped);
  }

  return buildFallbackResponse(payload, 'Provider returned an empty or invalid payload.');
}

function buildOpenRouterPayload({ model, system, user, maxTokens, temperature, trustedDomains }) {
  const resolvedTrustedDomains = Array.isArray(trustedDomains) && trustedDomains.length
    ? trustedDomains
    : TRUSTED_DOMAINS;

  return {
    model,
    max_tokens: maxTokens,
    temperature,
    stream: false,
    response_format: { type: 'json_object' },
    plugins: [
      {
        id: 'web',
        include_domains: resolvedTrustedDomains,
        max_results: 5,
      },
    ],
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };
}

function isInsufficientCreditsError(message) {
  const text = String(message || '').toLowerCase();
  return text.includes('insufficient credits')
    || text.includes('never purchased credits')
    || text.includes('quota')
    || text.includes('402')
    || text.includes('payment');
}

function generateMockResponse(payload = {}) {
  return buildFallbackResponse(payload, 'Local demo AI is active because a real provider was unavailable.');
}

async function providerRequest(url, options) {
  const response = await fetch(url, options);
  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(rawText || `HTTP ${response.status}`);
  }

  return rawText ? JSON.parse(rawText) : {};
}

async function generateFromProvider(payload) {
  const { provider = DEFAULT_PROVIDER, model = DEFAULT_MODEL, apiKey, system = DEFAULT_FORGE_SYSTEM_PROMPT, user, maxTokens = 800, temperature = 0.5, trustedDomains } = payload;
  const resolvedApiKey = (apiKey || '').trim() || process.env.FORGE_AI_API_KEY?.trim();

  if (provider === 'mock') {
    return generateMockResponse(payload);
  }

  if (!resolvedApiKey) {
    throw new Error('Missing backend API key. Add FORGE_AI_API_KEY to your env vars.');
  }

  if (provider !== 'openrouter') {
    throw new Error('This MVP deployment currently supports OpenRouter only.');
  }

  try {
    const data = await providerRequest('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolvedApiKey}`,
        'HTTP-Referer': 'https://forge.local',
        'X-OpenRouter-Title': 'FORGE MVP',
      },
      body: JSON.stringify(buildOpenRouterPayload({
        model,
        system,
        user,
        maxTokens,
        temperature,
        trustedDomains,
      })),
    });

    return extractText(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '');
    if (isInsufficientCreditsError(message)) {
      return generateMockResponse(payload);
    }
    throw error;
  }
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const payload = await request.json();
    const text = await generateFromProvider(payload);
    const parsed = parseStructuredResponse(text);
    response.status(200).json(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    response.status(500).json({ error: message });
  }
}
