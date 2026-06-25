require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;

// Gemini runtime — cheap Flash-Lite for custom (non-preset) questions.
// Default questions are served from preset_answers.json (zero tokens).
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.Gemini_Key;
const GEMINI_MODEL = 'gemini-2.5-flash-lite';
let genai;
const getGenAI = () => {
  if (!genai) genai = new GoogleGenAI({ apiKey: GEMINI_KEY });
  return genai;
};

// Supabase question logging — fire-and-forget, never blocks a response.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
function logQuestion({ question, mood, language, answer, citations, fallback }) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return;
  const row = {
    question: question || null,
    mood: mood || null,
    language,
    answer: answer ? answer.slice(0, 2000) : null,
    citations: citations ? citations.map(c => c.reference).join(', ') : null,
    fallback: fallback || false,
  };
  fetch(`${SUPABASE_URL}/rest/v1/question_logs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(row),
  }).catch(err => console.error('Supabase log error:', err.message));
}

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Load corpus and precomputed app data into memory at startup. Static requires
// ensure Vercel bundles these JSON files with the serverless function.
const corpus = require('../vachanamrut_corpus.json');
const precomputedSummaries = require('../summaries.json');
const precomputedMoodSummaries = require('../mood_summaries.json');
const hindiDiscourses = require('../discourses_hi.json');
let presetAnswers = {};
try { presetAnswers = require('../preset_answers.json'); } catch { presetAnswers = {}; }

let topicAnswers = {};
try { topicAnswers = require('../topic_answers.json'); } catch { topicAnswers = {}; }
const normQ = (q) => String(q || '').trim().replace(/\s+/g, ' ').toLowerCase();

// Build a reference → discourse map for O(1) lookup
const byRef = {};
for (const d of corpus) {
  byRef[d.reference.toUpperCase()] = d;
}

// Expand reference alias to section name for readable citations
const SECTION_LABELS = {
  GI:  'Gadhada I',
  SAR: 'Sarangpur',
  KAR: 'Kariyani',
  LOY: 'Loya',
  PAN: 'Panchala',
  GII: 'Gadhada II',
  VAR: 'Vartal',
  AMD: 'Amdavad',
  GIII:'Gadhada III',
  JET: 'Jetalpur',
};

// Extract a clean quote — just Maharaj's words, no “Shriji Maharaj said” preamble.
function dailyQuote(text) {
  const body = text.slice(150);
  const m = body.match(/(?:said|replied|explained|answered|spoke)\s*,?\s*“([\s\S]{60,})/);
  if (m && m[1]) {
    let quote = m[1].split(/”/)[0];
    if (quote.length < 40) quote = m[1];
    quote = quote.replace(/\s+/g, ' ').trim();
    const sentences = quote.match(/[^.!?]+[.!?]+/g);
    if (sentences && sentences.length > 3) {
      quote = sentences.slice(0, 3).join('').trim();
    }
    if (quote.length > 350) quote = quote.slice(0, 350);
    return quote;
  }
  return teachingExcerpt(text, 350);
}

function simpleExcerpt(text, maxLen = 300) {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  const start = Math.min(120, Math.floor(clean.length * 0.15));
  let chunk = clean.slice(start, start + maxLen);
  const lastPunct = Math.max(chunk.lastIndexOf('।'), chunk.lastIndexOf('|'), chunk.lastIndexOf('.'), chunk.lastIndexOf('?'));
  if (lastPunct > 40) chunk = chunk.slice(0, lastPunct + 1);
  return chunk.trim();
}

// Skip the scene-setting opening and return the actual teaching content
function teachingExcerpt(text, maxLen = 300) {
  const focusEnglishTeaching = (body) => {
    const patterns = [
      /Thereupon\s+Shriji\s+Mah[ãāa]r[ãāa]j\s+(?:said|replied|explained|answered|spoke)[,:]?\s*/i,
      /Shriji\s+Mah[ãāa]r[ãāa]j\s+(?:then\s+)?(?:said|replied|explained|answered|spoke)[,:]?\s*/i,
      /He\s+then\s+opened\s+His\s+eyes[\s\S]{0,160}?said,\s*/i,
    ];
    for (const pattern of patterns) {
      const m = body.match(pattern);
      if (m && m.index > 0 && m.index < 700) return body.slice(m.index);
    }
    return body;
  };
  // "gathered before Him." / "seated before Him." marks end of scene-setting
  const transition = text.match(/(?:gathered|seated|present)\s+before\s+[Hh]im[.,]\s*([\s\S]+)/);
  if (transition && transition.index < 700) {
    const after = transition[1].replace(/^\d+\s+/, '').trimStart();
    if (after.length > 50) return focusEnglishTeaching(after).slice(0, maxLen);
  }
  // Numbered paragraph "1 Shriji..." at start of line
  const numbered = text.match(/(?:^|\n)\s*1\s+([A-Z"'""“‘])/m);
  if (numbered && numbered.index < 900) {
    return text.slice(numbered.index).replace(/^\s*1\s+/, '').trimStart().slice(0, maxLen);
  }
  // "Shriji/Mahārāj said"
  const said = text.search(/(?:Shrij|Mahārāj|Swāmi Shri)[^\n]*said/);
  if (said > 0 && said < 700) return text.slice(said).slice(0, maxLen);
  // Fallback: skip first sentence (the date line)
  const dot = text.indexOf('. ', 50);
  if (dot > 0 && dot < 350) return text.slice(dot + 2).trimStart().slice(0, maxLen);
  return text.slice(0, maxLen);
}

function friendlyRef(ref) {
  const m = ref.match(/^([A-Z]+)-?(\d+)$/i);
  if (!m) return ref;
  const section = SECTION_LABELS[m[1].toUpperCase()] || m[1];
  return `${section} ${m[2]}`;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function stripDiacritics(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// English function words that carry no topical meaning and flood keyword scores.
const STOPWORDS = new Set([
  'a','an','the','is','it','i','me','my','you','your','we','our','he','she','they',
  'can','what','why','when','where','which','who','that','this','these','those',
  'are','be','been','being','was','were','do','does','did','has','have','had',
  'will','would','should','could','may','might','shall',
  'and','or','but','if','in','on','at','by','for','from','with','about','as',
  'into','through','before','after','above','below','between','out','off','over',
  'under','again','then','once','there','here','any','all','both','each','few',
  'more','most','no','not','only','own','same','so','than','too','very','just',
  'how','to','get','rid','of','go','make','help','tell','please','let',
  'give','show','find','know','think','want','need','like','see',
  'say','said','asked','answered','replied','also','even','still',
]);

function tokenise(text) {
  // Preserve Devanagari (ऀ-ॿ) and Gujarati (઀-૿) so that
  // Hindi and Gujarati query words survive tokenisation and can match QUERY_EXPANSIONS.
  return stripDiacritics(text)
    .toLowerCase()
    .replace(/[^\w\sऀ-ॿ઀-૿]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

// Strip stopwords from query tokens only — not from corpus text.
// This prevents common English function words from dominating relevance scores.
function queryTokens(text) {
  return tokenise(text).filter(t => t.length > 2 && !STOPWORDS.has(t));
}

function scoreDiscoure(discourse, queryTokens, lang) {
  const field = discourse[lang] || discourse.en;
  const haystack = stripDiacritics(`${field.title} ${field.text}`).toLowerCase();
  // For Gujarati queries also score against the English field so that
  // English expansion terms (appended by expandQuery) land hits.
  const enHaystack = lang === 'gu'
    ? stripDiacritics(`${discourse.en.title} ${discourse.en.text}`).toLowerCase()
    : null;
  let score = 0;
  for (const tok of queryTokens) {
    const re = new RegExp(tok, 'g');
    const m = haystack.match(re);
    if (m) score += m.length;
    if (enHaystack) {
      const em = enHaystack.match(re);
      if (em) score += em.length * 0.6; // weight English hits lower than native GU
    }
  }
  return score;
}

function topMatches(query, lang, n = 5) {
  const qToks = queryTokens(query);
  if (qToks.length === 0) return [];
  const scored = corpus
    .map(d => ({ d, score: scoreDiscoure(d, qToks, lang) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
  scored._topScore = scored.length ? scored[0].score : 0;
  scored._avgScore = scored.length ? scored.reduce((s, x) => s + x.score, 0) / scored.length : 0;
  const results = scored.map(x => x.d);
  results._topScore = scored._topScore;
  results._avgScore = scored._avgScore;
  return results;
}

function cleanText(text) {
  return (text || '').replace(/\s+/g, ' ').replace(/^\d+\s+/, '').trim();
}

function isIntroSentence(sentence, lang) {
  if (lang === 'gu') {
    return /પ્રશ્ન પૂછ|ઉત્તર કર્યો|થયો નહીં|લ્યો, અમે ઉત્તર કરીએ|પૂછ્યું જે/.test(sentence);
  }
  return /\?|asked|raised a question|answered according|satisfactory reply|allow me to answer|please describe/i.test(sentence);
}

function takeSentences(text, count = 3, maxLen = 650, lang = 'en') {
  const normalized = cleanText(text);
  const matches = normalized.match(/[^.!?।]+[.!?।]+(?:["”’])?/g) || [normalized];
  const picked = [];
  const usable = matches.filter(s => !isIntroSentence(s, lang));
  const source = usable.length ? usable : matches;
  for (const s of source) {
    const sentence = s.trim();
    if (sentence.length < 20) continue;
    picked.push(sentence);
    if (picked.length >= count || picked.join(' ').length >= maxLen) break;
  }
  const joined = picked.join(' ').trim();
  if (joined.length <= maxLen) return joined;
  const cut = joined.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 80 ? lastSpace : maxLen).trim()}.`;
}

