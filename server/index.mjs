import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { PostHog } from 'posthog-node';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const isProd = process.env.NODE_ENV === 'production';

// Per-IP per-minute rate limiter for the generate endpoint
const generateRateMap = new Map();

const PROVIDER_DEFAULTS = {
  gemini: {
    label: 'Google Gemini',
    model: 'gemini-2.0-flash',
  },
  anthropic: {
    label: 'Anthropic',
    model: 'claude-sonnet-4-20250514',
  },
  openrouter: {
    label: 'OpenRouter',
    model: 'z-ai/glm-4.5-air:free',
  },
};

function loadLocalEnv() {
  const envFile = path.resolve(root, '.env.local');
  if (!fs.existsSync(envFile)) {
    return;
  }

  const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const eq = line.indexOf('=');
    if (eq === -1) {
      continue;
    }

    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    const existing = process.env[key];
    if (!key || (existing !== undefined && existing.trim() !== '')) {
      continue;
    }

    process.env[key] = value;
  }
}

loadLocalEnv();

// Supabase server client (service role for admin operations)
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    })
  : null;

const posthog = process.env.POSTHOG_API_KEY
  ? new PostHog(process.env.POSTHOG_API_KEY, { host: process.env.POSTHOG_HOST || 'https://us.i.posthog.com' })
  : null;

const DEFAULT_PROVIDER = process.env.FORGE_AI_PROVIDER || 'openrouter';
const DEFAULT_MODEL = process.env.FORGE_AI_MODEL || PROVIDER_DEFAULTS[DEFAULT_PROVIDER]?.model || PROVIDER_DEFAULTS.openrouter.model;
const DEFAULT_API_KEY = process.env.FORGE_AI_API_KEY?.trim() || '';
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

function providerMissingKeyMessage(provider) {
  return `Missing API key for ${PROVIDER_DEFAULTS[provider]?.label || provider}.`;
}

