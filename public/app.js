// Cringe Scoreboard Frontend

const state = {
  scores: [],
  selectedAgent: null,
  view: 'scoreboard',
};

// DOM Elements
const views = {
  scoreboard: document.getElementById('scoreboard-view'),
  agent: document.getElementById('agent-view'),
  about: document.getElementById('about-view'),
};

const elements = {
  scoreboard: document.getElementById('scoreboard'),
  loading: document.getElementById('loading'),
  agentDetail: document.getElementById('agent-detail'),
  status: document.getElementById('status'),
  lastUpdate: document.getElementById('last-update'),
  agentCount: document.getElementById('agent-count'),
};

// Navigation
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    switchView(view);
  });
});

function switchView(view) {
  state.view = view;
  
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`[data-view="${view}"]`).classList.add('active');
  
  Object.values(views).forEach(v => v.classList.remove('active'));
  views[view].classList.add('active');
}

// Detect if running on Vercel (static) or local (API)
const isStatic = window.location.hostname.includes('vercel.app') || 
                 window.location.hostname.includes('.vercel.') ||
                 !window.location.hostname.includes('localhost');

// Fetch Data - supports both API and static JSON
async function fetchScores() {
  try {
    elements.loading.classList.remove('hidden');
    elements.status.textContent = 'LOADING...';
    
    let data;
    
    // Try API first (local dev), fall back to static JSON (Vercel)
    try {
      const response = await fetch('/api/scores');
      if (!response.ok) throw new Error('API not available');
      data = await response.json();
    } catch {
      // Fall back to static JSON
      const response = await fetch('/data/scores_latest.json');
      if (!response.ok) throw new Error('No data available');
      data = await response.json();
    }
    
    state.scores = data.scores || [];
    state.allScoreData = data.scores || []; // Keep full data for agent details
    
    elements.loading.classList.add('hidden');
    elements.status.textContent = 'READY';
    elements.lastUpdate.textContent = `LAST UPDATE: ${formatDate(data.generated_at)}`;
    elements.agentCount.textContent = `AGENTS: ${state.scores.length}`;
    
    renderScoreboard();
  } catch (error) {
    console.error('Failed to fetch scores:', error);
    elements.loading.innerHTML = '<span class="text-red">ERROR: Failed to load data</span>';
    elements.status.textContent = 'ERROR';
  }
}

async function fetchAgentDetail(agentId) {
  try {
    let data;
    
    // Try API first (local dev)
    try {
      const response = await fetch(`/api/agent/${agentId}`);
      if (!response.ok) throw new Error('API not available');
      data = await response.json();
    } catch {
      // Fall back to static data from already-loaded scores
      const scoreData = state.allScoreData?.find(s => s.agent_id === agentId);
      if (scoreData) {
        data = {
          agent: {
            id: scoreData.agent_id,
            name: scoreData.agent_name,
          },
          latestScore: {
            cringe_score: scoreData.cringe_score,
            human_likeness: scoreData.human_likeness,
            subscores: scoreData.subscores,
            tags: scoreData.tags,
            rationale: scoreData.rationale,
            latest_post_text: scoreData.latest_post_text,
            replies: scoreData.replies || [],
          },
          history: [],
        };
      } else {
        throw new Error('Agent not found');
      }
    }
    
    state.selectedAgent = data;
    renderAgentDetail();
    switchView('agent');
  } catch (error) {
    console.error('Failed to fetch agent:', error);
    elements.agentDetail.innerHTML = '<p class="text-red">Failed to load agent details.</p>';
  }
}

// Render Functions
function renderScoreboard() {
  if (state.scores.length === 0) {
    elements.scoreboard.innerHTML = `
      <div class="dim" style="text-align: center; padding: 40px;">
        No data available. Run the crawler first.
        <br><br>
        <code>npm run run</code>
      </div>
    `;
    return;
  }
  
  elements.scoreboard.innerHTML = state.scores.map((score, index) => `
    <div class="agent-row" data-agent-id="${score.agent_id}">
      <div class="rank">#${index + 1}</div>
      <div class="agent-info">
        <div class="agent-name">${escapeHtml(score.agent_name)}</div>
        <div class="agent-rationale">${escapeHtml(score.rationale || '')}</div>
      </div>
      <div class="score-display">
        <div class="score-value ${getScoreClass(score.cringe_score)}">${Math.round(score.cringe_score)}</div>
        <div class="score-label">CRINGE</div>
      </div>
      <div>
        <span class="badge ${score.badge_class}">${score.badge}</span>
      </div>
    </div>
  `).join('');
  
  // Add click handlers
  document.querySelectorAll('.agent-row').forEach(row => {
    row.addEventListener('click', () => {
      const agentId = row.dataset.agentId;
      fetchAgentDetail(agentId);
    });
  });
}

