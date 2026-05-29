import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { PostHog } from 'posthog-node';

// In-memory login failure tracker for brute-force protection (keyed by normalized email)
const loginFailures = new Map();
// Per-IP per-minute rate limiter for the generate endpoint
const generateRateMap = new Map();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const isProd = process.env.NODE_ENV === 'production';
const DATA_DIR = path.resolve(root, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const USAGE_FILE = path.join(DATA_DIR, 'usage.json');
const WAITLIST_FILE = path.join(DATA_DIR, 'waitlist.json');
const AUDIT_LOG_FILE = path.join(DATA_DIR, 'audit-log.json');

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

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    writeJson(filePath, fallback);
    return fallback;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function loadStores() {
  ensureDataDir();
  return {
    users: readJson(USERS_FILE, []),
    sessions: readJson(SESSIONS_FILE, {}),
  };
}

function persistStores(stores) {
  writeJson(USERS_FILE, stores.users);
  writeJson(SESSIONS_FILE, stores.sessions);
}

function loadUsageStore() {
  return readJson(USAGE_FILE, {});
}

function persistUsageStore(store) {
  writeJson(USAGE_FILE, store);
}

function loadWaitlistStore() {
  return readJson(WAITLIST_FILE, []);
}

function persistWaitlistStore(store) {
  writeJson(WAITLIST_FILE, store);
}

function loadAuditLog() {
  return readJson(AUDIT_LOG_FILE, []);
}

function appendAuditLog(entry) {
  const log = loadAuditLog();
  log.push(entry);
  writeJson(AUDIT_LOG_FILE, log.slice(-200));
}

function parseCookies(header = '') {
  return header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const [key, ...rest] = part.split('=');
      acc[key] = decodeURIComponent(rest.join('='));
      return acc;
    }, {});
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

function getSessionUserId(req) {
  const session = getSession(req);
  if (!session) {
    return null;
  }

  const stores = loadStores();
  const user = stores.users.find((entry) => entry.id === session.userId);
  return user?.id || null;
}

function enforceUsageLimits(req, requestedTokens = 0) {
  const usageStore = loadUsageStore();
  const dateKey = getTodayKey();
  const bucket = usageStore[dateKey] || { global: 0, ips: {}, users: {}, tokens: 0 };
  const ip = getRequestIp(req);
  const userId = getSessionUserId(req);

  const guestLimit = Number(process.env.FORGE_GUEST_DAILY_LIMIT || (isProd ? 2 : 100));
  const userLimit = Number(process.env.FORGE_USER_DAILY_LIMIT || (isProd ? 30 : 500));
  const globalLimit = Number(process.env.FORGE_GLOBAL_DAILY_LIMIT || (isProd ? 200 : 1000));
  const globalTokenBudget = Number(process.env.FORGE_GLOBAL_TOKEN_BUDGET || (isProd ? 50000 : 500000));

  if (bucket.global >= globalLimit) {
    throw new Error('FORGE is at its daily global capacity. Try again tomorrow.');
  }

  if (bucket.tokens >= globalTokenBudget) {
    throw new Error('FORGE reached its daily token budget. Come back tomorrow.');
  }

  if (!userId) {
    if ((bucket.ips[ip] || 0) >= guestLimit) {
      throw new Error('Guest forge limit reached for today. Create an account to unlock more.');
    }
  } else if ((bucket.users[userId] || 0) >= userLimit) {
    throw new Error('Daily forge limit reached. Upgrade or come back tomorrow.');
  }

  bucket.global += 1;
  bucket.tokens = (bucket.tokens || 0) + requestedTokens;
  bucket.ips[ip] = (bucket.ips[ip] || 0) + 1;

  if (userId) {
    bucket.users[userId] = (bucket.users[userId] || 0) + 1;
  }

  usageStore[dateKey] = bucket;
  persistUsageStore(usageStore);
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  // N=65536 (2^16) for stronger brute-force resistance per OWASP recommendations
  const hash = scryptSync(password, salt, 64, { N: 65536, r: 8, p: 1 }).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  try {
    const expected = Buffer.from(hash, 'hex');
    // Always derive with same cost parameters; use fixed 128-byte output for timing safety
    const derivedHex = scryptSync(password, salt, 64, { N: 65536, r: 8, p: 1 }).toString('hex');
    const actual = Buffer.from(derivedHex, 'hex');
    // Pad to equal length before constant-time compare to avoid length leak
    const maxLen = Math.max(expected.length, actual.length);
    const a = Buffer.alloc(maxLen, 0);
    const b = Buffer.alloc(maxLen, 0);
    expected.copy(a);
    actual.copy(b);
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function checkBruteForce(email) {
  const key = email.toLowerCase();
  const now = Date.now();
  const entry = loginFailures.get(key) || { count: 0, lockedUntil: 0 };
  if (entry.lockedUntil > now) {
    const remaining = Math.ceil((entry.lockedUntil - now) / 60000);
    throw new Error(`Too many failed attempts. Try again in ${remaining} minute(s).`);
  }
  return entry;
}

function recordLoginFailure(email) {
  const key = email.toLowerCase();
  const entry = loginFailures.get(key) || { count: 0, lockedUntil: 0 };
  entry.count += 1;
  // Lock for 15 minutes after 5 consecutive failures
  if (entry.count >= 5) {
    entry.lockedUntil = Date.now() + 15 * 60 * 1000;
    entry.count = 0;
  }
  loginFailures.set(key, entry);
}

function clearLoginFailures(email) {
  loginFailures.delete(email.toLowerCase());
}

// Per-IP sliding window rate limiter: max maxRequests per windowMs
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

function setSessionCookie(res, sessionId) {
  const secure = isProd ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `forge_session=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure}`
  );
}

function clearSessionCookie(res) {
  const secure = isProd ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `forge_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`
  );
}

