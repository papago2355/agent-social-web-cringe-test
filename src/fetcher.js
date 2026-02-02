import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { getConfig } from './config.js';

const requestCache = new Map();
let lastRequestTime = 0;

async function rateLimitedFetch(url, options = {}) {
  const delay = getConfig('crawling.rate_limits.politeness_delay_ms', 1000);
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;
  
  if (timeSinceLastRequest < delay) {
    await sleep(delay - timeSinceLastRequest);
  }
  
  lastRequestTime = Date.now();
  
  const maxAttempts = getConfig('crawling.retries.max_attempts', 3);
  const backoff = getConfig('crawling.retries.backoff_ms', 1000);
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'User-Agent': 'CringeScoreboard/1.0 (research project)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          ...options.headers,
        },
        timeout: getConfig('crawling.timeouts.page_load_ms', 30000),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      return response;
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      console.log(`[FETCH] Attempt ${attempt} failed, retrying in ${backoff * attempt}ms...`);
      await sleep(backoff * attempt);
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithCache(url) {
  if (requestCache.has(url)) {
    console.log(`[CACHE HIT] ${url}`);
    return requestCache.get(url);
  }
  
  console.log(`[FETCH] ${url}`);
  const response = await rateLimitedFetch(url);
  const html = await response.text();
  
  requestCache.set(url, html);
  
  if (getConfig('debug.save_raw_html', false)) {
    saveRawHtml(url, html);
  }
  
  return html;
}

function saveRawHtml(url, html) {
  const dir = './data/raw_html';
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const filename = url.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 100) + '_' + Date.now() + '.html';
  fs.writeFileSync(path.join(dir, filename), html);
}

export class TopPairingsFetcher {
  constructor() {
    this.baseUrl = getConfig('crawling.homepage_url', 'https://moltbook.com');
    this.selectors = getConfig('crawling.selectors', {});
  }
  
  async fetch() {
    const html = await fetchWithCache(this.baseUrl);
    return this.parse(html);
  }
  
  parse(html) {
    const $ = cheerio.load(html);
    const agents = [];
    
    const containerSelector = this.selectors.top_pairings_container || '.top-pairings';
    const itemSelector = this.selectors.pairing_item || '.pairing-item';
    const nameSelector = this.selectors.agent_name || '.agent-name';
    const linkSelector = this.selectors.agent_link || 'a';
    
    const container = $(containerSelector);
    
    if (container.length === 0) {
      console.log('[PARSE] Container not found, trying fuzzy search...');
      return this.fuzzyParse($);
    }
    
    container.find(itemSelector).each((index, el) => {
      if (index >= getConfig('sampling.num_agents', 10)) return false;
      
      const $el = $(el);
      const name = $el.find(nameSelector).text().trim() || $el.text().trim().slice(0, 50);
      const link = $el.find(linkSelector).attr('href') || '';
      const agentId = this.extractAgentId(link) || `agent_${index}`;
      
      agents.push({
        id: agentId,
        name: name || `Agent ${index + 1}`,
        url: this.resolveUrl(link),
        rank: index + 1,
      });
    });
    
    return agents;
  }
  
  fuzzyParse($) {
    const agents = [];
    
    const headings = $('h1, h2, h3, h4').filter((_, el) => {
      const text = $(el).text().toLowerCase();
      return text.includes('top') && (text.includes('pairing') || text.includes('agent'));
    });
    
    if (headings.length > 0) {
      const section = headings.first().parent();
      section.find('a').each((index, el) => {
        if (index >= getConfig('sampling.num_agents', 10)) return false;
        
        const $el = $(el);
        const href = $el.attr('href') || '';
        const text = $el.text().trim();
        
        if (text && href) {
          agents.push({
            id: this.extractAgentId(href) || `agent_${index}`,
            name: text,
            url: this.resolveUrl(href),
            rank: index + 1,
          });
        }
      });
    }
    
    return agents;
  }
  
  extractAgentId(url) {
    if (!url) return null;
    
    const patterns = [
      /\/agent\/([^\/\?]+)/,
      /\/profile\/([^\/\?]+)/,
      /\/user\/([^\/\?]+)/,
      /[?&]id=([^&]+)/,
    ];
    
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    
    return null;
  }
  
  resolveUrl(href) {
    if (!href) return null;
    if (href.startsWith('http')) return href;
    return new URL(href, this.baseUrl).toString();
  }
}

export class AgentContentFetcher {
  constructor() {
    this.selectors = getConfig('crawling.selectors', {});
    this.repliesPerAgent = getConfig('sampling.replies_per_agent', 10);
  }
  
  async fetch(agent) {
    if (!agent.url) {
      return { agent, latestPost: null, replies: [], rawHtml: null, error: 'No URL' };
    }
    
    try {
      const html = await fetchWithCache(agent.url);
      const parsed = this.parse(html, agent);
      return { ...parsed, rawHtml: html };
    } catch (error) {
      console.error(`[FETCH ERROR] ${agent.name}: ${error.message}`);
      return { agent, latestPost: null, replies: [], rawHtml: null, error: error.message };
    }
  }
  
  parse(html, agent) {
    const $ = cheerio.load(html);
    
    const postSelector = this.selectors.post_container || '.post';
    const textSelector = this.selectors.post_text || '.post-content';
    const timeSelector = this.selectors.post_timestamp || '.timestamp';
    const replySelector = this.selectors.reply_container || '.reply';
    
    let latestPost = null;
    const posts = $(postSelector);
    
    if (posts.length > 0) {
      const $post = posts.first();
      latestPost = {
        id: $post.attr('data-id') || $post.attr('id') || 'post_0',
        text: $post.find(textSelector).text().trim() || $post.text().trim(),
        createdAt: $post.find(timeSelector).attr('datetime') || $post.find(timeSelector).text().trim(),
      };
    }
    
    const replies = [];
    $(replySelector).each((index, el) => {
      if (index >= this.repliesPerAgent) return false;
      
      const $reply = $(el);
      const authorEl = $reply.find('.author, .username, [data-author]');
      const authorName = authorEl.text().trim() || authorEl.attr('data-author') || '';
      
      if (this.isAgentReply($reply, agent, authorName)) {
        replies.push({
          id: $reply.attr('data-id') || $reply.attr('id') || `reply_${index}`,
          text: $reply.find(textSelector).text().trim() || $reply.text().trim(),
          createdAt: $reply.find(timeSelector).attr('datetime') || $reply.find(timeSelector).text().trim(),
        });
      }
    });
    
    return { agent, latestPost, replies };
  }
  
  isAgentReply($reply, agent, authorName) {
    const agentNameLower = agent.name.toLowerCase();
    const authorLower = authorName.toLowerCase();
    
    if (authorLower.includes(agentNameLower) || agentNameLower.includes(authorLower)) {
      return true;
    }
    
    if ($reply.attr('data-agent-id') === agent.id) {
      return true;
    }
    
    return $reply.hasClass('agent-reply') || $reply.hasClass('bot-reply');
  }
}

export function clearCache() {
  requestCache.clear();
}
