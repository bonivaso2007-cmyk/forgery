import { useEffect, useState } from 'react';
import { captureEvent, identifyUser } from './lib/analytics';
import { getCurrentSessionUser, isSupabaseConfigured } from './lib/supabase';
import './mvp.css';

type MVPResult = {
  score: number;
  verdict: string;
  strengths: string[];
  weaknesses: string[];
  moves: string[];
};

const STORAGE_KEY = 'forge-mvp-state';
const DEFAULT_PROVIDER = 'openrouter';
const DEFAULT_OPENROUTER_MODEL = 'google/gemini-2.0-flash-001';
const IGNITE_SYSTEM_PROMPT = `You are FORGE, a ruthless founder ignition engine.
Your job is to validate the idea, not generate a generic plan.
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
- Frame the answer as an IGNITE validation pass for the idea.
- Make the verdict blunt, specific, and grounded in the idea's customer pain, payment story, and evidence gap.
- Name the first customer, what they are buying, and what evidence is missing.
- If the idea is weak, say it plainly and do not soften the language.
- Strengths should be the two strongest parts of the idea, not generic praise.
- Weaknesses should be the three biggest blockers, tied to the exact idea.
- Moves should be three concrete experiments or customer conversations that test the idea and reduce risk.
- Each string must be a short plain-English sentence with no markdown, bullets, links, or citations.
- Do not invent facts that are not implied by the idea unless you clearly label them as assumptions.`;

function coerceStructuredPayload(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return coerceStructuredPayload(JSON.parse(value));
    } catch {
      return value;
    }
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') {
      return coerceStructuredPayload(record.text);
    }
    if (typeof record.content === 'string') {
      return coerceStructuredPayload(record.content);
    }
  }

  return value;
}

function normalizeStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const cleaned = value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);

  return cleaned.length ? cleaned : fallback;
}

function parseMVPResponse(rawResponse: unknown): MVPResult {
  const fallback = {
    score: 35,
    verdict: 'The idea is not yet defensible without a clear customer, a painful problem, and proof that people will pay.',
    strengths: ['The idea has a clear use case, but the market proof is still missing.'],
    weaknesses: ['The business case is still too vague, and the first customer is not pinned down.'],
    moves: ['Talk to 5 people who fit the customer profile.', 'Define the offer in one sentence.', 'Measure whether they say yes, not just like it.'],
  };

  const parsed = coerceStructuredPayload(rawResponse);

  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>;

    return {
      score: typeof record.score === 'number' ? Math.min(100, Math.max(0, Math.round(record.score))) : fallback.score,
      verdict: typeof record.verdict === 'string' && record.verdict.trim() ? record.verdict.trim() : fallback.verdict,
      strengths: normalizeStringArray(record.strengths, fallback.strengths),
      weaknesses: normalizeStringArray(record.weaknesses, fallback.weaknesses),
      moves: normalizeStringArray(record.moves, fallback.moves),
    };
  }

  const text = typeof parsed === 'string' ? parsed.trim() : '';
  if (!text) {
    return {
      score: fallback.score,
      verdict: fallback.verdict,
      strengths: [...fallback.strengths],
      weaknesses: [...fallback.weaknesses],
      moves: [...fallback.moves],
    };
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const sections = {
    verdict: [] as string[],
    strengths: [] as string[],
    weaknesses: [] as string[],
    moves: [] as string[],
  };

  let current: keyof typeof sections | null = null;
  const scoreMatch = text.match(/score[:\s-]*([0-9]{1,3})\s*%?/i);
  const score = scoreMatch ? Math.min(100, Math.max(0, Number(scoreMatch[1]))) : fallback.score;

  for (const line of lines) {
    const cleaned = line.replace(/^[-*]\s*/, '');
    const lowered = cleaned.toLowerCase();

    if (lowered.startsWith('verdict')) {
      current = 'verdict';
      sections.verdict.push(cleaned.replace(/^verdict[:\-\s]*/i, ''));
      continue;
    }

    if (lowered.startsWith('what is working') || lowered.startsWith('strengths')) {
      current = 'strengths';
      continue;
    }

    if (lowered.startsWith('what is wrong') || lowered.startsWith('weaknesses')) {
      current = 'weaknesses';
      continue;
    }

    if (lowered.startsWith('what to do next') || lowered.startsWith('next moves') || lowered.startsWith('next 3 moves')) {
      current = 'moves';
      continue;
    }

    if (current) {
      sections[current].push(cleaned);
    }
  }

  return {
    score,
    verdict: sections.verdict.join(' ').trim() || fallback.verdict,
    strengths: sections.strengths.length ? sections.strengths : [...fallback.strengths],
    weaknesses: sections.weaknesses.length ? sections.weaknesses : [...fallback.weaknesses],
    moves: sections.moves.length ? sections.moves : [...fallback.moves],
  };
}