function gujaratiTeachingExcerpt(text, maxLen = 900) {
  const markers = ['પછી શ્રીજીમહારાજ', 'ત્યારે શ્રીજીમહારાજ', 'પછી મુક્તાનંદ સ્વામીએ', 'પછી'];
  for (const marker of markers) {
    const idx = (text || '').indexOf(marker);
    if (idx > 80 && idx < 1300) return text.slice(idx, idx + maxLen);
  }
  return cleanText(text).slice(0, maxLen);
}

function getDiscourseField(d, lang) {
  if (lang === 'hi' && hindiDiscourses[d.reference]) {
    return { title: hindiDiscourses[d.reference].title, text: hindiDiscourses[d.reference].text };
  }
  return (d[lang] && d[lang].title) ? d[lang] : d.en;
}

function localDiscourseSummary(d, lang) {
  if (lang === 'hi') return localDiscourseSummary(d, 'en');
  const field = lang === 'gu' && d.gu && d.gu.text ? d.gu : d.en;
  const core = lang === 'gu'
    ? gujaratiTeachingExcerpt(field.text, 1100)
    : teachingExcerpt(field.text, 1100);
  return takeSentences(core, 3, lang === 'gu' ? 760 : 700, lang);
}

function getDiscourseSummary(d, lang) {
  const stored = precomputedSummaries[d.reference] && precomputedSummaries[d.reference][lang];
  return stored || localDiscourseSummary(d, lang);
}