function getRequestIp(req) {
  // Only trust X-Forwarded-For when running behind a known reverse proxy (opt-in via env)
  if (process.env.TRUST_PROXY === 'true') {
    const xForwardedFor = req.headers['x-forwarded-for'];
    if (typeof xForwardedFor === 'string') {
      const first = xForwardedFor.split(',')[0].trim();
      if (first) return first;
    }
  }
  return req.socket?.remoteAddress || 'unknown';
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function estimateTokens(text) {
  const value = typeof text === 'string' ? text : '';
  return Math.max(1, Math.ceil(value.length / 4));
}

// Hash IP for privacy (using SHA-256 first 16 chars)
async function hashIp(ip) {
  const encoder = new TextEncoder();
  const data = encoder.encode(ip);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Per-IP sliding window rate limiter
function checkGenerateRateLimit(ip) {
  const maxRequests = 20;
  const windowMs = 60 * 1000;
  const now = Date.now();
  const timestamps = (generateRateMap.get(ip) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= maxRequests) {
    throw new Error('Too many requests. Slow down and try again in a moment.');
  }
  timestamps.push(now);
  generateRateMap.set(ip, timestamps);
}

// Enforce usage limits using Supabase database
async function enforceUsageLimits(req, userId, requestedTokens = 0) {
  if (!supabase) {
    console.warn('Supabase not configured - skipping usage limits');
    return;
  }

  const ip = getRequestIp(req);
  const ipHash = await hashIp(ip);
  const dateKey = getTodayKey();

  const guestLimit = Number(process.env.FORGE_GUEST_DAILY_LIMIT || (isProd ? 5 : 100));
  const userLimit = Number(process.env.FORGE_USER_DAILY_LIMIT || (isProd ? 50 : 500));
  const globalLimit = Number(process.env.FORGE_GLOBAL_DAILY_LIMIT || (isProd ? 500 : 2000));

  // Check global limit (aggregate all usage for today)
  const { data: globalUsage, error: globalError } = await supabase
    .from('usage_logs')
    .select('request_count, token_count')
    .eq('date_key', dateKey);

  if (globalError) {
    console.error('Error checking global usage:', globalError);
  }

  const totalRequests = (globalUsage || []).reduce((sum, r) => sum + (r.request_count || 0), 0);
  const totalTokens = (globalUsage || []).reduce((sum, r) => sum + (r.token_count || 0), 0);

  if (totalRequests >= globalLimit) {
    throw new Error('FORGE is at its daily global capacity. Try again tomorrow.');
  }

  if (!userId) {
    // Guest user - check by IP hash
    const { data: guestUsage, error: guestError } = await supabase
      .from('usage_logs')
      .select('request_count')
      .eq('ip_hash', ipHash)
      .eq('date_key', dateKey);

    if (guestError) {
      console.error('Error checking guest usage:', guestError);
    }

    const guestRequests = (guestUsage || []).reduce((sum, r) => sum + (r.request_count || 0), 0);
    if (guestRequests >= guestLimit) {
      throw new Error('Guest forge limit reached for today. Create a free account to unlock more.');
    }
  } else {
    // Authenticated user - check by user ID
    const { data: userUsage, error: userError } = await supabase
      .from('usage_logs')
      .select('request_count')
      .eq('user_id', userId)
      .eq('date_key', dateKey);

    if (userError) {
      console.error('Error checking user usage:', userError);
    }

    const userRequests = (userUsage || []).reduce((sum, r) => sum + (r.request_count || 0), 0);
    if (userRequests >= userLimit) {
      throw new Error('Daily forge limit reached. Upgrade or come back tomorrow.');
    }
  }

  // Log this usage
  const { error: insertError } = await supabase
    .from('usage_logs')
    .insert({
      user_id: userId || null,
      ip_hash: ipHash,
      date_key: dateKey,
      request_count: 1,
      token_count: requestedTokens,
      provider: DEFAULT_PROVIDER,
      model: DEFAULT_MODEL,
    });

  if (insertError) {
    console.error('Error logging usage:', insertError);
  }
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
  const fallbackScore = 45;
  const score = typeof result?.score === 'number'
    ? Math.max(0, Math.min(100, Math.round(result.score)))
    : fallbackScore;

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

function extractGeminiText(data) {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  return parts.map((part) => part.text || '').join('').trim();
}

function extractTextFromProvider(provider, data) {
  if (provider === 'gemini') {
    return extractGeminiText(data);
  }

  if (provider === 'openrouter') {
    let content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.delta?.content || '';

    if (!content && data?.choices?.[0]?.message?.reasoning) {
      content = data.choices[0].message.reasoning;
    }

    if (typeof content === 'string') {
      content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    }

    return content;
  }

  const firstContent = data?.content?.[0];
  if (typeof firstContent?.text === 'string') {
    let content = firstContent.text;
    if (typeof content === 'string') {
      content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    }
    return content;
  }

  return '';
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

async function providerRequest(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();

  if (!response.ok) {
    let errorMsg = `Provider HTTP ${response.status}`;
    try {
      const errBody = JSON.parse(text);
      const detail = errBody?.error?.message || errBody?.message || errBody?.error || '';
      if (typeof detail === 'string' && detail.length < 300) {
        errorMsg = detail;
      }
    } catch {
      // non-JSON error body
    }
    throw new Error(errorMsg);
  }

  return text ? JSON.parse(text) : {};
}

function buildOpenRouterPayload({ model, maxTokens, temperature, system, user, trustedDomains }) {
  const resolvedTrustedDomains = Array.isArray(trustedDomains) && trustedDomains.length
    ? trustedDomains
    : TRUSTED_DOMAINS;

  return {
    model,
    stream: false,
    max_tokens: maxTokens,
    temperature,
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

async function generateFromProvider(payload) {
  const { provider = DEFAULT_PROVIDER, model, apiKey, system = DEFAULT_FORGE_SYSTEM_PROMPT, user, maxTokens = 1400, temperature, trustedDomains } = payload;
  const resolvedProvider = PROVIDER_DEFAULTS[provider] ? provider : DEFAULT_PROVIDER;
  const resolvedApiKey = (apiKey || '').trim() || DEFAULT_API_KEY;
  const resolvedTemperature = Number.isFinite(Number(temperature)) ? Number(temperature) : 0.5;

  if (!resolvedApiKey) {
    throw new Error(providerMissingKeyMessage(resolvedProvider));
  }

  const resolvedModel = model || DEFAULT_MODEL || PROVIDER_DEFAULTS[resolvedProvider]?.model;

  if (resolvedProvider === 'gemini') {
    const data = await providerRequest(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(resolvedModel)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': resolvedApiKey,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: user }] }],
          systemInstruction: {
            role: 'system',
            parts: [{ text: system }],
          },
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: resolvedTemperature,
          },
        }),
      }
    );

    return extractGeminiText(data);
  }

  if (resolvedProvider === 'openrouter') {
    const data = await providerRequest('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolvedApiKey}`,
        'HTTP-Referer': 'https://forge.app',
        'X-OpenRouter-Title': 'FORGE',
      },
      body: JSON.stringify(buildOpenRouterPayload({
        model: resolvedModel,
        maxTokens,
        temperature: resolvedTemperature,
        system,
        user,
        trustedDomains,
      })),
    });

    return extractTextFromProvider(resolvedProvider, data);
  }

  const data = await providerRequest('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': resolvedApiKey,
    },
    body: JSON.stringify({
      model: resolvedModel,
      max_tokens: maxTokens,
      temperature: resolvedTemperature,
      system,
      stream: false,
      messages: [{ role: 'user', content: user }],
    }),
  });

  return extractTextFromProvider(resolvedProvider, data);
}

