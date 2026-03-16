# AI Code Review

> Automated code review powered by free local AI models (Ollama) with an easy upgrade path to Anthropic Claude.

## Features

- **Free & local** — uses Ollama with Code Llama, DeepSeek Coder, or Qwen 2.5 Coder
- **Exact locations** — reports issues with file name + line number
- **Severity levels** — Critical / High / Medium / Low / Info
- **CI/CD ready** — GitHub Actions workflow posts inline PR comments
- **Anthropic-ready** — one env var switch to use Claude when needed

## Quick Start

### 1. Install Ollama
Download from [ollama.ai](https://ollama.ai) and pull a model:
```bash
ollama pull qwen2.5-coder    # Recommended
# or
ollama pull codellama
# or
ollama pull deepseek-coder
```

### 2. Configure
```bash
cp .env.local.example .env.local
# Edit .env.local — set OLLAMA_MODEL to your pulled model
```

### 3. Run
```bash
npm install
npm run dev
# Open http://localhost:3000
```

## Switch to Anthropic Claude (Paid)

1. Get an API key at [console.anthropic.com](https://console.anthropic.com)
2. Edit `.env.local`:
   ```
   AI_PROVIDER=anthropic
   ANTHROPIC_API_KEY=sk-ant-...
   ANTHROPIC_MODEL=claude-sonnet-4-6
   ```
3. Run `npm install @anthropic-ai/sdk`
4. Uncomment the implementation in `src/lib/ai/anthropic-client.ts`

## CI/CD Setup

### GitHub Actions (Recommended: Anthropic in CI)
1. Add `ANTHROPIC_API_KEY` to your repository secrets
2. The `.github/workflows/code-review.yml` workflow runs automatically on every PR
3. Review results are posted as PR comments with inline annotations

### GitHub Actions (Free: Ollama on self-hosted runner)
1. Set up a [self-hosted runner](https://docs.github.com/en/actions/hosting-your-own-runners)
2. Install Ollama on that runner and pull your model
3. Uncomment the Ollama block in `.github/workflows/code-review.yml`

## Project Structure

```
src/
├── app/
│   ├── api/review/route.ts    # POST /api/review — main API endpoint
│   ├── page.tsx               # Home page UI
│   └── layout.tsx
├── components/
│   ├── layout/Header.tsx
│   ├── review/
│   │   ├── DiffInput.tsx      # Paste diff textarea
│   │   ├── ReviewReport.tsx   # Full report view
│   │   ├── IssueCard.tsx      # Single issue card
│   │   └── SeverityBadge.tsx
│   └── ui/                    # Button, Card, Badge
├── lib/
│   ├── ai/
│   │   ├── ollama-client.ts   # Free local AI
│   │   ├── anthropic-client.ts # Paid Claude (TODO: uncomment)
│   │   └── ai-provider.ts     # Router — picks provider from env
│   ├── parsers/diff-parser.ts # Parses unified git diff
│   ├── prompts/review-prompt.ts
│   └── utils/helpers.ts
├── hooks/useCodeReview.ts     # React hook for UI
└── types/index.ts             # All TypeScript types
scripts/
└── ci-review.ts               # CLI script for GitHub Actions
.github/workflows/
├── ci.yml                     # Lint + type-check + build
└── code-review.yml            # AI review on PRs
```

## Supported Models

| Model | Command | Notes |
|-------|---------|-------|
| Qwen 2.5 Coder 7B | `ollama pull qwen2.5-coder` | **Best free option** |
| DeepSeek Coder 6.7B | `ollama pull deepseek-coder` | Great for code |
| Code Llama 7B | `ollama pull codellama` | Meta's code model |
| Mistral 7B | `ollama pull mistral` | Good general purpose |
| Claude Sonnet 4.6 | Set `ANTHROPIC_API_KEY` | Best overall quality |
