#!/usr/bin/env node
/**
 * Regenerate RICH, detailed, thorough content with Gemini 2.5 Flash.
 *   node scripts/regenerate_rich.js moods        # 10 mood teachings en+gu+hi (rich)
 *   node scripts/regenerate_rich.js summaries    # 272 discourse summaries en+gu+hi (rich)
 *   node scripts/regenerate_rich.js all
 *
 * Resumable via a `rich:true` flag (independent of the old `haiku` flag).
 * Needs GEMINI_API_KEY in .env. One-time offline run; runtime stays $0.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const ROOT = path.join(__dirname, '..');
const corpus = require(path.join(ROOT, 'vachanamrut_corpus.json'));
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = 'gemini-2.5-flash';
const SUMMARIES_PATH = path.join(ROOT, 'summaries.json');
const MOODS_PATH = path.join(ROOT, 'mood_summaries.json');
const phase = process.argv[2] || 'all';

const GLOSSARY = 'Keep devotional/Sanskrit technical terms accurate and consistent using their standard equivalents in each language: jiva/atma (soul), maya, Brahman, Aksharbrahman, Parabrahman/Purushottam, gunatit, satsang, bhakti, ekantik dharma, gnan, vairagya, moksha/kalyan. Names: Bhagwan Swaminarayan, Shriji Maharaj. Keep Vachanamrut reference codes (e.g. Gadhada I-27) unchanged.';

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

async function ask(systemPrompt, userPrompt, maxTokens) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: MODEL,
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          maxOutputTokens: maxTokens,
          temperature: 0.4,
          thinkingConfig: { thinkingBudget: 0 },
        },
      });
      await sleep(250);
      return (response.text || '').trim();
    } catch (e) {
      const status = e.status || e.code;
      if (status === 429 || status === 503 || (status >= 500 && status < 600)) {
        const w = 4000 * (attempt + 1);
        process.stderr.write(`  ${status}, wait ${w}ms\n`);
        await sleep(w);
        continue;
      }
      throw e;
    }
  }
  throw new Error('failed after retries');
}

function parse3(text) {
  const en = (text.match(/<EN>([\s\S]*?)<\/EN>/i) || [])[1];
  const gu = (text.match(/<GU>([\s\S]*?)<\/GU>/i) || [])[1];
  const hi = (text.match(/<HI>([\s\S]*?)<\/HI>/i) || [])[1];
  return { en: en && en.trim(), gu: gu && gu.trim(), hi: hi && hi.trim() };
}

async function doSummaries() {
  const sums = fs.existsSync(SUMMARIES_PATH) ? JSON.parse(fs.readFileSync(SUMMARIES_PATH)) : {};
  let n = 0, done = 0;
  for (const d of corpus) {
    const ref = d.reference;
    sums[ref] = sums[ref] || {};
    if (sums[ref].rich) { done++; continue; }
    const sys = `You are a revered Vachanamrut scholar who explains Bhagwan Swaminarayan's teachings to sincere seekers. ${GLOSSARY}
Write a RICH, detailed and thorough summary (about 6 to 9 sentences) that genuinely helps a layperson understand and apply this discourse. Cover, woven naturally as flowing prose (not headings): the occasion or setting in a line; the central question or theme; the key teachings Maharaj gives WITH the reasoning or analogies he uses; and a warm, practical takeaway for the seeker's spiritual life. Be faithful to the text, reverent, clear and valuable — never generic or vague.
Provide the SAME summary in three languages. Output ONLY this exact format with no extra words:
<EN>{English summary}</EN>
<GU>{Gujarati summary}</GU>
<HI>{Hindi summary}</HI>`;
    const user = `Discourse reference: ${friendlyRef(ref)}\n\nTITLE: ${d.en.title}\n\nTEXT:\n${d.en.text.slice(0, 5000)}`;
    const out = await ask(sys, user, 6000);
    const { en, gu, hi } = parse3(out);
    if (en) sums[ref].en = en;
    if (gu) sums[ref].gu = gu;
    if (hi) sums[ref].hi = hi;
    if (en && gu && hi) { sums[ref].rich = true; done++; }
    n++;
    fs.writeFileSync(SUMMARIES_PATH, JSON.stringify(sums));
    if (n % 5 === 0) process.stderr.write(`  rich summaries: ${done}/${corpus.length} (latest ${ref})\n`);
  }
  process.stderr.write(`RICH SUMMARIES DONE (${done}/${corpus.length})\n`);
}

async function doMoods() {
  const moods = fs.existsSync(MOODS_PATH) ? JSON.parse(fs.readFileSync(MOODS_PATH)) : {};
  for (const mood of Object.keys(MOOD_KEYWORDS)) {
    moods[mood] = moods[mood] || {};
    if (moods[mood].rich) { process.stderr.write(`  mood ${mood} already rich, skip\n`); continue; }
    const matches = topMatches(MOOD_KEYWORDS[mood], 6);
    moods[mood].citations = matches.slice(0,5).map(d => ({ reference:d.reference, friendlyRef:friendlyRef(d.reference), title:d.en.title }));
    const ctx = matches.map(d => `[${friendlyRef(d.reference)}]\n${d.en.title}\n${d.en.text.slice(0,1100)}`).join('\n\n---\n\n');
    const sys = `You are a compassionate Vachanamrut scholar and spiritual guide. ${GLOSSARY}
Using ONLY the provided excerpts, compose a RICH, warm and thorough piece of guidance for someone feeling ${mood}. Make it genuinely comforting and substantial. Structure it as:
1) A short bold heading naming the spiritual antidote.
2) A 2-3 sentence opening that gently acknowledges the feeling and frames Bhagwan Swaminarayan's perspective.
3) FOUR specific teachings as bullet points, each 2-3 sentences, drawn from the excerpts WITH the reference in parentheses (e.g. (Gadhada I-27)) and the reasoning/analogy Maharaj gives.
4) A closing line of strength and hope.
Warm, grounded, faithful — not academic or generic. Provide the SAME piece in three languages. Output ONLY this exact format:
<EN>{English}</EN>
<GU>{Gujarati}</GU>
<HI>{Hindi}</HI>`;
    const user = `Feeling: ${mood}\n\nExcerpts:\n\n${ctx}`;
    const out = await ask(sys, user, 6000);
    const { en, gu, hi } = parse3(out);
    if (en) moods[mood].en = en;
    if (gu) moods[mood].gu = gu;
    if (hi) moods[mood].hi = hi;
    if (en && gu && hi) moods[mood].rich = true;
    fs.writeFileSync(MOODS_PATH, JSON.stringify(moods, null, 2));
    process.stderr.write(`  mood ${mood} rich en+gu+hi ${moods[mood].rich ? 'OK' : 'PARTIAL'}\n`);
  }
  process.stderr.write('RICH MOODS DONE\n');
}

(async () => {
  if (!process.env.GEMINI_API_KEY) { console.error('Missing GEMINI_API_KEY in .env'); process.exit(1); }
  if (phase === 'moods' || phase === 'all') await doMoods();
  if (phase === 'summaries' || phase === 'all') await doSummaries();
  process.stderr.write('ALL RICH DONE\n');
})().catch(e => { console.error(e); process.exit(1); });
