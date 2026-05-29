// @ts-nocheck
import { useState, useRef, useEffect, useCallback, useMemo } from "react";

const Q_TARGET = 6;
const LIME = "#C8FF00";
const PURPLE = "#B87FFF";
const ORANGE = "#FF6B00";
const PINK = "#FF3C78";
const CYAN = "#00D4FF";
const TEXT_MUTED = "#d7d7d7";
const TEXT_DIM = "#b8b8b8";
const TEXT_SOFT = "#8f8f8f";
const BRANCH_COLORS = [LIME, ORANGE, CYAN, PINK, PURPLE, "#00FFB2"];
const DEFAULT_PROVIDER = "mock";
const OPENROUTER_DEFAULT_MODEL = "deepseek/deepseek-v4-flash:free";
const OPENROUTER_MODELS = [
  { label: "DeepSeek v4 Flash (free)", value: "deepseek/deepseek-v4-flash:free" },
  { label: "GPT-4.1 mini", value: "openai/gpt-4.1-mini" },
  { label: "GPT-4o mini", value: "openai/gpt-4o-mini" },
  { label: "Llama 3.3 70B", value: "meta-llama/llama-3.3-70b-instruct" },
  { label: "Gemini 2.0 Flash", value: "google/gemini-2.0-flash-001" },
  { label: "Claude 3.5 Sonnet", value: "anthropic/claude-3.5-sonnet" },
];
const PROVIDERS = {
  gemini: {
    label: "Google Gemini",
    keyLabel: "Google Gemini API key",
    keyExample: "AIzaSy...",
    model: "gemini-2.0-flash",
    path: "/api/gemini/v1beta/models",
  },
  anthropic: {
    label: "Anthropic",
    keyLabel: "Anthropic API key",
    keyExample: "sk-ant-...",
    model: "claude-sonnet-4-20250514",
    path: "/api/anthropic/v1/messages",
  },
  mock: {
    label: "Local Demo AI (free)",
    keyLabel: "No key required",
    keyExample: "Leave blank",
    model: "demo",
    path: "/api/mock/v1",
  },
  huggingface: {
    label: "Hugging Face",
    keyLabel: "Hugging Face API key",
    keyExample: "hf_...",
    model: "google/flan-t5-large",
    path: "/api/huggingface/v1",
  },
  openrouter: {
    label: "OpenRouter",
    keyLabel: "OpenRouter API key",
    keyExample: "sk-or-v1-...",
    model: OPENROUTER_DEFAULT_MODEL,
    path: "/api/openrouter/v1",
  },
};

const PRODUCT_PATHS = {
  b2b_saas: {
    label: 'B2B SaaS',
    description: 'Target business buyers with a subscription product, pricing tiers, and a revenue operations strategy.',
    focus: 'Ask for customer willingness to pay, enterprise buyer decision criteria, and channel-led adoption.',
    guidance: ['Clarify the exact buyer role and the workflow you are replacing.', 'Frame pricing with contract value and payback time.', 'Surface how you will convert a trial lead into a paid account.'],
  },
  fintech: {
    label: 'Fintech',
    description: 'Build in a regulated payment or embedded finance motion with trust, compliance, and liquidity built-in.',
    focus: 'Probe banks, compliance, partner integrations, and regulatory risk alongside customer payment clarity.',
    guidance: ['Name the financial flow and the party who pays for trust.', 'Detail the compliance or risk check that earns you credibility.', 'Show how the revenue model is tied to transaction volume or take rate.'],
  },
  consumer_app: {
    label: 'Consumer App',
    description: 'Launch a consumer-facing experience that captures retention, daily use, and viral growth.',
    focus: 'Focus on onboarding, retention hooks, acquisition cost, and pricing/monetization fit.',
    guidance: ['Be explicit about the customer segment and their emotional job to be done.', 'Capture the exact product habit or network effect you want to create.', 'Define how you will measure early traction and retention.'],
  },
};

const WORKFLOW_MODES = {
  explorer: {
    label: 'Explorer',
    details: 'Your idea is still fuzzy. The engine will help you turn raw intuition into a testable thesis and a validated problem statement.',
  },
  validator: {
    label: 'Validator',
    details: 'Your concept exists. The engine will stress-test assumptions, willingness to pay, and product-market fit before you scale.',
  },
  operator: {
    label: 'Operator',
    details: 'You have a product or pilot. The engine will build the execution plan, rollout sequence, and operational checklist.',
  },
};

function providerConfig(provider, modelOverride) {
  const base = PROVIDERS[provider] || PROVIDERS[DEFAULT_PROVIDER];
  return {
    ...base,
    model: modelOverride || base.model,
  };
}

function providerKeyLabel(provider) {
  return providerConfig(provider).keyLabel;
}

const STORAGE_KEYS = {
  users: "forge-users",
  currentUser: "forge-current-user",
  profile: "forge-founder-profile",
  memory: "forge-memory-log",
  history: "forge-idea-history",
};
const WAITLIST_KEY = "forge-waitlist";
const PRICING_TIERS = [
  {
    name: "Free",
    price: "$0",
    summary: "For first experiments and ruthless validation",
    perks: ["5 forge runs / day", "Guest access", "Saved outputs after sign in"],
  },
  {
    name: "Pro",
    price: "$12/mo",
    summary: "For founders who want faster decisions and saved momentum",
    perks: ["Unlimited outputs", "Saved projects", "Priority regen", "Founder memory + export"],
  },
];