function createSession(userId) {
  const stores = loadStores();
  const sessionId = randomUUID();
  stores.sessions[sessionId] = {
    userId,
    expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
  };
  persistStores(stores);
  return sessionId;
}

function getSession(req) {
  const cookieHeader = req.headers.cookie || '';
  const cookies = parseCookies(cookieHeader);
  const sessionId = cookies.forge_session;
  if (!sessionId) {
    return null;
  }

  const stores = loadStores();
  const session = stores.sessions[sessionId];
  if (!session) {
    return null;
  }

  if (session.expiresAt <= Date.now()) {
    delete stores.sessions[sessionId];
    persistStores(stores);
    return null;
  }

  return { sessionId, ...session };
}

function serializeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    lastLogin: user.lastLogin || user.createdAt || null,
  };
}

function extractGeminiText(data) {
  const candidate = data?.candidates?.[0];
  const parts = candidate?.content?.parts || [];
  return parts.map((part) => part.text || '').join('').trim();
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

function extractTextFromProvider(provider, data) {
  if (provider === 'gemini') {
    return extractGeminiText(data);
  }

  if (provider === 'openrouter') {
    // Prioritize actual message content over internal thinking/reasoning chain
    let content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.delta?.content || '';
    
    // If content is empty but reasoning is present, we can use it as fallback,
    // though normally we want content.
    if (!content && data?.choices?.[0]?.message?.reasoning) {
      content = data.choices[0].message.reasoning;
    }
    
    // Strip <think>...</think> reasoning monologues if they are embedded in the content
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
    // Extract only a safe subset of the error — never forward raw provider errors to the client
    let errorMsg = `Provider HTTP ${response.status}`;
    try {
      const errBody = JSON.parse(text);
      const detail = errBody?.error?.message || errBody?.message || errBody?.error || '';
      if (typeof detail === 'string' && detail.length < 300) {
        errorMsg = detail;
      }
    } catch {
      // non-JSON error body — use status only
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
        'HTTP-Referer': 'https://forge.local',
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
  res.setHeader('X-XSS-Protection', '0'); // Modern browsers use CSP instead
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://us.i.posthog.com; img-src 'self' data: https://images.pexels.com;"
  );
  if (isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  next();
});

app.get('/api/health', (_, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/waitlist/join', (req, res) => {
  const { email, stage = 'Early idea' } = req.body || {};
  const normalizedEmail = String(email || '').trim().toLowerCase();

  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }

  const safeStage = String(stage).trim().slice(0, 100) || 'Early idea';

  const store = loadWaitlistStore();
  const already = store.some((entry) => entry.email === normalizedEmail);
  if (already) {
    return res.json({ ok: true, message: 'You are already on the list.' });
  }

  store.push({
    email: normalizedEmail,
    stage: safeStage,
    joinedAt: new Date().toISOString(),
  });
  persistWaitlistStore(store);

  appendAuditLog({
    type: 'waitlist_join',
    email: normalizedEmail,
    stage: safeStage,
    timestamp: new Date().toISOString(),
  });

  posthog?.capture({
    distinctId: normalizedEmail,
    event: 'waitlist_joined',
    properties: { stage: safeStage, $set: { email: normalizedEmail } },
  });

  res.json({ ok: true, message: 'You are on the waitlist. Launch updates are on the way.' });
});

app.get('/api/auth/session', (req, res) => {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const stores = loadStores();
  const user = stores.users.find((entry) => entry.id === session.userId);
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  res.json({ user: serializeUser(user) });
});

app.post('/api/auth/signup', (req, res) => {
  const { email, password, name = '' } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }

  const pw = String(password);
  if (pw.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }
  if (pw.length > 128) {
    return res.status(400).json({ error: 'Password is too long.' });
  }

  const nameStr = String(name).trim().slice(0, 64);

  const stores = loadStores();

  if (stores.users.some((entry) => entry.email === normalizedEmail)) {
    return res.status(409).json({ error: 'That email already exists. Try signing in instead.' });
  }

  const record = hashPassword(pw);
  const user = {
    id: randomUUID(),
    name: nameStr || normalizedEmail.split('@')[0],
    email: normalizedEmail,
    salt: record.salt,
    hash: record.hash,
    createdAt: new Date().toISOString(),
    lastLogin: new Date().toISOString(),
  };

  stores.users.push(user);
  persistStores(stores);

  const sessionId = createSession(user.id);
  setSessionCookie(res, sessionId);

  posthog?.capture({
    distinctId: user.id,
    event: 'user_signed_up',
    properties: { name: user.name, $set: { email: user.email, name: user.name } },
  });

  res.json({ user: serializeUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const pw = String(password);

  if (pw.length > 128) {
    return res.status(400).json({ error: 'Invalid credentials.' });
  }

  try {
    checkBruteForce(normalizedEmail);
  } catch (err) {
    return res.status(429).json({ error: err.message });
  }

  const stores = loadStores();
  const user = stores.users.find((entry) => entry.email === normalizedEmail);

  if (!user || !verifyPassword(pw, user.salt, user.hash)) {
    recordLoginFailure(normalizedEmail);
    return res.status(401).json({ error: 'Email or password is wrong.' });
  }

  clearLoginFailures(normalizedEmail);
  user.lastLogin = new Date().toISOString();
  persistStores(stores);

  const sessionId = createSession(user.id);
  setSessionCookie(res, sessionId);

  posthog?.capture({
    distinctId: user.id,
    event: 'user_logged_in',
    properties: { $set: { email: user.email, name: user.name } },
  });

  res.json({ user: serializeUser(user) });
});

app.post('/api/auth/logout', (req, res) => {
  const session = getSession(req);
  if (session) {
    const stores = loadStores();
    delete stores.sessions[session.sessionId];
    persistStores(stores);
  }

  clearSessionCookie(res);
  res.json({ ok: true });
});

app.post('/api/forge/generate', async (req, res) => {
  const payload = req.body || {};

  // Enforce per-IP per-minute rate limit before touching usage counters
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

  // Only forward the fields the server actually uses — never forward arbitrary payloads
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
    enforceUsageLimits(req, tokenEstimate);
    const text = await generateFromProvider(safePayload);
    const parsed = parseStructuredResponse(text, safePayload);
    const successUserId = getSessionUserId(req);
    appendAuditLog({
      type: 'generate',
      ip,
      userId: successUserId,
      provider: safePayload.provider || DEFAULT_PROVIDER,
      model: safePayload.model || DEFAULT_MODEL,
      status: 'ok',
      tokens: tokenEstimate,
      timestamp: new Date().toISOString(),
    });
    posthog?.capture({
      distinctId: successUserId || ip,
      event: 'forge_generate_completed',
      properties: {
        provider: safePayload.provider || DEFAULT_PROVIDER,
        model: safePayload.model || DEFAULT_MODEL,
        tokens: tokenEstimate,
        authenticated: Boolean(successUserId),
      },
    });
    // Never expose raw AI response text — only return the structured result
    res.json(parsed);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown server error';
    // Sanitize provider error messages before sending to client
    const clientMessage = /api key|authentication|unauthorized|forbidden|token|secret/i.test(message)
      ? 'AI provider error. Please try again later.'
      : message.slice(0, 200);
    const failUserId = getSessionUserId(req);
    appendAuditLog({
      type: 'generate',
      ip,
      userId: failUserId,
      provider: safePayload.provider || DEFAULT_PROVIDER,
      model: safePayload.model || DEFAULT_MODEL,
      status: 'error',
      error: message.slice(0, 500),
      tokens: tokenEstimate,
      timestamp: new Date().toISOString(),
    });
    posthog?.capture({
      distinctId: failUserId || ip,
      event: 'forge_generate_failed',
      properties: {
        provider: safePayload.provider || DEFAULT_PROVIDER,
        model: safePayload.model || DEFAULT_MODEL,
        tokens: tokenEstimate,
        authenticated: Boolean(failUserId),
      },
    });

    if (message.includes('limit') || message.includes('capacity') || message.includes('budget') || message.includes('Too many')) {
      return res.status(429).json({ error: clientMessage });
    }
    res.status(500).json({ error: clientMessage });
  }
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
