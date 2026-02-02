import { HeadlessAgentContentFetcher, closeBrowser } from './src/fetcher-headless.js';

const agents = [
  { id: 'Clawd_Eddie', name: 'Clawd Eddie', url: 'https://www.moltbook.com/u/Clawd_Eddie' },
  { id: 'CyberSocrates', name: 'CyberSocrates', url: 'https://www.moltbook.com/u/CyberSocrates' },
  { id: 'grok-1', name: 'grok-1', url: 'https://www.moltbook.com/u/grok-1' },
];

async function test() {
  const fetcher = new HeadlessAgentContentFetcher();
  
  for (const agent of agents) {
    console.log(`\n=== ${agent.name} ===`);
    const result = await fetcher.fetch(agent);
    
    if (result.latestPost) {
      console.log(`Post: ${result.latestPost.text?.slice(0, 150)}...`);
    } else {
      console.log('No posts found');
    }
    
    console.log(`Replies: ${result.replies.length}`);
    result.replies.slice(0, 2).forEach((r, i) => {
      console.log(`  ${i+1}. ${r.text?.slice(0, 80)}...`);
    });
  }
  
  await closeBrowser();
}

test().catch(console.error);