function citationList(matches, lang) {
  return matches.map(d => ({
    reference: d.reference,
    friendlyRef: friendlyRef(d.reference),
    title: getDiscourseField(d, lang).title || d.en.title,
  }));
}

const MOOD_THEMES = {
  hi: {
    sad:       'जब हृदय ईश्वर को याद करता है और सत्संग में रहता है, तो दुख हल्का हो जाता है।',
    anxious:   'मन चिंता में नहीं, भगवान में स्थिर हो जाए तो शांति मिलती है।',
    angry:     'धैर्य, विनम्रता और मन के संयम से क्रोध शांत होता है।',
    lonely:    'अकेलेपन का उपाय भगवान, संत और हरिभक्तों के संग में है।',
    fearful:   'भगवान में दृढ़ श्रद्धा होने पर भय कम हो जाता है।',
    confused:  'समझ, विवेक और संत के मार्गदर्शन से स्पष्टता मिलती है।',
    depressed: 'भगवान में दृढ़ विश्वास, सत्संग और स्थिर पुरुषार्थ से शक्ति वापस आती है।',
    peaceful:  'सच्ची शांति भक्ति, भगवान के स्मरण और अंतर की संतुष्टि से आती है।',
    happy:     'आनंद कृतज्ञता से भगवान को अर्पण हो तो भक्ति बनती है।',
    lazy:      'नियम, पुरुषार्थ और लक्ष्य के स्मरण से आध्यात्मिक ऊर्जा बढ़ती है।',
  },
  en: {
    sad: 'Sorrow becomes lighter when the heart remembers God and stays close to satsang.',
    anxious: 'Peace grows when the mind rests in God instead of chasing every worry.',
    angry: 'Anger cools through patience, humility, and control of the mind.',
    lonely: 'Loneliness is answered by God, the Sant, and the company of devotees.',
    fearful: 'Fear weakens when faith in God becomes firm.',
    confused: 'Clarity comes from spiritual understanding, discernment, and guidance from the Sant.',
    depressed: 'Strength returns through firm faith in God, satsang, and steady spiritual effort.',
    peaceful: 'True peace comes from devotion, remembrance of God, and inner contentment.',
    happy: 'Joy becomes devotion when it is offered back to God with gratitude.',
    lazy: 'Spiritual energy grows through discipline, effort, and remembrance of the goal.',
  },
  gu: {
    sad: 'દુઃખ હળવું થાય છે જ્યારે હૃદય ભગવાનને યાદ કરે અને સત્સંગમાં રહે.',
    anxious: 'મન ચિંતામાં નહીં, ભગવાનમાં સ્થિર થાય ત્યારે શાંતિ વધે છે.',
    angry: 'ધીરજ, નમ્રતા અને મનના સંયમથી ક્રોધ શાંત થાય છે.',
    lonely: 'એકલતાનો ઉપાય ભગવાન, સંત અને હરિભક્તોના સંગમાં છે.',
    fearful: 'ભગવાનમાં દૃઢ શ્રદ્ધા થાય ત્યારે ભય ઓછો થાય છે.',
    confused: 'સમજ, વિવેક અને સંતના માર્ગદર્શનથી સ્પષ્ટતા મળે છે.',
    depressed: 'ભગવાનમાં દૃઢ વિશ્વાસ, સત્સંગ અને સ્થિર પુરુષાર્થથી બળ પાછું આવે છે.',
    peaceful: 'સાચી શાંતિ ભક્તિ, ભગવાનના સ્મરણ અને અંતરના સંતોષથી આવે છે.',
    happy: 'આનંદ કૃતજ્ઞતાથી ભગવાનને અર્પણ થાય ત્યારે ભક્તિ બને છે.',
    lazy: 'નિયમ, પુરુષાર્થ અને ધ્યેયના સ્મરણથી આધ્યાત્મિક ઊર્જા વધે છે.',
  },
};

