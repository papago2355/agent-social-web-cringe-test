# CRINGE OR HUMAN 🤖

> "Are you a cringe robot?"

A configurable system for detecting and ranking AI agents on Moltbook by their **cringe factor** - performative, try-hard, unnatural behavior that signals "generated."

```
╔══════════════════════════════════════════════════════╗
║   ██████╗██████╗ ██╗███╗   ██╗ ██████╗ ███████╗     ║
║  ██╔════╝██╔══██╗██║████╗  ██║██╔════╝ ██╔════╝     ║
║  ██║     ██████╔╝██║██╔██╗ ██║██║  ███╗█████╗       ║
║  ██║     ██╔══██╗██║██║╚██╗██║██║   ██║██╔══╝       ║
║  ╚██████╗██║  ██║██║██║ ╚████║╚██████╔╝███████╗     ║
║   ╚═════╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚══════╝     ║
║          S C O R E B O A R D   v1.0                 ║
╚══════════════════════════════════════════════════════╝
```

## Quick Start

```bash
# Install dependencies
npm install

# Set OpenRouter API key
export OPENROUTER_API_KEY=your_key_here

# Run full pipeline (crawl + score + export)
npm run run

# Start the web server
npm run serve
# Open http://localhost:3000
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run run` | Full pipeline: crawl → score → export |
| `npm run crawl` | Crawl only (no scoring) |
| `npm run score <agent_id>` | Re-score specific agent |
| `npm run serve` | Start web server |

### CLI Options

```bash
# Use custom config
node src/cli.js run --config=./my-config.yaml

# Skip unchanged agents
node src/cli.js run --skip-unchanged
```

## Configuration

Everything is controlled via `config.yaml`:

```yaml
crawling:
  homepage_url: "https://moltbook.com"
  strategy: "static"  # static | headless | backend
  selectors:
    top_pairings_container: ".top-pairings"
    # ... customize selectors

sampling:
  num_agents: 10
  replies_per_agent: 10

scoring:
  model: "openai/gpt-4o-mini"
  strategy: "single_pass"  # single_pass | two_pass | self_consistency
  rubric_weights:
    performative: 1.5
    meme_overuse: 1.0
    llm_tells: 2.0
    # ...
```

## Scoring Dimensions

| Dimension | Weight | Description |
|-----------|--------|-------------|
| **Performative** | 1.5x | Forced hype, virtue signaling, try-hard swagger |
| **Meme Overuse** | 1.0x | Stale slang, awkward internet voice |
| **LLM Tells** | 2.0x | "As an AI...", sterile structure, generic empathy |
| **Context Drift** | 1.0x | Replies don't match thread context |
| **Repetition** | 1.5x | Same phrases, predictable cadence |
| **Overexplaining** | 1.0x | Robotic politeness, excessive hedging |

## Badges

| Badge | Score Range |
|-------|-------------|
| 🚨 **CERTIFIED CRINGE** | 80-100 |
| ⚠️ **KINDA CRINGE** | 60-79 |
| 😐 **MID** | 40-59 |
| 🤖 **SEEMS HUMAN** | 20-39 |
| 💜 **BASED** | 0-19 |

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   TopPairings   │────▶│  AgentContent   │────▶│  CringeScorer   │
│    Fetcher      │     │    Fetcher      │     │   (OpenRouter)  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                      │                       │
         ▼                      ▼                       ▼
    ┌─────────────────────────────────────────────────────────┐
    │                      SQLite DB                          │
    │   runs │ agents │ agent_samples │ scores                │
    └─────────────────────────────────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   Retro DOS Frontend  │
                    │   http://localhost:3k │
                    └───────────────────────┘
```

## Output Files

After a run:

```
output/
├── scores_latest.json   # Latest ranked scores
└── top_pairings.json    # Current top 10 agents

data/
├── cringe.db            # SQLite database with history
└── raw_html/            # Cached HTML for debugging
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | Yes | API key for LLM scoring |
| `PORT` | No | Server port (default: 3000) |
| `DEBUG` | No | Show stack traces |

## Vercel Deployment

The project is configured for Vercel static deployment with automated daily crawls.

### Setup

1. **Push to GitHub** - Connect your repo to Vercel

2. **Configure Vercel:**
   - Framework: Other
   - Build Command: `npm run build`
   - Output Directory: `dist`

3. **Add Secrets in GitHub:**
   - `OPENROUTER_API_KEY` - For LLM scoring
   - `VERCEL_DEPLOY_HOOK` - (Optional) Vercel deploy hook URL for auto-rebuild

4. **Create Deploy Hook in Vercel:**
   - Project Settings → Git → Deploy Hooks
   - Add the URL to GitHub secrets as `VERCEL_DEPLOY_HOOK`

### How It Works

- **Static Frontend:** The UI is served as static HTML/CSS/JS
- **Pre-generated Data:** Scores are read from `/data/scores_latest.json`
- **Daily Crawl:** GitHub Actions runs the crawler at 6 AM UTC
- **Auto Deploy:** After crawl, Vercel is triggered to rebuild with new data

### Manual Crawl

Trigger manually from GitHub → Actions → "Daily Cringe Crawl" → Run workflow

## License

MIT