export default function MVPApp() {
  const [idea, setIdea] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<MVPResult | null>(null);

  useEffect(() => {
    captureEvent('forge_mvp_viewed');

    if (!isSupabaseConfigured) {
      return;
    }

    void getCurrentSessionUser().then((user: { id: string; email?: string } | null) => {
      if (!user) {
        return;
      }

      if (user.email) {
        identifyUser(user.id, user.email);
        return;
      }

      identifyUser(user.id);
    });
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved);
      if (parsed?.idea) {
        setIdea(parsed.idea);
      }
      if (parsed?.result) {
        setResult(parsed.result);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!idea && !result) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        idea,
        result,
      })
    );
  }, [idea, result]);

  const igniteIdea = async () => {
    const trimmedIdea = idea.trim();
    if (!trimmedIdea) {
      setError('Add your idea first.');
      return;
    }

    setLoading(true);
    setError('');
    captureEvent('forge_ignite_attempted', { idea_length: trimmedIdea.length });

    try {
      const response = await fetch('/api/forge/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: DEFAULT_PROVIDER,
          model: DEFAULT_OPENROUTER_MODEL,
          temperature: 0.5,
          system: IGNITE_SYSTEM_PROMPT,
          user: `Idea: ${trimmedIdea}`,
          maxTokens: 800,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error || 'Something went wrong.');
      }

      const nextResult = parseMVPResponse(data);
      setResult(nextResult);
      captureEvent('forge_ignite_generated', { score: nextResult.score });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to ignite your idea right now.';
      setError(message);
      captureEvent('forge_ignite_failed', { error: message });
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    captureEvent('forge_ignite_reset');
    setIdea('');
    setResult(null);
    setError('');
  };

  return (
    <div className="mvp-shell">
      <div className="mvp-layout">
        <section className="mvp-hero">
          <p className="mvp-kicker">FORGE IGNITE</p>
          <h1>Drop in your idea and ignite the validation.</h1>
          <p className="mvp-subcopy">
            One idea. One ruthless score. One fast read on whether it is worth building, testing, or killing.
          </p>
          <div className="mvp-hero-badges">
            <span>IGNITE</span>
            <span>Simple</span>
            <span>Founder-first</span>
          </div>
        </section>

        <section className="mvp-card">
          <div className="mvp-card-header">
            <div>
              <p className="mvp-card-label">What are you building?</p>
              <h2>Describe the idea in one clean pass</h2>
            </div>
            <span className="mvp-pill">Beta</span>
          </div>

          <label className="mvp-field-label" htmlFor="idea-input">
            Idea
          </label>
          <textarea
            id="idea-input"
            className="mvp-textarea"
            placeholder="Example: A mobile tool that helps local shops send reminder texts to customers."
            value={idea}
            onChange={(event) => setIdea(event.target.value)}
            rows={6}
          />

          <div className="mvp-actions">
            <button className="mvp-btn primary" onClick={igniteIdea} disabled={loading}>
              {loading ? 'Igniting…' : 'IGNITE'}
            </button>
            <button className="mvp-btn secondary" onClick={reset} disabled={loading}>
              Clear
            </button>
          </div>

          {error && <p className="mvp-error">{error}</p>}
        </section>

        <section className="mvp-results">
          {result ? (
            <>
              <div className="mvp-card">
                <div className="mvp-card-header">
                  <div>
                    <p className="mvp-card-label">Your result</p>
                    <h2>Idea validity</h2>
                  </div>
                  <span className="mvp-score">{result.score}%</span>
                </div>
                <p className="mvp-verdict">{result.verdict}</p>
                <p className="mvp-score-note">Only one score is shown here: this is the current validity of the idea.</p>
              </div>

              <div className="mvp-grid">
                <div className="mvp-card">
                  <p className="mvp-card-label">What is wrong</p>
                  <ul className="mvp-list">
                    {result.weaknesses.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div className="mvp-card">
                  <p className="mvp-card-label">What is working</p>
                  <ul className="mvp-list">
                    {result.strengths.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div className="mvp-card">
                  <p className="mvp-card-label">What to do next</p>
                  <ul className="mvp-list">
                    {result.moves.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="mvp-card">
                <div className="mvp-card-header">
                  <div>
                    <p className="mvp-card-label">Coach's reality check</p>
                    <h2>What to do before you build</h2>
                  </div>
                </div>
                <p className="mvp-verdict">
                  If you cannot name your first customer, explain why they are in pain today, and show how you will reach them in the next 7 days, the honest answer is: do not build yet.
                </p>
                <ul className="mvp-list">
                  <li>
                    <strong>Example:</strong> If your idea helps local shops send reminders, your first test is not an app. It is a one-page offer, a 5-minute demo, and 3 real owners saying they would pay.
                  </li>
                  <li>
                    <strong>Personal advice:</strong> Do not ask your friends if it is good. Ask the person who feels the pain and has money. If they hesitate, you are not solving a real problem yet.
                  </li>
                  <li>
                    <strong>Hard rule:</strong> If you cannot get one honest buyer signal in 48 hours, treat that as a failure and cut the scope. Do not add features to hide the weakness.
                  </li>
                </ul>
              </div>
            </>
          ) : (
            <div className="mvp-card placeholder-card">
              <p className="mvp-card-label">Ready to launch</p>
              <h2>Use IGNITE to pressure-test your idea fast.</h2>
              <p className="mvp-subcopy">
                This version is built for speed: one idea in, one clear validation out. No clutter, no extra steps.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