function localMoodAnswer(mood, matches, lang) {
  const theme = (MOOD_THEMES[lang] && MOOD_THEMES[lang][mood]) || MOOD_THEMES.en[mood] || MOOD_THEMES.en.peaceful;
  const points = matches.slice(0, 4).map((d) => {
    const field = lang === 'gu' && d.gu && d.gu.text ? d.gu : d.en;
    const core = lang === 'gu'
      ? gujaratiTeachingExcerpt(field.text, 700)
      : teachingExcerpt(field.text, 700);
    return `${takeSentences(core, 1, lang === 'gu' ? 260 : 240, lang)} (${friendlyRef(d.reference)})`;
  });
  if (lang === 'hi') {
    return [theme, ...points, 'इन वचनों के साथ धीरे-धीरे मन को भगवान की ओर वापस लाएं।'].join('\n\n');
  }
  if (lang === 'gu') {
    return [theme, ...points, 'આ વચનો સાથે ધીમે ધીમે મનને ભગવાન તરફ પાછું વાળો.'].join('\n\n');
  }
  return [theme, ...points, 'Let these teachings gently turn the mind back toward God, one steady step at a time.'].join('\n\n');
}

function getMoodAnswer(mood, lang, matches) {
  const stored = precomputedMoodSummaries[mood] && precomputedMoodSummaries[mood][lang];
  return stored || localMoodAnswer(mood, matches, lang);
}

// Graceful fallback for free-form questions when the LLM is unavailable —
// stitches the most relevant discourse excerpts into a readable, cited answer.
function localQuestionAnswer(matches, lang) {
  const intro = lang === 'hi'
    ? 'इस विषय पर वचनामृत के सबसे प्रासंगिक उपदेश ये हैं:'
    : lang === 'gu'
      ? 'આ વિષય પર વચનામૃતના સૌથી સંબંધિત ઉપદેશ આ રહ્યા:'
      : 'Here are the most relevant teachings from the Vachanamrut on this:';
  const points = matches.slice(0, 4).map((d) => {
    const field = lang === 'gu' && d.gu && d.gu.text ? d.gu : d.en;
    const core = lang === 'gu' ? gujaratiTeachingExcerpt(field.text, 700) : teachingExcerpt(field.text, 700);
    return `${takeSentences(core, 2, lang === 'gu' ? 320 : 300, lang)} (${friendlyRef(d.reference)})`;
  });
  return [intro, ...points].join('\n\n');
}

// Parse time-of-day / weather / moon phase from a discourse opening (English text)
function parseAmbience(text) {
  const t = (text || '').slice(0, 600).toLowerCase();
  let time = 'afternoon';
  if (/\bon the night\b|\bat night\b|\bnight of\b|after sunset|after dark|nightfall|hours after sunset/.test(t)) time = 'night';
  else if (/brahma muh[uū]rta|before sunrise|predawn|pre-dawn/.test(t)) time = 'morning';
  else if (/in the morning|early morning|at dawn|morning of|at sunrise/.test(t)) time = 'morning';
  else if (/in the evening|at dusk|evening of|at sunset|time of evening prayers/.test(t)) time = 'evening';
  else if (/at noon|midday|afternoon/.test(t)) time = 'noon';
  let weather = 'clear';
  if (/āshādh|ashadh|shrāvan|shravan|shraavan|bhādrapad|bhadrapad/.test(t)) weather = 'monsoon';
  else if (/māgsar|magsar|posh|māgh|magh/.test(t)) weather = 'winter';
  else if (/vaisākh|vaishakh|jeth/.test(t)) weather = 'summer';
  let moonPhase = 'quarter';
  const sudiM = t.match(/sudi\s*(\d+)/), vadiM = t.match(/vadi\s*(\d+)/);
  if (sudiM) { const d = parseInt(sudiM[1]); moonPhase = d >= 13 ? 'full' : d <= 3 ? 'crescent' : 'quarter'; }
  else if (vadiM) { const d = parseInt(vadiM[1]); moonPhase = d >= 12 ? 'new' : 'quarter'; }
  return { time, weather, moonPhase };
}

// ── endpoints ────────────────────────────────────────────────────────────────

// GET /api/daily — deterministic discourse of the day (same for everyone, changes daily)
app.get('/api/daily', (req, res) => {
  const lang = req.query.lang === 'gu' ? 'gu' : req.query.lang === 'hi' ? 'hi' : 'en';
  // IST day index (UTC+5:30) — verse changes at midnight India time
  const dayNumber = Math.floor((Date.now() + 19800000) / 86400000);
  const d = corpus[dayNumber % corpus.length];
  const field = getDiscourseField(d, lang);
  res.json({
    reference: d.reference,
    friendlyRef: friendlyRef(d.reference),
    title: field.title || d.reference,
    excerpt: lang === 'en' ? dailyQuote(d.en.text) : simpleExcerpt(field.text || d.en.text, 300),
  });
});

// GET /api/random — a random discourse
app.get('/api/random', (req, res) => {
  const d = corpus[Math.floor(Math.random() * corpus.length)];
  res.json({ reference: d.reference });
});

