#!/usr/bin/env node
/**
 * AI Code Review Script
 * Model: qwen2.5-coder:1.5b (local, free, via Ollama)
 *
 * TODO (Anthropic — paid upgrade):
 *   1. npm install @anthropic-ai/sdk
 *   2. Add ANTHROPIC_API_KEY to GitHub repo Secrets
 *   3. Uncomment callAnthropic() below and swap it in main()
 */

import fs from "fs";
import readline from "readline";

// ── Config ─────────────────────────────────────────────────────────────────
// Hardcoded model — change here to switch models globally
const OLLAMA_URL = "http://localhost:11434";
const MODEL      = "qwen2.5-coder:1.5b";   // ← single source of truth

// ── Read diff ───────────────────────────────────────────────────────────────
async function readInput() {
  const args = process.argv.slice(2);
  const idx  = args.indexOf("--diff");

  if (idx !== -1 && args[idx + 1]) {
    return fs.readFileSync(args[idx + 1], "utf-8");
  }

  const rl    = readline.createInterface({ input: process.stdin });
  const lines = [];
  for await (const line of rl) lines.push(line);
  return lines.join("\n");
}

// ── Parse diff → extract real file names and line numbers ──────────────────
// This prevents the AI from hallucinating file names
function parseDiffMeta(diff) {
  const files   = [];
  const fileRx  = /^diff --git a\/.+ b\/(.+)$/gm;
  let m;
  while ((m = fileRx.exec(diff)) !== null) {
    if (!files.includes(m[1])) files.push(m[1]);
  }
  return files;
}

