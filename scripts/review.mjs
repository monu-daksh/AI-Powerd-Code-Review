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
const MODEL      = "deepseek-coder-v2";   // ← single source of truth

// ── Read diff ───────────────────────────────────────────────────────────────
async function readInput() {
  const args = process.argv.slice(2);
  const idx  = args.indexOf("--diff");

  if (idx !== -1 && args[idx + 1]) {
    // Strip UTF-8 BOM if present (PowerShell Out-File adds BOM by default)
    return fs.readFileSync(args[idx + 1], "utf-8").replace(/^\uFEFF/, "");
  }

  const rl    = readline.createInterface({ input: process.stdin });
  const lines = [];
  for await (const line of rl) lines.push(line);
  return lines.join("\n");
}

// ── Parse diff → extract real file names and line numbers ──────────────────
// This prevents the AI from hallucinating file names
// NOTE: normalize \r\n → \n first (Windows PowerShell writes CRLF line endings)
function parseDiffMeta(diff) {
  const normalized = diff.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const files      = [];
  const fileRx     = /^diff --git a\/.+ b\/(.+)$/gm;
  let m;
  while ((m = fileRx.exec(normalized)) !== null) {
    const file = m[1].trim(); // trim trailing \r just in case
    if (!files.includes(file)) files.push(file);
  }
  return files;
}

// ── Filter diff to only src/ files (skip CI/tooling changes) ────────────────
// This prevents the AI from reviewing .github/ or scripts/ and producing false positives
function filterDiffToSrc(diff) {
  const normalized = diff.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const sections = normalized.split(/(?=^diff --git )/m);
  const srcSections = sections.filter((s) => {
    const m = s.match(/^diff --git a\/.+ b\/(.+)$/m);
    if (!m) return false;
    const file = m[1].trim();
    return file.startsWith("src/");
  });
  return srcSections.join("\n");
}

// ── Annotate each added line with its real new-file line number ──────────────
// Parses @@ hunk headers to track position, then prefixes each `+` line with
// `[Lxxx]` so the AI can report exact line numbers without guessing.
function annotateLineNumbers(diff) {
  const lines = diff.split("\n");
  const result = [];
  let newLineNum = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const m = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (m) newLineNum = parseInt(m[1], 10);
      result.push(line);
    } else if (line.startsWith("+++") || line.startsWith("---")) {
      result.push(line);
    } else if (line.startsWith("+")) {
      result.push(`+[L${newLineNum}] ${line.slice(1)}`);
      newLineNum++;
    } else if (line.startsWith("-")) {
      result.push(line); // removed lines don't move the new-file counter
    } else if (line.startsWith(" ")) {
      newLineNum++; // context line — advance counter but keep for trimming
      result.push(line);
    } else {
      result.push(line);
    }
  }
  return result.join("\n");
}

// ── Trim diff to only added lines + file/hunk headers (reduces tokens ~60%) ──
// Must run AFTER annotateLineNumbers so [Lxxx] prefixes are preserved.
function trimDiff(diff) {
  return diff
    .split("\n")
    .filter((line) =>
      line.startsWith("diff --git") ||
      line.startsWith("+++") ||
      line.startsWith("@@") ||
      line.startsWith("+")   // includes annotated `+[Lxxx]` lines
    )
    .join("\n");
}