// GET /api/maharaj-question — a Q&A pair from the Vachanamrut, changes daily
const _maharajQuestions = (() => {
  const out = [];
  for (let i = 1; i < corpus.length; i++) {
    const d = corpus[i];
    const text = d.en.text;
    const sentences = (text.match(/[^.!?\n]+[?]+/g) || []);
    for (const s of sentences) {
      const q = s.trim().replace(/^[\s\d””„‟”']+/, '').trim();
      if (q.length < 40 || q.length > 300) continue;
      const idx = text.indexOf(s);
      if (idx < 150) continue;
      const after = text.slice(idx + s.length);
      const mm = after.slice(0, 300).match(/Shriji\s+Mah[aã]r[aã]j\s+(?:replied|said|explained|answered|clarified|continued|stated)/i);
      if (!mm) continue;
      let speech = after.slice(mm.index + mm[0].length).replace(/^[\s,]*[“”””]?\s*/, '').replace(/\s+/g, ' ').trim();
      const aSentences = speech.match(/[^.!?]+[.!?]+/g);
      if (!aSentences || aSentences.length < 1) continue;
      let answer = aSentences.slice(0, 3).join('').trim().replace(/^[“”””\s]+/, '').replace(/[“”””]+$/, '').trim();
      if (answer.length > 400) { const cut = answer.slice(0, 400).lastIndexOf('.'); answer = cut > 100 ? answer.slice(0, cut + 1) : answer.slice(0, 400); }
      if (answer.length < 30) continue;
      out.push({ question: q, answer, reference: d.reference, friendlyRef: friendlyRef(d.reference), title: d.en.title });
    }
  }
  return out;
})();

app.get('/api/maharaj-question', (req, res) => {
  if (!_maharajQuestions.length) return res.json(null);
  const dayNumber = Math.floor((Date.now() + 19800000) / 86400000);
  res.json(_maharajQuestions[dayNumber % _maharajQuestions.length]);
});

app.get('/api/maharaj-questions', (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const start = (page - 1) * limit;
  const items = _maharajQuestions.slice(start, start + limit);
  res.json({ items, total: _maharajQuestions.length, page, pages: Math.ceil(_maharajQuestions.length / limit) });
});

// GET /api/mood/:mood — return top discourse cards for a mood (no AI call)
app.get('/api/mood/:mood', (req, res) => {
  const mood = req.params.mood.toLowerCase();
  const lang = req.query.lang === 'gu' ? 'gu' : req.query.lang === 'hi' ? 'hi' : 'en';
  const keywords = MOOD_KEYWORDS[mood];
  if (!keywords) return res.status(404).json({ error: 'Unknown mood' });

  // Mood keywords are English — always score against the English field,
  // then render in the requested display language.
  const results = topMatches(keywords, 'en', 6);
  res.json(results.map(d => {
    const field = getDiscourseField(d, lang);
    return {
      reference: d.reference,
      friendlyRef: friendlyRef(d.reference),
      title: field.title || d.en.title,
      excerpt: lang === 'hi' ? field.text.slice(0, 300) : teachingExcerpt(field.text, 300),
      ambience: parseAmbience(d.en.text),
    };
  }));
});

// GET /api/section/:code — list all discourses in a section
app.get('/api/section/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const lang = req.query.lang === 'gu' ? 'gu' : req.query.lang === 'hi' ? 'hi' : 'en';
  const results = corpus
    .filter(d => d.reference.toUpperCase().startsWith(code + '-'))
    .map(d => {
      const field = getDiscourseField(d, lang);
      return {
        reference: d.reference,
        friendlyRef: friendlyRef(d.reference),
        title: field.title || d.en.title,
      };
    });
  if (!results.length) return res.status(404).json({ error: `Section "${req.params.code}" not found` });
  res.json(results);
});

// GET /api/discourse/:ref
app.get('/api/discourse/:ref', (req, res) => {
  const key = req.params.ref.toUpperCase();
  const d = byRef[key];
  if (!d) return res.status(404).json({ error: `Discourse "${req.params.ref}" not found` });
  const resp = { ...d };
  if (hindiDiscourses[d.reference]) {
    resp.hi = {
      title: hindiDiscourses[d.reference].title,
      text: hindiDiscourses[d.reference].text,
      friendlyRef: friendlyRef(d.reference),
    };
  }
  res.json(resp);
});

// GET /api/summary/:ref — plain-language summary of a discourse (precomputed)
app.get('/api/summary/:ref', (req, res) => {
  const key = req.params.ref.toUpperCase();
  const lang = req.query.lang === 'gu' ? 'gu' : req.query.lang === 'hi' ? 'hi' : 'en';
  const d = byRef[key];
  if (!d) return res.status(404).json({ error: 'Discourse not found' });

  res.json({
    summary: getDiscourseSummary(d, lang),
    cached: true,
    source: precomputedSummaries[d.reference] && precomputedSummaries[d.reference][lang] ? 'precomputed' : 'local',
  });
});

// GET /api/search?q=&lang=en
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').trim();
  const lang = req.query.lang === 'gu' ? 'gu' : req.query.lang === 'hi' ? 'hi' : 'en';
  if (!q) return res.json([]);
  const searchLang = lang === 'hi' ? 'en' : lang;
  const results = topMatches(expandQuery(q), searchLang);
  res.json(results.map(d => {
    const field = getDiscourseField(d, lang);
    return {
      reference: d.reference,
      friendlyRef: friendlyRef(d.reference),
      title: field.title || d.en.title,
      snippet: lang === 'hi' ? field.text.slice(0, 300) : teachingExcerpt(field.text, 300),
    };
  }));
});

