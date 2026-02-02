import { loadConfig, getConfig } from './config.js';
import { TopPairingsFetcher, AgentContentFetcher, clearCache } from './fetcher.js';
import { HeadlessTopPairingsFetcher, HeadlessAgentContentFetcher, closeBrowser } from './fetcher-headless.js';
import { CringeScorer, getBadge } from './scorer.js';
import * as db from './db.js';
import fs from 'fs';
import path from 'path';

function getFetchers() {
  const strategy = getConfig('crawling.strategy', 'static');
  
  if (strategy === 'headless') {
    console.log('[MODE] Using headless browser (Playwright)');
    return {
      pairingsFetcher: new HeadlessTopPairingsFetcher(),
      contentFetcher: new HeadlessAgentContentFetcher(),
      cleanup: closeBrowser,
    };
  }
  
  console.log('[MODE] Using static HTML fetch');
  return {
    pairingsFetcher: new TopPairingsFetcher(),
    contentFetcher: new AgentContentFetcher(),
    cleanup: clearCache,
  };
}

export async function runFull(options = {}) {
  const config = loadConfig();
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║     CRINGE SCOREBOARD - FULL RUN         ║');
  console.log('╚══════════════════════════════════════════╝\n');
  
  const runId = db.createRun(config);
  console.log(`[RUN] Started run #${runId}`);
  
  const { pairingsFetcher, contentFetcher, cleanup } = getFetchers();
  
  try {
    console.log('\n[PHASE 1] Fetching Top Pairings...');
    const agents = await pairingsFetcher.fetch();
    
    if (agents.length === 0) {
      throw new Error('No agents found on homepage');
    }
    
    console.log(`[OK] Found ${agents.length} agents:`);
    agents.forEach(a => console.log(`  ${a.rank}. ${a.name} (${a.id})`));
    
    console.log('\n[PHASE 2] Fetching Agent Content...');
    const samples = [];
    
    for (const agent of agents) {
      console.log(`  → Fetching ${agent.name}...`);
      db.upsertAgent(agent);
      
      const sample = await contentFetcher.fetch(agent);
      sample.rank = agent.rank;
      
      const sampleId = db.saveSample(runId, agent.id, sample);
      samples.push({ ...sample, sampleId, agent });
      
      console.log(`    Got ${sample.replies.length} replies, post: ${sample.latestPost ? 'yes' : 'no'}`);
    }
    
    console.log('\n[PHASE 3] Scoring Agents...');
    const scorer = new CringeScorer();
    const results = [];
    
    for (const sample of samples) {
      if (options.skipUnchanged && !hasContentChanged(sample)) {
        console.log(`  → Skipping ${sample.agent.name} (unchanged)`);
        continue;
      }
      
      console.log(`  → Scoring ${sample.agent.name}...`);
      const score = await scorer.score(sample);
      
      db.saveScore(runId, sample.agent.id, sample.sampleId, score);
      
      const badge = getBadge(score.cringe_score);
      results.push({
        agent: sample.agent,
        score,
        badge,
      });
      
      console.log(`    Cringe: ${score.cringe_score} [${badge.label}] - ${score.rationale.slice(0, 60)}...`);
    }
    
    console.log('\n[PHASE 4] Exporting Results...');
    await exportResults(runId, results, samples);
    
    const summary = {
      agentsProcessed: agents.length,
      agentsScored: results.length,
      topCringe: results.sort((a, b) => b.score.cringe_score - a.score.cringe_score)[0]?.agent.name,
      mostHuman: results.sort((a, b) => b.score.human_likeness - a.score.human_likeness)[0]?.agent.name,
    };
    
    db.completeRun(runId, summary);
    
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║              RUN COMPLETE                ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log(`  Agents processed: ${summary.agentsProcessed}`);
    console.log(`  Agents scored: ${summary.agentsScored}`);
    console.log(`  Top cringe: ${summary.topCringe}`);
    console.log(`  Most human: ${summary.mostHuman}`);
    
    await cleanup();
    return { runId, summary, results };
    
  } catch (error) {
    console.error(`\n[FATAL] ${error.message}`);
    db.failRun(runId, error);
    await cleanup();
    throw error;
  }
}

