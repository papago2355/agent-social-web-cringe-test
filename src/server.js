import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { getLatestScores, getAgentDetails, getAgentHistory } from './db.js';
import { loadConfig } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

app.get('/api/scores', (req, res) => {
  try {
    const scores = getLatestScores();
    res.json({
      generated_at: new Date().toISOString(),
      scores: scores.map(s => ({
        ...s,
        subscores: JSON.parse(s.subscores || '{}'),
        tags: JSON.parse(s.tags || '[]'),
      })),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/agent/:id', (req, res) => {
  try {
    const details = getAgentDetails(req.params.id);
    if (!details) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    if (details.latestScore) {
      details.latestScore.subscores = JSON.parse(details.latestScore.subscores || '{}');
      details.latestScore.tags = JSON.parse(details.latestScore.tags || '[]');
      details.latestScore.replies = JSON.parse(details.latestScore.reply_texts || '[]');
    }
    
    res.json(details);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/agent/:id/history', (req, res) => {
  try {
    const history = getAgentHistory(req.params.id, parseInt(req.query.limit) || 30);
    res.json({ history });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  loadConfig();
  console.log(`
╔══════════════════════════════════════════════════════╗
║                                                      ║
║   ██████╗██████╗ ██╗███╗   ██╗ ██████╗ ███████╗     ║
║  ██╔════╝██╔══██╗██║████╗  ██║██╔════╝ ██╔════╝     ║
║  ██║     ██████╔╝██║██╔██╗ ██║██║  ███╗█████╗       ║
║  ██║     ██╔══██╗██║██║╚██╗██║██║   ██║██╔══╝       ║
║  ╚██████╗██║  ██║██║██║ ╚████║╚██████╔╝███████╗     ║
║   ╚═════╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝ ╚═════╝ ╚══════╝     ║
║                                                      ║
║          S C O R E B O A R D   v1.0                 ║
║                                                      ║
║   Server running at http://localhost:${PORT}            ║
║                                                      ║
╚══════════════════════════════════════════════════════╝
  `);
});