function safeParse(value, fallback) {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function uid() {
  return `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function defaultFounderProfile() {
  return {
    name: "",
    stage: "pre-revenue",
    geo: "",
    customer: "",
    problem: "",
    solution: "",
    market: "",
    revenue: "",
    channels: "",
    constraints: "",
    strengths: "",
    risks: "",
    goals: "",
  };
}

function resolveTheme(mode) {
  const isDark = mode === "dark";
  return isDark
    ? {
        pageBg: "#070707",
        panelBg: "#0a0a0a",
        panelAlt: "#090909",
        border: "#171717",
        borderSoft: "#141414",
        textPrimary: "#f0f0f0",
        textMuted: "#d7d7d7",
        textDim: "#b8b8b8",
        textSoft: "#8f8f8f",
        shadow: "rgba(0, 0, 0, 0.35)",
      }
    : {
        pageBg: "#f5f7fb",
        panelBg: "#ffffff",
        panelAlt: "#f3f6fb",
        border: "#d8dee8",
        borderSoft: "#e5eaf1",
        textPrimary: "#111827",
        textMuted: "#1f2937",
        textDim: "#4b5563",
        textSoft: "#6b7280",
        shadow: "rgba(15, 23, 42, 0.08)",
      };
}

function getRealityCheck(profile) {
  const requiredFields = [
    ["customer", "customer persona"],
    ["problem", "problem statement"],
    ["solution", "solution"],
    ["market", "market / traction thesis"],
    ["revenue", "revenue model"],
  ];
  const missing = requiredFields
    .filter(([key]) => !(profile?.[key] || "").trim())
    .map(([, label]) => label);
  const readiness = Math.max(0, Math.round((100 / requiredFields.length) * (requiredFields.length - missing.length)));
  return { missing, readiness };
}

function buildFounderContext(profile, currentUser, memory, idea, productTrack, workflowMode) {
  const track = PRODUCT_PATHS[productTrack] || PRODUCT_PATHS.b2b_saas;
  const mode = WORKFLOW_MODES[workflowMode] || WORKFLOW_MODES.explorer;
  const snapshot = [
    `Founder: ${currentUser?.name || currentUser?.email || "Unknown founder"}`,
    `Stage: ${(profile?.stage || "pre-revenue").trim() || "pre-revenue"}`,
    `Geo: ${(profile?.geo || "Not set").trim() || "Not set"}`,
    `Track: ${track.label}`,
    `Workflow: ${mode.label}`,
    `Customer: ${(profile?.customer || "Not set").trim() || "Not set"}`,
    `Problem: ${(profile?.problem || "Not set").trim() || "Not set"}`,
    `Solution: ${(profile?.solution || "Not set").trim() || "Not set"}`,
    `Market: ${(profile?.market || "Not set").trim() || "Not set"}`,
    `Revenue model: ${(profile?.revenue || "Not set").trim() || "Not set"}`,
    `Channels: ${(profile?.channels || "Not set").trim() || "Not set"}`,
    `Constraints: ${(profile?.constraints || "Not set").trim() || "Not set"}`,
    `Strengths: ${(profile?.strengths || "Not set").trim() || "Not set"}`,
    `Risks: ${(profile?.risks || "Not set").trim() || "Not set"}`,
    `Goals: ${(profile?.goals || "Not set").trim() || "Not set"}`,
  ];

  if (idea?.trim()) {
    snapshot.push(`Current idea: ${idea.trim()}`);
  }

  if (Array.isArray(memory) && memory.length) {
    const recent = memory.slice(0, 4).map((entry) => `- ${entry.note}`);
    snapshot.push(`Recent memory:\n${recent.join("\n")}`);
  }

  return snapshot.join("\n");
}

function buildQuestionSystem(productTrack, workflowMode) {
  const track = PRODUCT_PATHS[productTrack] || PRODUCT_PATHS.b2b_saas;
  const mode = WORKFLOW_MODES[workflowMode] || WORKFLOW_MODES.explorer;
  return `You are FORGE — the ruthless founder decision engine.
Track: ${track.label}. Focus: ${track.focus}.
Workflow mode: ${mode.label}. ${mode.details}
Ask one direct, decision-driving question at a time. Prioritize paying customers, testable assumptions, execution risks, and go-to-market clarity. Keep the question tightly tied to the current idea and the founder's company context. Return ONLY the question.`;
}

function buildScoreSystem(productTrack, workflowMode) {
  const track = PRODUCT_PATHS[productTrack] || PRODUCT_PATHS.b2b_saas;
  const mode = WORKFLOW_MODES[workflowMode] || WORKFLOW_MODES.explorer;
  return `You are FORGE — score this idea for the ${track.label} path and the ${mode.label} founder workflow.
Return JSON only with these fields:
{
  "score": 0,
  "label": "",
  "verdict": "",
  "strengths": [""],
  "gaps": [""],
  "metrics": {
    "problem_severity": 0,
    "willingness_to_pay": 0,
    "differentiation": 0,
    "execution_risk": 0
  },
  "evidence_links": [""],
  "user_input_summary": "",
  "forge_inference_summary": ""
}`;
}

function normalizeIdeaScore(score) {
  const rawScore = typeof score?.score === "number" ? score.score : Number(score?.score ?? 0);
  const numeric = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0;
  const label = score?.label || (numeric >= 80 ? "Exceptional" : numeric >= 60 ? "Strong" : numeric >= 40 ? "Solid" : numeric >= 20 ? "Needs Work" : "Weak");
  const verdict = score?.verdict || (numeric >= 80 ? "This is a founder-grade shot. Tighten execution and test market motion." : numeric >= 60 ? "A solid thesis with a few decisive gaps to close." : numeric >= 40 ? "Promising, but the proof stack is still underbuilt." : "The core claim is not strong enough yet; attack the biggest assumption first.");
  const strengths = Array.isArray(score?.strengths) ? score.strengths : [];
  const gaps = Array.isArray(score?.gaps) ? score.gaps : [];
  const metrics = typeof score?.metrics === "object" && score?.metrics !== null ? score.metrics : {
    problem_severity: 0,
    willingness_to_pay: 0,
    differentiation: 0,
    execution_risk: 0,
  };
  const evidence_links = Array.isArray(score?.evidence_links) ? score.evidence_links.filter(Boolean) : [];

  return { ...score, score: numeric, label, verdict, strengths, gaps, metrics, evidence_links };
}

function formatExportContent(type, data, idea) {
  const title = type === "mindmap" ? "FORGE Mind Map" : type === "blueprint" ? "FORGE Blueprint" : type === "roadmap" ? "FORGE Roadmap" : type === "businessplan" ? "FORGE Business Plan" : type === "actionplan" ? "FORGE 30-Day Plan" : type === "swot" ? "FORGE SWOT" : "FORGE Output";
  const lines = [title, "Built with FORGE", "https://forge.local", `Generated: ${new Date().toLocaleString()}`, `Idea: ${idea || "Untitled idea"}`];

  if (!data) {
    return lines.join("\n\n");
  }

  if (type === "mindmap") {
    lines.push("Center:", String(data.center || "IDEA"));
    (data.branches || []).forEach((branch) => {
      lines.push(`\nBranch: ${branch.label || "Branch"}`);
      (branch.nodes || []).forEach((node) => lines.push(`- ${node}`));
    });
    return lines.join("\n");
  }

  if (type === "blueprint") {
    lines.push("Vision:", String(data.vision || ""), "Sections:");
    (data.sections || []).forEach((section) => {
      lines.push(`\n${section.title || "Section"}`);
      if (section.content) lines.push(section.content);
      (section.bullets || []).forEach((bullet) => lines.push(`- ${bullet}`));
    });
    return lines.join("\n");
  }

  if (type === "roadmap") {
    lines.push("Phases:");
    (data.phases || []).forEach((phase) => {
      lines.push(`\n${phase.phase || "Phase"} (${phase.duration || ""})`);
      lines.push(phase.title || "");
      lines.push(phase.goal || "");
      (phase.milestones || []).forEach((milestone) => lines.push(`- ${milestone}`));
    });
    return lines.join("\n");
  }

  if (type === "businessplan") {
    lines.push("Business Plan:");
    (data.sections || []).forEach((section) => {
      lines.push(`\n${section.title || "Section"}`);
      lines.push(section.content || "");
    });
    return lines.join("\n");
  }

  if (type === "actionplan") {
    lines.push("30-Day Action Plan:");
    (data.weeks || []).forEach((week) => {
      lines.push(`\n${week.week || "Week"}: ${week.focus || ""}`);
      (week.tasks || []).forEach((task) => lines.push(`- ${task.task || task} | ${task.outcome || ""}`));
    });
    return lines.join("\n");
  }

  if (type === "swot") {
    lines.push("SWOT Summary:");
    ["strengths", "weaknesses", "opportunities", "threats"].forEach((key) => {
      lines.push(`\n${key.toUpperCase()}`);
      (data[key] || []).forEach((item) => lines.push(`- ${item}`));
    });
    if (data.strategic_insight) {
      lines.push(`\nStrategic insight:\n${data.strategic_insight}`);
    }
    return lines.join("\n");
  }

  return lines.join("\n\n");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPrintableHtml(type, data, idea) {
  const generatedAt = new Date().toLocaleString();
  const safeIdea = escapeHtml(idea || "Untitled idea");

  const header = `
    <div class="hero">
      <div>
        <p class="eyebrow">FORGE</p>
        <h1>Founder export</h1>
      </div>
      <div class="meta">
        <p>${escapeHtml(type)}</p>
        <p>${escapeHtml(generatedAt)}</p>
        <p>Built with FORGE</p>
      </div>
    </div>
    <div class="summary">
      <p><strong>Idea:</strong> ${safeIdea}</p>
    </div>
  `;

  if (type === "mindmap") {
    const branches = (data.branches || []).map((branch) => `
      <div class="card">
        <h3>${escapeHtml(branch.label || "Branch")}</h3>
        <ul>${(branch.nodes || []).map((node) => `<li>${escapeHtml(node)}</li>`).join("")}</ul>
      </div>`).join("");

    return `
      ${header}
      <section>
        <h2>Center</h2>
        <p>${escapeHtml(data.center || "IDEA")}</p>
      </section>
      <section class="grid">${branches}</section>
    `;
  }

  if (type === "blueprint") {
    const sections = (data.sections || []).map((section) => `
      <div class="card">
        <h3>${escapeHtml(section.title || "Section")}</h3>
        ${section.content ? `<p>${escapeHtml(section.content)}</p>` : ""}
        ${(section.bullets || []).length ? `<ul>${(section.bullets || []).map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>` : ""}
      </div>`).join("");

    return `
      ${header}
      <section>
        <h2>Vision</h2>
        <p>${escapeHtml(data.vision || "")}</p>
      </section>
      <section class="grid">${sections}</section>
    `;
  }

  if (type === "roadmap") {
    const phases = (data.phases || []).map((phase) => `
      <div class="card">
        <h3>${escapeHtml(phase.phase || "Phase")}</h3>
        <p><strong>${escapeHtml(phase.title || "")}</strong></p>
        <p>${escapeHtml(phase.goal || "")}</p>
        <p><strong>Duration:</strong> ${escapeHtml(phase.duration || "")}</p>
        ${(phase.milestones || []).length ? `<ul>${(phase.milestones || []).map((milestone) => `<li>${escapeHtml(milestone)}</li>`).join("")}</ul>` : ""}
        ${(phase.kpis || []).length ? `<ul>${(phase.kpis || []).map((kpi) => `<li>${escapeHtml(kpi)}</li>`).join("")}</ul>` : ""}
      </div>`).join("");

    return `${header}<section class="grid">${phases}</section>`;
  }

  if (type === "businessplan") {
    const sections = (data.sections || []).map((section) => `
      <div class="card">
        <h3>${escapeHtml(section.title || "Section")}</h3>
        <p>${escapeHtml(section.content || "")}</p>
      </div>`).join("");

    return `${header}<section class="grid">${sections}</section>`;
  }

  if (type === "actionplan") {
    const weeks = (data.weeks || []).map((week) => `
      <div class="card">
        <h3>${escapeHtml(week.week || "Week")}</h3>
        <p><strong>${escapeHtml(week.focus || "")}</strong></p>
        <ul>${(week.tasks || []).map((task) => `
          <li>
            <strong>${escapeHtml(task.task || task)}</strong>
            <div>Priority: ${escapeHtml(task.priority || "MED")}</div>
            <div>Outcome: ${escapeHtml(task.outcome || "")}</div>
            ${task.tool ? `<div>Tool: ${escapeHtml(task.tool)}</div>` : ""}
            ${task.script ? `<div>Script: ${escapeHtml(task.script)}</div>` : ""}
            ${task.failure ? `<div>Failure condition: ${escapeHtml(task.failure)}</div>` : ""}
          </li>`).join("")}</ul>
      </div>`).join("");

    return `${header}<section class="grid">${weeks}</section>`;
  }

  if (type === "swot") {
    const groups = [
      ["strengths", "Strengths"],
      ["weaknesses", "Weaknesses"],
      ["opportunities", "Opportunities"],
      ["threats", "Threats"],
    ].map(([key, label]) => `
      <div class="card">
        <h3>${escapeHtml(label)}</h3>
        <ul>${(data[key] || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>`).join("");

    return `
      ${header}
      <section class="grid">${groups}</section>
      ${data.strategic_insight ? `<section class="card"><h2>Strategic Read</h2><p>${escapeHtml(data.strategic_insight)}</p></section>` : ""}
    `;
  }

  return `${header}<section class="card"><p>${escapeHtml(JSON.stringify(data))}</p></section>`;
}

function extractErrorText(res) {
  return res.text().catch(() => "");
}

async function callForgeAPI(payload) {
  const res = await fetch("/api/forge/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await extractErrorText(res);
    throw new Error(`HTTP ${res.status}${text ? `: ${text}` : ""}`);
  }

  const data = await res.json();
  if (!data?.text) throw new Error("Empty response");
  return data.text;
}

async function aiStream(system, user, onChunk, maxTok = 1400, apiKey = "", provider = DEFAULT_PROVIDER, model = "") {
  const key = apiKey.trim();
  const config = providerConfig(provider, model);
  const full = await callForgeAPI({
    system,
    user,
    provider,
    model: config.model,
    maxTokens: maxTok,
    apiKey: key,
  });

  onChunk(full);
  return full;
}

async function ai(system, user, asJSON = false, maxTok = 1400, retries = 2, apiKey = "", provider = DEFAULT_PROVIDER, model = "") {
  for (let i = 0; i <= retries; i++) {
    try {
      let full = "";
      await aiStream(system, user, (t) => {
        full = t;
      }, maxTok, apiKey, provider, model);
      if (!full) throw new Error("Empty response");
      if (!asJSON) return full;
      return extractJSON(full);
    } catch (e) {
      if (i === retries) throw e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
}

function extractJSON(raw) {
  let s = raw || "";
  
  // Remove any <think> reasoning blocks if using a reasoning model
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, "");
  
  // Strip code blocks and markdown fences
  s = s.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON found in response");
  
  s = s.slice(start, end + 1);
  
  // Strip trailing commas from arrays and objects
  s = s.replace(/,\s*([}\]])/g, "$1");
  
  // Remove control characters
  s = s.replace(/\p{Cc}/gu, "");
  
  try {
    return JSON.parse(s);
  } catch (err) {
    try {
      // Fallback repair: replace unescaped newlines inside JSON strings with spaces
      const repaired = s.replace(/\r?\n/g, " ");
      return JSON.parse(repaired);
    } catch {
      throw new Error(`JSON Parse Failure: ${err.message}`);
    }
  }
}

// ── PARALLEL PREFETCH ─────────────────────────────────────
function usePrefetch(apiKey, provider, model) {
  const cache = useRef({});
  const prefetch = useCallback(
    (sys, prompt, key) => {
      if (cache.current[key]) return;
      cache.current[key] = ai(sys, prompt, false, 600, 2, apiKey, provider, model);
    },
    [apiKey, provider, model]
  );
  const consume = useCallback(async (key) => {
    if (cache.current[key]) {
      const val = await cache.current[key];
      delete cache.current[key];
      return val;
    }
    return null;
  }, []);
  return { prefetch, consume };
}

// ── MARKDOWN ──────────────────────────────────────────────
function Md({ text }) {
  const lines = (text || "").split("\n");
  return (
    <div style={{ fontFamily: "monospace" }}>
      {lines.map((line, i) => {
        if (!line.trim()) return <div key={i} style={{ height: "0.55rem" }} />;
        const isH2 = line.startsWith("## ");
        const isH3 = line.startsWith("### ");
        const isBullet = /^[-→•]\s/.test(line.trim());
        const content = line.replace(/^#+\s/, "").replace(/^[-→•]\s/, "");
        const html = content.replace(/\*\*(.+?)\*\*/g, "<strong style='color:#e8e8e8'>$1</strong>");
        return (
          <div
            key={i}
            style={{
              marginBottom: isH2 ? "0.9rem" : "0.15rem",
              marginTop: isH2 ? "1.3rem" : isH3 ? "0.7rem" : 0,
              fontSize: isH2 ? "0.88rem" : "0.81rem",
              fontWeight: isH2 || isH3 ? "bold" : "normal",
              color: isH2 ? LIME : isH3 ? "#ddd" : isBullet ? "#999" : "#bbb",
              lineHeight: "1.72",
              paddingLeft: isBullet ? "1rem" : 0,
              position: "relative",
            }}
          >
            {isBullet && <span style={{ position: "absolute", left: 0, color: LIME }}>→</span>}
            <span dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        );
      })}
    </div>
  );
}

// ── INTERACTIVE MIND MAP ──────────────────────────────────
function MindMap({ data }) {
  const svgRef = useRef(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState(null);
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);

  const W = 1100,
    H = 720,
    cx = W / 2,
    cy = H / 2;
  const bR = 210,
    nR = 125;
  const branches = (data.branches || []).slice(0, 6);
  const N = branches.length;

  const wrap = (txt, max) => {
    if (!txt) return [""];
    const words = String(txt).split(" ");
    const lines = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).trim().length > max) {
        lines.push(cur.trim());
        cur = w;
      } else cur = (cur + " " + w).trim();
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 2);
  };

  const positions = useMemo(() => {
    return branches.map((b, i) => {
      const angle = (i / N) * 2 * Math.PI - Math.PI / 2;
      const bx = cx + Math.cos(angle) * bR;
      const by = cy + Math.sin(angle) * bR;
      const nodes = (b.nodes || []).slice(0, 4).map((node, j) => {
        const nAngle = angle + (j - (Math.max((b.nodes || []).slice(0, 4).length, 1) - 1) / 2) * 0.44;
        return {
          node,
          nAngle,
          nx: bx + Math.cos(nAngle) * nR,
          ny: by + Math.sin(nAngle) * nR,
        };
      });
      return { angle, bx, by, nodes };
    });
  }, [branches, cx, cy, N]);

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    setDragging(true);
    setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y });
  };
  const onMouseMove = (e) => {
    if (!dragging || !dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    const limitX = W * 0.7;
    const limitY = H * 0.7;
    const x = Math.max(-limitX, Math.min(limitX, dx));
    const y = Math.max(-limitY, Math.min(limitY, dy));
    setTransform((t) => ({ ...t, x, y }));
  };
  const onMouseUp = () => {
    setDragging(false);
    setDragStart(null);
  };

  const onWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.09;
    setTransform((t) => ({ ...t, scale: Math.min(Math.max(t.scale * factor, 0.3), 3) }));
  };

  const resetView = () => setTransform({ x: 0, y: 0, scale: 1 });
  const fitAll = () => setTransform({ x: 0, y: 0, scale: 0.72 });

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const isSelected = (key) => selected === key;
  const isHov = (key) => hovered === key;

  return (
    <div style={{ position: "relative", background: "#060606", borderRadius: "12px", overflow: "hidden" }}>
      <div style={{ position: "absolute", top: "12px", right: "12px", display: "flex", gap: "6px", zIndex: 10 }}>
        {[{ label: "+", action: () => setTransform((t) => ({ ...t, scale: Math.min(t.scale * 1.2, 3) })) }, { label: "−", action: () => setTransform((t) => ({ ...t, scale: Math.max(t.scale * 0.83, 0.3) })) }, { label: "⊡", action: fitAll }, { label: "↺", action: resetView }].map((b, i) => (
          <button
            key={i}
            onClick={b.action}
            style={{ background: "#111", border: "1px solid #222", color: "#555", borderRadius: "5px", width: "28px", height: "28px", cursor: "pointer", fontSize: "0.85rem", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "monospace", transition: "all .15s" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = LIME;
              e.currentTarget.style.color = LIME;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#222";
              e.currentTarget.style.color = "#555";
            }}
          >
            {b.label}
          </button>
        ))}
      </div>
      <div style={{ position: "absolute", bottom: "10px", left: "12px", color: "#1e1e1e", fontSize: "0.58rem", fontFamily: "monospace", zIndex: 10 }}>
        drag to pan · scroll to zoom · click nodes to highlight
      </div>
      {selected && (
        <div style={{ position: "absolute", bottom: "10px", right: "12px", background: "#0d0d0d", border: `1px solid ${LIME}30`, borderRadius: "6px", padding: "6px 12px", zIndex: 10, maxWidth: "200px" }}>
          <div style={{ color: LIME, fontSize: "0.58rem", letterSpacing: "2px", marginBottom: "2px" }}>SELECTED</div>
          <div style={{ color: "#ccc", fontSize: "0.74rem", fontFamily: "monospace" }}>{selected}</div>
        </div>
      )}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block", cursor: dragging ? "grabbing" : "grab", userSelect: "none" }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <defs>
          <filter id="glow"><feGaussianBlur stdDeviation="4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <filter id="glow2"><feGaussianBlur stdDeviation="2" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          {branches.map((b, i) => {
            const c = b.color || BRANCH_COLORS[i % 6];
            return (
              <radialGradient key={i} id={`rg${i}`} cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor={c} stopOpacity="0.25" />
                <stop offset="100%" stopColor={c} stopOpacity="0.04" />
              </radialGradient>
            );
          })}
        </defs>
        <rect width={W} height={H} fill="#060606" />

        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.scale})`} style={{ transformOrigin: `${cx}px ${cy}px` }}>
          <circle cx={cx} cy={cy} r={90} fill={LIME} opacity="0.05" filter="url(#glow)" />
          <circle cx={cx} cy={cy} r={72} fill={LIME} filter="url(#glow2)" />
          {wrap(data.center || "IDEA", 11).map((ln, i, arr) => (
            <text key={i} x={cx} y={cy + (i - (arr.length - 1) / 2) * 17} textAnchor="middle" dominantBaseline="middle" fontSize="13" fontWeight="900" fill="#000" fontFamily="monospace">
              {ln}
            </text>
          ))}

          {positions.map((pos, i) => {
            const b = branches[i];
            const color = b.color || BRANCH_COLORS[i % 6];
            const branchKey = b.label || `branch${i}`;
            const isBSel = isSelected(branchKey);
            const isBHov = isHov(branchKey);
            const active = isBSel || isBHov;

            return (
              <g key={i}>
                <line x1={cx + Math.cos(pos.angle) * 74} y1={cy + Math.sin(pos.angle) * 74} x2={pos.bx} y2={pos.by} stroke={color} strokeWidth={active ? 2.5 : 1.8} opacity={active ? 0.9 : 0.5} style={{ transition: "all .25s" }} />
                <ellipse cx={pos.bx} cy={pos.by} rx={active ? 64 : 60} ry={active ? 32 : 29} fill={`url(#rg${i})`} stroke={color} strokeWidth={active ? 2.2 : 1.5} opacity={active ? 1 : 0.85} style={{ transition: "all .25s", cursor: "pointer", filter: active ? `drop-shadow(0 0 6px ${color})` : "none" }} onClick={() => setSelected(isBSel ? null : branchKey)} onMouseEnter={() => setHovered(branchKey)} onMouseLeave={() => setHovered(null)} />
                {wrap(b.label || "", 13).map((ln, li) => (
                  <text key={li} x={pos.bx} y={pos.by + (li - (wrap(b.label || "", 13).length - 1) / 2) * 14} textAnchor="middle" dominantBaseline="middle" fontSize={active ? 12 : 11} fontWeight="bold" fill={color} fontFamily="monospace" style={{ transition: "all .2s", cursor: "pointer", pointerEvents: "none" }}>
                    {ln}
                  </text>
                ))}

                {pos.nodes.map(({ node, nAngle, nx, ny }, j) => {
                  const nodeKey = String(node || "");
                  const isNSel = isSelected(nodeKey);
                  const isNHov = isHov(nodeKey);
                  const nActive = isNSel || isNHov || isBSel;
                  const ls = wrap(nodeKey, 13);
                  const bh = ls.length * 17 + 12;
                  return (
                    <g key={j}>
                      <line x1={pos.bx + Math.cos(nAngle) * 62} y1={pos.by + Math.sin(nAngle) * 31} x2={nx - Math.cos(nAngle) * 52} y2={ny - Math.sin(nAngle) * (bh / 2)} stroke={color} strokeWidth={nActive ? 1.4 : 0.9} opacity={nActive ? 0.6 : 0.22} style={{ transition: "all .2s" }} />
                      <rect x={nx - 52} y={ny - bh / 2} width={104} height={bh} rx={6} fill={isNSel ? `${color}20` : "#0e0e0e"} stroke={color} strokeWidth={nActive ? 1.2 : 0.7} strokeOpacity={nActive ? 0.9 : 0.45} style={{ transition: "all .2s", cursor: "pointer", filter: isNSel ? `drop-shadow(0 0 4px ${color})` : "none" }} onClick={() => setSelected(isNSel ? null : nodeKey)} onMouseEnter={() => setHovered(nodeKey)} onMouseLeave={() => setHovered(null)} />
                      {ls.map((ln, li) => (
                        <text key={li} x={nx} y={ny - bh / 2 + li * 17 + 14} textAnchor="middle" dominantBaseline="middle" fontSize={nActive ? 9.5 : 8.5} fill={nActive ? "#e8e8e8" : "#aaa"} fontFamily="monospace" style={{ transition: "all .2s", pointerEvents: "none" }}>
                          {ln}
                        </text>
                      ))}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

// ── OUTPUT RENDERERS ──────────────────────────────────────
function Blueprint({ data, streaming }) {
  return (
    <div style={{ fontFamily: "monospace" }}>
      {streaming && <StreamBadge />}
      <h2 style={{ color: LIME, fontSize: "1.35rem", margin: "0 0 6px" }}>{data.title}</h2>
      <p style={{ color: "#444", fontSize: "0.85rem", margin: "0 0 2rem", fontStyle: "italic", lineHeight: "1.65" }}>{data.vision}</p>
      {(data.sections || []).map((s, i) => (
        <div key={i} style={{ marginBottom: "1.5rem", paddingLeft: "1.1rem", borderLeft: `2px solid ${LIME}25` }}>
          <div style={{ color: LIME, fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "3px", marginBottom: "0.35rem" }}>{s.title}</div>
          <p style={{ color: "#c8c8c8", fontSize: "0.85rem", lineHeight: "1.72", margin: "0 0 0.45rem" }}>{s.content}</p>
          {(s.bullets || []).map((b, j) => (
            <div key={j} style={{ color: "#555", fontSize: "0.78rem", marginBottom: "0.18rem", paddingLeft: "0.8rem" }}>→ {b}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Roadmap({ data, streaming }) {
  const cols = [LIME, ORANGE, CYAN, PINK];
  return (
    <div style={{ fontFamily: "monospace" }}>
      {streaming && <StreamBadge />}
      <h2 style={{ color: LIME, fontSize: "1.35rem", margin: "0 0 2rem" }}>{data.title}</h2>
      {(data.phases || []).map((p, i) => {
        const c = cols[i % 4];
        return (
          <div key={i} style={{ display: "flex", gap: "1.4rem", marginBottom: "2.2rem" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: "50px" }}>
              <div style={{ width: "46px", height: "46px", borderRadius: "50%", border: `2px solid ${c}`, display: "flex", alignItems: "center", justifyContent: "center", color: c, fontWeight: "900", fontSize: "1.1rem", background: `${c}0a` }}>{i + 1}</div>
              <div style={{ color: c, fontSize: "0.57rem", marginTop: "5px", textAlign: "center" }}>{p.duration}</div>
            </div>
            <div style={{ flex: 1, borderLeft: `1px solid ${c}18`, paddingLeft: "1.4rem" }}>
              <div style={{ color: c, fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "2.5px" }}>{p.phase}</div>
              <div style={{ color: "#f0f0f0", fontSize: "0.97rem", fontWeight: "bold", margin: "3px 0 7px" }}>{p.title}</div>
              <div style={{ color: "#888", fontSize: "0.82rem", marginBottom: "0.75rem", lineHeight: "1.6" }}>{p.goal}</div>
              {(p.milestones || []).map((m, j) => <div key={j} style={{ color: "#444", fontSize: "0.77rem", marginBottom: "0.18rem" }}>✓ {m}</div>)}
              {(p.kpis || []).length > 0 && (
                <div style={{ marginTop: "0.6rem", display: "flex", flexWrap: "wrap", gap: "5px" }}>
                  {p.kpis.map((k, j) => (
                    <span key={j} style={{ background: `${c}0f`, border: `1px solid ${c}28`, color: c, fontSize: "0.64rem", padding: "2px 7px", borderRadius: "3px" }}>{k}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BusinessPlan({ data, streaming }) {
  return (
    <div style={{ fontFamily: "monospace" }}>
      {streaming && <StreamBadge />}
      <h2 style={{ color: LIME, fontSize: "1.35rem", margin: "0 0 4px" }}>{data.title}</h2>
      <p style={{ color: ORANGE, fontSize: "0.9rem", margin: "0 0 1.8rem", fontStyle: "italic" }}>{data.oneliner}</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
        {(data.sections || []).map((s, i, arr) => (
          <div key={i} style={{ background: "#0a0a0a", border: "1px solid #171717", borderRadius: "8px", padding: "0.9rem", gridColumn: i === 0 || i === arr.length - 1 ? "1/-1" : "auto" }}>
            <div style={{ color: LIME, fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "2.5px", marginBottom: "0.4rem" }}>{s.title}</div>
            <p style={{ color: "#bbb", fontSize: "0.82rem", lineHeight: "1.68", margin: 0 }}>{s.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionPlan({ data, streaming }) {
  const pc = { HIGH: PINK, MED: ORANGE, LOW: LIME };
  const [done, setDone] = useState({});
  return (
    <div style={{ fontFamily: "monospace" }}>
      {streaming && <StreamBadge />}
      <h2 style={{ color: LIME, fontSize: "1.35rem", margin: "0 0 2rem" }}>{data.title}</h2>
      {(data.weeks || []).map((w, i) => (
        <div key={i} style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.65rem", paddingBottom: "0.4rem", borderBottom: "1px solid #121212" }}>
            <span style={{ color: LIME, fontWeight: "bold", fontSize: "0.77rem" }}>{w.week}</span>
            <span style={{ color: "#222", fontSize: "0.69rem" }}>— {w.focus}</span>
          </div>
          {(w.tasks || []).map((t, j) => {
            const p = (t.priority || "MED").toUpperCase().slice(0, 3);
            const c = pc[p] || "#888";
            const k = `${i}-${j}`;
            const isDone = done[k];
            return (
              <div
                key={j}
                onClick={() => setDone((d) => ({ ...d, [k]: !d[k] }))}
                style={{ display: "flex", gap: "0.85rem", alignItems: "flex-start", background: isDone ? "#0d0d0d" : "#0a0a0a", border: `1px solid ${isDone ? LIME + "20" : "#121212"}`, borderRadius: "6px", padding: "0.68rem 0.88rem", marginBottom: "0.35rem", cursor: "pointer", transition: "all .18s", opacity: isDone ? 0.5 : 1 }}
              >
                <span style={{ color: c, fontSize: "0.57rem", fontWeight: "bold", border: `1px solid ${c}`, padding: "2px 5px", borderRadius: "3px", minWidth: "28px", textAlign: "center", flexShrink: 0, marginTop: "2px" }}>{p}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: isDone ? "#555" : "#eee", fontSize: "0.83rem", marginBottom: "0.16rem", textDecoration: isDone ? "line-through" : "none" }}>{t.task}</div>
                  <div style={{ color: "#272727", fontSize: "0.72rem" }}>→ {t.outcome}</div>
                </div>
                <span style={{ color: isDone ? LIME : "#1e1e1e", fontSize: "0.9rem", flexShrink: 0, transition: "color .2s" }}>{isDone ? "✓" : "○"}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function SWOT({ data, streaming }) {
  const quads = [
    { key: "strengths", label: "Strengths", color: LIME, icon: "↑" },
    { key: "weaknesses", label: "Weaknesses", color: PINK, icon: "↓" },
    { key: "opportunities", label: "Opportunities", color: CYAN, icon: "→" },
    { key: "threats", label: "Threats", color: ORANGE, icon: "⚠" },
  ];
  return (
    <div style={{ fontFamily: "monospace" }}>
      {streaming && <StreamBadge />}
      <h2 style={{ color: LIME, fontSize: "1.35rem", margin: "0 0 4px" }}>{data.title}</h2>
      <p style={{ color: "#333", fontSize: "0.79rem", margin: "0 0 1.5rem" }}>{data.summary}</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.85rem" }}>
        {quads.map((q) => (
          <div key={q.key} style={{ background: "#0a0a0a", border: `1px solid ${q.color}18`, borderRadius: "10px", padding: "1.1rem" }}>
            <div style={{ color: q.color, fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "3px", marginBottom: "0.7rem" }}>{q.icon} {q.label}</div>
            {(data[q.key] || []).map((item, i) => (
              <div key={i} style={{ display: "flex", gap: "0.5rem", marginBottom: "0.42rem" }}>
                <span style={{ color: q.color, fontSize: "0.68rem", marginTop: "2px", flexShrink: 0 }}>◆</span>
                <span style={{ color: "#bbb", fontSize: "0.8rem", lineHeight: "1.58" }}>{item}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {data.strategic_insight && (
        <div style={{ marginTop: "1rem", background: `${LIME}06`, border: `1px solid ${LIME}15`, borderRadius: "8px", padding: "0.95rem" }}>
          <div style={{ color: LIME, fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "3px", marginBottom: "0.3rem" }}>Strategic Read</div>
          <p style={{ color: "#ccc", fontSize: "0.82rem", lineHeight: "1.68", margin: 0 }}>{data.strategic_insight}</p>
        </div>
      )}
    </div>
  );
}

function StreamBadge() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "1rem" }}>
      <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: LIME, animation: "pulse 1s ease infinite" }} />
      <span style={{ color: LIME, fontSize: "0.58rem", letterSpacing: "2.5px", fontFamily: "monospace" }}>STREAMING</span>
    </div>
  );
}

function CompanyBuilder({ idea, qaCtx, onClose, apiKey, provider, model, founderContext }) {
  const [step, setStep] = useState("pick");
  const [mode, setMode] = useState(null);
  const [bg, setBg] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [result]);

  const build = async () => {
    setStep("result");
    setLoading(true);
    setResult("");
    setDone(false);
    const modeCtx = mode === "scratch" ? `Founder starting from zero. Build foundational systems from first principles.\nFounder context:\n${founderContext}` : `Founder background: "${bg}". Go deep on leverage points, not basics.\nFounder context:\n${founderContext}`;
    const sys = `You are FORGE SYSTEMS — a company architect. McKinsey meets YC. Ruthlessly specific.
Structure with ## section headers. Use → for bullets. No filler. Start immediately.`;
    const prompt = `Idea: "${idea}"
Founder's thinking:
${qaCtx}
Context: ${modeCtx}

## 1. Company Architecture
## 2. Core Operating Systems
## 3. Workflow Design
## 4. Hiring Sequence
## 5. Revenue Operations
## 6. Tech Stack (exact tools)
## 7. Asymmetric Growth Levers
## 8. 90-Day Formation Plan
## 9. Critical Failure Points`;
    try {
      await aiStream(sys, prompt, (chunk) => setResult(chunk), 1600, apiKey, provider, model);
    } catch (e) {
      setResult(`Error: ${e.message}`);
    }
    setLoading(false);
    setDone(true);
  };

  const S = {
    card: (active, c) => ({ background: "#0a0a0a", border: `1px solid ${active ? c : "#191919"}`, borderRadius: "10px", padding: "1.35rem", cursor: "pointer", transition: "all .15s", transform: active ? "translateY(-2px)" : "none" }),
    btn: (c = LIME) => ({ background: c, color: c === LIME ? "#000" : "#fff", border: "none", borderRadius: "6px", padding: "0.8rem 1.8rem", fontSize: "0.72rem", fontWeight: "900", letterSpacing: "2px", cursor: "pointer", fontFamily: "monospace" }),
    ta: { width: "100%", background: "#0b0b0b", border: "1px solid #1a1a1a", borderRadius: "8px", color: "#f0f0f0", fontSize: "0.85rem", padding: "1rem", resize: "none", outline: "none", fontFamily: "monospace", lineHeight: "1.7", boxSizing: "border-box" },
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "#00000092", zIndex: 2000, display: "flex", justifyContent: "flex-end" }}>
      <div style={{ width: "min(620px,100vw)", background: "#080808", borderLeft: "1px solid #1a1a1a", display: "flex", flexDirection: "column", height: "100vh" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.15rem 1.5rem", borderBottom: "1px solid #111", flexShrink: 0 }}>
          <div>
            <div style={{ color: PURPLE, fontSize: "0.72rem", fontWeight: "900", letterSpacing: "3px", fontFamily: "monospace" }}>🏗 COMPANY BUILDER</div>
            <div style={{ color: TEXT_DIM, fontSize: "0.55rem", letterSpacing: "1.5px", fontFamily: "monospace", marginTop: "2px" }}>SYSTEMS & WORKFLOW SYNTHESISER</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "1px solid #1a1a1a", color: TEXT_MUTED, borderRadius: "5px", padding: "5px 10px", cursor: "pointer", fontFamily: "monospace", fontSize: "0.67rem" }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "1.5rem" }}>
          {step === "pick" && (
            <div>
              <p style={{ color: "#f0f0f0", fontSize: "1.05rem", margin: "0 0 0.4rem", fontWeight: "300", fontFamily: "monospace" }}>Are you entering from scratch or as an industry insider?</p>
              <p style={{ color: TEXT_MUTED, fontSize: "0.76rem", margin: "0 0 2rem", fontFamily: "monospace" }}>This shapes the entire architecture.</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "2rem" }}>
                <div style={S.card(mode === "scratch", LIME)} onClick={() => setMode("scratch")}>
                  <div style={{ fontSize: "1.7rem", marginBottom: "0.55rem" }}>🌱</div>
                  <div style={{ color: mode === "scratch" ? LIME : "#e0e0e0", fontWeight: "bold", marginBottom: "0.35rem", fontSize: "0.88rem", fontFamily: "monospace" }}>Starting Fresh</div>
                  <div style={{ color: "#2a2a2a", fontSize: "0.72rem", lineHeight: "1.55", fontFamily: "monospace" }}>Zero prior experience. First principles all the way.</div>
                </div>
                <div style={S.card(mode === "industry", PURPLE)} onClick={() => setMode("industry")}>
                  <div style={{ fontSize: "1.7rem", marginBottom: "0.55rem" }}>⚔️</div>
                  <div style={{ color: mode === "industry" ? PURPLE : "#e0e0e0", fontWeight: "bold", marginBottom: "0.35rem", fontSize: "0.88rem", fontFamily: "monospace" }}>Industry Insider</div>
                  <div style={{ color: "#2a2a2a", fontSize: "0.72rem", lineHeight: "1.55", fontFamily: "monospace" }}>Experience, network, insider knowledge to leverage.</div>
                </div>
              </div>
              {mode === "industry" && (
                <div style={{ marginBottom: "1.5rem" }}>
                  <p style={{ color: TEXT_DIM, fontSize: "0.6rem", letterSpacing: "3px", fontFamily: "monospace", margin: "0 0 0.55rem", textTransform: "uppercase" }}>Your Background</p>
                  <textarea style={{ ...S.ta, height: "115px" }} placeholder="Role, years in the industry, what you've seen fail, key relationships..." value={bg} onChange={(e) => setBg(e.target.value)} />
                </div>
              )}
              {mode && <button style={S.btn(PURPLE)} onClick={build} disabled={mode === "industry" && !bg.trim()}>BUILD COMPANY SYSTEM →</button>}
            </div>
          )}
          {step === "result" && (
            <div>
              {loading && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", marginBottom: "1.4rem" }}>
                  <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: PURPLE, animation: "pulse 1s ease infinite" }} />
                  <span style={{ color: PURPLE, fontSize: "0.6rem", letterSpacing: "2.5px", fontFamily: "monospace" }}>SYNTHESISING…</span>
                </div>
              )}
              {done && <div style={{ color: LIME, fontSize: "0.6rem", letterSpacing: "2.5px", marginBottom: "1.4rem", fontFamily: "monospace" }}>✓ COMPLETE</div>}
              <Md text={result} />
              <div ref={scrollRef} />
              {done && <button style={{ ...S.btn(PURPLE), marginTop: "2rem" }} onClick={() => { setStep("pick"); setMode(null); setResult(""); setBg(""); setDone(false); }}>REBUILD →</button>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function IntelPanel({ idea, onClose, apiKey, provider, model, founderContext }) {
  const [msgs, setMsgs] = useState([{ role: "assistant", content: `## FORGE INTEL\n\nLive AI research partner. Ask me:\n\n→ Market size and real numbers\n→ Competitors in this space\n→ Industry trends and shifts\n→ Regulations and compliance\n→ Funding landscape\n→ Tech options and trade-offs` }]);
  const [inp, setInp] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef(null);
  const taRef = useRef(null);
  const histRef = useRef([]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const suggests = idea ? ["Real market size?", "Top competitors?", "Key regulations?", "Typical funding path?"] : [];

  const send = useCallback(
    async (text) => {
      const q = (text || inp).trim();
      if (!q || busy) return;
      setInp("");
      const userMsg = { role: "user", content: q };
      histRef.current = [...histRef.current, userMsg];
      setMsgs((prev) => [...prev, userMsg, { role: "assistant", content: "" }]);
      setBusy(true);

      const sys = `You are FORGE INTEL — direct, research-sharp AI for founders.
Answer with specifics and numbers. Use **bold** for key terms. Use → for lists.
Give best estimates when exact data unavailable. Never over-hedge.
Idea context: "${idea}"
Founder context:
${founderContext}`;

      const ctxMsgs = histRef.current.map((m) => m.content).join("\n\n---\n\n");
      const prompt = `Previous context:\n${ctxMsgs.slice(0, -q.length)}\n\nLatest question: ${q}`;

      try {
        let reply = "";
        await aiStream(sys, prompt, (chunk) => {
          reply = chunk;
          setMsgs((prev) => {
            const next = [...prev];
            next[next.length - 1] = { role: "assistant", content: chunk };
            return next;
          });
        }, 900, apiKey, provider, model);
        const aMsg = { role: "assistant", content: reply };
        histRef.current = [...histRef.current, aMsg];
      } catch (e) {
        setMsgs((prev) => {
          const n = [...prev];
          n[n.length - 1] = { role: "assistant", content: `Error: ${e.message}` };
          return n;
        });
      }
      setBusy(false);
      setTimeout(() => taRef.current?.focus(), 80);
    },
    [apiKey, busy, idea, inp, provider, model, founderContext]
  );

  return (
    <div style={{ position: "fixed", top: 0, right: 0, width: "min(420px,100vw)", height: "100vh", background: "#080808", borderLeft: "1px solid #1a1a1a", display: "flex", flexDirection: "column", zIndex: 1000, boxShadow: "-10px 0 50px #000d" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1.1rem 1.4rem", borderBottom: "1px solid #101010", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
          <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: LIME, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: "bold" }}>⚡</div>
          <div>
            <div style={{ color: LIME, fontSize: "0.7rem", fontWeight: "900", letterSpacing: "3px", fontFamily: "monospace" }}>FORGE INTEL</div>
            <div style={{ color: TEXT_DIM, fontSize: "0.54rem", letterSpacing: "1.5px", fontFamily: "monospace" }}>AI RESEARCH CHAT</div>
          </div>
        </div>
        <button onClick={onClose} style={{ background: "transparent", border: "1px solid #1a1a1a", color: TEXT_MUTED, borderRadius: "5px", padding: "5px 10px", cursor: "pointer", fontFamily: "monospace", fontSize: "0.67rem" }}>✕</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "1.1rem 1.35rem", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ display: "flex", gap: "0.55rem", flexDirection: m.role === "user" ? "row-reverse" : "row" }}>
            <div style={{ width: "22px", height: "22px", borderRadius: "50%", flexShrink: 0, background: m.role === "user" ? "#141414" : LIME, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", color: m.role === "user" ? "#666" : "#000", fontFamily: "monospace", fontWeight: "bold", border: m.role === "user" ? "1px solid #1e1e1e" : "none", marginTop: "2px" }}>
              {m.role === "user" ? "U" : "F"}
            </div>
            <div style={{ maxWidth: "91%", background: m.role === "user" ? "#0d0d0d" : "transparent", border: m.role === "user" ? "1px solid #191919" : "none", borderRadius: "8px", padding: m.role === "user" ? "0.6rem 0.85rem" : "0 0 0 0.15rem" }}>
              {m.content === "" ? (
                <div style={{ display: "flex", gap: "4px", padding: "6px 0" }}>{[0, 1, 2].map((j) => <span key={j} style={{ width: "5px", height: "5px", borderRadius: "50%", background: LIME, display: "inline-block", animation: `pulse 1.3s ease ${j * 0.2}s infinite` }} />)}</div>
              ) : (
                <Md text={m.content} />
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {msgs.length === 1 && idea && (
        <div style={{ padding: "0 1.35rem 0.7rem", flexShrink: 0 }}>
          <div style={{ color: TEXT_DIM, fontSize: "0.54rem", letterSpacing: "2.5px", fontFamily: "monospace", marginBottom: "0.35rem" }}>QUICK SEARCHES</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
            {suggests.map((q, i) => (
              <button key={i} onClick={() => send(q)} style={{ background: "#090909", border: "1px solid #151515", borderRadius: "5px", color: TEXT_MUTED, fontFamily: "monospace", fontSize: "0.7rem", padding: "0.42rem 0.8rem", cursor: "pointer", transition: "all .12s" }} onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${LIME}40`; e.currentTarget.style.color = "#aaa"; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#151515"; e.currentTarget.style.color = TEXT_MUTED; }}>
                {q}
              </button>
            ))}
          </div>
        </div>
      )}
      <div style={{ padding: "0.85rem 1.35rem 1rem", borderTop: "1px solid #101010", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "flex-end" }}>
          <textarea ref={taRef} style={{ flex: 1, background: "#0b0b0b", border: "1px solid #1c1c1c", borderRadius: "7px", color: "#f0f0f0", fontSize: "0.83rem", padding: "0.65rem", resize: "none", outline: "none", fontFamily: "monospace", lineHeight: "1.65", height: "60px", boxSizing: "border-box" }} placeholder="Ask anything…" value={inp} onChange={(e) => setInp(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} disabled={busy} />
          <button onClick={() => send()} disabled={busy || !inp.trim()} style={{ background: busy || !inp.trim() ? "#0f0f0f" : LIME, color: "#000", border: `1px solid ${busy || !inp.trim() ? "#1a1a1a" : LIME}`, borderRadius: "6px", width: "42px", height: "60px", cursor: busy || !inp.trim() ? "not-allowed" : "pointer", fontSize: "1rem", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s", fontWeight: "bold" }}>{busy ? "…" : "→"}</button>
        </div>
        <div style={{ color: TEXT_SOFT, fontSize: "0.56rem", fontFamily: "monospace", marginTop: "0.4rem" }}>Enter to send · Shift+Enter newline</div>
      </div>
    </div>
  );
}

function SidebarNav({ activeView, onNavigate, themePalette, onSignOut, isAuthenticated, compactMode, isOpen, onToggle }) {
  const navItems = [
    { key: "forge", icon: "🛠️", label: "Forge" },
    { key: "profile", icon: "👤", label: "Profile" },
    { key: "memory", icon: "📝", label: "Memory" },
    { key: "pricing", icon: "💸", label: "Pricing" },
    { key: "settings", icon: "⚙️", label: "Settings" },
    { key: "guide", icon: "📘", label: "Guide" },
  ];

  return (
    <div
      style={{
        position: "sticky",
        top: "1rem",
        zIndex: 40,
        width: isOpen ? "92px" : "56px",
        padding: compactMode ? "0.75rem 0.5rem" : "0.9rem 0.6rem",
        borderRadius: "22px",
        background: themePalette.panelBg,
        border: `1px solid ${themePalette.border}`,
        boxShadow: `0 18px 40px ${themePalette.shadow}`,
        transition: "width .2s ease, transform .2s ease",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "grid", gap: "0.5rem" }}>
        <button
          onClick={onToggle}
          style={{
            border: `1px solid ${themePalette.border}`,
            borderRadius: "16px",
            background: "transparent",
            color: themePalette.textMuted,
            padding: compactMode ? "0.55rem 0.25rem" : "0.7rem 0.3rem",
            cursor: "pointer",
            fontFamily: "monospace",
            fontSize: "0.8rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isOpen ? "⟨" : "⟩"}
        </button>

        {isOpen && (
          <div style={{ color: LIME, fontSize: "0.48rem", letterSpacing: "2px", padding: "0.25rem 0 0.35rem", textAlign: "center" }}>
            NAV
          </div>
        )}

        {navItems.map((item) => {
          const active = activeView === item.key;
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              style={{
                border: "none",
                borderRadius: "16px",
                background: active ? `${LIME}18` : "transparent",
                color: active ? LIME : themePalette.textMuted,
                padding: compactMode ? "0.55rem 0.2rem" : "0.7rem 0.25rem",
                display: "flex",
                flexDirection: isOpen ? "column" : "row",
                gap: isOpen ? "0.2rem" : "0",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                fontFamily: "monospace",
                minHeight: isOpen ? "56px" : "40px",
              }}
              title={item.label}
            >
              <span style={{ fontSize: "1rem", lineHeight: 1 }}>{item.icon}</span>
              {isOpen && <span style={{ fontSize: "0.5rem", letterSpacing: "0.8px" }}>{item.label}</span>}
            </button>
          );
        })}

        {isAuthenticated && isOpen && (
          <button
            onClick={onSignOut}
            style={{
              marginTop: "0.35rem",
              border: `1px solid ${themePalette.border}`,
              borderRadius: "16px",
              background: "transparent",
              color: themePalette.textSoft,
              padding: compactMode ? "0.55rem 0.2rem" : "0.7rem 0.25rem",
              cursor: "pointer",
              fontFamily: "monospace",
              fontSize: "0.5rem",
            }}
          >
            Logout
          </button>
        )}
      </div>
    </div>
  );
}

const CONFIGS = {
  mindmap: {
    sys: `JSON only. Start with { end with }. No markdown, no extra text.
{"center":"2-3 words","branches":[{"label":"2 words","color":"#hex","nodes":["short","short","short","short"]}]}
5-6 branches, 3-4 nodes each, max 4 words per item, vivid distinct hex colors.`,
    usr: (idea, ctx) => `Idea:"${idea}"\n${ctx}\nMind map: concept,market,users,revenue,risks,execution.`,
  },
  blueprint: {
    sys: `JSON only. Start with { end with }. No markdown.
{"title":"...","vision":"punchy sentence","sections":[{"title":"NAME","content":"2-3 sentences","bullets":["pt","pt","pt"]}]}
7 sections: Core Concept,Problem & Solution,Target Market,Unique Advantage,Key Assumptions,Critical Risks,Success Metrics.`,
    usr: (idea, ctx) => `Idea:"${idea}"\n${ctx}`,
  },
  roadmap: {
    sys: `JSON only. Start with { end with }.
{"title":"...","phases":[{"phase":"Phase 1","title":"...","duration":"X weeks","goal":"...","milestones":["...","...","..."],"kpis":["...","..."]}]}
4 phases: Foundation,Launch,Scale,Dominate.`,
    usr: (idea, ctx) => `Idea:"${idea}"\n${ctx}`,
  },
  businessplan: {
    sys: `JSON only. Start with { end with }.
{"title":"...","oneliner":"pitch","sections":[{"title":"NAME","content":"content"}]}
10 sections: Problem,Solution,Market Size,Business Model,Revenue Streams,Go-To-Market,Competitive Moat,Team Requirements,Financial Projections,Next Steps.`,
    usr: (idea, ctx) => `Idea:"${idea}"\n${ctx}`,
  },
  actionplan: {
    sys: `JSON only. Start with { end with }. No markdown.
{"title":"...","weeks":[{"week":"Week 1","focus":"goal","tasks":[{"task":"action","priority":"HIGH","outcome":"result","tool":"URL or app","script":"copy/paste script or blank","failure":"measurable failure condition"}]}]}
Requirements: 4 weeks, 4-5 tasks each. Every task must be under 4 hours, include exact tool or URL, give a copy/paste script when possible, and state a measurable failure condition. Use HIGH MED or LOW only.`,
    usr: (idea, ctx) => `Idea:"${idea}"\n${ctx}`,
  },
  swot: {
    sys: `JSON only. Start with { end with }.
{"title":"...","summary":"sentence","strengths":["...","...","...","..."],"weaknesses":["...","...","...","..."],"opportunities":["...","...","...","..."],"threats":["...","...","...","..."],"strategic_insight":"2-3 sentences"}`,
    usr: (idea, ctx) => `Idea:"${idea}"\n${ctx}`,
  },
};

function getFallbackOutput(type, idea) {
  const cleanIdea = idea || "your startup concept";
  if (type === "mindmap") {
    return {
      center: "STARTUP MAP",
      branches: [
        { label: "Concept", color: LIME, nodes: ["Core Value Offer", "Target Pain Point", "Solution Validation", "Unit Economics"] },
        { label: "Target Market", color: ORANGE, nodes: ["TAM/SAM Sizing", "Competitor Gaps", "Early Adopter Profiles", "Market Channels"] },
        { label: "Monetization", color: CYAN, nodes: ["SaaS Subscriptions", "Transaction Fees", "Enterprise Pricing", "LTV / CAC ratio"] },
        { label: "Execution", color: PINK, nodes: ["MVP Landing Page", "5 Buyer Interviews", "Paid Ad Smoke Test", "Launch Roadmap"] }
      ]
    };
  }
  if (type === "blueprint") {
    return {
      title: "FOUNDER BLUEPRINT",
      vision: `Build a highly scalable validation path for: ${cleanIdea}`,
      sections: [
        { title: "Core Concept", content: `A dedicated solution aiming to solve critical workflow friction in the ${cleanIdea} space.`, bullets: ["Focus on maximum customer convenience", "Frictionless setup", "Modular features"] },
        { title: "Problem & Solution", content: "Customers face high manual overhead or inefficiencies. The solution automates the bottleneck.", bullets: ["Cut operating hours by 50%", "Reduce human error margin", "Instant reporting"] },
        { title: "Target Market", content: "Niche operators and service professionals who feel the daily pain and have budget authorization.", bullets: ["Early adopter persona defined", "Direct outreach channel identified", "High-growth industry niche"] }
      ]
    };
  }
  if (type === "roadmap") {
    return {
      title: "LAUNCH ROADMAP",
      phases: [
        { phase: "Phase 1", title: "Foundation & Setup", duration: "1-2 weeks", goal: "Establish a direct line to 5 target buyers and validate problem intensity.", milestones: ["Define the one-sentence offer", "Build high-fidelity mockups", "Launch lead captures"], kpis: ["5 buyer interviews completed", "100+ target emails collected"] },
        { phase: "Phase 2", title: "MVP & First Trial", duration: "3-4 weeks", goal: "Deploy the simplest functional offer and sign up early testers.", milestones: ["Launch single-page landing", "Acquire 3 beta users", "Configure billing gateway"], kpis: ["10% landing page conversion", "3 active beta signups"] },
        { phase: "Phase 3", title: "Revenue & Scale", duration: "5-8 weeks", goal: "Convert initial users into paid cohorts and establish feedback systems.", milestones: ["Charge first subscription", "Gather user testimonials", "Launch referral loops"], kpis: ["$500+ Monthly Recurring Revenue", "Net Promoter Score of 50+"] },
        { phase: "Phase 4", title: "Market Domination", duration: "9-12 weeks", goal: "Scale customer acquisition channels and expand core capabilities.", milestones: ["Automate growth funnels", "Expand feature sets", "Establish agency partnerships"], kpis: ["30% MoM growth rate", "Customer churn below 5%"] }
      ]
    };
  }
  if (type === "businessplan") {
    return {
      title: "LEAN BUSINESS PLAN",
      oneliner: `Disrupting traditional models through targeted validation of: ${cleanIdea}`,
      sections: [
        { title: "Problem & Customer", content: "Target buyers spend too much time on manual workarounds. Willingness to pay is high for a streamlined solution." },
        { title: "Monetization Strategy", content: "Monthly software-as-a-service (SaaS) tiers with a low barrier to entry to capture initial velocity." },
        { title: "Go-To-Market Loop", content: "Direct cold outreach, community-driven advocacy, and organic search content optimization." }
      ]
    };
  }
  if (type === "actionplan") {
    return {
      title: "30-DAY VALIDATION PLAN",
      weeks: [
        {
          week: "Week 1",
          focus: "Problem Intensity Verification",
          tasks: [
            { task: "List 15 prospects matching target persona on LinkedIn", priority: "HIGH", outcome: "A clean Google Sheet with prospect details", tool: "LinkedIn Search" },
            { task: "Draft a 3-sentence non-salesy outreach script focused on advice", priority: "HIGH", outcome: "Outreach message script ready to send", tool: "Google Docs" }
          ]
        },
        {
          week: "Week 2",
          focus: "Landing Page & Smoke Test",
          tasks: [
            { task: "Build a single-column landing page highlighting the offer", priority: "HIGH", outcome: "Landing page is live at custom subdomain", tool: "Carrd.co / Vercel" },
            { task: "Integrate a simple email signup form connected to an autoresponder", priority: "MED", outcome: "Email collection functional", tool: "Loops.so / Mailerlite" }
          ]
        }
      ]
    };
  }
  if (type === "swot") {
    return {
      title: "SWOT ASSESSMENT",
      summary: `Strategic read for ${cleanIdea}.`,
      strengths: ["High-speed execution model", "Agile startup iteration cycle", "Highly specific value proposition"],
      weaknesses: ["Under-funded initial marketing budget", "High dependency on third-party APIs", "Undifferentiated brand identity"],
      opportunities: ["Unserved long-tail customer segments", "Leveraging new AI API models", "Co-marketing with existing ecosystem players"],
      threats: ["Platform risk / policy changes", "Fast follower copycats", "High customer churn during early product phase"],
      strategic_insight: "Focus intensely on a narrow niche. Build a direct relationship with 10 power users before attempting any high-budget scale operations."
    };
  }
  return {};
}

const OUTPUTS = [
  { key: "mindmap", icon: "🗺️", label: "Mind Map", desc: "Interactive visual landscape" },
  { key: "blueprint", icon: "📐", label: "Blueprint", desc: "Concept, market, risks, metrics" },
  { key: "roadmap", icon: "🛣️", label: "Roadmap", desc: "4-phase plan to dominance" },
  { key: "businessplan", icon: "📊", label: "Business Plan", desc: "Lean plan across all pillars" },
  { key: "actionplan", icon: "⚡", label: "30-Day Plan", desc: "Checkable tasks. Real outcomes." },
  { key: "swot", icon: "🎯", label: "SWOT", desc: "Ruthless strategic breakdown" },
];

const Q_SYS = `You are FORGE — the ruthless founder decision engine.
No fluff. No hype. No framing.
Ask one question per round that forces the founder to name a paying customer, a real test, an assumption, or a next experiment.
Rotate through Creative, Critical, Strategic, and Logical styles.
Tie every question to the idea and the founder's current story.
Return only the question. Nothing else.`;

const QUESTION_STEP_METADATA = [
  {
    title: 'Problem',
    why: 'This reveals the exact pain your customer is paying to escape.',
    example: 'Example: "Mid-market accounts teams waste 10+ hours monthly reconciling failed transfers."',
  },
  {
    title: 'Customer',
    why: 'This tells us who will actually open their wallet for your solution.',
    example: 'Example: "Finance managers at fintech scale-ups handling >500 transactions/day."',
  },
  {
    title: 'Revenue',
    why: 'This forces a real payment trigger instead of vague hope.',
    example: 'Example: "They pay once each failed payout costs $2,500 in support time."',
  },
  {
    title: 'Channels',
    why: 'This exposes the fastest path to real buyer conversations.',
    example: 'Example: "Cold outreach to 20 VP finance leaders in logistics and marketplaces."',
  },
  {
    title: 'Risk',
    why: 'This surfaces the biggest assumption that would kill the plan if wrong.',
    example: 'Example: "The idea depends on customers trusting a third party with payout data."',
  },
  {
    title: 'Moat',
    why: 'This forces you to prove why the idea won’t be copied in 30 days.',
    example: 'Example: "We win because we own a proprietary ruleset built from 1,000 rejected cases."',
  },
];

const GUEST_FREE_QUESTIONS = 3;

function getQuestionStepMetadata(index) {
  return QUESTION_STEP_METADATA[index] || {
    title: `Step ${index + 1}`,
    why: 'This question sharpens your founder judgement and forces a specific answer.',
    example: 'Answer with a concrete customer, a number, or a test you can run this week.',
  };
}

function normalizeTag(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9- ]+/g, '').slice(0, 32);
}

function evaluateAnswerQuality(answer) {
  const text = (answer || '').trim();
  if (!text) {
    return { difficulty: 'Missing', critique: 'No answer yet. Name one clear fact about the customer or problem.' };
  }
  if (text.length < 75) {
    return { difficulty: 'Too vague', critique: 'This is still too short. Add a concrete customer, metric, or example.' };
  }
  if (/\b(any|everyone|someone|people|just|whatever)\b/i.test(text)) {
    return { difficulty: 'Too broad', critique: 'This is too broad. Name a specific buyer group or situation.' };
  }
  if (/\b(probably|maybe|could|might|think)\b/i.test(text)) {
    return { difficulty: 'Hedged', critique: 'This sounds hedged. Replace wishful terms with a stronger claim or evidence.' };
  }
  return { difficulty: 'Founder-ready', critique: 'Good. This answer is specific enough to build the next plan step from.' };
}

const ctxStr = (pairs) => pairs.map((x, i) => `Q${i + 1}: ${x.question}\nA${i + 1}: ${x.answer}`).join('\n\n');

export default function Forge() {
  const [phase, setPhase] = useState("ignition");
  const [idea, setIdea] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_PROVIDER;
    return localStorage.getItem("forge-ai-provider") || DEFAULT_PROVIDER;
  });
  const [model, setModel] = useState(() => {
    if (typeof window === "undefined") return OPENROUTER_DEFAULT_MODEL;
    return localStorage.getItem("forge-ai-model") || OPENROUTER_DEFAULT_MODEL;
  });
  const [qa, setQa] = useState([]);
  const [curQ, setCurQ] = useState("");
  const [curA, setCurA] = useState("");
  const [currentTags, setCurrentTags] = useState([]);
  const [tagValue, setTagValue] = useState("");
  const [answerCritique, setAnswerCritique] = useState("");
  const [answerDifficulty, setAnswerDifficulty] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadMsg, setLoadMsg] = useState("");
  const [outType, setOutType] = useState(null);
  const [outputs, setOutputs] = useState({});
  const [err, setErr] = useState("");
  const [intel, setIntel] = useState(false);
  const [company, setCompany] = useState(false);
  const [ideaScore, setIdeaScore] = useState(null);
  const [productTrack, setProductTrack] = useState("b2b_saas");
  const [workflowMode, setWorkflowMode] = useState("explorer");
  const [variants, setVariants] = useState([]);
  const [reflection, setReflection] = useState("");
  const [savedReflection, setSavedReflection] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [wizardStep, setWizardStep] = useState("forge");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [themeMode, setThemeMode] = useState(() => {
    if (typeof window === "undefined") return "dark";
    return localStorage.getItem("forge-theme-mode") || "dark";
  });
  const [compactMode, setCompactMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return safeParse(localStorage.getItem("forge-compact-mode"), false);
  });
  const [authEmail, setAuthEmail] = useState("");
  const [authName, setAuthName] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [waitlistEmail, setWaitlistEmail] = useState(() => {
    if (typeof window === "undefined") return "";
    return safeParse(localStorage.getItem(WAITLIST_KEY), { email: "", stage: "Early idea" }).email || "";
  });
  const [waitlistStage, setWaitlistStage] = useState(() => {
    if (typeof window === "undefined") return "Early idea";
    return safeParse(localStorage.getItem(WAITLIST_KEY), { email: "", stage: "Early idea" }).stage || "Early idea";
  });
  const [waitlistStatus, setWaitlistStatus] = useState("");
  const [waitlistBusy, setWaitlistBusy] = useState(false);
  const [founderProfile, setFounderProfile] = useState(() => {
    if (typeof window === "undefined") return defaultFounderProfile();
    return safeParse(localStorage.getItem(STORAGE_KEYS.profile), defaultFounderProfile());
  });
  const [memoryLog, setMemoryLog] = useState(() => {
    if (typeof window === "undefined") return [];
    const saved = safeParse(localStorage.getItem(STORAGE_KEYS.memory), []);
    return Array.isArray(saved) ? saved : [];
  });
  const [ideaHistory, setIdeaHistory] = useState(() => {
    if (typeof window === "undefined") return [];
    const saved = safeParse(localStorage.getItem(STORAGE_KEYS.history), []);
    return Array.isArray(saved) ? saved : [];
  });
  const [memoryNote, setMemoryNote] = useState("");
  const taRef = useRef(null);
  const { prefetch, consume } = usePrefetch(apiKey, provider, model);

  const addVariant = () => {
    const trimmed = idea.trim();
    if (!trimmed) return;
    setVariants((prev) => [
      ...prev,
      {
        id: `${Date.now()}-${prev.length + 1}`,
        label: `Variant ${prev.length + 1}`,
        idea: trimmed,
        score: ideaScore?.score ?? 0,
        createdAt: new Date().toLocaleTimeString(),
      },
    ]);
  };

  const saveReflection = () => {
    const note = reflection.trim();
    if (!note) return;
    setSavedReflection(note);
    setReflection("");
  };

  const renderMetricBar = (label, value) => {
    const normalized = Math.max(0, Math.min(100, Math.round(value)));
    return (
      <div style={{ marginBottom: 4 }}>
        <div style={{ fontSize: 12, color: "var(--editorForeground)" }}>{label}: {normalized}</div>
        <div style={{ width: "100%", height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 999 }}>
          <div style={{ width: `${normalized}%`, height: "100%", background: "#60a5fa", borderRadius: 999 }} />
        </div>
      </div>
    );
  };

  useEffect(() => {
    let cancelled = false;

    async function hydrateSession() {
      try {
        const res = await fetch("/api/auth/session", { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.user) {
          setCurrentUser(data.user);
        }
      } catch {
        // No active server session.
      }
    }

    hydrateSession();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (currentUser && wizardStep === "auth") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWizardStep("forge");
    }
  }, [currentUser, wizardStep]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("forge-ai-provider", provider);
    }
  }, [provider]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("forge-ai-model", model);
    }
  }, [model]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("forge-theme-mode", themeMode);
      localStorage.setItem("forge-compact-mode", JSON.stringify(compactMode));
      const systemDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;
      const effectiveTheme = themeMode === "system" ? (systemDark ? "dark" : "light") : themeMode;
      const palette = resolveTheme(effectiveTheme);
      document.body.style.background = palette.pageBg;
      document.body.style.color = palette.textPrimary;
      document.documentElement.style.colorScheme = effectiveTheme;
    }
  }, [themeMode, compactMode]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEYS.profile, JSON.stringify(founderProfile));
    }
  }, [founderProfile]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEYS.memory, JSON.stringify(memoryLog));
    }
  }, [memoryLog]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(ideaHistory));
    }
  }, [ideaHistory]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(WAITLIST_KEY, JSON.stringify({ email: waitlistEmail, stage: waitlistStage }));
    }
  }, [waitlistEmail, waitlistStage]);

  const founderContext = useMemo(() => buildFounderContext(founderProfile, currentUser, memoryLog, idea, productTrack, workflowMode), [founderProfile, currentUser, memoryLog, idea, productTrack, workflowMode]);
  const realityGate = useMemo(() => getRealityCheck(founderProfile), [founderProfile]);
  const isAuthenticated = Boolean(currentUser);

  const updateProfileField = useCallback((key, value) => {
    setFounderProfile((prev) => ({ ...prev, [key]: value }));
  }, []);

  const persistMemory = useCallback((note, source = "manual") => {
    const trimmed = note.trim();
    if (!trimmed) return;
    if (!isAuthenticated) {
      setErr("Create a free account to save founder memories.");
      return;
    }
    setMemoryLog((prev) => [{ id: uid(), note: trimmed, source, createdAt: new Date().toISOString() }, ...prev].slice(0, 12));
  }, [isAuthenticated]);

  const addIdeaHistory = useCallback((value) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setIdeaHistory((prev) => [{ id: uid(), idea: trimmed, createdAt: new Date().toISOString() }, ...prev].slice(0, 18));
  }, []);

  const signIn = useCallback(async () => {
    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthError("Enter an email and password.");
      return;
    }

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          email: authEmail.trim(),
          password: authPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setAuthError(data?.error || "Sign in failed.");
        return;
      }

      setCurrentUser(data.user);
      setAuthError("");
      setErr("");
      setAuthPassword("");
      setWizardStep("forge");
    } catch (error) {
      setAuthError(error.message || "Sign in failed.");
    }
  }, [authEmail, authPassword]);

  const signUp = useCallback(async () => {
    if (!authEmail.trim() || !authPassword.trim()) {
      setAuthError("Enter an email and password.");
      return;
    }

    if (authPassword.length < 8) {
      setAuthError("Use at least 8 characters for your password.");
      return;
    }

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          email: authEmail.trim(),
          password: authPassword,
          name: authName.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setAuthError(data?.error || "Sign up failed.");
        return;
      }

      setCurrentUser(data.user);
      setAuthError("");
      setErr("");
      setAuthPassword("");
      setAuthName("");
      setWizardStep("forge");
    } catch (error) {
      setAuthError(error.message || "Sign up failed.");
    }
  }, [authEmail, authPassword, authName]);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Ignore logout failures and clear the local session.
    }

    setCurrentUser(null);
    setWizardStep("forge");
    setAuthError("");
    setErr("");
  }, []);

  const joinWaitlist = useCallback(async () => {
    const email = waitlistEmail.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setWaitlistStatus("Enter a valid email address.");
      return;
    }

    setWaitlistBusy(true);
    setWaitlistStatus("Joining the waitlist…");

    try {
      const res = await fetch("/api/waitlist/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, stage: waitlistStage }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Waitlist signup failed.");
      }
      setWaitlistStatus(data?.message || "You are on the waitlist.");
      setErr("");
    } catch (error) {
      setWaitlistStatus(error.message || "Waitlist signup failed.");
    } finally {
      setWaitlistBusy(false);
    }
  }, [waitlistEmail, waitlistStage]);

  const scoreIdea = useCallback(
    async (pairs) => {
      if (!isAuthenticated) {
        setErr("Sign in or create an account before scoring your idea.");
        return;
      }

      try {
        const s = await ai(
          buildScoreSystem(productTrack, workflowMode),
          `Founder context:\n${founderContext}\n\nIdea:"${idea}"\n${ctxStr(pairs)}`,
          true,
          800,
          2,
          apiKey,
          provider,
          model
        );
        setIdeaScore(normalizeIdeaScore(s));
      } catch (error) {
        console.error(error);
      }
    },
    [apiKey, idea, provider, model, founderContext, isAuthenticated, productTrack, workflowMode]
  );

  const triggerPrefetch = useCallback(
    (updated) => {
      if (updated.length >= Q_TARGET) return;
      const styles = ["Creative", "Critical", "Strategic", "Logical"];
      const nextStyle = styles[updated.length % styles.length];
      const key = `q${updated.length + 1}`;
      prefetch(buildQuestionSystem(productTrack, workflowMode), `Founder context:\n${founderContext}\n\nIdea:"${idea}"\n\nSo far:\n${ctxStr(updated)}\n\nQ${updated.length + 1} of ${Q_TARGET}: Use ${nextStyle} style. Biggest unexplored gap. Push hard.`, key);
    },
    [idea, founderContext, prefetch, productTrack, workflowMode]
  );

  const ignite = async () => {
    if (!idea.trim() || loading) return;
    if (isAuthenticated) {
      addIdeaHistory(idea);
    }
    setLoading(true);
    setErr("");
    setCurrentTags([]);
    setTagValue("");
    setAnswerCritique("");
    setAnswerDifficulty("");
    try {
      const q = await ai(
        buildQuestionSystem(productTrack, workflowMode),
        `Founder context:\n${founderContext}\n\nIdea:"${idea}"\nQ1 of ${Q_TARGET}. Creative style. Most foundational: what they're ACTUALLY building, for WHOM, the single reason it must exist NOW.`,
        false,
        1000,
        2,
        apiKey,
        provider,
        model
      );
      setCurQ(q);
      setPhase("questioning");
      prefetch(
        buildQuestionSystem(productTrack, workflowMode),
        `Founder context:\n${founderContext}\n\nIdea:"${idea}"\n\nQ2 of ${Q_TARGET}: Critical style. After they answer Q1 about what/who/why, push on the biggest assumption baked into their idea.`,
        "q2_pre"
      );
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
  };

  const next = async () => {
    if (!curA.trim() || loading) return;
    setErr("");
    const normalizedTags = currentTags.map(normalizeTag).filter(Boolean);
    const feedback = evaluateAnswerQuality(curA);
    setAnswerCritique(feedback.critique);
    setAnswerDifficulty(feedback.difficulty);
    const updated = [...qa, { question: curQ, answer: curA.trim(), tags: normalizedTags }];
    setQa(updated);
    setCurA("");
    setCurrentTags([]);
    setTagValue("");

    if (updated.length >= Q_TARGET) {
      if (!isAuthenticated) {
        setErr("Create a free account to unlock your Idea Score and roadmap.");
        setPhase("output-select");
        return;
      }
      scoreIdea(updated);
      setPhase("output-select");
      return;
    }
    setLoading(true);
    triggerPrefetch([...updated, { question: "?", answer: "?" }]);
    try {
      const styles = ["Creative", "Critical", "Strategic", "Logical"];
      const nextStyle = styles[updated.length % styles.length];
      const key = `q${updated.length + 1}`;
      const cached = await Promise.race([consume(key), new Promise((r) => setTimeout(() => r(null), 200))]);
      const q = cached || (await ai(
        buildQuestionSystem(productTrack, workflowMode),
        `Founder context:\n${founderContext}\n\nIdea:"${idea}"\n\nSo far:\n${ctxStr(updated)}\n\nQ${updated.length + 1} of ${Q_TARGET}: ${nextStyle} style. Biggest unexplored gap. Go hard.`,
        false,
        1000,
        2,
        apiKey,
        provider,
        model
      ));
      setCurQ(q);
    } catch (e) {
      setErr(e.message);
    }
    setLoading(false);
    setTimeout(() => taRef.current?.focus(), 60);
  };

  const generate = async (type) => {
    if (!isAuthenticated) {
      setErr("Create a free account to unlock your outputs and save this work.");
      return;
    }
    if (realityGate.missing.length) {
      setErr(`Complete your founder profile first: ${realityGate.missing.join(", ")}.`);
      return;
    }
    if (outputs[type]) {
      setOutType(type);
      setPhase("output");
      return;
    }
    setOutType(type);
    setPhase("generating");
    setErr("");
    setLoadMsg(`Forging ${OUTPUTS.find((o) => o.key === type)?.label}…`);
    const cfg = CONFIGS[type];
    try {
      const result = await ai(cfg.sys, cfg.usr(idea, `${founderContext}\n\n${ctxStr(qa)}`), true, 1400, 2, apiKey, provider, model);
      setOutputs((prev) => ({ ...prev, [type]: result }));
      setPhase("output");
    } catch (e) {
      console.warn("AI generation failed, falling back to local synthesis:", e);
      const fallbackResult = getFallbackOutput(type, idea);
      setOutputs((prev) => ({ ...prev, [type]: fallbackResult }));
      setErr(`Note: Used offline validation framework template (${e.message})`);
      setPhase("output");
    }
  };

  const regen = async (type) => {
    if (!isAuthenticated) {
      setErr("Create a free account to regenerate outputs and save your work.");
      return;
    }
    setOutputs((prev) => {
      const n = { ...prev };
      delete n[type];
      return n;
    });
    setPhase("generating");
    setLoadMsg(`Reforging ${OUTPUTS.find((o) => o.key === type)?.label}…`);
    const cfg = CONFIGS[type];
    try {
      const result = await ai(cfg.sys, cfg.usr(idea, `${founderContext}\n\n${ctxStr(qa)}`), true, 1400, 2, apiKey, provider, model);
      setOutputs((prev) => ({ ...prev, [type]: result }));
      setPhase("output");
    } catch (e) {
      console.warn("AI regeneration failed, falling back to local synthesis:", e);
      const fallbackResult = getFallbackOutput(type, idea);
      setOutputs((prev) => ({ ...prev, [type]: fallbackResult }));
      setErr(`Note: Used offline validation framework template (${e.message})`);
      setPhase("output");
    }
  };

  const exportCurrentOutput = useCallback(() => {
    if (!outType || !outputs[outType]) return;

    const payload = formatExportContent(outType, outputs[outType], idea);
    const blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `forge-${outType}-${Date.now()}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [idea, outType, outputs]);

  const exportCurrentOutputPdf = useCallback(() => {
    if (!outType || !outputs[outType]) return;

    const printWindow = window.open("", "_blank", "width=900,height=700");
    if (!printWindow) {
      setErr("Popup blocked. Allow popups to export this as PDF.");
      return;
    }

    const html = buildPrintableHtml(outType, outputs[outType], idea);
    printWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>FORGE export</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111827; margin: 0; padding: 32px; background: #fff; }
    .eyebrow { text-transform: uppercase; letter-spacing: 3px; color: #1f2937; font-weight: 700; margin: 0 0 8px; }
    h1, h2, h3 { color: #0f172a; margin-top: 0; }
    .hero { display: flex; justify-content: space-between; gap: 16px; border-bottom: 1px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 16px; }
    .meta { text-align: right; font-size: 0.9rem; color: #4b5563; }
    .summary { margin-bottom: 24px; font-size: 1rem; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); }
    .card { border: 1px solid #e5e7eb; border-radius: 14px; padding: 18px; background: #fafafa; }
    .card p, .card li { color: #374151; font-size: 0.96rem; line-height: 1.65; }
    ul { padding-left: 18px; margin-bottom: 0; }
    strong { color: #111827; }
    @media print { body { padding: 24px; } .card { break-inside: avoid; } }
  </style>
</head>
<body>${html}</body>
</html>`);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
      printWindow.close();
    }, 250);
  }, [idea, outType, outputs]);

  const reset = () => {
    setPhase("ignition");
    setIdea("");
    setQa([]);
    setCurQ("");
    setCurA("");
    setLoading(false);
    setOutType(null);
    setOutputs({});
    setErr("");
    setLoadMsg("");
    setIntel(false);
    setCompany(false);
    setIdeaScore(null);
  };

  const openSideView = useCallback((target) => {
    if (target === "forge") {
      setWizardStep("forge");
      return;
    }
    if (target === "profile") {
      setWizardStep("profile");
      return;
    }
    if (target === "memory") {
      setWizardStep("memory");
      return;
    }
    if (target === "settings") {
      setWizardStep("settings");
      return;
    }
    if (target === "guide") {
      setWizardStep("guide");
      return;
    }
    if (target === "pricing") {
      setWizardStep("pricing");
      return;
    }
    if (target === "auth") {
      setWizardStep("auth");
    }
  }, []);
  const scoreColor = (s) => (s >= 80 ? LIME : s >= 60 ? ORANGE : s >= 40 ? "#FFD700" : PINK);
  const effectiveTheme = themeMode === "system" && typeof window !== "undefined" && window.matchMedia ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : themeMode;
  const themePalette = resolveTheme(effectiveTheme);
  const cardPadding = compactMode ? "0.85rem" : "1rem";

  const G = {
    app: { minHeight: "100vh", background: themePalette.pageBg, color: themePalette.textPrimary, fontFamily: "monospace", display: "flex", flexDirection: "column", alignItems: "center", padding: "0 1.25rem" },
    wrap: { width: "100%", maxWidth: "100%", transition: "padding-right .3s", boxSizing: "border-box" },
    hdr: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1.8rem 0 1.4rem", borderBottom: `1px solid ${themePalette.border}`, marginBottom: "2.5rem" },
    label: { color: themePalette.textDim, fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "3.5px", marginBottom: "0.65rem" },
    ta: { width: "100%", background: themePalette.panelAlt, border: `1px solid ${themePalette.border}`, borderRadius: "8px", color: themePalette.textPrimary, fontSize: "0.97rem", padding: "1.1rem", resize: "none", outline: "none", fontFamily: "monospace", lineHeight: "1.72", boxSizing: "border-box" },
    btn: { background: LIME, color: "#000", border: "none", borderRadius: "6px", padding: "0.82rem 1.9rem", fontSize: "0.72rem", fontWeight: "900", letterSpacing: "2.5px", cursor: "pointer", fontFamily: "monospace", textTransform: "uppercase" },
    ghost: { background: "transparent", color: themePalette.textMuted, border: `1px solid ${themePalette.border}`, borderRadius: "6px", padding: "0.58rem 1.05rem", fontSize: "0.67rem", cursor: "pointer", fontFamily: "monospace", transition: "all .15s" },
    err: { color: PINK, fontSize: "0.73rem", marginTop: "0.75rem", background: "#FF3C780e", border: "1px solid #FF3C7818", borderRadius: "5px", padding: "0.58rem 0.88rem" },
  };

  return (
    <div style={G.app}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:.1}50%{opacity:1}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes glowPulse{0%,100%{box-shadow:0 0 0 0 #C8FF0000}50%{box-shadow:0 0 22px 5px #C8FF0038}}
        textarea:focus{border-color:#232323!important;}
        .fab:hover{transform:translateY(-4px) scale(1.07)!important;box-shadow:0 10px 28px #C8FF0035!important;}
        .fab2:hover{transform:translateY(-4px) scale(1.07)!important;box-shadow:0 10px 28px #B87FFF35!important;}
        .outcard:hover{border-color:#C8FF0055!important;transform:translateY(-3px)!important;background:#0c0c0c!important;}
        .gh:hover{color:#888!important;border-color:#282828!important;}
      `}</style>

      {wizardStep === "forge" && !intel && (
        <button
          className="fab"
          onClick={() => {
            setIntel(true);
            setCompany(false);
          }}
          style={{
            position: "fixed",
            bottom: "7.5rem",
            right: "1.75rem",
            width: "52px",
            height: "52px",
            borderRadius: "50%",
            background: LIME,
            border: "none",
            cursor: "pointer",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 999,
            transition: "all .2s",
            boxShadow: `0 4px 18px ${LIME}28`,
            animation: "glowPulse 3s ease infinite",
          }}
        >
          <span style={{ fontSize: "19px", lineHeight: 1 }}>⚡</span>
          <span style={{ fontSize: "0.35rem", letterSpacing: "0.8px", color: "#000", fontFamily: "monospace", fontWeight: "900", marginTop: "1px" }}>INTEL</span>
        </button>
      )}

      {wizardStep === "forge" && (
        <button
          className="fab2"
          onClick={() => {
            setCompany(true);
            setIntel(false);
          }}
          style={{
            position: "fixed",
            bottom: "2rem",
            right: "1.75rem",
            width: "52px",
            height: "52px",
            borderRadius: "50%",
            background: PURPLE,
            border: "none",
            cursor: "pointer",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 999,
            transition: "all .2s",
            boxShadow: `0 4px 18px ${PURPLE}28`,
          }}
        >
          <span style={{ fontSize: "19px", lineHeight: 1 }}>🏗</span>
          <span style={{ fontSize: "0.35rem", letterSpacing: "0.5px", color: "#fff", fontFamily: "monospace", fontWeight: "900", marginTop: "1px" }}>BUILD</span>
        </button>
      )}

      {intel && <IntelPanel idea={idea} onClose={() => setIntel(false)} apiKey={apiKey} provider={provider} model={model} founderContext={founderContext} />}
      {company && <CompanyBuilder idea={idea} qaCtx={ctxStr(qa)} onClose={() => setCompany(false)} apiKey={apiKey} provider={provider} model={model} founderContext={founderContext} />}

      <div
        style={{
          width: "100%",
          maxWidth: "1560px",
          display: "grid",
          gridTemplateColumns: sidebarOpen ? "96px minmax(0, 1fr)" : "56px minmax(0, 1fr)",
          gap: sidebarOpen ? "1rem" : "0.75rem",
          alignItems: "start",
          transition: "grid-template-columns .2s ease, gap .2s ease",
          boxSizing: "border-box",
        }}
      >
        <SidebarNav
          activeView={wizardStep}
          onNavigate={openSideView}
          themePalette={themePalette}
          onSignOut={signOut}
          isAuthenticated={isAuthenticated}
          compactMode={compactMode}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen((prev) => !prev)}
        />

        <div style={{ ...G.wrap, paddingRight: intel ? "440px" : "0", minWidth: 0 }}>
          <div style={G.hdr}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.9rem" }}>
              <img
                src="/favicon.svg"
                alt="FORGE logo"
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "14px",
                  background: "linear-gradient(135deg, rgba(200,255,0,0.16), rgba(184,127,255,0.14))",
                  padding: "4px",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
                }}
              />
              <div>
                <h1 style={{ color: LIME, fontSize: "1.9rem", fontWeight: "900", letterSpacing: "7px", margin: 0, lineHeight: 1 }}>FORGE</h1>
                <p style={{ color: TEXT_DIM, fontSize: "0.57rem", letterSpacing: "3px", margin: "4px 0 0" }}>IDEA ENGINE FOR FOUNDERS</p>
              </div>
            </div>
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
              {wizardStep === "forge" && (
                <>
                  <button className="gh" onClick={() => { setIntel(!intel); setCompany(false); }} style={{ ...G.ghost, color: intel ? LIME : TEXT_MUTED, borderColor: intel ? `${LIME}35` : "#181818" }}>⚡ Intel</button>
                  <button className="gh" onClick={() => { setCompany(true); setIntel(false); }} style={{ ...G.ghost, color: PURPLE, borderColor: `${PURPLE}28` }}>🏗 Build Co.</button>
                  <button className="gh" style={G.ghost} onClick={() => setWizardStep("memory")}>← Note</button>
                  <button className="gh" style={G.ghost} onClick={reset}>↩ Reset</button>
                </>
              )}
              {wizardStep !== "forge" && isAuthenticated && (
                <button className="gh" style={G.ghost} onClick={signOut}>Sign out</button>
              )}
            </div>
          </div>

          <div style={{ display: "grid", gap: "1rem", marginBottom: "1.4rem" }}>
            <div style={{ background: "#0a0a0a", border: "1px solid #171717", borderRadius: "10px", padding: "1rem 1rem 1.1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginBottom: "0.85rem", flexWrap: "wrap" }}>
                <div>
                  <div style={{ color: LIME, fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "3px" }}>ONBOARDING</div>
                  <div style={{ color: TEXT_DIM, fontSize: "0.58rem", marginTop: "4px" }}>
                    {wizardStep === "auth" && "Create your account to unlock the founder workspace."}
                    {wizardStep === "profile" && "Add your real founder context so every prompt is grounded."}
                    {wizardStep === "memory" && "Save one note to anchor your next decision."}
                    {wizardStep === "forge" && (isAuthenticated ? `Signed in as ${currentUser?.name || currentUser?.email}` : "Guest mode is on: start instantly, then log in when you're ready to save and unlock the full result stack.")}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.35rem", alignItems: "center", flexWrap: "wrap" }}>
                  {["auth", "profile", "memory", "forge"].map((step, index) => {
                    const active = wizardStep === step;
                    const passed = ["auth", "profile", "memory", "forge"].indexOf(wizardStep) >= index;
                    return (
                      <span
                        key={step}
                        style={{
                          padding: "0.2rem 0.55rem",
                          borderRadius: "999px",
                          border: `1px solid ${active ? LIME : passed ? `${LIME}22` : "#171717"}`,
                          color: active ? LIME : passed ? TEXT_MUTED : TEXT_SOFT,
                          fontSize: "0.55rem",
                          fontFamily: "monospace",
                          background: active ? `${LIME}08` : "transparent",
                        }}
                      >
                        {index + 1}
                      </span>
                    );
                  })}
                </div>
              </div>

              {wizardStep === "auth" && (
                <div style={{ display: "grid", gap: "0.7rem" }}>
                  <input value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="Email" style={{ width: "100%", background: "#090909", border: "1px solid #1e1e1e", borderRadius: "7px", color: "#f0f0f0", fontSize: "0.85rem", padding: "0.8rem 0.9rem", outline: "none", boxSizing: "border-box", fontFamily: "monospace" }} />
                  <input value={authName} onChange={(e) => setAuthName(e.target.value)} placeholder="Display name (optional)" style={{ width: "100%", background: "#090909", border: "1px solid #1e1e1e", borderRadius: "7px", color: "#f0f0f0", fontSize: "0.85rem", padding: "0.8rem 0.9rem", outline: "none", boxSizing: "border-box", fontFamily: "monospace" }} />
                  <input type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="Password" style={{ width: "100%", background: "#090909", border: "1px solid #1e1e1e", borderRadius: "7px", color: "#f0f0f0", fontSize: "0.85rem", padding: "0.8rem 0.9rem", outline: "none", boxSizing: "border-box", fontFamily: "monospace" }} />
                  <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
                    <button style={G.btn} onClick={signIn}>LOG IN</button>
                    <button className="gh" style={G.ghost} onClick={signUp}>SIGN UP</button>
                  </div>
                  {authError && <div style={{ ...G.err, marginTop: "0.85rem" }}>{authError}</div>}
                </div>
              )}

              {wizardStep === "profile" && (
                <div style={{ display: "grid", gap: "1rem" }}>
                  <div style={{ background: "#090909", border: "1px solid #141414", borderRadius: "10px", padding: "1rem" }}>
                    <div style={{ color: LIME, fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "3px", marginBottom: "0.75rem" }}>AI SETTINGS</div>
                    <div style={{ display: "grid", gap: "0.8rem" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
                        <div style={{ color: TEXT_DIM, fontSize: "0.58rem" }}>{providerKeyLabel(provider)}</div>
                        <select
                          value={provider}
                          onChange={(e) => {
                            const next = e.target.value;
                            setProvider(next);
                            setModel(next === "openrouter" ? (localStorage.getItem("forge-ai-model") || OPENROUTER_DEFAULT_MODEL) : providerConfig(next).model);
                            setApiKey("");
                            setErr("");
                          }}
                          style={{ background: "#090909", border: "1px solid #1e1e1e", borderRadius: "6px", color: "#f0f0f0", padding: "0.5rem 0.7rem", fontFamily: "monospace", fontSize: "0.7rem", outline: "none" }}
                        >
                          {Object.entries(PROVIDERS).map(([key, cfg]) => (
                            <option key={key} value={key}>{cfg.label}</option>
                          ))}
                        </select>
                      </div>
                      <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={providerConfig(provider).keyExample} style={{ width: "100%", background: "#090909", border: "1px solid #1e1e1e", borderRadius: "7px", color: "#f0f0f0", fontSize: "0.85rem", padding: "0.8rem 0.9rem", outline: "none", boxSizing: "border-box", fontFamily: "monospace" }} />
                      {provider === "openrouter" && (
                        <div>
                          <div style={{ color: LIME, fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "3px", marginBottom: "0.45rem" }}>OpenRouter model</div>
                          <select value={model} onChange={(e) => setModel(e.target.value)} style={{ background: "#090909", border: "1px solid #1e1e1e", borderRadius: "6px", color: "#f0f0f0", padding: "0.6rem 0.75rem", fontFamily: "monospace", fontSize: "0.7rem", outline: "none", width: "100%" }}>
                            {OPENROUTER_MODELS.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div style={{ color: apiKey.trim() ? LIME : TEXT_SOFT, fontSize: "0.58rem", fontFamily: "monospace" }}>
                        {apiKey.trim() ? "API key is session-only and sent to the backend for this browser session." : `Paste your ${providerKeyLabel(provider)} here to enable generation.`}
                      </div>
                    </div>
                  </div>

                  <div style={{ background: "#090909", border: "1px solid #141414", borderRadius: "10px", padding: "1rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", marginBottom: "0.8rem", flexWrap: "wrap" }}>
                      <div>
                        <div style={{ color: LIME, fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "3px" }}>FOUNDER PROFILE</div>
                        <div style={{ color: TEXT_DIM, fontSize: "0.58rem", marginTop: "4px" }}>{realityGate.readiness}% readiness · {realityGate.missing.length ? `Add ${realityGate.missing.join(", ")}` : "Profile is grounded"}</div>
                      </div>
                      <div style={{ color: TEXT_MUTED, fontSize: "0.56rem", fontFamily: "monospace" }}>Grounds every prompt</div>
                    </div>
                    <div style={{ display: "grid", gap: "0.7rem" }}>
                      <input value={founderProfile.name} onChange={(e) => updateProfileField("name", e.target.value)} placeholder="Founder name" style={{ ...G.ta, padding: "0.8rem 0.9rem", fontSize: "0.85rem" }} />
                      <input value={founderProfile.geo} onChange={(e) => updateProfileField("geo", e.target.value)} placeholder="Geography / market region" style={{ ...G.ta, padding: "0.8rem 0.9rem", fontSize: "0.85rem" }} />
                      <input value={founderProfile.stage} onChange={(e) => updateProfileField("stage", e.target.value)} placeholder="Stage (pre-revenue, traction, etc.)" style={{ ...G.ta, padding: "0.8rem 0.9rem", fontSize: "0.85rem" }} />
                      <textarea value={founderProfile.customer} onChange={(e) => updateProfileField("customer", e.target.value)} placeholder="Who is the customer?" style={{ ...G.ta, minHeight: "68px" }} />
                      <textarea value={founderProfile.problem} onChange={(e) => updateProfileField("problem", e.target.value)} placeholder="What pain are you solving?" style={{ ...G.ta, minHeight: "68px" }} />
                      <textarea value={founderProfile.solution} onChange={(e) => updateProfileField("solution", e.target.value)} placeholder="What is the solution?" style={{ ...G.ta, minHeight: "68px" }} />
                      <textarea value={founderProfile.market} onChange={(e) => updateProfileField("market", e.target.value)} placeholder="Market thesis / competition" style={{ ...G.ta, minHeight: "68px" }} />
                      <textarea value={founderProfile.revenue} onChange={(e) => updateProfileField("revenue", e.target.value)} placeholder="Revenue model or monetization path" style={{ ...G.ta, minHeight: "68px" }} />
                      <textarea value={founderProfile.constraints} onChange={(e) => updateProfileField("constraints", e.target.value)} placeholder="Real constraints: time, capital, ops, market, team" style={{ ...G.ta, minHeight: "68px" }} />
                      <textarea value={founderProfile.strengths} onChange={(e) => updateProfileField("strengths", e.target.value)} placeholder="Founder strengths / unfair advantages" style={{ ...G.ta, minHeight: "68px" }} />
                      <textarea value={founderProfile.risks} onChange={(e) => updateProfileField("risks", e.target.value)} placeholder="Top risks / blockers" style={{ ...G.ta, minHeight: "68px" }} />
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "0.65rem", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                    <button className="gh" style={G.ghost} onClick={() => setWizardStep("auth")}>← Back</button>
                    <button style={G.btn} onClick={() => setWizardStep("memory")}>CONTINUE TO NOTE →</button>
                  </div>
                </div>
              )}

              {wizardStep === "memory" && (
                <div style={{ display: "grid", gap: "1rem" }}>
                  <div style={{ background: "#090909", border: "1px solid #141414", borderRadius: "10px", padding: "1rem" }}>
                    <div style={{ color: LIME, fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "3px", marginBottom: "0.8rem" }}>MEMORY</div>
                    <input value={memoryNote} onChange={(e) => setMemoryNote(e.target.value)} placeholder="Save a founder note, decision, or constraint" style={{ width: "100%", background: "#090909", border: "1px solid #1e1e1e", borderRadius: "7px", color: "#f0f0f0", fontSize: "0.85rem", padding: "0.8rem 0.9rem", outline: "none", boxSizing: "border-box", fontFamily: "monospace" }} />
                    <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap", marginTop: "0.8rem" }}>
                      <button style={G.btn} onClick={() => { persistMemory(memoryNote); setMemoryNote(""); }}>SAVE NOTE</button>
                      <button className="gh" style={G.ghost} onClick={() => setMemoryLog([])}>CLEAR MEMORY</button>
                    </div>
                    <div style={{ color: TEXT_DIM, fontSize: "0.56rem", fontFamily: "monospace", marginTop: "0.65rem" }}>Recent memories and ideas are included in future prompt grounding.</div>
                  </div>

                  <div style={{ background: "#090909", border: "1px solid #141414", borderRadius: "10px", padding: "1rem" }}>
                    <div style={{ color: LIME, fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "3px", marginBottom: "0.8rem" }}>RECENT IDEAS</div>
                    <div style={{ display: "grid", gap: "0.5rem" }}>
                      {ideaHistory.slice(0, 5).map((entry) => (
                        <div key={entry.id} style={{ background: "#090909", border: "1px solid #141414", borderRadius: "8px", padding: "0.7rem 0.85rem", color: TEXT_MUTED, fontSize: "0.74rem" }}>
                          {entry.idea}
                        </div>
                      ))}
                      {!ideaHistory.length && <div style={{ color: TEXT_SOFT, fontSize: "0.72rem" }}>Ideas will appear here after ignition.</div>}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "0.65rem", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
                    <button className="gh" style={G.ghost} onClick={() => setWizardStep("profile")}>← Back</button>
                    <button style={G.btn} onClick={() => setWizardStep("forge")}>ENTER FORGE →</button>
                  </div>
                </div>
              )}

              {wizardStep === "settings" && (
                <div style={{ display: "grid", gap: "1rem" }}>
                  <div style={{ background: themePalette.panelBg, border: `1px solid ${themePalette.border}`, borderRadius: "10px", padding: cardPadding }}>
                    <div style={{ color: LIME, fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "3px", marginBottom: "0.85rem" }}>VISUAL + UI SETTINGS</div>
                    <div style={{ display: "grid", gap: "0.85rem" }}>
                      <div>
                        <div style={{ color: themePalette.textDim, fontSize: "0.58rem", marginBottom: "0.45rem" }}>Theme mode</div>
                        <select value={themeMode} onChange={(e) => setThemeMode(e.target.value)} style={{ width: "100%", background: themePalette.panelAlt, border: `1px solid ${themePalette.border}`, borderRadius: "7px", color: themePalette.textPrimary, padding: "0.8rem 0.9rem", fontFamily: "monospace", fontSize: "0.8rem", outline: "none" }}>
                          <option value="dark">Dark</option>
                          <option value="light">Light</option>
                          <option value="system">System</option>
                        </select>
                      </div>
                      <label style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "1rem", color: themePalette.textMuted, fontSize: "0.8rem", background: themePalette.panelAlt, border: `1px solid ${themePalette.border}`, borderRadius: "8px", padding: "0.85rem 0.9rem" }}>
                        <span>
                          <div style={{ fontWeight: 900, marginBottom: "0.15rem" }}>Compact UI</div>
                          <div style={{ color: themePalette.textDim, fontSize: "0.58rem" }}>Tightens spacing for a lighter workspace.</div>
                        </span>
                        <input type="checkbox" checked={compactMode} onChange={(e) => setCompactMode(e.target.checked)} />
                      </label>
                    </div>
                  </div>

                  <div style={{ background: themePalette.panelBg, border: `1px solid ${themePalette.border}`, borderRadius: "10px", padding: cardPadding }}>
                    <div style={{ color: LIME, fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "3px", marginBottom: "0.85rem" }}>SESSION TOOLS</div>
                    <div style={{ display: "grid", gap: "0.75rem", color: themePalette.textMuted, fontSize: "0.78rem" }}>
                      <div>• Open the Intel or Build Co. panels when you want live analysis and company architecture support.</div>
                      <div>• Tap Note to capture a founder memory, then return to Forge to ground the next output.</div>
                      <div>• Use the sidebar to jump between profile, memory, settings, and the how-to guide.</div>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "0.65rem", alignItems: "center", flexWrap: "wrap" }}>
                    <button className="gh" style={G.ghost} onClick={() => openSideView("forge")}>← Back to Forge</button>
                    {isAuthenticated && <button className="gh" style={G.ghost} onClick={signOut}>Logout</button>}
                  </div>
                </div>
              )}

              {wizardStep === "guide" && (
                <div style={{ display: "grid", gap: "1rem" }}>
                  <div style={{ background: themePalette.panelBg, border: `1px solid ${themePalette.border}`, borderRadius: "10px", padding: cardPadding }}>
                    <div style={{ color: LIME, fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "3px", marginBottom: "0.85rem" }}>FORGE QUICK GUIDE</div>
                    <div style={{ display: "grid", gap: "0.8rem", color: themePalette.textMuted, fontSize: "0.78rem", lineHeight: 1.8 }}>
                      <div><strong style={{ color: themePalette.textPrimary }}>1. Start as a guest.</strong> You can ignite your idea immediately and work through the first questions without creating an account.</div>
                      <div><strong style={{ color: themePalette.textPrimary }}>2. Return later to save and unlock more.</strong> Create an account when you want to keep your work, unlock the score + roadmap, and attach your founder profile.</div>
                      <div><strong style={{ color: themePalette.textPrimary }}>3. Fill the profile when you’re ready.</strong> Founder location, customer, problem, solution, market, revenue, constraints, strengths, and risks make every response more grounded.</div>
                      <div><strong style={{ color: themePalette.textPrimary }}>4. Ignite your idea.</strong> Drop a raw idea and let FORGE pressure-test it with a brutally honest founder lens.</div>
                      <div><strong style={{ color: themePalette.textPrimary }}>5. Use Intel and Build Co.</strong> Open the side panels for research, deeper questioning, and company architecture support.</div>
                    </div>
                  </div>
                  <div style={{ background: themePalette.panelAlt, border: `1px solid ${themePalette.border}`, borderRadius: "10px", padding: cardPadding }}>
                    <div style={{ color: LIME, fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "3px", marginBottom: "0.85rem" }}>PROMPT RULES</div>
                    <div style={{ color: themePalette.textMuted, fontSize: "0.78rem", lineHeight: 1.8 }}>
                      FORGE is intentionally ruthless and real: it should challenge your assumptions, pressure-test your market, and force clarity before you move.
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "0.65rem", alignItems: "center", flexWrap: "wrap" }}>
                    <button className="gh" style={G.ghost} onClick={() => openSideView("forge")}>← Back to Forge</button>
                  </div>
                </div>
              )}

              {wizardStep === "pricing" && (
                <div style={{ display: "grid", gap: "1rem" }}>
                  <div style={{ background: themePalette.panelBg, border: `1px solid ${themePalette.border}`, borderRadius: "10px", padding: cardPadding }}>
                    <div style={{ color: LIME, fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "3px", marginBottom: "0.85rem" }}>PRICING + LAUNCH</div>
                    <div style={{ display: "grid", gap: "0.9rem", color: themePalette.textMuted, fontSize: "0.78rem", lineHeight: 1.8 }}>
                      <div>
                        <strong style={{ color: themePalette.textPrimary }}>Free</strong> keeps the beta usable for founders who want to validate ideas fast.
                      </div>
                      <div>
                        <strong style={{ color: themePalette.textPrimary }}>Pro</strong> unlocks higher output volume, saved projects, and a cleaner founder workflow.
                      </div>
                      <div style={{ color: themePalette.textDim, fontSize: "0.68rem" }}>Current beta: login + saved work is active; the pricing layer is a clear stub so the product feels real from day one.</div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.8rem", marginTop: "1rem" }}>
                      {PRICING_TIERS.map((tier) => (
                        <div key={tier.name} style={{ background: themePalette.panelAlt, border: `1px solid ${themePalette.border}`, borderRadius: "10px", padding: "1rem" }}>
                          <div style={{ color: LIME, fontSize: "0.58rem", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "0.35rem" }}>{tier.name}</div>
                          <div style={{ color: themePalette.textPrimary, fontSize: "1.1rem", fontWeight: 900, marginBottom: "0.3rem" }}>{tier.price}</div>
                          <div style={{ color: themePalette.textMuted, fontSize: "0.74rem", marginBottom: "0.7rem" }}>{tier.summary}</div>
                          <div style={{ display: "grid", gap: "0.5rem" }}>
                            {tier.perks.map((perk) => (
                              <div key={perk} style={{ color: themePalette.textMuted, fontSize: "0.72rem" }}>• {perk}</div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div style={{ background: themePalette.panelBg, border: `1px solid ${themePalette.border}`, borderRadius: "10px", padding: cardPadding }}>
                    <div style={{ color: LIME, fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "3px", marginBottom: "0.85rem" }}>WAITLIST</div>
                    <div style={{ display: "grid", gap: "0.8rem" }}>
                      <div style={{ color: themePalette.textMuted, fontSize: "0.78rem", lineHeight: 1.8 }}>
                        Join the beta list to get launch updates, founder feedback prompts, and early access to the next build wave.
                      </div>
                      <input value={waitlistEmail} onChange={(e) => setWaitlistEmail(e.target.value)} placeholder="Email" style={{ width: "100%", background: themePalette.panelAlt, border: `1px solid ${themePalette.border}`, borderRadius: "7px", color: themePalette.textPrimary, fontSize: "0.85rem", padding: "0.8rem 0.9rem", outline: "none", boxSizing: "border-box", fontFamily: "monospace" }} />
                      <select value={waitlistStage} onChange={(e) => setWaitlistStage(e.target.value)} style={{ width: "100%", background: themePalette.panelAlt, border: `1px solid ${themePalette.border}`, borderRadius: "7px", color: themePalette.textPrimary, fontSize: "0.85rem", padding: "0.8rem 0.9rem", outline: "none", fontFamily: "monospace" }}>
                        <option value="Early idea">Early idea</option>
                        <option value="Validation">Validation</option>
                        <option value="Pre-revenue">Pre-revenue</option>
                        <option value="Already building">Already building</option>
                      </select>
                      <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap", alignItems: "center" }}>
                        <button style={{ ...G.btn, opacity: waitlistBusy ? 0.5 : 1 }} onClick={joinWaitlist} disabled={waitlistBusy}>{waitlistBusy ? "JOINING…" : "JOIN WAITLIST"}</button>
                        <button className="gh" style={G.ghost} onClick={() => openSideView("forge")}>← Back to Forge</button>
                      </div>
                      {waitlistStatus && (
                        <div style={{ marginTop: 0, color: waitlistStatus.includes("already") || waitlistStatus.includes("You are on the waitlist") ? LIME : PINK, fontSize: "0.72rem", padding: "0.7rem 0.85rem", borderRadius: "8px", background: waitlistStatus.includes("already") || waitlistStatus.includes("You are on the waitlist") ? `${LIME}08` : `${PINK}08`, border: `1px solid ${waitlistStatus.includes("already") || waitlistStatus.includes("You are on the waitlist") ? `${LIME}18` : `${PINK}18`}` }}>
                          {waitlistStatus}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {wizardStep === "forge" && (
            <div style={{ display: "grid", gap: "1rem" }}>
              {phase === "ignition" && (
                <div style={{ animation: "fadeIn .4s ease" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
                    <div>
                      <p style={{ ...G.label, marginBottom: "0.45rem" }}>FORGE PROMISE</p>
                      <h2 style={{ margin: 0, fontSize: "1.25rem", lineHeight: "1.5", fontWeight: 800 }}>Investor-grade validation in 30 minutes from a single founder hypothesis.</h2>
                    </div>
                    <div style={{ display: "grid", gap: "0.85rem", padding: "1rem", borderRadius: "14px", border: `1px solid ${LIME}20`, background: `${themePalette.panelAlt}` }}>
                      <div style={{ color: TEXT_DIM, fontSize: "0.78rem" }}>What you will build:</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.9rem" }}>
                        <div style={{ padding: "0.95rem", borderRadius: "12px", background: themePalette.pageBg, border: `1px solid ${themePalette.border}` }}>
                          <div style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.5rem" }}>Result stack snapshot</div>
                          <div style={{ color: TEXT_MUTED, fontSize: "0.8rem", lineHeight: "1.65" }}>
                            • Problem: painful manual workflow costing 10+ hours per week.<br />
                            • Customer: revenue operations leaders at fintechs with 500+ monthly payouts.<br />
                            • Moat: proprietary rules built from real declined payment cases.<br />
                            • Plan: validate 5 buyers, launch a paid pilot, lock first revenue in 30 days.
                          </div>
                        </div>
                        <div style={{ padding: "0.95rem", borderRadius: "12px", background: themePalette.pageBg, border: `1px solid ${themePalette.border}` }}>
                          <div style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.5rem" }}>Why FORGE works</div>
                          <div style={{ color: TEXT_MUTED, fontSize: "0.8rem", lineHeight: "1.65" }}>
                            It converts raw founder intuition into a focused question sequence, then turns the answers into a decision-grade plan and score.
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "grid", gap: "0.9rem", marginTop: "1.4rem" }}>
                    <div>
                      <div style={{ ...G.label }}>Choose your product track</div>
                      <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap" }}>
                        {Object.entries(PRODUCT_PATHS).map(([key, path]) => (
                          <button key={key} type="button" style={{
                            ...G.ghost,
                            borderColor: productTrack === key ? LIME : themePalette.border,
                            color: productTrack === key ? LIME : themePalette.textPrimary,
                            background: productTrack === key ? "rgba(200,255,0,0.1)" : themePalette.panelAlt,
                          }} onClick={() => setProductTrack(key)}>{path.label}</button>
                        ))}
                      </div>
                      <div style={{ color: TEXT_DIM, fontSize: "0.78rem", marginTop: "0.55rem" }}>{PRODUCT_PATHS[productTrack].description}</div>
                    </div>
                    <div>
                      <div style={{ ...G.label }}>Choose your workflow mode</div>
                      <div style={{ display: "flex", gap: "0.65rem", flexWrap: "wrap" }}>
                        {Object.entries(WORKFLOW_MODES).map(([key, mode]) => (
                          <button key={key} type="button" style={{
                            ...G.ghost,
                            borderColor: workflowMode === key ? LIME : themePalette.border,
                            color: workflowMode === key ? LIME : themePalette.textPrimary,
                            background: workflowMode === key ? "rgba(200,255,0,0.1)" : themePalette.panelAlt,
                          }} onClick={() => setWorkflowMode(key)}>{mode.label}</button>
                        ))}
                      </div>
                      <div style={{ color: TEXT_DIM, fontSize: "0.78rem", marginTop: "0.55rem" }}>{WORKFLOW_MODES[workflowMode].details}</div>
                    </div>
                  </div>
                  <p style={{ ...G.label, marginTop: "1.5rem" }}>Drop your raw idea</p>
                  <textarea style={{ ...G.ta, height: "155px" }} placeholder={"No polish needed. Half-baked is fine.\nRaw and messy is where the best ideas live."} value={idea} onChange={(e) => setIdea(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !loading) ignite(); }} />
                  <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginTop: "0.9rem", flexWrap: "wrap" }}>
                    <button style={{ ...G.btn, opacity: !idea.trim() || loading ? 0.28 : 1 }} onClick={ignite} disabled={!idea.trim() || loading}>{loading ? "LOADING…" : "IGNITE →"}</button>
                    <span style={{ color: TEXT_DIM, fontSize: "0.6rem" }}>⌘ + Enter</span>
                  </div>
                  {!isAuthenticated && (
                    <div style={{ marginTop: "0.9rem", padding: "0.9rem 1rem", borderRadius: "10px", border: `1px solid ${LIME}18`, background: `${LIME}05`, color: TEXT_MUTED, fontSize: "0.74rem", lineHeight: 1.6 }}>
                      Guest mode is live. You have {Math.max(0, GUEST_FREE_QUESTIONS - qa.length)} free questions before sign-up is suggested.
                      <button className="gh" style={{ ...G.ghost, marginLeft: "0.6rem", display: "inline-flex" }} onClick={() => openSideView("auth")}>Create account</button>
                    </div>
                  )}
                  <div style={{ marginTop: "0.9rem", display: "grid", gap: "0.7rem" }}>
                    <div style={{ color: TEXT_DIM, fontSize: "0.76rem" }}>Used by pre-seed and seed founders who need a sharper plan, not another vague idea generator.</div>
                    <div style={{ color: TEXT_DIM, fontSize: "0.76rem" }}>This is not a landing page builder. It is a founder decision engine that forces your most important assumptions on the table.</div>
                  </div>
                  {err && <div style={{ ...G.err, marginTop: "0.9rem" }}>{err}</div>}
                </div>
              )}

              {phase === "questioning" && (
                <div style={{ animation: "fadeIn .3s ease" }}>
                  <div style={{ display: "flex", gap: "4px", marginBottom: "0.7rem" }}>
                    {Array.from({ length: Q_TARGET }).map((_, i) => (
                      <div key={i} style={{ height: "2px", flex: 1, borderRadius: "2px", background: i < qa.length ? LIME : i === qa.length ? `${LIME}32` : "#111", transition: "background .4s" }} />
                    ))}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", marginBottom: "1rem", flexWrap: "wrap" }}>
                    <div>
                      <div style={{ fontSize: "0.65rem", letterSpacing: "2px", color: TEXT_DIM, textTransform: "uppercase" }}>Step {qa.length + 1} of {Q_TARGET}</div>
                      <div style={{ fontSize: "1rem", fontWeight: 700, color: "#f4f4f4", marginTop: "0.25rem" }}>{getQuestionStepMetadata(qa.length).title}</div>
                    </div>
                    <div style={{ color: TEXT_DIM, fontSize: "0.75rem", maxWidth: "480px" }}>{getQuestionStepMetadata(qa.length).why}</div>
                  </div>
                  <div style={{ marginBottom: "1.4rem", padding: "0.95rem 1rem", borderRadius: "12px", background: themePalette.panelAlt, border: `1px solid ${themePalette.border}` }}>
                    <div style={{ fontSize: "0.72rem", color: TEXT_DIM, marginBottom: "0.45rem", letterSpacing: "1.5px", textTransform: "uppercase" }}>Example answer</div>
                    <div style={{ color: "#e5e5e5", fontSize: "0.87rem", lineHeight: "1.6" }}>{getQuestionStepMetadata(qa.length).example}</div>
                  </div>
                  {loading ? (
                    <div style={{ padding: "2.5rem 0" }}>
                      <span style={{ color: LIME, fontSize: "0.68rem", letterSpacing: "2.5px" }}>FORGE</span>
                      <span style={{ color: TEXT_DIM, fontSize: "0.68rem" }}> thinking</span>
                      {[0, 1, 2, 3].map((i) => (
                        <span key={i} style={{ color: LIME, animation: `pulse 1.5s ease ${i * 0.25}s infinite` }}>.</span>
                      ))}
                    </div>
                  ) : (
                    <div>
                      <p style={{ color: "#e5e5e5", fontSize: "1.1rem", lineHeight: "1.78", margin: "0 0 1.2rem", fontWeight: "300" }}>{curQ}</p>
                      <p style={G.label}>Your answer</p>
                      <textarea ref={taRef} style={{ ...G.ta, height: "108px" }} placeholder="Honest. No performance." value={curA} onChange={(e) => { setCurA(e.target.value); if (e.target.value.length === 3) triggerPrefetch([...qa, { question: curQ, answer: e.target.value }]); }} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && curA.trim() && !loading) next(); }} autoFocus />
                      <div style={{ display: "grid", gap: "0.75rem", marginTop: "0.85rem" }}>
                        <div style={{ display: "grid", gap: "0.5rem" }}>
                          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                            {currentTags.map((tag) => (
                              <button key={tag} style={{ border: `1px solid ${LIME}30`, background: "rgba(200,255,0,0.08)", color: LIME, borderRadius: "999px", padding: "0.45rem 0.7rem", fontSize: "0.72rem", cursor: "pointer" }} onClick={() => setCurrentTags((prev) => prev.filter((t) => t !== tag))}>#{tag} ×</button>
                            ))}
                          </div>
                          <div style={{ display: "flex", gap: "0.7rem", flexWrap: "wrap", alignItems: "center" }}>
                            <input value={tagValue} onChange={(e) => setTagValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const tag = normalizeTag(tagValue); if (tag && !currentTags.includes(tag) && currentTags.length < 5) { setCurrentTags((prev) => [...prev, tag]); } setTagValue(''); } }} placeholder="Add a tag like segment, region, risk…" style={{ flex: 1, minWidth: "0", background: themePalette.panelAlt, border: `1px solid ${themePalette.border}`, borderRadius: "7px", color: themePalette.textPrimary, padding: "0.85rem 1rem", fontFamily: "monospace", fontSize: "0.87rem", outline: "none" }} />
                            <button className="gh" style={{ ...G.ghost, fontSize: "0.72rem" }} onClick={() => { const tag = normalizeTag(tagValue); if (tag && !currentTags.includes(tag) && currentTags.length < 5) { setCurrentTags((prev) => [...prev, tag]); } setTagValue(''); }}>Add tag</button>
                          </div>
                          <div style={{ color: TEXT_DIM, fontSize: "0.68rem" }}>Tags help FORGE connect your answers to later plan sections.</div>
                        </div>
                        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
                          <button style={{ ...G.btn, opacity: !curA.trim() ? 0.22 : 1 }} onClick={next} disabled={!curA.trim() || loading}>{qa.length + 1 === Q_TARGET ? "FINISH →" : "NEXT →"}</button>
                          {qa.length >= 3 && !isAuthenticated && (
                            <button className="gh" style={G.ghost} onClick={() => { setErr("Create a free account to unlock your Idea Score and roadmap."); setPhase("output-select"); }}>skip to unlock →</button>
                          )}
                          {qa.length >= 3 && isAuthenticated && <button className="gh" style={G.ghost} onClick={() => { scoreIdea(qa); setPhase("output-select"); }}>skip →</button>}
                        </div>
                      </div>
                      {(answerDifficulty || answerCritique) && (
                        <div style={{ marginTop: "0.95rem", padding: "0.9rem 1rem", borderRadius: "9px", background: themePalette.panelAlt, border: `1px solid ${themePalette.border}`, color: TEXT_DIM, fontSize: "0.78rem", lineHeight: 1.55 }}>
                          <div style={{ fontWeight: 700, color: answerDifficulty === 'Founder-ready' ? LIME : PINK, marginBottom: "0.35rem" }}>{answerDifficulty}</div>
                          <div>{answerCritique}</div>
                        </div>
                      )}
                      {!isAuthenticated && qa.length >= 3 && (
                        <div style={{ marginTop: "0.9rem", padding: "0.8rem 0.9rem", borderRadius: "9px", border: `1px solid ${LIME}18`, background: `${LIME}05`, color: TEXT_MUTED, fontSize: "0.74rem", lineHeight: 1.6 }}>
                          You’ve unlocked a sharper insight loop. Create a free account to save your work and lock in the full score + roadmap.
                          <button className="gh" style={{ ...G.ghost, marginLeft: "0.6rem", display: "inline-flex" }} onClick={() => openSideView("auth")}>Create account</button>
                        </div>
                      )}
                      {err && <div style={{ ...G.err, marginTop: "0.9rem" }}>{err}</div>}
                    </div>
                  )}
                </div>
              )}

              {phase === "output-select" && (
                <div style={{ animation: "fadeIn .3s ease" }}>
                  {ideaScore && (
                    <div style={{ background: "#090909", border: `1px solid ${scoreColor(ideaScore.score)}18`, borderRadius: "10px", padding: "1.15rem 1.35rem", marginBottom: "2rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "0.75rem" }}>
                        <div style={{ fontSize: "2.1rem", fontWeight: "900", color: scoreColor(ideaScore.score), fontFamily: "monospace", lineHeight: 1 }}>{ideaScore.score}%</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: scoreColor(ideaScore.score), fontSize: "0.65rem", fontWeight: "bold", letterSpacing: "2px" }}>{(ideaScore.label || "").toUpperCase()}</div>
                          <div style={{ color: TEXT_MUTED, fontSize: "0.77rem", marginTop: "2px", lineHeight: "1.5" }}>{ideaScore.verdict}</div>
                        </div>
                        <div style={{ width: "48px", height: "48px", borderRadius: "50%", background: `${scoreColor(ideaScore.score)}10`, border: `2px solid ${scoreColor(ideaScore.score)}35`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.55rem", color: scoreColor(ideaScore.score), fontWeight: "bold", textAlign: "center", lineHeight: "1.3", fontFamily: "monospace" }}>IDEA<br />SCORE</div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.65rem" }}>
                        <div>
                          <div style={{ color: LIME, fontSize: "0.56rem", letterSpacing: "2px", marginBottom: "0.3rem" }}>STRENGTHS</div>
                          {(ideaScore.strengths || []).map((s, i) => (
                            <div key={i} style={{ color: TEXT_MUTED, fontSize: "0.74rem", marginBottom: "0.15rem" }}>→ {s}</div>
                          ))}
                        </div>
                        <div>
                          <div style={{ color: PINK, fontSize: "0.56rem", letterSpacing: "2px", marginBottom: "0.3rem" }}>GAPS</div>
                          {(ideaScore.gaps || []).map((g, i) => (
                            <div key={i} style={{ color: TEXT_MUTED, fontSize: "0.74rem", marginBottom: "0.15rem" }}>→ {g}</div>
                          ))}
                        </div>
                      </div>
                      <div style={{ marginTop: "1rem", display: "grid", gap: "0.75rem" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.6rem" }}>
                          {Object.entries(ideaScore.metrics || {}).map(([metric, value]) => (
                            <div key={metric} style={{ padding: "0.85rem", borderRadius: "10px", background: "rgba(255,255,255,0.03)", border: `1px solid ${themePalette.border}` }}>
                              <div style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "1.7px", color: TEXT_DIM, marginBottom: "0.35rem" }}>{metric.replace(/_/g, " ")}</div>
                              <div style={{ fontSize: "1rem", fontWeight: 700, color: "#fff" }}>{Math.round(value)}%</div>
                            </div>
                          ))}
                        </div>
                        {Array.isArray(ideaScore.evidence_links) && ideaScore.evidence_links.length > 0 && (
                          <div style={{ color: TEXT_DIM, fontSize: "0.76rem", lineHeight: "1.65" }}>
                            Evidence:
                            <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
                              {ideaScore.evidence_links.map((link, i) => (
                                <li key={i} style={{ marginBottom: "0.3rem" }}>{link}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {!ideaScore && (
                    <div style={{ marginBottom: "2rem", padding: "0.85rem 1rem", borderRadius: "10px", border: `1px solid ${LIME}18`, background: `${LIME}05`, color: TEXT_MUTED, fontSize: "0.74rem", lineHeight: 1.6 }}>
                      {isAuthenticated
                        ? "Scoring your idea…"
                        : "Create a free account to unlock your Idea Score and roadmap, then return to generate the full output stack."}
                    </div>
                  )}

                  <p style={G.label}>Build your output</p>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.8rem", marginBottom: "0.8rem" }}>
                    {OUTPUTS.map((o) => {
                      const done = !!outputs[o.key];
                      return (
                        <div key={o.key} className="outcard" style={{ background: "#0a0a0a", border: `1px solid ${done ? `${LIME}22` : "#131313"}`, borderRadius: "10px", padding: "1.1rem", cursor: "pointer", transition: "all .18s", position: "relative" }} onClick={() => generate(o.key)}>
                          {done && <span style={{ position: "absolute", top: "0.5rem", right: "0.6rem", color: LIME, fontSize: "0.5rem", letterSpacing: "1.5px" }}>READY</span>}
                          <div style={{ fontSize: "1.3rem", marginBottom: "0.45rem" }}>{o.icon}</div>
                          <div style={{ color: "#e8e8e8", fontSize: "0.84rem", fontWeight: "bold", marginBottom: "0.25rem" }}>{o.label}</div>
                          <div style={{ color: TEXT_MUTED, fontSize: "0.7rem", lineHeight: "1.4" }}>{o.desc}</div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ background: "#0a0a0a", border: `1px solid ${PURPLE}18`, borderRadius: "10px", padding: "1.1rem", cursor: "pointer", display: "flex", alignItems: "center", gap: "1rem", transition: "all .18s" }} onClick={() => setCompany(true)} onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${PURPLE}45`; }} onMouseLeave={(e) => { e.currentTarget.style.borderColor = `${PURPLE}18`; }}>
                    <span style={{ fontSize: "1.3rem" }}>🏗️</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: PURPLE, fontSize: "0.84rem", fontWeight: "bold", marginBottom: "0.22rem" }}>Company Builder</div>
                      <div style={{ color: TEXT_MUTED, fontSize: "0.7rem" }}>Systems, workflows & org design to form a real company</div>
                    </div>
                    <span style={{ color: PURPLE, fontSize: "1rem", flexShrink: 0 }}>→</span>
                  </div>
                  {err && <div style={{ ...G.err, marginTop: "1rem" }}>{err}</div>}
                </div>
              )}

              {phase === "generating" && (
                <div style={{ textAlign: "center", padding: "6rem 0", animation: "fadeIn .3s ease" }}>
                  <div style={{ width: "36px", height: "36px", border: `2px solid ${LIME}15`, borderTop: `2px solid ${LIME}`, borderRadius: "50%", margin: "0 auto 1.5rem", animation: "spin 0.7s linear infinite" }} />
                  <p style={{ color: LIME, fontSize: "0.66rem", letterSpacing: "4px", margin: "0 0 0.45rem" }}>FORGING</p>
                  <p style={{ color: TEXT_DIM, fontSize: "0.74rem" }}>{loadMsg}</p>
                </div>
              )}

              {phase === "output" && outType && outputs[outType] && (
                <div style={{ animation: "fadeIn .3s ease" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "0.6rem" }}>
                    <span style={{ color: LIME, fontSize: "0.6rem", letterSpacing: "3px", textTransform: "uppercase" }}>{OUTPUTS.find((o) => o.key === outType)?.icon} {OUTPUTS.find((o) => o.key === outType)?.label}</span>
                    <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                      <button className="gh" style={G.ghost} onClick={() => regen(outType)}>↻ Regen</button>
                      <button className="gh" style={G.ghost} onClick={exportCurrentOutput}>⬇ Download TXT</button>
                      <button className="gh" style={G.ghost} onClick={exportCurrentOutputPdf}>🖨️ Export PDF</button>
                      <button className="gh" style={G.ghost} onClick={() => setPhase("output-select")}>← All</button>
                      <button className="gh" style={G.ghost} onClick={reset}>New Idea</button>
                    </div>
                  </div>
                  <div style={{ background: "#0b0b0b", border: "1px solid #121212", borderRadius: "12px", padding: outType === "mindmap" ? "0" : "1.9rem" }}>
                    {outType === "mindmap" && <MindMap data={outputs[outType]} />}
                    {outType === "blueprint" && <Blueprint data={outputs[outType]} />}
                    {outType === "roadmap" && <Roadmap data={outputs[outType]} />}
                    {outType === "businessplan" && <BusinessPlan data={outputs[outType]} />}
                    {outType === "actionplan" && <ActionPlan data={outputs[outType]} />}
                    {outType === "swot" && <SWOT data={outputs[outType]} />}
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ height: "5rem" }} />
        </div>
      </div>
    </div>
  );
}