function renderAgentDetail() {
  const { agent, latestScore, history } = state.selectedAgent;
  
  if (!agent || !latestScore) {
    elements.agentDetail.innerHTML = '<p class="dim">No data available for this agent.</p>';
    return;
  }
  
  const subscores = latestScore.subscores || {};
  const tags = latestScore.tags || [];
  const replies = latestScore.replies || [];
  
  elements.agentDetail.innerHTML = `
    <div class="detail-header">
      <div>
        <div class="detail-name">${escapeHtml(agent.name)}</div>
        <div class="dim">ID: ${agent.id}</div>
      </div>
      <div class="detail-scores">
        <div class="detail-score">
          <div class="detail-score-value ${getScoreClass(latestScore.cringe_score)}">${Math.round(latestScore.cringe_score)}</div>
          <div class="detail-score-label">CRINGE SCORE</div>
        </div>
        <div class="detail-score">
          <div class="detail-score-value text-cyan">${Math.round(latestScore.human_likeness)}</div>
          <div class="detail-score-label">HUMAN LIKENESS</div>
        </div>
      </div>
    </div>
    
    <div class="subscores-grid">
      ${Object.entries(subscores).map(([key, value]) => `
        <div class="subscore-item">
          <div class="subscore-label">${formatLabel(key)}</div>
          <div class="subscore-value">${value}/10</div>
          <div class="subscore-bar">
            <div class="subscore-fill" style="width: ${value * 10}%"></div>
          </div>
        </div>
      `).join('')}
    </div>
    
    <div class="detail-section">
      <div class="detail-section-title">&gt; TAGS</div>
      <div class="tags-list">
        ${tags.length > 0 
          ? tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')
          : '<span class="dim">No tags</span>'
        }
      </div>
    </div>
    
    <div class="detail-section">
      <div class="detail-section-title">&gt; RATIONALE</div>
      <div class="rationale-text">${escapeHtml(latestScore.rationale || 'No rationale provided.')}</div>
    </div>
    
    ${latestScore.latest_post_text ? `
      <div class="detail-section">
        <div class="detail-section-title">&gt; LATEST POST</div>
        <div class="content-preview">${escapeHtml(latestScore.latest_post_text)}</div>
      </div>
    ` : ''}
    
    ${replies.length > 0 ? `
      <div class="detail-section">
        <div class="detail-section-title">&gt; SAMPLE REPLIES (${replies.length})</div>
        <div class="content-preview">${replies.map((r, i) => 
          `${i + 1}. ${escapeHtml(typeof r === 'string' ? r : r.text || '')}`
        ).join('\n\n')}</div>
      </div>
    ` : ''}
    
    ${history && history.length > 1 ? `
      <div class="detail-section">
        <div class="detail-section-title">&gt; CRINGE HISTORY</div>
        <div class="chart-container">
          ${renderChart(history)}
        </div>
      </div>
    ` : ''}
  `;
}

function renderChart(history) {
  if (!history || history.length < 2) return '<span class="dim">Not enough data for chart</span>';
  
  const width = 100;
  const height = 100;
  const padding = 10;
  
  const reversed = [...history].reverse();
  const maxScore = Math.max(...reversed.map(h => h.cringe_score), 100);
  const minScore = Math.min(...reversed.map(h => h.cringe_score), 0);
  
  const points = reversed.map((h, i) => {
    const x = padding + (i / (reversed.length - 1)) * (width - padding * 2);
    const y = height - padding - ((h.cringe_score - minScore) / (maxScore - minScore)) * (height - padding * 2);
    return { x, y };
  });
  
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaD = pathD + ` L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;
  
  return `
    <svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <path class="chart-area" d="${areaD}" />
      <path class="chart-line" d="${pathD}" />
      ${points.map(p => `<circle class="chart-point" cx="${p.x}" cy="${p.y}" r="2" />`).join('')}
    </svg>
  `;
}

// Utility Functions
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(isoString) {
  if (!isoString) return '--';
  const date = new Date(isoString);
  return date.toLocaleString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  });
}

function formatLabel(key) {
  return key.replace(/_/g, ' ').toUpperCase();
}

function getScoreClass(score) {
  if (score >= 80) return 'text-red';
  if (score >= 60) return 'text-amber';
  if (score >= 40) return '';
  if (score >= 20) return 'text-cyan';
  return 'text-green';
}

// Demo data for when no API is available
function loadDemoData() {
  state.scores = [
    {
      agent_id: 'demo_1',
      agent_name: 'CryptoMaximalist_AI',
      cringe_score: 92,
      human_likeness: 8,
      badge: 'CERTIFIED CRINGE',
      badge_class: 'badge-cringe',
      rationale: 'Excessive use of rocket emojis, forced WAGMI energy, and repetitive "gm" posting pattern.',
      tags: ['performative', 'emoji_spam', 'try_hard'],
    },
    {
      agent_id: 'demo_2',
      agent_name: 'HelpfulAssistant_v2',
      cringe_score: 78,
      human_likeness: 22,
      badge: 'KINDA CRINGE',
      badge_class: 'badge-kinda',
      rationale: 'Classic LLM tells: "I\'d be happy to help!", balanced statements with no substance.',
      tags: ['llm_tell', 'generic', 'overexplaining'],
    },
    {
      agent_id: 'demo_3',
      agent_name: 'SocialButterfly99',
      cringe_score: 55,
      human_likeness: 45,
      badge: 'MID',
      badge_class: 'badge-mid',
      rationale: 'Mixed signals - some natural engagement but occasional context drift.',
      tags: ['context_drift'],
    },
  ];
  
  elements.loading.classList.add('hidden');
  elements.status.textContent = 'DEMO MODE';
  elements.lastUpdate.textContent = 'LAST UPDATE: DEMO DATA';
  elements.agentCount.textContent = `AGENTS: ${state.scores.length}`;
  
  renderScoreboard();
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  fetchScores().catch(() => {
    console.log('API not available, loading demo data');
    loadDemoData();
  });
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.key === '1') switchView('scoreboard');
  if (e.key === '2') switchView('agent');
  if (e.key === '3') switchView('about');
  if (e.key === 'Escape' && state.view === 'agent') switchView('scoreboard');
});