// Topic answers (pre-generated, zero runtime tokens)
app.get('/api/topic-answers', (req, res) => {
  res.json(topicAnswers);
});

// Mood → search keywords mapping
const MOOD_KEYWORDS = {
  sad:       'sorrow grief consolation hope strength overcome sadness',
  anxious:   'anxiety worry mind peace calm fearlessness equanimity',
  angry:     'anger patience equanimity peace mind control jealousy',
  lonely:    'loneliness fellowship satsang companion God devotee',
  fearful:   'fear courage protection refuge faith God strength',
  confused:  'wisdom understanding clarity discernment gnana doubt intellect',
  depressed: 'despair hope liberation joy courage uplift faith perseverance',
  peaceful:  'peace meditation devotion bliss contentment God form',
  happy:     'joy gratitude devotion bhakti celebration God glory',
  lazy:      'effort discipline spiritual practice dedication perseverance',
};

// Expand common secular / misspelled query terms into Vachanamrut corpus terms.
// This bridges the gap between how users phrase questions and how the corpus is written.
// Covers English, Hindi (always searches EN corpus), and Gujarati (searches GU corpus
// but scorer also weights the EN field so English expansion terms still land hits).
const QUERY_EXPANSIONS = {
  // ── English ───────────────────────────────────────────────────────────────
  lazy:           'tamas indolence diligence exertion endeavor neglect idle effort',
  laziness:       'tamas indolence diligence exertion endeavor neglect idle effort',
  lazyness:       'tamas indolence diligence exertion endeavor neglect idle effort',
  sloth:          'tamas indolence diligence exertion neglect idle effort',
  procrastinate:  'indolence diligence neglect idle effort discipline',
  overcome:       'conquer attain control discipline perseverance effort mind',
  overcoming:     'conquer attain control discipline perseverance effort',
  conquer:        'conquer control discipline effort perseverance mind',
  achieve:        'attain liberation goal effort fulfillment devotion',
  achieving:      'attain liberation goal effort',
  success:        'liberation devotion bhakti goal effort',
  goal:           'liberation moksha devotion effort',
  want:           'desire attachment wish longing',
  wanting:        'desire attachment wish longing',
  addiction:      'desire attachment senses control mind renunciation vairagya',
  addictions:     'desire attachment senses control mind renunciation vairagya',
  habit:          'mind control senses discipline renunciation attachment',
  habits:         'mind control senses discipline renunciation attachment',
  anger:          'anger patience equanimity mind control',
  angry:          'anger patience equanimity mind',
  fear:           'fear courage faith God protection',
  afraid:         'fear courage faith God protection',
  worry:          'anxiety mind peace equanimity',
  worried:        'anxiety mind peace equanimity',
  stress:         'anxiety mind peace equanimity calm',
  sad:            'sorrow grief consolation hope satsang',
  sadness:        'sorrow grief consolation hope',
  depressed:      'despair hope faith perseverance courage',
  depression:     'despair hope faith perseverance',
  lonely:         'loneliness satsang devotee companion',
  loneliness:     'loneliness fellowship satsang companion',
  mind:           'mind control thoughts meditation God',
  thoughts:       'mind thoughts meditation equanimity',
  focus:          'mind concentration meditation devotion',
  happy:          'joy bliss devotion contentment God',
  happiness:      'joy bliss devotion contentment',
  peace:          'peace equanimity devotion mind God',
  god:            'God Parabrahman devotion bhakti form',
  soul:           'jiva soul divine Brahman nature',
  devotion:       'devotion bhakti God ekantik',
  life:           'soul liberation spiritual existence',
  purpose:        'liberation devotion God soul goal',
  meaning:        'liberation devotion God soul purpose',

  // ── Hindi → English corpus terms ─────────────────────────────────────────
  // Hindi always searches the English corpus (searchLang = 'en'), so expansions
  // must be English words that appear in the corpus.
  'आलस':         'tamas indolence diligence exertion endeavor neglect idle effort',
  'आलसी':        'tamas indolence diligence exertion neglect idle effort',
  'क्रोध':      'anger patience equanimity mind control',
  'गुस्सा':    'anger patience equanimity mind',
  'भय':           'fear courage faith God protection',
  'डर':           'fear courage faith God protection',
  'दुख':         'sorrow grief consolation hope strength',
  'उदास':   'sorrow grief consolation hope',
  'चिंता':     'anxiety worry peace mind equanimity',
  'अकेला':     'loneliness satsang devotee companion fellowship',
  'अकेलापन': 'loneliness fellowship satsang companion',
  'मन':           'mind control thoughts meditation equanimity',
  'सुख':         'joy happiness peace devotion contentment God',
  'इच्छा':     'desire wish longing attachment',
  'लक्ष्य':      'goal liberation devotion effort',
  'उद्देश्य':  'goal purpose liberation devotion',
  'सफलता':     'liberation devotion goal effort',
  'जीवन':   'life soul liberation devotion spiritual',
  'भक्ति':     'devotion bhakti God form ekantik',
  'मोक्ष':     'liberation soul moksha God',
  'छुटकारा':  'liberation freedom relief effort perseverance',
  'ध्यान':     'meditation mind focus devotion God',
  'प्राप्त':    'attain liberation goal devotion',
  'निराश':     'despair hope faith courage perseverance',
  'हासिल':     'attain liberation goal effort',
  'पाना':   'attain liberation goal devotion',
  'शांति':     'peace equanimity devotion mind God',
  'खुशी':   'joy happiness peace devotion contentment',
  'आत्मा':     'jiva soul divine Brahman nature',
  'भगवान':     'God Parabrahman devotion bhakti form',
  'सत्संग':    'satsang fellowship devotee companion God',
  'त्याग':     'renunciation vairagya devotion liberation',
  'संयम':   'control mind equanimity discipline devotion',

  // ── Gujarati → English corpus terms ──────────────────────────────────────
  // Gujarati searches the GU corpus but the scorer also weights EN matches,
  // so English expansion terms land hits even for Gujarati queries.
  'આળસ':        'tamas indolence diligence exertion endeavor neglect idle effort',
  'આળસુ':       'tamas indolence diligence exertion neglect idle effort',
  'ક્રોધ':    'anger patience equanimity mind control',
  'ભય':          'fear courage faith God protection',
  'દુઃખ':  'sorrow grief consolation hope strength',
  'ઉદાસ':  'sorrow grief consolation hope',
  'ચિંતા':   'anxiety worry peace mind equanimity',
  'એકલા':  'loneliness satsang devotee companion',
  'એકલાપણું': 'loneliness fellowship satsang companion',
  'મન':          'mind control thoughts meditation equanimity',
  'સુખ':        'joy happiness peace devotion contentment',
  'ઇચ્છા':   'desire wish longing attachment',
  'ધ્યેય':   'goal liberation devotion effort',
  'સફળ':        'liberation devotion goal effort',
  'જીવન':  'life soul liberation devotion spiritual',
  'ભક્તિ':   'devotion bhakti God form ekantik',
  'મોક્ષ':   'liberation soul moksha God',
  'ધ્યાન':   'meditation mind focus devotion',
  'શાંતિ':   'peace equanimity devotion mind God',
  'ખુશ':        'joy happiness peace devotion contentment',
  'આત્મા':   'jiva soul divine Brahman nature',
  'ભગવાન':   'God Parabrahman devotion bhakti form',
  'સત્સંગ':  'satsang fellowship devotee companion God',
  'ત્યાગ':   'renunciation vairagya devotion liberation',
  'સંયમ':  'control mind equanimity discipline devotion',
};