function hasContentChanged(sample) {
  const lastSample = db.getLastSample(sample.agent.id);
  if (!lastSample) return true;
  
  const currentPostText = sample.latestPost?.text || '';
  const lastPostText = lastSample.latest_post_text || '';
  
  if (currentPostText !== lastPostText) return true;
  
  const currentReplies = JSON.stringify(sample.replies.map(r => r.text));
  const lastReplies = lastSample.reply_texts || '[]';
  
  return currentReplies !== lastReplies;
}

async function exportResults(runId, results, samples = []) {
  const exportPath = getConfig('output.export_path', './output');
  
  if (!fs.existsSync(exportPath)) {
    fs.mkdirSync(exportPath, { recursive: true });
  }
  
  // Create a map of samples for enriching scores
  const sampleMap = new Map();
  for (const sample of samples) {
    sampleMap.set(sample.agent?.id, sample);
  }
  
  const latestScores = results.map(r => {
    const sample = sampleMap.get(r.agent.id);
    return {
      agent_id: r.agent.id,
      agent_name: r.agent.name,
      agent_url: r.agent.url,
      rank: r.agent.rank,
      cringe_score: r.score.cringe_score,
      human_likeness: r.score.human_likeness,
      badge: r.badge.label,
      badge_class: r.badge.class,
      tags: r.score.tags,
      rationale: r.score.rationale,
      subscores: r.score.subscores,
      // Include sample data for static site
      latest_post_text: sample?.latestPost?.text || null,
      replies: sample?.replies?.map(r => typeof r === 'string' ? r : r.text) || [],
    };
  });
  
  latestScores.sort((a, b) => b.cringe_score - a.cringe_score);
  
  fs.writeFileSync(
    path.join(exportPath, 'scores_latest.json'),
    JSON.stringify({ 
      generated_at: new Date().toISOString(), 
      run_id: runId,
      scores: latestScores 
    }, null, 2)
  );
  
  const topPairings = results.map(r => ({
    id: r.agent.id,
    name: r.agent.name,
    url: r.agent.url,
    rank: r.agent.rank,
  }));
  
  fs.writeFileSync(
    path.join(exportPath, 'top_pairings.json'),
    JSON.stringify({ 
      generated_at: new Date().toISOString(),
      agents: topPairings 
    }, null, 2)
  );
  
  console.log(`  → Exported to ${exportPath}/`);
}

export async function runCrawlOnly() {
  console.log('\n[CRAWL ONLY MODE]\n');
  
  const pairingsFetcher = new TopPairingsFetcher();
  const agents = await pairingsFetcher.fetch();
  
  console.log(`Found ${agents.length} agents:\n`);
  agents.forEach(a => {
    console.log(`  ${a.rank}. ${a.name}`);
    console.log(`     ID: ${a.id}`);
    console.log(`     URL: ${a.url}\n`);
  });
  
  const contentFetcher = new AgentContentFetcher();
  
  for (const agent of agents) {
    console.log(`\n--- ${agent.name} ---`);
    const sample = await contentFetcher.fetch(agent);
    
    if (sample.latestPost) {
      console.log(`\nLatest Post:\n${sample.latestPost.text?.slice(0, 200)}...`);
    }
    
    console.log(`\nReplies (${sample.replies.length}):`);
    sample.replies.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.text?.slice(0, 80)}...`);
    });
  }
  
  clearCache();
}

export async function runScoreOnly(agentId) {
  console.log(`\n[SCORE ONLY MODE] Agent: ${agentId}\n`);
  
  const sample = db.getLastSample(agentId);
  if (!sample) {
    throw new Error(`No sample found for agent ${agentId}`);
  }
  
  const scorer = new CringeScorer();
  const score = await scorer.score({
    latestPost: { text: sample.latest_post_text },
    replies: JSON.parse(sample.reply_texts || '[]'),
  });
  
  const badge = getBadge(score.cringe_score);
  
  console.log('\n═══════════════════════════════════════');
  console.log(`  CRINGE SCORE: ${score.cringe_score} [${badge.label}]`);
  console.log(`  HUMAN LIKENESS: ${score.human_likeness}`);
  console.log('═══════════════════════════════════════');
  console.log('\nSubscores:');
  Object.entries(score.subscores).forEach(([k, v]) => {
    console.log(`  ${k}: ${v}/10`);
  });
  console.log('\nTags:', score.tags.join(', '));
  console.log('\nRationale:', score.rationale);
  
  return score;
}
