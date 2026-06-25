#!/usr/bin/env node
/**
 * Regenerate AI-quality summaries ONCE and store them (token-free at runtime).
 * Self-paced to stay under Groq free-tier limits; resumable via an `ai:true` flag.
 *
 *   node scripts/regen_ai_summaries.js moods        # just the 10 moods (fast)
 *   node scripts/regen_ai_summaries.js discourses   # all discourse summaries (slow)
 *   node scripts/regen_ai_summaries.js              # moods then discourses
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Groq = require('groq-sdk');

const ROOT = path.join(__dirname, '..');
const corpus = require(path.join(ROOT, 'vachanamrut_corpus.json'));
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const SUMMARIES_PATH = path.join(ROOT, 'summaries.json');
const MOODS_PATH = path.join(ROOT, 'mood_summaries.json');
const phase = process.argv[2] || 'all';

const MOOD_KEYWORDS = {
  sad:'sorrow grief consolation hope strength overcome sadness', anxious:'anxiety worry mind peace calm fearlessness equanimity',
  angry:'anger patience equanimity peace mind control jealousy', lonely:'loneliness fellowship satsang companion God devotee',
  fearful:'fear courage protection refuge faith God strength', confused:'wisdom understanding clarity discernment gnana doubt intellect',
  depressed:'despair hope liberation joy courage uplift faith perseverance', peaceful:'peace meditation devotion bliss contentment God form',
  happy:'joy gratitude devotion bhakti celebration God glory', lazy:'effort discipline spiritual practice dedication perseverance',
};
const SECTION_LABELS = { GI:'Gadhada I', SAR:'Sarangpur', KAR:'Kariyani', LOY:'Loya', PAN:'Panchala', GII:'Gadhada II', VAR:'Vartal', AMD:'Amdavad', GIII:'Gadhada III', JET:'Jetalpur' };
const friendlyRef = (r) => { const m=r.match(/^([A-Z]+)-?(\d+)$/i); return m?`${SECTION_LABELS[m[1].toUpperCase()]||m[1]} ${m[2]}`:r; };
const stripD = (t)=>t.normalize('NFD').replace(/[̀-ͯ]/g,'');
const tok = (t)=>stripD(t).toLowerCase().replace(/[^\w\s]/g,' ').split(/\s+/).filter(Boolean);
const score=(d,ts)=>{const h=stripD(`${d.en.title} ${d.en.text}`).toLowerCase();let s=0;for(const t of ts){const m=h.match(new RegExp(t,'g'));if(m)s+=m.length;}return s;};
const topMatches=(q,n=5)=>{const ts=tok(q);return corpus.map(d=>({d,s:score(d,ts)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).slice(0,n).map(x=>x.d);};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

// Robust call: self-paces and waits out token rate limits (window is ~60s)
async function chat(model, messages, maxTokens, baseDelay) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const c = await groq.chat.completions.create({ model, max_tokens: maxTokens, messages });
      await sleep(baseDelay); // proactive pacing
      return c.choices[0].message.content.trim();
    } catch (e) {
      const status = e.status || e.response?.status;
      if (status === 429 || status >= 500) {
        const m = (e.message || '').match(/try again in ([\d.]+)s/i);
        const wait = Math.min(65000, Math.max((m ? parseFloat(m[1]) : 60) * 1000 + 1500, 20000));
        process.stderr.write(`  ${status} rate limit — waiting ${(wait/1000)|0}s\n`);
        await sleep(wait);
        continue;
      }
      throw e;
    }
  }
  throw new Error('failed after retries');
}
const clean = (s) => s.replace(/^[^\n]*\b(summary|here'?s|here is|in simple)\b[^\n]*:\s*/i,'').replace(/^["“']|["”']$/g,'').trim();

const SUM_SYS = {
  en:'You are a Vachanamrut scholar. Summarise the discourse in 3-4 simple, warm sentences so a layperson grasps its core teaching. Start directly — no preamble.',
  gu:'તમે વચનામૃતના વિદ્વાન છો. પ્રવચનનો સરળ ગુજરાતીમાં ૩-૪ વાક્યનો સારાંશ આપો જેથી સામાન્ય વ્યક્તિ મુખ્ય ઉપદેશ સમજે. પ્રસ્તાવના વગર સીધો સારાંશ આપો.',
};
const moodSys=(mood,lang)=>`You are a compassionate Vachanamrut scholar. Using ONLY the provided excerpts, present what Bhagwan Swaminarayan teaches as wisdom and remedy for someone feeling ${mood}. Do NOT frame as answering a question — present as direct teachings. Structure: (1) a one-line theme naming the spiritual antidote, (2) 3-4 specific teachings from the excerpts with their reference in parentheses, (3) one closing line of strength. Cite the reference (e.g. Gadhada I-27) after each point. Warm, grounded, not academic.`+(lang==='gu'?' Respond in Gujarati.':' Respond in English.');

async function doMoods() {
  const moods = fs.existsSync(MOODS_PATH) ? JSON.parse(fs.readFileSync(MOODS_PATH)) : {};
  for (const mood of Object.keys(MOOD_KEYWORDS)) {
    const matches = topMatches(MOOD_KEYWORDS[mood], 5);
    moods[mood] = moods[mood] || {};
    moods[mood].citations = matches.map(d => ({ reference:d.reference, friendlyRef:friendlyRef(d.reference), title:d.en.title }));
    // Always build context from English (token-light); the system prompt sets output language.
    const ctx = matches.map(d => `[${friendlyRef(d.reference)}]\n${d.en.title}\n${d.en.text.slice(0,650)}`).join('\n\n---\n\n');
    for (const lang of ['en','gu']) {
      if (moods[mood][lang] && moods[mood].ai) continue;
      moods[mood][lang] = clean(await chat('llama-3.1-8b-instant',
        [{role:'system',content:moodSys(mood,lang)},{role:'user',content:`Teachings for someone feeling ${mood}.\n\nExcerpts:\n\n${ctx}`}], 700, 16000));
      process.stderr.write(`  mood ${mood} (${lang}) ✓\n`);
    }
    moods[mood].ai = true;
    fs.writeFileSync(MOODS_PATH, JSON.stringify(moods, null, 2));
  }
  process.stderr.write('MOODS DONE\n');
}

async function doDiscourses() {
  const sums = fs.existsSync(SUMMARIES_PATH) ? JSON.parse(fs.readFileSync(SUMMARIES_PATH)) : {};
  let n = 0;
  for (const d of corpus) {
    const ref = d.reference;
    sums[ref] = sums[ref] || {};
    if (sums[ref].ai) continue; // resumable: skip already-AI-done
    // English only via AI (8B is strong at English summarising; weak at Gujarati,
    // and Gujarati source text blows the per-minute token cap). Gujarati keeps its
    // existing extractive summary until the 70B daily quota can do it properly.
    const text = `${d.en.title}\n\n${d.en.text.slice(0,2800)}`;
    sums[ref].en = clean(await chat('llama-3.1-8b-instant',
      [{role:'system',content:SUM_SYS.en},{role:'user',content:text}], 300, 9500));
    sums[ref].ai = true;
    n++;
    fs.writeFileSync(SUMMARIES_PATH, JSON.stringify(sums));
    if (n % 5 === 0) process.stderr.write(`  discourses: ${n} done (latest ${ref})\n`);
  }
  process.stderr.write('DISCOURSES DONE\n');
}

(async () => {
  if (phase === 'moods' || phase === 'all') await doMoods();
  if (phase === 'discourses' || phase === 'all') await doDiscourses();
  process.stderr.write('ALL DONE\n');
})().catch(e => { console.error(e); process.exit(1); });