// Augment a free-form question with Vachanamrut-relevant corpus terms.
function expandQuery(q) {
  const tokens = tokenise(q);
  const extra = [];
  for (const tok of tokens) {
    const expansion = QUERY_EXPANSIONS[tok];
    if (expansion) extra.push(expansion);
  }
  return extra.length ? `${q} ${extra.join(' ')}` : q;
}

// POST /api/ask
app.post('/api/ask', async (req, res) => {
  const { question, lang, mood } = req.body;
  if (!question && !mood) return res.status(400).json({ error: 'question or mood is required' });

  const language = lang === 'gu' ? 'gu' : lang === 'hi' ? 'hi' : 'en';

  // Mood-only: search on mood keywords. Free-form: expand query to corpus terms.
  const searchQuery = !question && mood
    ? MOOD_KEYWORDS[mood] || mood
    : mood && MOOD_KEYWORDS[mood]
      ? `${expandQuery(question)} ${MOOD_KEYWORDS[mood]}`
      : expandQuery(question);

  // Preset check first — Hindi questions can't score against the English corpus,
  // so we must check presets before the matches.length===0 early-return.
  if (question && !mood) {
    const preset = presetAnswers[`${language}|${normQ(question)}`];
    if (preset && preset.answer) {
      return res.json({ answer: preset.answer, citations: preset.citations || [], cached: true });
    }
  }

  // Mood keywords and Hindi corpus are English → always score English field.
  const searchLang = (mood || language === 'hi') ? 'en' : language;
  const matches = topMatches(searchQuery, searchLang);

  const OFF_TOPIC_MSG = language === 'gu'
    ? 'હું ફક્ત ભગવાન સ્વામિનારાયણના વચનામૃતના ઉપદેશો વિશે જ પ્રશ્નોના ઉત્તર આપી શકું છું. સત્સંગ, મન, ભક્તિ, માયા, અથવા દૈનિક જીવન વિશે પૂછવાનો પ્રયાસ કરો.'
    : language === 'hi'
      ? 'मैं केवल भगवान स्वामिनारायण के वचनामृत की शिक्षाओं के बारे में प्रश्नों का उत्तर दे सकता हूँ। सत्संग, मन, भक्ति, माया, या दैनिक जीवन के बारे में पूछने का प्रयास करें।'
      : 'I can only answer questions about Bhagwan Swaminarayan\'s teachings in the Vachanamrut. Try asking about satsang, the mind, devotion, maya, or daily living.';

  if (matches.length === 0) {
    return res.json({ answer: OFF_TOPIC_MSG, citations: [], refused: true });
  }

  // Low relevance gate — if keyword overlap is very weak, the question is
  // likely off-topic (e.g. "weather", "cricket", "write me a poem about cars").
  if (question && !mood && matches._topScore < 4 && matches._avgScore < 2.5) {
    return res.json({ answer: OFF_TOPIC_MSG, citations: [], refused: true });
  }

  if (mood && !question) {
    return res.json({
      answer: getMoodAnswer(mood, language, matches),
      citations: citationList(matches, language),
      cached: true,
    });
  }

  const contextBlocks = matches.map(d => {
    const field = d.en;
    return `[${friendlyRef(d.reference)}]\n${field.title}\n${field.text.slice(0, 1200)}`;
  }).join('\n\n---\n\n');

  const langInstruction = language === 'hi' ? 'Answer in Hindi (हिंदी में उत्तर दें).'
    : language === 'gu' ? 'Answer in Gujarati.'
    : 'Answer in English.';

  const systemPrompt = mood
    ? `You are a compassionate guide well-versed in the Vachanamrut. ` +
      `The person is currently feeling ${mood}. ` +
      `Using ONLY the provided discourse excerpts, respond with warmth and empathy. ` +
      `Acknowledge their feeling briefly, then share 2-3 specific teachings from the excerpts that speak directly to this state. ` +
      `Close with a short uplifting message grounded in the teachings. ` +
      `Always cite the specific reference (e.g. Gadhada I-27) for every point. ` +
      `${langInstruction} Keep your response focused and comforting, not academic.`
    : `You are a warm and wise Vachanamrut scholar helping a sincere seeker. ` +
      `Answer the question using ONLY the provided discourse excerpts. ` +
      `IMPORTANT: If the question has NO genuine connection to spirituality, devotion, philosophy, ethics, daily living, ` +
      `or any topic Bhagwan Swaminarayan addresses in the Vachanamrut, you MUST refuse politely. ` +
      `Do NOT force-fit unrelated questions to scripture. For off-topic questions (sports, weather, entertainment, technology, ` +
      `politics, recipes, etc.), respond ONLY with: "I can only answer questions about Bhagwan Swaminarayan's teachings in the Vachanamrut. ` +
      `Try asking about satsang, the mind, devotion, maya, or daily living." ` +
      `If the question uses modern or secular language but relates to a genuine human struggle (e.g. "how to get rid of laziness", ` +
      `"how to deal with anger"), interpret it through Bhagwan Swaminarayan's spiritual lens. ` +
      `Draw directly from the excerpts. Always cite the specific reference (e.g. Gadhada I-27) for each point. ` +
      `${langInstruction} Be warm, practical and reverent. Write 150-250 words.`;

  const userMessage = `Question: ${question}\n\nRelevant Vachanamrut excerpts:\n\n${contextBlocks}`;

  const citations = citationList(matches, language);

  // 1) No Gemini key → degrade gracefully to a local cited answer
  if (!GEMINI_KEY) {
    return res.json({ answer: localQuestionAnswer(matches, language), citations, fallback: true });
  }

  // 3) Custom question → cheap Gemini Flash-Lite at runtime (one retry on rate-limit)
  const callGemini = () => getGenAI().models.generateContent({
    model: GEMINI_MODEL,
    contents: userMessage,
    config: { systemInstruction: systemPrompt, maxOutputTokens: 1024, temperature: 0.4, thinkingConfig: { thinkingBudget: 0 } },
  });

  try {
    let r;
    try {
      r = await callGemini();
    } catch (firstErr) {
      const status = firstErr.status || firstErr.code;
      if (status === 429 || status === 503) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        r = await callGemini();
      } else {
        throw firstErr;
      }
    }
    const answer = (r.text || '').trim();
    if (!answer) throw new Error('empty answer');
    logQuestion({ question, mood, language, answer, citations, fallback: false });
    res.json({ answer, citations });
  } catch (err) {
    console.error('Gemini API error:', err.message);
    const fallbackAnswer = localQuestionAnswer(matches, language);
    logQuestion({ question, mood, language, answer: fallbackAnswer, citations, fallback: true });
    res.json({ answer: fallbackAnswer, citations, fallback: true });
  }
});

// Fallback — serve index.html for any unknown route
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ShriHari Vani server running on http://localhost:${PORT}`);
});

module.exports = app;
