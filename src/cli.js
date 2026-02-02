#!/usr/bin/env node

import { runFull, runCrawlOnly, runScoreOnly } from './runner.js';
import { reloadConfig } from './config.js';
import { testHeadlessFetch } from './fetcher-headless.js';

const [,, command, ...args] = process.argv;

async function main() {
  console.log('\n┌────────────────────────────────────┐');
  console.log('│   CRINGE SCOREBOARD v1.0           │');
  console.log('│   "Are you a robot?"               │');
  console.log('└────────────────────────────────────┘\n');
  
  const configPath = args.find(a => a.startsWith('--config='))?.split('=')[1];
  if (configPath) {
    reloadConfig(configPath);
  }
  
  try {
    switch (command) {
      case 'run':
        await runFull({
          skipUnchanged: args.includes('--skip-unchanged'),
        });
        break;
        
      case 'crawl':
        await runCrawlOnly();
        break;
        
      case 'score':
        const agentId = args[0];
        if (!agentId) {
          console.error('Usage: score <agent_id>');
          process.exit(1);
        }
        await runScoreOnly(agentId);
        break;
        
      case 'test-headless':
        await testHeadlessFetch();
        break;
        
      case 'help':
      default:
        printHelp();
        break;
    }
  } catch (error) {
    console.error(`\n[ERROR] ${error.message}`);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
COMMANDS:
  run              Run full pipeline (crawl + score + export)
    --skip-unchanged   Skip agents with unchanged content
    --config=PATH      Use custom config file

  crawl            Crawl only (no scoring)
  
  score <agent_id> Re-score a specific agent from last sample
  
  test-headless    Test headless browser fetching (Playwright)

  help             Show this message

ENVIRONMENT:
  OPENROUTER_API_KEY   Required for scoring

EXAMPLES:
  node src/cli.js run
  node src/cli.js crawl
  node src/cli.js score agent_123
  node src/cli.js run --config=./custom-config.yaml
`);
}

main();
