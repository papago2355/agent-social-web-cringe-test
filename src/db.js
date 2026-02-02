import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { getConfig } from './config.js';

let db = null;

export function getDb() {
  if (db) return db;
  
  const dbPath = getConfig('output.db_path', './data/cringe.db');
  const absolutePath = path.resolve(dbPath);
  const dir = path.dirname(absolutePath);
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  db = new Database(absolutePath);
  db.pragma('journal_mode = WAL');
  
  initSchema(db);
  
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT DEFAULT 'running',
      config_snapshot TEXT,
      summary TEXT
    );
    
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT,
      profile_image TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    
    CREATE TABLE IF NOT EXISTS agent_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      agent_id TEXT NOT NULL,
      rank INTEGER,
      latest_post_text TEXT,
      latest_post_id TEXT,
      latest_post_created_at TEXT,
      reply_texts TEXT,
      raw_html TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    );
    
    CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      agent_id TEXT NOT NULL,
      sample_id INTEGER NOT NULL,
      cringe_score REAL NOT NULL,
      human_likeness REAL NOT NULL,
      confidence REAL,
      subscores TEXT,
      tags TEXT,
      rationale TEXT,
      model_used TEXT,
      prompt_version TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (sample_id) REFERENCES agent_samples(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_scores_agent ON scores(agent_id);
    CREATE INDEX IF NOT EXISTS idx_scores_run ON scores(run_id);
    CREATE INDEX IF NOT EXISTS idx_samples_run ON agent_samples(run_id);
  `);
}

export function createRun(configSnapshot) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO runs (started_at, config_snapshot, status)
    VALUES (?, ?, 'running')
  `);
  const result = stmt.run(new Date().toISOString(), JSON.stringify(configSnapshot));
  return result.lastInsertRowid;
}

export function completeRun(runId, summary) {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE runs SET completed_at = ?, status = 'completed', summary = ?
    WHERE id = ?
  `);
  stmt.run(new Date().toISOString(), JSON.stringify(summary), runId);
}

export function failRun(runId, error) {
  const db = getDb();
  const stmt = db.prepare(`
    UPDATE runs SET completed_at = ?, status = 'failed', summary = ?
    WHERE id = ?
  `);
  stmt.run(new Date().toISOString(), JSON.stringify({ error: error.message }), runId);
}

export function upsertAgent(agent) {
  const db = getDb();
  const now = new Date().toISOString();
  
  const existing = db.prepare('SELECT * FROM agents WHERE id = ?').get(agent.id);
  
  if (existing) {
    db.prepare(`
      UPDATE agents SET name = ?, url = ?, profile_image = ?, last_seen_at = ?
      WHERE id = ?
    `).run(agent.name, agent.url, agent.profileImage || null, now, agent.id);
  } else {
    db.prepare(`
      INSERT INTO agents (id, name, url, profile_image, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(agent.id, agent.name, agent.url, agent.profileImage || null, now, now);
  }
}

export function saveSample(runId, agentId, sample) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO agent_samples (run_id, agent_id, rank, latest_post_text, latest_post_id, 
      latest_post_created_at, reply_texts, raw_html, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const result = stmt.run(
    runId,
    agentId,
    sample.rank,
    sample.latestPost?.text,
    sample.latestPost?.id,
    sample.latestPost?.createdAt,
    JSON.stringify(sample.replies || []),
    sample.rawHtml,
    new Date().toISOString()
  );
  
  return result.lastInsertRowid;
}

export function saveScore(runId, agentId, sampleId, score) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO scores (run_id, agent_id, sample_id, cringe_score, human_likeness, 
      confidence, subscores, tags, rationale, model_used, prompt_version, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  stmt.run(
    runId,
    agentId,
    sampleId,
    score.cringe_score,
    score.human_likeness,
    score.confidence,
    JSON.stringify(score.subscores || {}),
    JSON.stringify(score.tags || []),
    score.rationale,
    score.model_used,
    score.prompt_version,
    new Date().toISOString()
  );
}

export function getLatestScores() {
  const db = getDb();
  return db.prepare(`
    SELECT s.*, a.name as agent_name, a.url as agent_url, a.profile_image
    FROM scores s
    JOIN agents a ON s.agent_id = a.id
    WHERE s.run_id = (SELECT MAX(id) FROM runs WHERE status = 'completed')
    ORDER BY s.cringe_score DESC
  `).all();
}

export function getAgentHistory(agentId, limit = 30) {
  const db = getDb();
  return db.prepare(`
    SELECT s.cringe_score, s.human_likeness, s.created_at, r.id as run_id
    FROM scores s
    JOIN runs r ON s.run_id = r.id
    WHERE s.agent_id = ? AND r.status = 'completed'
    ORDER BY s.created_at DESC
    LIMIT ?
  `).all(agentId, limit);
}

export function getAgentDetails(agentId) {
  const db = getDb();
  
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
  if (!agent) return null;
  
  const latestScore = db.prepare(`
    SELECT s.*, as2.latest_post_text, as2.reply_texts
    FROM scores s
    JOIN agent_samples as2 ON s.sample_id = as2.id
    WHERE s.agent_id = ?
    ORDER BY s.created_at DESC
    LIMIT 1
  `).get(agentId);
  
  const history = getAgentHistory(agentId);
  
  return { agent, latestScore, history };
}

export function getLastSample(agentId) {
  const db = getDb();
  return db.prepare(`
    SELECT * FROM agent_samples
    WHERE agent_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).get(agentId);
}
