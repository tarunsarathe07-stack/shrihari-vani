#!/usr/bin/env node
/**
 * Pre-generate answers for all "Teachings About…" topic chips.
 * Saves to topic_answers.json — served statically, zero runtime tokens.
 *
 *   node scripts/generate_topic_answers.js
 *
 * Resumable: skips topics already present. Needs GEMINI_API_KEY in .env.
 */
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const ROOT    = path.join(__dirname, '..');
const corpus  = require(path.join(ROOT, 'vachanamrut_corpus.json'));
const ai      = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.Gemini_Key });
const MODEL   = 'gemini-2.5-flash';
const OUT     = path.join(ROOT, 'topic_answers.json');

const TOPICS = [
  { key: 'devotion',      label: 'Devotion (Bhakti)',      query: 'What does the Vachanamrut teach about devotion and bhakti toward God?' },
  { key: 'the-mind',     label: 'The Mind',               query: 'What does the Vachanamrut teach about controlling and understanding the mind?' },
  { key: 'maya',         label: 'Maya',                   query: 'What does the Vachanamrut teach about maya and its nature?' },
  { key: 'satsang',      label: 'Satsang',                query: 'What does the Vachanamrut teach about the importance of satsang and spiritual fellowship?' },
  { key: 'liberation',   label: 'Liberation (Mukti)',     query: 'What does the Vachanamrut teach about liberation, mukti, and attaining God\'s abode?' },
  { key: 'the-soul',     label: 'The Soul (Atma)',        query: 'What does the Vachanamrut teach about the nature of the soul (atma/jiva)?' },
  { key: 'renunciation', label: 'Renunciation',           query: 'What does the Vachanamrut teach about true renunciation and vairagya?' },
  { key: 'gods-form',    label: "God's Form",             query: "What does the Vachanamrut teach about God's divine form and meditating upon it?" },
  { key: 'service',      label: 'Service (Seva)',         query: 'What does the Vachanamrut teach about selfless service and seva to God and devotees?' },
  { key: 'meditation',   label: 'Meditation (Dhyan)',     query: 'What does the Vachanamrut teach about meditation, dhyan, and contemplating God\'s form?' },
  { key: 'virtues',      label: 'Virtues',                query: 'What does the Vachanamrut teach about virtues, good qualities, and sadgunas a devotee must cultivate?' },
  { key: 'surrender',    label: 'Surrender',              query: 'What does the Vachanamrut teach about complete surrender and sharanagati to God?' },
  { key: 'the-guru',     label: 'The Guru',               query: 'What does the Vachanamrut teach about the role and importance of the Satpurush or guru?' },
  { key: 'death',        label: 'Death & Afterlife',      query: 'What does the Vachanamrut teach about death, the afterlife, and what happens to the soul?' },
  { key: 'dharma',       label: 'Dharma',                 query: 'What does the Vachanamrut teach about dharma and righteous conduct in daily life?' },
  { key: 'knowledge',    label: 'Knowledge (Jnan)',       query: 'What does the Vachanamrut teach about spiritual knowledge (jnan) and understanding God\'s greatness?' },
];

const SECTION_LABELS = { GI:'Gadhada I', SAR:'Sarangpur', KAR:'Kariyani', LOY:'Loya', PAN:'Panchala', GII:'Gadhada II', VAR:'Vartal', AMD:'Amdavad', GIII:'Gadhada III', JET:'Jetalpur' };
const friendlyRef = (r) => { const m = r.match(/^([A-Z]+)-?(\d+)$/i); return m ? `${SECTION_LABELS[m[1].toUpperCase()] || m[1]} ${m[2]}` : r; };
const stripD = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '');
const tok    = (t) => stripD(t).toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
const score  = (d, ts) => { const h = stripD(`${d.en.title} ${d.en.text}`).toLowerCase(); let s = 0; for (const t of ts) { const m = h.match(new RegExp(t, 'g')); if (m) s += m.length; } return s; };
const top5   = (q) => { const ts = tok(q); return corpus.map(d => ({ d, s: score(d, ts) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 7).map(x => x.d); };
const sleep  = (ms) => new Promise(r => setTimeout(r, ms));

const SYSTEM = `You are a revered Vachanamrut scholar helping devotees understand Bhagwan Swaminarayan's teachings.
Using ONLY the provided discourse excerpts, write a warm, insightful answer of about 180-250 words.
Structure it as 2-3 flowing paragraphs — no bullet points or headers.
Cite specific references (e.g. Gadhada I-27) naturally within the text where relevant.
Be reverent, clear, and genuinely helpful — speak directly to the devotee's heart.
Answer entirely in English.`;

async function generate(userPrompt) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const r = await ai.models.generateContent({
        model: MODEL,
        contents: userPrompt,
        config: { systemInstruction: SYSTEM, maxOutputTokens: 1200, temperature: 0.35, thinkingConfig: { thinkingBudget: 0 } },
      });
      await sleep(300);
      return (r.text || '').trim();
    } catch (e) {
      const status = e.status || e.code;
      if (status === 429 || status === 503 || (status >= 500 && status < 600)) {
        const w = 5000 * (attempt + 1); process.stderr.write(`  ${status}, waiting ${w}ms\n`); await sleep(w); continue;
      }
      throw e;
    }
  }
  throw new Error('failed after retries');
}

(async () => {
  if (!process.env.GEMINI_API_KEY && !process.env.Gemini_Key) { console.error('Missing GEMINI_API_KEY'); process.exit(1); }
  const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT)) : {};

  for (const topic of TOPICS) {
    if (out[topic.key] && out[topic.key].answer) {
      process.stderr.write(`skip  ${topic.key}\n`); continue;
    }
    const matches = top5(topic.query);
    const ctx = matches.map(d => `[${friendlyRef(d.reference)}] ${d.en.title}\n${d.en.text.slice(0, 1400)}`).join('\n\n---\n\n');
    const user = `Topic: ${topic.label}\nQuestion: ${topic.query}\n\nRelevant Vachanamrut excerpts:\n\n${ctx}`;
    process.stderr.write(`gen   ${topic.key}…`);
    const answer = await generate(user);
    out[topic.key] = {
      label: topic.label,
      answer,
      citations: matches.slice(0, 5).map(d => ({ reference: d.reference, friendlyRef: friendlyRef(d.reference), title: d.en.title })),
    };
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    process.stderr.write(` done (${answer.length} chars)\n`);
  }
  process.stderr.write('ALL TOPIC ANSWERS DONE\n');
})().catch(e => { console.error(e); process.exit(1); });