// ── Call Ollama ─────────────────────────────────────────────────────────────
async function callOllama(diff, changedFiles) {
  const fileList = changedFiles.map((f) => `  - ${f}`).join("\n");

  const systemPrompt = `You are a senior software engineer doing a strict code review.
Return ONLY valid JSON — no markdown, no explanation, no code fences.

JSON schema (follow exactly):
{
  "summary": "2-3 sentence overall assessment",
  "score": <number 0-100, lower = more issues>,
  "issues": [
    {
      "file": "exact filename as listed below",
      "line": <line number where issue occurs>,
      "severity": "critical" | "high" | "medium" | "low",
      "category": "security" | "bug" | "performance" | "style" | "eslint" | "typescript",
      "title": "short title",
      "description": "what is wrong and why it is a problem",
      "suggestion": "exactly how to fix it"
    }
  ]
}

Files changed in this diff (use ONLY these exact filenames):
${fileList}

Rules:
- Only report issues in lines that start with + (added lines)
- Use the EXACT filename from the list above — never invent filenames
- Line number = the new file line number shown in the @@ hunk header
- Flag: SQL injection, console.log in prod, any types, missing error handling
- Flag ESLint: no-explicit-any, prefer-const, unused vars
- Flag TypeScript: missing types, use of any
- If code is clean: return empty issues array and score >= 85`;

  const userPrompt = `Review this git diff:\n\n${diff}`;

  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method : "POST",
    headers: { "Content-Type": "application/json" },
    body   : JSON.stringify({
      model  : MODEL,
      prompt : userPrompt,
      system : systemPrompt,
      stream : false,
      format : "json",
      options: { temperature: 0.1, num_predict: 4000 },
    }),
    signal: AbortSignal.timeout(300_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Ollama error ${res.status}: ${text}\n` +
      `Make sure Ollama is running and "${MODEL}" is pulled.\n` +
      `Run: ollama pull ${MODEL}`
    );
  }

  const data = await res.json();
  return data.response;
}

// TODO (Anthropic — uncomment to use Claude instead of Ollama):
// async function callAnthropic(diff, changedFiles) {
//   const { default: Anthropic } = await import("@anthropic-ai/sdk");
//   const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
//   const fileList = changedFiles.map((f) => `  - ${f}`).join("\n");
//   const msg = await client.messages.create({
//     model      : "claude-sonnet-4-6",   // or claude-opus-4-6 for best results
//     max_tokens : 4096,
//     system     : systemPrompt,          // same prompt as callOllama above
//     messages   : [{ role: "user", content: `Review this git diff:\n\n${diff}` }],
//   });
//   return msg.content[0].text;
// }

// ── Parse JSON response ──────────────────────────────────────────────────────
function parseResponse(raw) {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
    else throw new Error("AI returned non-JSON. Try running again or switch to a larger model.");
  }

  // Normalize field names — small models use different keys
  return {
    summary: parsed.summary ?? parsed.overview ?? parsed.assessment ?? parsed.description ?? "No summary provided.",
    score  : parsed.score   ?? parsed.overall_score ?? parsed.rating ?? parsed.quality_score ?? 70,
    issues : parsed.issues  ?? parsed.problems      ?? parsed.findings ?? parsed.errors ?? [],
  };
}

// ── Validate issues — fuzzy match file names to prevent hallucination ────────
function validateReport(report, changedFiles) {
  report.issues = (report.issues ?? []).filter((issue) => {
    if (!issue.file) return false;

    // exact match first
    if (changedFiles.includes(issue.file)) return true;

    // fuzzy: check if any changed file ends with the reported file (or vice versa)
    const fuzzy = changedFiles.find(
      (f) => f.endsWith(issue.file) || issue.file.endsWith(f) || f.includes(issue.file)
    );

    if (fuzzy) {
      issue.file = fuzzy; // correct the file name to the full path
      return true;
    }

    console.warn(`  Skipping hallucinated file: "${issue.file}"`);
    return false;
  });
  return report;
}

// ── Format Markdown for PR comment ──────────────────────────────────────────
function toMarkdown(report) {
  const icon = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵" };
  const lines = [];

  lines.push("## AI Code Review");
  lines.push(
    `> **Score:** ${report.score}/100 &nbsp;|&nbsp; **Model:** \`${MODEL}\` &nbsp;|&nbsp; **Issues:** ${report.issues.length}`
  );
  lines.push("");
  lines.push(`**${report.summary}**`);
  lines.push("");

  if (report.issues.length === 0) {
    lines.push("No issues found — code looks good!");
  } else {
    // Group by file
    const byFile = {};
    for (const issue of report.issues) {
      (byFile[issue.file] ??= []).push(issue);
    }

    for (const [file, issues] of Object.entries(byFile)) {
      lines.push(`### \`${file}\``);
      for (const issue of issues) {
        const sev  = issue.severity?.toLowerCase() ?? "low";
        const cat  = issue.category ? ` \`[${issue.category}]\`` : "";
        lines.push(
          `**${icon[sev] ?? "⚪"} ${sev.toUpperCase()} — Line ${issue.line}${cat} — ${issue.title}**`
        );
        lines.push(issue.description);
        if (issue.suggestion) lines.push(`> 💡 *${issue.suggestion}*`);
        lines.push("");
      }
    }
  }

  lines.push("---");
  lines.push(`*Generated by AI Code Review · Ollama + \`${MODEL}\`*`);
  return lines.join("\n");
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const diff = await readInput();

  if (!diff.trim()) {
    console.log("No diff — nothing to review.");
    process.exit(0);
  }

  const changedFiles = parseDiffMeta(diff);
  console.log(`\n Reviewing ${changedFiles.length} file(s) with ${MODEL}...`);
  console.log(`   Files: ${changedFiles.join(", ")}`);
  console.log(`   Diff : ${diff.split("\n").length} lines`);

  // TODO (Anthropic): swap callOllama → callAnthropic here
  const raw = await callOllama(diff, changedFiles);

  // Debug: show raw AI response so we can verify the JSON shape
  console.log("\n── Raw AI response ──────────────────────────────────");
  console.log(raw.slice(0, 800));
  console.log("─────────────────────────────────────────────────────\n");

  let report = parseResponse(raw);
  report     = validateReport(report, changedFiles);

  fs.writeFileSync("review.json", JSON.stringify(report, null, 2));
  console.log(" Written: review.json");

  const md = toMarkdown(report);
  fs.writeFileSync("review.md", md);
  console.log(" Written: review.md");

  // Console summary
  console.log("\n" + "─".repeat(60));
  console.log(`Score : ${report.score}/100`);
  console.log(`Issues: ${report.issues.length}`);
  for (const i of report.issues) {
    console.log(`  [${i.severity.toUpperCase()}] ${i.file}:${i.line} — ${i.title}`);
  }
  console.log("─".repeat(60) + "\n");

  process.exit(0);
}

main().catch((err) => {
  console.error(" Review failed:", err.message);
  process.exit(1);
});
