import { chromium } from 'playwright';
import { getConfig } from './config.js';
import fs from 'fs';
import path from 'path';

let browser = null;

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
    });
  }
  return browser;
}

export async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

function saveDebugHtml(name, html) {
  if (!getConfig('debug.save_raw_html', false)) return;
  
  const dir = './data/raw_html';
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  const filename = `${name}_${Date.now()}.html`;
  fs.writeFileSync(path.join(dir, filename), html);
  console.log(`  [DEBUG] Saved HTML: ${filename}`);
}

export class HeadlessTopPairingsFetcher {
  constructor() {
    this.baseUrl = getConfig('crawling.homepage_url', 'https://www.moltbook.com');
    this.timeout = getConfig('crawling.timeouts.page_load_ms', 30000);
    this.selectorWait = getConfig('crawling.timeouts.selector_wait_ms', 10000);
  }
  
  async fetch() {
    console.log('[HEADLESS] Launching browser...');
    const browser = await getBrowser();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    
    const page = await context.newPage();
    
    try {
      console.log(`[HEADLESS] Navigating to ${this.baseUrl}...`);
      await page.goto(this.baseUrl, { 
        waitUntil: 'networkidle',
        timeout: this.timeout,
      });
      
      // Wait for Top Pairings section to load
      console.log('[HEADLESS] Waiting for Top Pairings to load...');
      
      // Try multiple selectors for the Top Pairings section
      const pairingSelectors = [
        'text=Top Pairings',
        '[class*="pairing"]',
        'h2:has-text("Top Pairings")',
      ];
      
      let foundSelector = null;
      for (const sel of pairingSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 5000 });
          foundSelector = sel;
          break;
        } catch {
          continue;
        }
      }
      
      if (!foundSelector) {
        console.log('[HEADLESS] Top Pairings section not found, trying to wait for agent links...');
      }
      
      // Wait a bit more for dynamic content
      await page.waitForTimeout(3000);
      
      // Get the full HTML for debugging
      const html = await page.content();
      saveDebugHtml('homepage', html);
      
      // Extract Top Pairings agents - specifically from the sidebar widget
      const agents = await page.evaluate(() => {
        const results = [];
        
        // Find the Top Pairings header (contains emoji + "Top Pairings")
        const topPairingsHeader = Array.from(document.querySelectorAll('h2'))
          .find(el => el.textContent?.includes('Top Pairings'));
        
        if (topPairingsHeader) {
          // The container is the parent div with the rounded-lg border
          const widget = topPairingsHeader.closest('div.rounded-lg') || 
                        topPairingsHeader.closest('div[class*="border"]');
          
          if (widget) {
            // Find all agent links within this specific widget
            // Each pairing has: rank badge, avatar, name, twitter handle, reach
            const pairingLinks = widget.querySelectorAll('a[href*="/u/"]');
            
            pairingLinks.forEach((link) => {
              const href = link.getAttribute('href');
              const username = href?.match(/\/u\/([^\/\?]+)/)?.[1];
              
              if (!username) return;
              
              // Get the rank from the numbered badge (1, 2, 3, etc.)
              const rankBadge = link.querySelector('div[class*="rounded"][class*="font-bold"]');
              const rankText = rankBadge?.textContent?.trim();
              const rank = parseInt(rankText) || (results.length + 1);
              
              // Get agent name
              const nameEl = link.querySelector('div.text-sm.font-semibold');
              const name = nameEl?.textContent?.trim() || username;
              
              // Get twitter handle
              const twitterEl = link.querySelector('span[class*="text-\\[\\#1da1f2\\]"]');
              const twitter = twitterEl?.textContent?.trim() || '';
              
              // Get reach (followers)
              const reachEl = link.querySelector('div.text-right div.font-bold');
              const reach = reachEl?.textContent?.trim() || '';
              
              if (!results.find(r => r.id === username)) {
                results.push({
                  id: username,
                  name: name,
                  url: new URL(href, window.location.origin).toString(),
                  rank: rank,
                  twitter: twitter,
                  reach: reach,
                });
              }
            });
            
            // Sort by rank
            results.sort((a, b) => a.rank - b.rank);
          }
        }
        
        return results;
      });
      
      console.log(`[HEADLESS] Found ${agents.length} agents`);
      
      await context.close();
      return agents;
      
    } catch (error) {
      console.error(`[HEADLESS ERROR] ${error.message}`);
      const html = await page.content();
      saveDebugHtml('homepage_error', html);
      await context.close();
      throw error;
    }
  }
}

export class HeadlessAgentContentFetcher {
  constructor() {
    this.timeout = getConfig('crawling.timeouts.page_load_ms', 30000);
    this.repliesPerAgent = getConfig('sampling.replies_per_agent', 10);
    this.delay = getConfig('crawling.rate_limits.politeness_delay_ms', 1000);
  }
  
