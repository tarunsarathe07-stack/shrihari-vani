#!/usr/bin/env node
/**
 * Pre-generate answers for the DEFAULT example questions (the chips shown on the
 * home page) in en/gu/hi, and save them to preset_answers.json. These are served
 * statically at $0 runtime cost — clicking a default question never spends tokens.
 *
 *   node scripts/generate_preset_answers.js
 *
 * Resumable: skips questions already present. Needs GEMINI_API_KEY in .env.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const ROOT = path.join(__dirname, '..');
const corpus = require(path.join(ROOT, 'vachanamrut_corpus.json'));
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.Gemini_Key });
const MODEL = 'gemini-2.5-flash'; // best quality — one-time, ~18 calls
const OUT_PATH = path.join(ROOT, 'preset_answers.json');

// Keep in sync with EXAMPLE_QUESTIONS in public/index.html
const EXAMPLE_QUESTIONS = {
  en: [
    'What is the nature of the soul (jiva)?',
    'How should a devotee control the mind?',
    'What is the importance of satsang?',
    'How does one attain the state of gunatit?',
    'What is true renunciation?',
    'How to develop unwavering devotion to God?',
  ],
  gu: [
    'જીવ ની ઓળખ કઈ છે?',
    'ભક્ત મન ને કઈ રીતે વશ કરે?',
    'સત્સંગ ની ઉત્કૃષ્ટ મહત્તા શું છે?',
    'ગુણાતીત અવસ્થા કઈ રીતે પ્રાપ્ત થાય?',
    'સાચો ત્યાગ કોને કહ્યો?',
    'ભગવાન પ્રત્યે અટળ ભક્તિ કઈ રીતે વધે?',
  ],
  hi: [
    'जीव की पहचान क्या है?',
    'भक्त मन को कैसे वश में करे?',
    'सत्संग का क्या महत्व है?',
    'गुणातीत अवस्था कैसे प्राप्त होती है?',
    'सच्चा त्याग किसे कहते हैं?',
    'भगवान के प्रति अटल भक्ति कैसे बढ़े?',
  ],
};

const SECTION_LABELS = { GI:'Gadhada I', SAR:'Sarangpur', KAR:'Kariyani', LOY:'Loya', PAN:'Panchala', GII:'Gadhada II', VAR:'Vartal', AMD:'Amdavad', GIII:'Gadhada III', JET:'Jetalpur' };
const friendlyRef = (r) => { const m=r.match(/^([A-Z]+)-?(\d+)$/i); return m?`${SECTION_LABELS[m[1].toUpperCase()]||m[1]} ${m[2]}`:r; };
const stripD = (t)=>t.normalize('NFD').replace(/[̀-ͯ]/g,'');
const tok = (t)=>stripD(t).toLowerCase().replace(/[^\w\s]/g,' ').split(/\s+/).filter(Boolean);
const score=(d,ts)=>{const h=stripD(`${d.en.title} ${d.en.text}`).toLowerCase();let s=0;for(const t of ts){const m=h.match(new RegExp(t,'g'));if(m)s+=m.length;}return s;};
const topMatches=(q,n=5)=>{const ts=tok(q);return corpus.map(d=>({d,s:score(d,ts)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).slice(0,n).map(x=>x.d);};
const norm = (q)=>String(q||'').trim().replace(/\s+/g,' ').toLowerCase();
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

const LANG_NAME = { en:'English', gu:'Gujarati', hi:'Hindi' };

async function ask(systemPrompt, userPrompt) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const r = await ai.models.generateContent({
        model: MODEL,
        contents: userPrompt,
        config: { systemInstruction: systemPrompt, maxOutputTokens: 2000, temperature: 0.4, thinkingConfig: { thinkingBudget: 0 } },
      });
      await sleep(250);
      return (r.text || '').trim();
    } catch (e) {
      const status = e.status || e.code;
      if (status === 429 || status === 503 || (status >= 500 && status < 600)) {
        const w = 4000 * (attempt + 1); process.stderr.write(`  ${status}, wait ${w}ms\n`); await sleep(w); continue;
      }
      throw e;
    }
  }
  throw new Error('failed after retries');
}

(async () => {
  if (!process.env.GEMINI_API_KEY && !process.env.Gemini_Key) { console.error('Missing GEMINI key'); process.exit(1); }
  const out = fs.existsSync(OUT_PATH) ? JSON.parse(fs.readFileSync(OUT_PATH)) : {};
  for (const lang of Object.keys(EXAMPLE_QUESTIONS)) {
    for (const q of EXAMPLE_QUESTIONS[lang]) {
      const key = `${lang}|${norm(q)}`;
      if (out[key] && out[key].answer) { process.stderr.write(`skip ${key}\n`); continue; }
      // Retrieval: gu scores against gu field; en/hi against english
      const searchLang = lang === 'gu' ? 'gu' : 'en';
      const ts = tok(q);
      const matches = corpus.map(d=>({d,s:(()=>{const f=(searchLang==='gu'&&d.gu&&d.gu.text)?d.gu:d.en;const h=stripD(`${f.title} ${f.text}`).toLowerCase();let s=0;for(const t of ts){const m=h.match(new RegExp(t,'g'));if(m)s+=m.length;}return s;})()}))
        .filter(x=>x.s>0).sort((a,b)=>b.s-a.s).slice(0,5).map(x=>x.d);
      const use = matches.length ? matches : topMatches(q, 5);
      const ctx = use.map(d => `[${friendlyRef(d.reference)}]\n${d.en.title}\n${d.en.text.slice(0,1200)}`).join('\n\n---\n\n');
      const sys = `You are a revered Vachanamrut scholar. Answer the question using ONLY the provided discourse excerpts. Write a warm, clear, well-structured answer of about 150-230 words. Cite the specific reference (e.g. Gadhada I-27) in parentheses for each point you make. Answer entirely in ${LANG_NAME[lang]}. Be reverent, faithful and genuinely helpful — not academic.`;
      const user = `Question: ${q}\n\nRelevant Vachanamrut excerpts:\n\n${ctx}`;
      const answer = await ask(sys, user);
      out[key] = {
        question: q,
        answer,
        citations: use.map(d => ({ reference:d.reference, friendlyRef:friendlyRef(d.reference), title:(d[lang]&&d[lang].title?d[lang]:d.en).title })),
      };
      fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
      process.stderr.write(`done ${key} (${answer.length} chars)\n`);
    }
  }
  process.stderr.write('PRESET ANSWERS DONE\n');
})().catch(e => { console.error(e); process.exit(1); });
