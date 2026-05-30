import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { createClient } from '@supabase/supabase-js';
import { PostHog } from 'posthog-node';
import helmet from 'helmet';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import * as db from './db.mjs';

let __dirname;
try {
  __dirname = path.dirname(fileURLToPath(import.meta.url));
} catch {
  __dirname = process.cwd();
}
const root = path.resolve(__dirname, '..');
const isProd = process.env.NODE_ENV === 'production';

// Per-IP per-minute rate limiter for the generate endpoint
const generateRateMap = new Map();
const globalRateMap = new Map();
const authRateMap = new Map();

function createRateLimitHandler(rateMap, maxRequests, windowMs, message) {
  return (req, res, next) => {
    const key = getRequestIp(req) || req.ip || req.headers['x-forwarded-for'] || 'unknown';
    const now = Date.now();
    const entry = rateMap.get(key) || { count: 0, resetAt: now + windowMs };

    if (entry.resetAt <= now) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }

    entry.count += 1;
    rateMap.set(key, entry);

    if (entry.count > maxRequests) {
      res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }

    next();
  };
}

const PROVIDER_DEFAULTS = {
  mock: {
    label: 'Local Demo AI (free)',
    model: 'demo',
  },
  huggingface: {
    label: 'Hugging Face (Inference API)',
    model: 'deepseek-ai/DeepSeek-V4-Pro',
  },
  huggingface_router: {
    label: 'Hugging Face Router (OpenAI API)',
    model: 'deepseek-ai/DeepSeek-R1:novita',
  },
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
    model: 'deepseek/deepseek-v4-flash:free',
  },
  python_local: {
    label: 'Local Python AI (Transformers)',
    model: 'distilgpt2',
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

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-before-prod';
const SESSION_COOKIE = 'forge_session';
const OAUTH_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '433261777203-2cmdeen156bpoi6se920f96vb3so1e7r.apps.googleusercontent.com';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_SUCCESS = process.env.GOOGLE_REDIRECT_SUCCESS || '/';
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
const GLOBAL_RATE_LIMIT = Number(process.env.GLOBAL_RATE_LIMIT || 200);
const AUTH_RATE_LIMIT = Number(process.env.AUTH_RATE_LIMIT || 10);
const FORGE_GENERATE_RATE_LIMIT = Number(process.env.FORGE_GENERATE_RATE_LIMIT || 20);

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

const DEFAULT_HF_API_KEY = process.env.HF_TOKEN?.trim() || '';
const DEFAULT_PROVIDER = process.env.FORGE_AI_PROVIDER || (DEFAULT_HF_API_KEY ? 'huggingface_router' : 'mock');
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

function parseCookies(cookieHeader = '') {
  return cookieHeader.split(';').reduce((cookies, pair) => {
    const [name, ...rest] = pair.split('=');
    if (!name) return cookies;
    cookies[name.trim()] = decodeURIComponent(rest.join('=').trim() || '');
    return cookies;
  }, {});
}

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  return parseCookies(cookieHeader)[SESSION_COOKIE] || null;
}

function signJwt(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      name: user.name || '',
      provider: user.provider || 'local',
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function verifyJwtToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

async function verifyAuthToken(reqOrHeader) {
  let token = null;

  if (typeof reqOrHeader === 'string') {
    if (reqOrHeader.startsWith('Bearer ')) {
      token = reqOrHeader.slice(7).trim();
    } else {
      token = reqOrHeader.trim();
    }
  } else if (reqOrHeader?.headers) {
    token = getTokenFromRequest(reqOrHeader);
  }

  if (token) {
    const payload = verifyJwtToken(token);
    if (payload && payload.sub && payload.email) {
      return {
        id: payload.sub,
        email: payload.email,
        name: payload.name || '',
        provider: payload.provider || 'local',
      };
    }
  }

  if (!supabase || typeof reqOrHeader !== 'object') {
    return null;
  }

  const authHeader = reqOrHeader.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const tokenValue = authHeader.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(tokenValue);
  if (error || !user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    name: user.user_metadata?.name || user.email?.split('@')[0] || '',
  };
}

function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(res) {
  res.cookie(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    expires: new Date(0),
  });
}

function providerMissingKeyMessage(provider) {
  return `Missing API key for ${PROVIDER_DEFAULTS[provider]?.label || provider}.`;
}