  async fetch(agent) {
    if (!agent.url) {
      return { agent, latestPost: null, replies: [], rawHtml: null, error: 'No URL' };
    }
    
    const browser = await getBrowser();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });
    
    const page = await context.newPage();
    
    try {
      console.log(`  [HEADLESS] Loading ${agent.name}...`);
      
      // Politeness delay
      await new Promise(r => setTimeout(r, this.delay));
      
      await page.goto(agent.url, {
        waitUntil: 'networkidle',
        timeout: this.timeout,
      });
      
      // Wait for content to load
      await page.waitForTimeout(2000);
      
      // Try to wait for posts/content
      try {
        await page.waitForSelector('[class*="post"], [class*="content"], [class*="message"]', { 
          timeout: 5000 
        });
      } catch {
        console.log(`  [HEADLESS] No post selectors found for ${agent.name}`);
      }
      
      const html = await page.content();
      saveDebugHtml(`agent_${agent.id}`, html);
      
      // Extract posts and replies
      const content = await page.evaluate((repliesLimit) => {
        const result = {
          latestPost: null,
          replies: [],
          profile: null,
        };
        
        // Extract profile info
        const profileSection = document.querySelector('main > div');
        if (profileSection) {
          const nameEl = profileSection.querySelector('h1');
          const bioEl = profileSection.querySelector('p.text-\\[\\#818384\\]');
          const karmaEl = profileSection.querySelector('.text-\\[\\#ff4500\\].font-bold');
          
          result.profile = {
            name: nameEl?.textContent?.trim() || '',
            bio: bioEl?.textContent?.trim() || '',
            karma: karmaEl?.textContent?.trim() || '0',
          };
        }
        
        // Find posts - Moltbook uses <a> links with specific structure
        // Look for posts in the "Posts" section
        const postsHeader = Array.from(document.querySelectorAll('h2'))
          .find(h => h.textContent?.includes('Posts'));
        
        let postsContainer = postsHeader?.nextElementSibling;
        let postElements = [];
        
        if (postsContainer) {
          // Posts are <a> elements with rounded-lg class
          postElements = Array.from(postsContainer.querySelectorAll('a[href*="/post/"]'));
        }
        
        // Fallback: find all post links on page
        if (postElements.length === 0) {
          postElements = Array.from(document.querySelectorAll('a[href*="/post/"]'));
        }
        
        // Get latest post (first one)
        if (postElements.length > 0) {
          const firstPost = postElements[0];
          const titleEl = firstPost.querySelector('h3');
          const contentEl = firstPost.querySelector('p.text-\\[\\#d7dadc\\]');
          const metaEl = firstPost.querySelector('.text-xs.text-\\[\\#818384\\]');
          
          const title = titleEl?.textContent?.trim() || '';
          const body = contentEl?.textContent?.trim() || '';
          const fullText = title + (body ? '\n\n' + body : '');
          
          if (fullText && fullText.length > 10) {
            result.latestPost = {
              id: firstPost.getAttribute('href')?.match(/\/post\/([^\/\?]+)/)?.[1] || 'post_0',
              text: fullText.slice(0, 2000),
              title: title,
              createdAt: metaEl?.textContent || null,
            };
          }
        }
        
        // Use remaining posts as "replies" (samples of agent content)
        postElements.slice(1, repliesLimit + 1).forEach((post, index) => {
          const titleEl = post.querySelector('h3');
          const contentEl = post.querySelector('p.text-\\[\\#d7dadc\\]');
          
          const title = titleEl?.textContent?.trim() || '';
          const body = contentEl?.textContent?.trim() || '';
          const fullText = title + (body ? '\n\n' + body : '');
          
          if (fullText && fullText.length > 10) {
            result.replies.push({
              id: post.getAttribute('href')?.match(/\/post\/([^\/\?]+)/)?.[1] || `post_${index}`,
              text: fullText.slice(0, 1000),
              title: title,
              createdAt: null,
            });
          }
        });
        
        return result;
      }, this.repliesPerAgent);
      
      await context.close();
      
      return {
        agent,
        latestPost: content.latestPost,
        replies: content.replies,
        rawHtml: html,
      };
      
    } catch (error) {
      console.error(`  [HEADLESS ERROR] ${agent.name}: ${error.message}`);
      await context.close();
      return { agent, latestPost: null, replies: [], rawHtml: null, error: error.message };
    }
  }
}

// Quick test function
export async function testHeadlessFetch() {
  console.log('\n=== HEADLESS FETCH TEST ===\n');
  
  try {
    const fetcher = new HeadlessTopPairingsFetcher();
    const agents = await fetcher.fetch();
    
    console.log('\nAgents found:');
    agents.forEach(a => {
      console.log(`  ${a.rank}. ${a.name} (${a.id})`);
      console.log(`     URL: ${a.url}`);
    });
    
    if (agents.length > 0) {
      console.log('\n--- Testing first agent content fetch ---\n');
      
      const contentFetcher = new HeadlessAgentContentFetcher();
      const content = await contentFetcher.fetch(agents[0]);
      
      console.log(`\nLatest post: ${content.latestPost?.text?.slice(0, 100) || 'None'}...`);
      console.log(`Replies: ${content.replies.length}`);
      content.replies.slice(0, 3).forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.text?.slice(0, 60)}...`);
      });
    }
    
  } finally {
    await closeBrowser();
  }
  
  console.log('\n=== TEST COMPLETE ===\n');
}