const app = express();
app.use(express.json({ limit: '100kb' }));

// Security headers on every response
app.use((_, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.supabase.co https://us.i.posthog.com https://openrouter.ai https://api.anthropic.com https://generativelanguage.googleapis.com; img-src 'self' data: https://images.pexels.com https://lh3.googleusercontent.com;"
  );
  if (isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  next();
});

app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', supabase: supabase ? 'configured' : 'not_configured' });
});

// Verify Supabase JWT token and return user info
async function verifyAuthToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ') || !supabase) {
    return null;
  }

  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.user_metadata?.name || user.email?.split('@')[0] || '',
  };
}

app.post('/api/forge/generate', async (req, res) => {
  const payload = req.body || {};

  // Get user from Authorization header if present
  const authHeader = req.headers.authorization;
  const user = await verifyAuthToken(authHeader);
  const userId = user?.id || null;

  // Enforce per-IP per-minute rate limit
  const ip = getRequestIp(req);
  try {
    checkGenerateRateLimit(ip);
  } catch (err) {
    return res.status(429).json({ error: err.message });
  }

  // Validate and sanitize user-supplied input fields
  const userInput = typeof payload.user === 'string' ? payload.user.trim() : '';
  if (!userInput) {
    return res.status(400).json({ error: 'No idea provided.' });
  }
  if (userInput.length > 4000) {
    return res.status(400).json({ error: 'Input is too long. Keep it under 4000 characters.' });
  }

  // Only forward the fields the server actually uses
  const safePayload = {
    provider: typeof payload.provider === 'string' ? payload.provider : undefined,
    model: typeof payload.model === 'string' ? payload.model : undefined,
    temperature: payload.temperature,
    system: typeof payload.system === 'string' ? payload.system : undefined,
    user: userInput,
    maxTokens: typeof payload.maxTokens === 'number' ? Math.min(payload.maxTokens, 2000) : undefined,
  };

  const tokenEstimate = estimateTokens(`${safePayload.system || ''}\n${safePayload.user}`) + Number(safePayload.maxTokens || 1400);

  try {
    await enforceUsageLimits(req, userId, tokenEstimate);
    const text = await generateFromProvider(safePayload);
    const parsed = parseStructuredResponse(text, safePayload);

    // If user is authenticated, save the idea to the database
    if (user && supabase) {
      const { error: saveError } = await supabase
        .from('ideas')
        .insert({
          user_id: user.id,
          idea_text: userInput,
          score: parsed.score,
          verdict: parsed.verdict,
          strengths: parsed.strengths,
          weaknesses: parsed.weaknesses,
          moves: parsed.moves,
          provider: safePayload.provider || DEFAULT_PROVIDER,
          model: safePayload.model || DEFAULT_MODEL,
        });

      if (saveError) {
        console.error('Error saving idea:', saveError);
        // Continue even if save fails - don't block the user
      }
    }

    posthog?.capture({
      distinctId: userId || ip,
      event: 'forge_generate_completed',
      properties: {
        provider: safePayload.provider || DEFAULT_PROVIDER,
        model: safePayload.model || DEFAULT_MODEL,
        tokens: tokenEstimate,
        authenticated: Boolean(userId),
      },
    });

    res.json(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    const clientMessage = /api key|authentication|unauthorized|forbidden|token|secret/i.test(message)
      ? 'AI provider error. Please try again later.'
      : message.slice(0, 200);

    posthog?.capture({
      distinctId: userId || ip,
      event: 'forge_generate_failed',
      properties: {
        provider: safePayload.provider || DEFAULT_PROVIDER,
        model: safePayload.model || DEFAULT_MODEL,
        tokens: tokenEstimate,
        authenticated: Boolean(userId),
      },
    });

    if (message.includes('limit') || message.includes('capacity') || message.includes('budget') || message.includes('Too many')) {
      return res.status(429).json({ error: clientMessage });
    }
    res.status(500).json({ error: clientMessage });
  }
});

// Get user's saved ideas
app.get('/api/ideas', async (req, res) => {
  const authHeader = req.headers.authorization;
  const user = await verifyAuthToken(authHeader);

  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (!supabase) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const { data, error } = await supabase
    .from('ideas')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch ideas' });
  }

  res.json({ ideas: data });
});