function getRequestIp(req) {
  const trustedProxyIp = process.env.TRUSTED_PROXY_IP?.trim();
  const trustProxy = process.env.TRUST_PROXY === 'true' || Boolean(trustedProxyIp);

  if (trustProxy) {
    const remoteAddr = req.socket?.remoteAddress;
    if (!trustedProxyIp || remoteAddr === trustedProxyIp) {
      const xForwardedFor = req.headers['x-forwarded-for'];
      if (typeof xForwardedFor === 'string') {
        const first = xForwardedFor.split(',')[0].trim();
        if (first) return first;
      }
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

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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

function buildHuggingFacePayload({ system, user, maxTokens, temperature }) {
  return {
    inputs: `${system}\n\n${user}`,
    parameters: {
      max_new_tokens: maxTokens,
      temperature,
      return_full_text: false,
      top_p: 0.95,
      repetition_penalty: 1.03,
    },
  };
}

function extractTextFromHuggingFace(data) {
  if (typeof data === 'string') {
    return data.trim();
  }

  if (Array.isArray(data) && data.length > 0) {
    if (typeof data[0].generated_text === 'string') {
      return data[0].generated_text.trim();
    }
    if (typeof data[0].text === 'string') {
      return data[0].text.trim();
    }
  }

  if (typeof data?.generated_text === 'string') {
    return data.generated_text.trim();
  }

  if (typeof data?.text === 'string') {
    return data.text.trim();
  }

  return '';
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

// ── Hugging Face Router (OpenAI-compatible) ──────────────────
async function generateFromHuggingFaceRouter({ model, apiKey, system, user, maxTokens, temperature }) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  const body = {
    model: model || 'deepseek-ai/DeepSeek-R1:novita',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    max_tokens: maxTokens || 1400,
    temperature: temperature ?? 0.5,
    stream: false,
  };

  const data = await providerRequest('https://router.huggingface.co/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  // OpenAI-compatible response format
  return data?.choices?.[0]?.message?.content || '';
}

// ── Python Local AI (Transformers) ──────────────────────────
async function generateFromPythonLocal({ system, user, maxTokens = 300 }) {
  // Construct the full prompt for the local model
  const prompt = `${system}\n\nUser idea: ${user}\n\nFORGE analysis:`;

  return new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const scriptPath = path.join(__dirname, '..', 'deepseek', 'server_bridge.py');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

    const child = spawn(pythonCmd, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60000,
      env: {
        ...process.env,
        FORGE_LOCAL_MAX_TOKENS: String(maxTokens),
      },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code !== 0) {
        console.warn(`Python bridge exited with code ${code}`, stderr.slice(0, 200));
        // Fallback to mock on Python failure
        resolve(null);
        return;
      }

      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed.text || null);
      } catch {
        // If output is not JSON, treat the raw stdout as the result
        const cleaned = stdout.trim();
        resolve(cleaned || null);
      }
    });

    child.on('error', (err) => {
      console.warn('Could not start Python bridge:', err.message);
      resolve(null);
    });

    // Write prompt to stdin
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function generateFromProvider(payload) {
  const { provider = DEFAULT_PROVIDER, model, apiKey, system = DEFAULT_FORGE_SYSTEM_PROMPT, user, maxTokens = 1400, temperature, trustedDomains } = payload;
  const resolvedProvider = PROVIDER_DEFAULTS[provider] ? provider : DEFAULT_PROVIDER;
  const resolvedApiKey = (apiKey || '').trim() || DEFAULT_API_KEY || DEFAULT_HF_API_KEY;
  const resolvedTemperature = Number.isFinite(Number(temperature)) ? Number(temperature) : 0.5;
  const resolvedModel = model || DEFAULT_MODEL || PROVIDER_DEFAULTS[resolvedProvider]?.model;

  if (resolvedProvider === 'mock') {
    return generateMockResponse(payload);
  }

  // ── Python Local AI (no API key needed) ─────────────
  if (resolvedProvider === 'python_local') {
    try {
      const pythonResult = await generateFromPythonLocal({
        system,
        user,
        maxTokens: Math.min(maxTokens || 1400, 500),
      });
      if (pythonResult) return pythonResult;
      // Fallback to mock on Python failure
      return generateMockResponse(payload);
    } catch (err) {
      console.warn('Python local AI failed:', err.message);
      return generateMockResponse(payload);
    }
  }

  if (!resolvedApiKey) {
    throw new Error(providerMissingKeyMessage(resolvedProvider));
  }

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

  if (resolvedProvider === 'mock') {
    return generateMockResponse(payload);
  }

  if (resolvedProvider === 'huggingface') {
    try {
      const headers = {
        'Content-Type': 'application/json',
      };

      if (resolvedApiKey) {
        headers.Authorization = `Bearer ${resolvedApiKey}`;
      }

      const data = await providerRequest(
        `https://api-inference.huggingface.co/models/${encodeURIComponent(resolvedModel)}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(buildHuggingFacePayload({
            system,
            user,
            maxTokens,
            temperature: resolvedTemperature,
          })),
        }
      );

      const text = extractTextFromHuggingFace(data);
      return text || generateMockResponse(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '');
      if (isInsufficientCreditsError(message) || /unauthorized|forbidden|permission|quota|rate limit|not found/.test(message.toLowerCase())) {
        if (resolvedApiKey) {
          return generateFromHuggingFaceRouter({
            model: 'deepseek-ai/DeepSeek-R1:novita',
            apiKey: resolvedApiKey,
            system,
            user,
            maxTokens,
            temperature: resolvedTemperature,
          });
        }
        return generateMockResponse(payload);
      }
      throw error;
    }
  }

  // ── Hugging Face Router (OpenAI-compatible) ─────────
  if (resolvedProvider === 'huggingface_router') {
    try {
      const text = await generateFromHuggingFaceRouter({
        model: resolvedModel,
        apiKey: resolvedApiKey,
        system,
        user,
        maxTokens,
        temperature: resolvedTemperature,
      });
      if (text) return text;
      return generateMockResponse(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '');
      if (isInsufficientCreditsError(message) || /unauthorized|forbidden|permission|quota|rate limit/.test(message.toLowerCase())) {
        return generateMockResponse(payload);
      }
      throw error;
    }
  }

  if (resolvedProvider === 'openrouter') {
    if (!resolvedApiKey) {
      return generateMockResponse(payload);
    }

    try {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || '');
      if (isInsufficientCreditsError(message) || /unauthorized|forbidden|permission|quota|rate limit|not found/.test(message.toLowerCase())) {
        return generateMockResponse(payload);
      }
      throw error;
    }
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
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: ALLOWED_ORIGIN,
  credentials: true,
}));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use('/api', createRateLimitHandler(globalRateMap, GLOBAL_RATE_LIMIT, 15 * 60 * 1000, 'Global API rate limit exceeded.'));

// Security headers on every response
app.use((_, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.supabase.co https://us.i.posthog.com https://openrouter.ai https://api.anthropic.com https://generativelanguage.googleapis.com https://router.huggingface.co; img-src 'self' data: https://images.pexels.com https://lh3.googleusercontent.com;"
  );
  if (isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  next();
});

// Fallback for Vite: return JSON error instead of HTML for API routes
app.use('/api', (req, res, next) => {
  res.setHeader('Content-Type', 'application/json');
  next();
});

app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', supabase: supabase ? 'configured' : 'not_configured' });
});

app.get('/api/auth/session', async (req, res) => {
  const user = await verifyAuthToken(req);
  res.json({ user });
});

app.post('/api/auth/login', createRateLimitHandler(authRateMap, AUTH_RATE_LIMIT, 15 * 60 * 1000, 'Too many authentication attempts. Slow down and try again.'), async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const user = await db.getUserByEmail(email);
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = signJwt(user);
  setSessionCookie(res, token);
  res.json({ user: { id: user.id, email: user.email, name: user.name || '', provider: user.provider } });
});

app.post('/api/auth/signup', createRateLimitHandler(authRateMap, AUTH_RATE_LIMIT, 15 * 60 * 1000, 'Too many signup attempts. Slow down and try again.'), async (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Provide a valid email and a password with at least 8 characters.' });
  }

  const existing = await db.getUserByEmail(email);
  if (existing) {
    return res.status(409).json({ error: 'Account already exists. Try logging in or continue with Google.' });
  }

  const hash = bcrypt.hashSync(password, 12);
  const user = await db.createUser({ email, name: name || '', passwordHash: hash, provider: 'local' });
  const token = signJwt(user);
  setSessionCookie(res, token);
  res.json({ user: { id: user.id, email: user.email, name: user.name || '', provider: user.provider } });
});

app.post('/api/auth/logout', async (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/google', createRateLimitHandler(authRateMap, AUTH_RATE_LIMIT, 15 * 60 * 1000, 'Too many authentication attempts. Slow down and try again.'), (req, res) => {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get('/api/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).json({ error: 'Missing OAuth code.' });
  }
  if (!GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({ error: 'Google OAuth is not configured on the server.' });
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: String(code),
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: OAUTH_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  const tokenData = await tokenResponse.json();
  const accessToken = tokenData.access_token;
  if (!accessToken) {
    console.error('Google token error', tokenData);
    return res.status(400).json({ error: 'Google token exchange failed.' });
  }

  const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const profileData = await profileResponse.json();
  const email = profileData.email?.toLowerCase();
  if (!email) {
    return res.status(400).json({ error: 'Google did not return a usable email address.' });
  }

  const user = await db.createOrUpdateGoogleUser({ email, name: profileData.name || profileData.email?.split('@')[0] || '' });
  const token = signJwt(user);
  setSessionCookie(res, token);
  res.redirect(GOOGLE_REDIRECT_SUCCESS);
});

app.post('/api/waitlist/join', async (req, res) => {
  const { email, stage } = req.body || {};
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email is required.' });
  }
  try {
    const data = await db.saveWaitlist(email, stage || 'Early idea');
    res.json({ message: 'Added to the waitlist.', waitlist: data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to join the waitlist.' });
  }
});

app.post('/api/forge/generate', async (req, res) => {
  const payload = req.body || {};

  // Get user from Authorization header if present
  const user = await verifyAuthToken(req);
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
    // Don't let usage limits block generation - they're a soft check
    try {
      await enforceUsageLimits(req, userId, tokenEstimate);
    } catch (usageError) {
      console.warn('Usage limit check failed (non-blocking):', usageError.message);
    }
    const text = await generateFromProvider(safePayload);
    const parsed = parseStructuredResponse(text, safePayload);

    // If user is authenticated, save the idea to the database
    if (user) {
      try {
        if (supabase) {
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
          }
        } else {
          await db.saveIdea(user.id, {
            idea_text: userInput,
            score: parsed.score,
            verdict: parsed.verdict,
            strengths: parsed.strengths,
            weaknesses: parsed.weaknesses,
            moves: parsed.moves,
            provider: safePayload.provider || DEFAULT_PROVIDER,
            model: safePayload.model || DEFAULT_MODEL,
            tags: [],
          });
        }
      } catch (saveError) {
        console.error('Error saving idea:', saveError);
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
    console.error('Generate endpoint error:', message);
    // Only mask errors that explicitly mention invalid API keys or auth tokens
    const clientMessage = /invalid api key|missing api key|authentication failed|401|403/i.test(message)
      ? 'AI provider error. Please check your API key and try again.'
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
  const user = await verifyAuthToken(req);

  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const limit = Math.min(Number(req.query.limit) || 50, 100);

  if (supabase) {
    const { data, error } = await supabase
      .from('ideas')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch ideas' });
    }

    return res.json({ ideas: data });
  }

  try {
    const ideas = await db.getIdeasByUserId(user.id, limit);
    return res.json({ ideas });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch ideas' });
  }
});

// Update an idea (e.g., mark as favorite, add tags)
app.patch('/api/ideas/:id', async (req, res) => {
  const user = await verifyAuthToken(req);

  if (!user) {
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

  if (supabase) {
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

    return res.json({ idea: data });
  }

  try {
    const idea = await db.updateIdea(id, allowedUpdates, user.id);
    if (!idea) {
      return res.status(404).json({ error: 'Idea not found' });
    }
    return res.json({ idea });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update idea' });
  }
});

// Delete an idea
app.delete('/api/ideas/:id', async (req, res) => {
  const user = await verifyAuthToken(req);

  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const { id } = req.params;

  if (supabase) {
    const { error } = await supabase
      .from('ideas')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id);

    if (error) {
      return res.status(500).json({ error: 'Failed to delete idea' });
    }

    return res.json({ ok: true });
  }

  try {
    await db.deleteIdea(id, user.id);
    return res.json({ ok: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to delete idea' });
  }
});

// Get user profile
app.get('/api/profile', async (req, res) => {
  const user = await verifyAuthToken(req);

  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  if (supabase) {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch profile' });
    }

    return res.json({ profile: data || { id: user.id, name: user.name || '' } });
  }

  try {
    const profile = await db.getProfile(user.id);
    return res.json({ profile: profile || { id: user.id, name: user.name || '' } });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update user profile
app.patch('/api/profile', async (req, res) => {
  const user = await verifyAuthToken(req);

  if (!user) {
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

  if (supabase) {
    const { data, error } = await supabase
      .from('profiles')
      .upsert({ id: user.id, ...filteredUpdates })
      .select()
      .maybeSingle();

    if (error) {
      return res.status(500).json({ error: 'Failed to update profile' });
    }

    return res.json({ profile: data });
  }

  try {
    const profile = await db.upsertProfile(user.id, filteredUpdates);
    return res.json({ profile });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

async function start() {
  await db.initializeDatabase();

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