// ── Call Ollama ─────────────────────────────────────────────────────────────
async function callOllama(diff, changedFiles) {
  diff = trimDiff(annotateLineNumbers(diff));
  const fileList = changedFiles.map((f) => `  - ${f}`).join("\n");

  const systemPrompt = `You are a senior software engineer doing a strict code review.
Return ONLY valid JSON — no markdown, no explanation, no code fences.

Each added line has its real file line number embedded as [Lxxx] at the start.
Use that exact number as the "line" field — do NOT guess or approximate.

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
- Line number = the [Lxxx] value on the affected added line — use it exactly
- Flag: SQL injection, console.log in prod, any types, missing error handling
- Flag ESLint: no-explicit-any, prefer-const, unused vars
- Flag TypeScript: missing types, use of any
- If code is clean: return empty issues array and score >= 85`;

  const userPrompt = `Review this git diff:\n\n${diff}`;

  let res;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      res = await fetch(`${OLLAMA_URL}/api/generate`, {
        method : "POST",
        headers: { "Content-Type": "application/json" },
        body   : JSON.stringify({
          model  : MODEL,
          prompt : userPrompt,
          system : systemPrompt,
          stream : false,
          format : "json",
          options: { temperature: 0.1, num_predict: 8000 },
        }),
        signal: AbortSignal.timeout(600_000),
      });
      break; // success — exit retry loop
    } catch (err) {
      console.warn(`  Ollama attempt ${attempt}/3 failed: ${err.message}`);
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, 5000 * attempt));
    }
  }

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

  // 1. Try full parse
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // 2. Extract FIRST complete JSON object using brace counting (handles double-output from phi3)
    const start = cleaned.indexOf("{");
    if (start !== -1) {
      let depth = 0, end = -1;
      for (let i = start; i < cleaned.length; i++) {
        if (cleaned[i] === "{") depth++;
        else if (cleaned[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
      }
      if (end !== -1) {
        try { parsed = JSON.parse(cleaned.slice(start, end + 1)); } catch {}
      }
    }
  }

  // 3. Salvage: extract all complete {...} objects that look like issues
  if (!parsed) {
    const issues = [];
    let i = 0;
    while (i < cleaned.length) {
      const s = cleaned.indexOf("{", i);
      if (s === -1) break;
      let depth = 0, e = -1;
      for (let j = s; j < cleaned.length; j++) {
        if (cleaned[j] === "{") depth++;
        else if (cleaned[j] === "}") { depth--; if (depth === 0) { e = j; break; } }
      }
      if (e === -1) break;
      const candidate = cleaned.slice(s, e + 1);
      try {
        const obj = JSON.parse(candidate);
        if (obj.file && obj.severity) issues.push(obj);
      } catch {}
      i = e + 1;
    }
    if (issues.length > 0) {
      console.warn("  JSON was truncated — salvaged", issues.length, "issue(s) from partial response");
      parsed = { summary: "Review completed (partial response).", score: 70, issues };
    } else {
      throw new Error("AI returned non-JSON. Try running again or switch to a larger model.");
    }
  }

  // Normalize field names — small models use different keys
  return {
    summary: parsed.summary ?? parsed.overview ?? parsed.assessment ?? "No summary provided.",
    score  : parsed.score   ?? parsed.overall_score ?? parsed.rating ?? 70,
    issues : parsed.issues  ?? parsed.problems ?? parsed.findings ?? [],
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
  console.log("DEBUG: script started, Node version:", process.version);
  console.log("DEBUG: args:", process.argv.slice(2).join(" "));
  const raw_diff = await readInput();
  const diff     = raw_diff.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (!diff.trim()) {
    console.log("No diff — nothing to review.");
    process.exit(0);
  }

  // Debug: show first 3 lines to confirm diff format is correct
  const firstLines = diff.split("\n").slice(0, 3);
  console.log("\n── First 3 lines of diff ────────────────────────────");
  firstLines.forEach((l, i) => console.log(`  ${i}: ${JSON.stringify(l)}`));
  console.log("─────────────────────────────────────────────────────\n");

  // Filter to src/ only — skip CI config and tooling changes to avoid false positives
  const srcDiff = filterDiffToSrc(diff);
  const reviewDiff = srcDiff.trim() ? srcDiff : diff; // fallback to full diff if no src/ files

  const changedFiles = parseDiffMeta(reviewDiff);
  console.log(`\n Reviewing ${changedFiles.length} file(s) with ${MODEL}...`);
  console.log(`   Files: ${changedFiles.join(", ")}`);
  console.log(`   Diff : ${reviewDiff.split("\n").length} lines`);

  // Verify Ollama is reachable before sending the full diff
  try {
    await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
  } catch {
    console.error(`\n Ollama is not reachable at ${OLLAMA_URL}`);
    console.error("  Make sure Ollama is running: ollama serve");
    process.exit(1);
  }

  // TODO (Anthropic): swap callOllama → callAnthropic here
  const raw = await callOllama(reviewDiff, changedFiles);

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
  console.error(err.stack);
  process.exit(1);
});
