#!/usr/bin/env node
/**
 * One-time generation of Gujarati + Hindi static content with Claude Haiku.
 * (English is generated for free by the Groq script; Haiku fills the Gu/Hi gap.)
 *
 *   node scripts/generate_haiku.js moods        # mood teachings gu+hi
 *   node scripts/generate_haiku.js discourses   # discourse summaries gu+hi
 *   node scripts/generate_haiku.js hinditext    # FULL Hindi scripture -> discourses_hi.json
 *   node scripts/generate_haiku.js all          # all of the above
 *
 * Needs ANTHROPIC_API_KEY in .env. Resumable via a `haiku:true` flag.
 * Runtime stays $0 — this only runs offline, once.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const ROOT = path.join(__dirname, '..');
const corpus = require(path.join(ROOT, 'vachanamrut_corpus.json'));
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-haiku-4-5';
const SUMMARIES_PATH = path.join(ROOT, 'summaries.json');
const MOODS_PATH = path.join(ROOT, 'mood_summaries.json');
const phase = process.argv[2] || 'all';

const GLOSSARY = 'Keep devotional/Sanskrit technical terms accurate and consistent using their standard Hindi/Gujarati equivalents: jiva/atma (soul), maya, Brahman, Aksharbrahman, Parabrahman/Purushottam, gunatit, satsang, bhakti, ekantik dharma, gnan, vairagya, moksha/kalyan. Names: Bhagwan Swaminarayan, Shriji Maharaj. Keep Vachanamrut reference codes (e.g. Gadhada I-27) unchanged.';

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

async function ask(system, user, maxTokens) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const m = await anthropic.messages.create({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role:'user', content: user }] });
      await sleep(250);
      return m.content.map(b => b.text || '').join('').trim();
    } catch (e) {
      const s = e.status;
      if (s === 429 || s === 529 || s >= 500) { const w = 3000*(attempt+1); process.stderr.write(`  ${s}, wait ${w}ms\n`); await sleep(w); continue; }
      throw e;
    }
  }
  throw new Error('failed after retries');
}

// Parse a <GU>..</GU><HI>..</HI> response
function parseGuHi(text) {
  const gu = (text.match(/<GU>([\s\S]*?)<\/GU>/i) || [])[1];
  const hi = (text.match(/<HI>([\s\S]*?)<\/HI>/i) || [])[1];
  return { gu: gu && gu.trim(), hi: hi && hi.trim() };
}

async function doDiscourses() {
  const sums = fs.existsSync(SUMMARIES_PATH) ? JSON.parse(fs.readFileSync(SUMMARIES_PATH)) : {};
  let n = 0;
  for (const d of corpus) {
    const ref = d.reference;
    sums[ref] = sums[ref] || {};
    if (sums[ref].haiku) continue;
    const sys = `You are a Vachanamrut scholar and translator. ${GLOSSARY} Output ONLY in this exact format with no extra words:\n<GU>{Gujarati summary}</GU>\n<HI>{Hindi summary}</HI>`;
    const user = `Write a simple, warm 3-4 sentence summary of this discourse so a layperson grasps its core teaching. Provide the SAME summary in Gujarati and in Hindi.\n\n${d.en.title}\n\n${d.en.text.slice(0, 3000)}`;
    const out = await ask(sys, user, 900);
    const { gu, hi } = parseGuHi(out);
    if (gu) sums[ref].gu = gu;
    if (hi) sums[ref].hi = hi;
    if (gu && hi) sums[ref].haiku = true;
    n++;
    fs.writeFileSync(SUMMARIES_PATH, JSON.stringify(sums));
    if (n % 5 === 0) process.stderr.write(`  discourses gu+hi: ${n} (latest ${ref})\n`);
  }
  process.stderr.write('DISCOURSES (gu+hi) DONE\n');
}

async function doMoods() {
  const moods = fs.existsSync(MOODS_PATH) ? JSON.parse(fs.readFileSync(MOODS_PATH)) : {};
  for (const mood of Object.keys(MOOD_KEYWORDS)) {
    const matches = topMatches(MOOD_KEYWORDS[mood], 5);
    moods[mood] = moods[mood] || {};
    moods[mood].citations = matches.map(d => ({ reference:d.reference, friendlyRef:friendlyRef(d.reference), title:d.en.title }));
    const ctx = matches.map(d => `[${friendlyRef(d.reference)}]\n${d.en.title}\n${d.en.text.slice(0,650)}`).join('\n\n---\n\n');
    const sys = `You are a compassionate Vachanamrut scholar and translator. ${GLOSSARY} Output ONLY this exact format:\n<GU>{Gujarati}</GU>\n<HI>{Hindi}</HI>`;
    const user = `Using ONLY these excerpts, present what Bhagwan Swaminarayan teaches as wisdom and remedy for someone feeling ${mood}. Structure: (1) a one-line theme naming the spiritual antidote, (2) 3-4 specific teachings with their reference in parentheses, (3) one closing line of strength. Warm, grounded, not academic. Provide the SAME piece in Gujarati and Hindi.\n\nExcerpts:\n\n${ctx}`;
    const out = await ask(sys, user, 1400);
    const { gu, hi } = parseGuHi(out);
    if (gu) moods[mood].gu = gu;
    if (hi) moods[mood].hi = hi;
    delete moods[mood].gu_interim;
    moods[mood].haiku = true;
    fs.writeFileSync(MOODS_PATH, JSON.stringify(moods, null, 2));
    process.stderr.write(`  mood ${mood} gu+hi ✓\n`);
  }
  process.stderr.write('MOODS (gu+hi) DONE\n');
}

// Full Hindi translation of each discourse (title + complete text) -> discourses_hi.json
async function doHindiText() {
  const HI_PATH = path.join(ROOT, 'discourses_hi.json');
  const hi = fs.existsSync(HI_PATH) ? JSON.parse(fs.readFileSync(HI_PATH)) : {};
  let n = 0;
  for (const d of corpus) {
    const ref = d.reference;
    if (hi[ref] && hi[ref].text) continue; // resumable
    const sys = `You are a faithful translator of the BAPS Swaminarayan Vachanamrut into natural, reverent Hindi. ${GLOSSARY} Translate accurately and completely, preserving meaning, paragraph breaks, and all reference codes. Output ONLY this format:\n<TITLE>{Hindi title}</TITLE>\n<TEXT>{full Hindi translation}</TEXT>`;
    const user = `Translate this discourse into Hindi.\n\nTITLE: ${d.en.title}\n\nTEXT:\n${d.en.text}`;
    const out = await ask(sys, user, 4000);
    const title = (out.match(/<TITLE>([\s\S]*?)<\/TITLE>/i) || [])[1];
    const text = (out.match(/<TEXT>([\s\S]*?)<\/TEXT>/i) || [])[1];
    if (title && text) hi[ref] = { title: title.trim(), text: text.trim() };
    n++;
    fs.writeFileSync(HI_PATH, JSON.stringify(hi));
    if (n % 3 === 0) process.stderr.write(`  hindi text: ${n} (latest ${ref})\n`);
  }
  process.stderr.write('HINDI FULL TEXT DONE\n');
}

(async () => {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('Missing ANTHROPIC_API_KEY in .env'); process.exit(1); }
  if (phase === 'moods' || phase === 'all') await doMoods();
  if (phase === 'discourses' || phase === 'all') await doDiscourses();
  if (phase === 'hinditext' || phase === 'all') await doHindiText();
  process.stderr.write('ALL DONE\n');
})().catch(e => { console.error(e); process.exit(1); });
