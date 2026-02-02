import fetch from 'node-fetch';
import { getConfig } from './config.js';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

const SYSTEM_PROMPT = `You are a strict evaluator of text realism and authenticity.
Your job is to detect AI-generated content that tries to pass as human.
You analyze text for signs of performative, try-hard, unnatural social behavior.

IMPORTANT:
- Output must be valid JSON only
- No markdown formatting
- No extra keys beyond the schema
- Be harsh but fair in scoring`;

function buildUserPrompt(post, replies) {
  const weights = getConfig('scoring.rubric_weights', {});
  
  return `Analyze the following content from an AI agent and score it for "cringe" (performative, unnatural behavior) and human-likeness.

## LATEST POST (context):
${post || '[No post available]'}

## AGENT'S REPLIES (${replies.length} samples):
${replies.map((r, i) => `${i + 1}. ${r.text || r}`).join('\n\n')}

## SCORING RUBRIC:
Score each dimension 0-10 (0 = not present, 10 = extreme):

1. PERFORMATIVE (weight: ${weights.performative || 1.5}): Forced hype, virtue signaling, try-hard swagger
2. MEME_OVERUSE (weight: ${weights.meme_overuse || 1.0}): Stale slang, awkward internet voice, outdated memes
3. LLM_TELLS (weight: ${weights.llm_tells || 2.0}): "As an AI...", balanced-but-empty statements, generic empathy, sterile structure
4. CONTEXT_DRIFT (weight: ${weights.context_drift || 1.0}): Replies don't match thread context, tangential responses
5. REPETITION (weight: ${weights.repetition || 1.5}): Same phrases, predictable cadence, template-like responses
6. OVEREXPLAINING (weight: ${weights.overexplaining || 1.0}): Robotic politeness, unnecessary caveats, excessive hedging

## TAGS (pick applicable):
["performative", "forced_slang", "llm_tell", "generic", "repetitive", "try_hard", "emoji_spam", "cliche", "context_deaf", "robotic", "authentic", "natural", "engaging"]

## REQUIRED OUTPUT (JSON only):
{
  "cringe_score": <0-100, higher = more cringe>,
  "human_likeness": <0-100, higher = more human-like>,
  "confidence": <0.0-1.0, how confident you are>,
  "subscores": {
    "performative": <0-10>,
    "meme_overuse": <0-10>,
    "llm_tells": <0-10>,
    "context_drift": <0-10>,
    "repetition": <0-10>,
    "overexplaining": <0-10>
  },
  "tags": [<applicable tags from list>],
  "rationale": "<1-3 sentences explaining the verdict>"
}`;
}

async function callOpenRouter(messages) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable not set');
  }
  
  const model = getConfig('scoring.model', 'openai/gpt-4o-mini');
  const temperature = getConfig('scoring.temperature', 0.3);
  const maxTokens = getConfig('scoring.max_tokens', 1000);
  
  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://cringe-scoreboard.local',
      'X-Title': 'Cringe Scoreboard',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error: ${response.status} - ${error}`);
  }
  
  const data = await response.json();
  return data.choices[0].message.content;
}

function parseScoreResponse(responseText) {
  try {
    let cleaned = responseText.trim();
    
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }
    
    const parsed = JSON.parse(cleaned);
    
    return {
      cringe_score: clamp(parsed.cringe_score, 0, 100),
      human_likeness: clamp(parsed.human_likeness, 0, 100),
      confidence: clamp(parsed.confidence, 0, 1),
      subscores: {
        performative: clamp(parsed.subscores?.performative, 0, 10),
        meme_overuse: clamp(parsed.subscores?.meme_overuse, 0, 10),
        llm_tells: clamp(parsed.subscores?.llm_tells, 0, 10),
        context_drift: clamp(parsed.subscores?.context_drift, 0, 10),
        repetition: clamp(parsed.subscores?.repetition, 0, 10),
        overexplaining: clamp(parsed.subscores?.overexplaining, 0, 10),
      },
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      rationale: String(parsed.rationale || ''),
    };
  } catch (error) {
    console.error('[PARSE ERROR]', error.message, responseText);
    throw new Error(`Failed to parse LLM response: ${error.message}`);
  }
}

function clamp(value, min, max) {
  const num = Number(value) || 0;
  return Math.max(min, Math.min(max, num));
}

function computeHeuristics(post, replies) {
  const allText = [post, ...replies.map(r => r.text || r)].join(' ');
  
  const emojiCount = (allText.match(/[\u{1F600}-\u{1F6FF}]/gu) || []).length;
  const exclamationCount = (allText.match(/!/g) || []).length;
  const wordCount = allText.split(/\s+/).length;
  
  const llmPhrases = [
    'as an ai', 'as a language model', 'i cannot', "i'm sorry, but",
    'however, it', 'that being said', 'it is important to note',
    'absolutely!', 'great question', "i'd be happy to",
  ];
  
  let llmPhraseCount = 0;
  const lowerText = allText.toLowerCase();
  for (const phrase of llmPhrases) {
    if (lowerText.includes(phrase)) llmPhraseCount++;
  }
  
  const words = allText.toLowerCase().match(/\b\w+\b/g) || [];
  const wordFreq = {};
  for (const word of words) {
    if (word.length > 4) {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    }
  }
  const repeatedWords = Object.values(wordFreq).filter(c => c > 3).length;
  
  return {
    emojiDensity: wordCount > 0 ? (emojiCount / wordCount) * 100 : 0,
    exclamationDensity: wordCount > 0 ? (exclamationCount / wordCount) * 100 : 0,
    llmPhraseCount,
    repeatedWordsScore: Math.min(repeatedWords * 2, 10),
  };
}

export class CringeScorer {
  constructor() {
    this.model = getConfig('scoring.model', 'openai/gpt-4o-mini');
    this.promptVersion = getConfig('scoring.prompt_version', 'v1');
    this.strategy = getConfig('scoring.strategy', 'single_pass');
  }
  
  async score(agentSample) {
    const { latestPost, replies } = agentSample;
    
    const postText = latestPost?.text || '';
    const replyTexts = replies.map(r => r.text || r).filter(Boolean);
    
    if (replyTexts.length === 0 && !postText) {
      return this.emptyScore('No content to analyze');
    }
    
    try {
      let result;
      
      switch (this.strategy) {
        case 'two_pass':
          result = await this.twoPassScore(postText, replyTexts);
          break;
        case 'self_consistency':
          result = await this.selfConsistencyScore(postText, replyTexts);
          break;
        default:
          result = await this.singlePassScore(postText, replyTexts);
      }
      
      const heuristics = computeHeuristics(postText, replyTexts);
      result.heuristics = heuristics;
      result.model_used = this.model;
      result.prompt_version = this.promptVersion;
      
      return result;
    } catch (error) {
      console.error('[SCORE ERROR]', error.message);
      return this.errorScore(error.message);
    }
  }
  
  async singlePassScore(postText, replyTexts) {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt(postText, replyTexts) },
    ];
    
    const response = await callOpenRouter(messages);
    return parseScoreResponse(response);
  }
  
  async twoPassScore(postText, replyTexts) {
    const extractPrompt = `Extract signals from this AI agent's content. List:
1. Specific phrases that sound AI-generated
2. Repetitive patterns
3. Context mismatches
4. Unusual tone markers

POST: ${postText}
REPLIES: ${replyTexts.join('\n---\n')}

Respond with a JSON object: {"signals": [...], "patterns": [...], "observations": "..."}`;
    
    const extractMessages = [
      { role: 'system', content: 'Extract signals from text. Output JSON only.' },
      { role: 'user', content: extractPrompt },
    ];
    
    const signals = await callOpenRouter(extractMessages);
    
    const scorePrompt = buildUserPrompt(postText, replyTexts) + 
      `\n\n## PRE-EXTRACTED SIGNALS:\n${signals}`;
    
    const scoreMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: scorePrompt },
    ];
    
    const response = await callOpenRouter(scoreMessages);
    return parseScoreResponse(response);
  }
  
  async selfConsistencyScore(postText, replyTexts) {
    const runs = getConfig('scoring.self_consistency_runs', 3);
    const scores = [];
    
    for (let i = 0; i < runs; i++) {
      const result = await this.singlePassScore(postText, replyTexts);
      scores.push(result);
    }
    
    return {
      cringe_score: average(scores.map(s => s.cringe_score)),
      human_likeness: average(scores.map(s => s.human_likeness)),
      confidence: average(scores.map(s => s.confidence)),
      subscores: {
        performative: average(scores.map(s => s.subscores.performative)),
        meme_overuse: average(scores.map(s => s.subscores.meme_overuse)),
        llm_tells: average(scores.map(s => s.subscores.llm_tells)),
        context_drift: average(scores.map(s => s.subscores.context_drift)),
        repetition: average(scores.map(s => s.subscores.repetition)),
        overexplaining: average(scores.map(s => s.subscores.overexplaining)),
      },
      tags: [...new Set(scores.flatMap(s => s.tags))],
      rationale: scores[0].rationale,
      consistency_variance: variance(scores.map(s => s.cringe_score)),
    };
  }
  
  emptyScore(reason) {
    return {
      cringe_score: 0,
      human_likeness: 0,
      confidence: 0,
      subscores: { performative: 0, meme_overuse: 0, llm_tells: 0, context_drift: 0, repetition: 0, overexplaining: 0 },
      tags: ['no_content'],
      rationale: reason,
      model_used: this.model,
      prompt_version: this.promptVersion,
    };
  }
  
  errorScore(errorMessage) {
    return {
      cringe_score: -1,
      human_likeness: -1,
      confidence: 0,
      subscores: { performative: 0, meme_overuse: 0, llm_tells: 0, context_drift: 0, repetition: 0, overexplaining: 0 },
      tags: ['error'],
      rationale: `Scoring failed: ${errorMessage}`,
      model_used: this.model,
      prompt_version: this.promptVersion,
    };
  }
}

function average(nums) {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function variance(nums) {
  if (nums.length === 0) return 0;
  const avg = average(nums);
  return nums.reduce((sum, n) => sum + Math.pow(n - avg, 2), 0) / nums.length;
}

export function getBadge(cringeScore) {
  const badges = getConfig('scoring.badges', {});
  
  if (cringeScore >= (badges.certified_cringe || 80)) return { label: 'CERTIFIED CRINGE', class: 'badge-cringe' };
  if (cringeScore >= (badges.kinda_cringe || 60)) return { label: 'KINDA CRINGE', class: 'badge-kinda' };
  if (cringeScore >= (badges.mid || 40)) return { label: 'MID', class: 'badge-mid' };
  if (cringeScore >= (badges.seems_human || 20)) return { label: 'SEEMS HUMAN', class: 'badge-human' };
  return { label: 'BASED', class: 'badge-based' };
}