// Update an idea (e.g., mark as favorite, add tags)
app.patch('/api/ideas/:id', async (req, res) => {
  const authHeader = req.headers.authorization;
  const user = await verifyAuthToken(authHeader);

  if (!user || !supabase) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { id } = req.params;
  const updates = req.body || {};

  // Only allow specific fields to be updated
  const allowedUpdates = {};
  if (typeof updates.is_favorite === 'boolean') allowedUpdates.is_favorite = updates.is_favorite;
  if (Array.isArray(updates.tags)) allowedUpdates.tags = updates.tags;

  if (Object.keys(allowedUpdates).length === 0) {
    return res.status(400).json({ error: 'No valid updates provided' });
  }

  const { data, error } = await supabase
    .from('ideas')
    .update(allowedUpdates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .maybeSingle();

  if (error || !data) {
    return res.status(404).json({ error: 'Idea not found' });
  }

  res.json({ idea: data });
});

// Delete an idea
app.delete('/api/ideas/:id', async (req, res) => {
  const authHeader = req.headers.authorization;
  const user = await verifyAuthToken(authHeader);

  if (!user || !supabase) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { id } = req.params;

  const { error } = await supabase
    .from('ideas')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);

  if (error) {
    return res.status(500).json({ error: 'Failed to delete idea' });
  }

  res.json({ ok: true });
});

// Get user profile
app.get('/api/profile', async (req, res) => {
  const authHeader = req.headers.authorization;
  const user = await verifyAuthToken(authHeader);

  if (!user || !supabase) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (error) {
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }

  res.json({ profile: data || { id: user.id, name: user.name || '' } });
});

// Update user profile
app.patch('/api/profile', async (req, res) => {
  const authHeader = req.headers.authorization;
  const user = await verifyAuthToken(authHeader);

  if (!user || !supabase) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const updates = req.body || {};

  // Only allow specific fields
  const allowedFields = ['name', 'stage', 'geo', 'customer', 'problem', 'solution', 'market', 'revenue', 'channels', 'constraints', 'strengths', 'risks', 'goals'];
  const filteredUpdates = {};
  for (const field of allowedFields) {
    if (typeof updates[field] === 'string') {
      filteredUpdates[field] = updates[field].slice(0, 2000);
    }
  }

  const { data, error } = await supabase
    .from('profiles')
    .upsert({ id: user.id, ...filteredUpdates })
    .select()
    .maybeSingle();

  if (error) {
    return res.status(500).json({ error: 'Failed to update profile' });
  }

  res.json({ profile: data });
});

async function start() {
  if (!isProd) {
    const vite = await createViteServer({
      configFile: path.resolve(root, 'vite.config.ts'),
      server: {
        middlewareMode: true,
      },
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(root, 'dist');
    if (!fs.existsSync(path.join(distPath, 'index.html'))) {
      throw new Error('Production build not found. Run npm run build first.');
    }

    app.use(express.static(distPath));
    app.get('*', (_, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';

  app.listen(port, host, () => {
    console.log(`FORGE server listening on http://${host}:${port}`);
    console.log(`Supabase: ${supabase ? 'configured' : 'not configured'}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});

process.on('SIGTERM', async () => {
  await posthog?.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await posthog?.shutdown();
  process.exit(0);
});
