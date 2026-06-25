#!/usr/bin/env node
/**
 * Build static, token-free summaries for:
 *   - summaries.json       -> one simple summary per discourse (en + gu)
 *   - mood_summaries.json  -> one mood teaching per mood (en + gu)
 *
 * This is intentionally local and deterministic. It does not call Groq or any
 * other model, so it can be re-run without rate limits or token cost.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const corpus = require(path.join(ROOT, 'vachanamrut_corpus.json'));

const SUMMARIES_PATH = path.join(ROOT, 'summaries.json');
const MOODS_PATH = path.join(ROOT, 'mood_summaries.json');

const SECTION_LABELS = {
  GI: 'Gadhada I',
  SAR: 'Sarangpur',
  KAR: 'Kariyani',
  LOY: 'Loya',
  PAN: 'Panchala',
  GII: 'Gadhada II',
  VAR: 'Vartal',
  AMD: 'Amdavad',
  GIII: 'Gadhada III',
  JET: 'Jetalpur',
};

const MOOD_KEYWORDS = {
  sad: 'sorrow grief consolation hope strength overcome sadness',
  anxious: 'anxiety worry mind peace calm fearlessness equanimity',
  angry: 'anger patience equanimity peace mind control jealousy',
  lonely: 'loneliness fellowship satsang companion God devotee',
  fearful: 'fear courage protection refuge faith God strength',
  confused: 'wisdom understanding clarity discernment gnana doubt intellect',
  depressed: 'despair hope liberation joy courage uplift faith perseverance',
  peaceful: 'peace meditation devotion bliss contentment God form',
  happy: 'joy gratitude devotion bhakti celebration God glory',
  lazy: 'effort discipline spiritual practice dedication perseverance',
};

const MOOD_THEMES = {
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

const MOOD_OVERRIDES = {
  en: {
    depressed:
      'Cultivating unwavering faith in God as the spiritual antidote to depression.\n\n' +
      'Bhagwan Swaminarayan teaches that a devotee with faith in God coupled with the knowledge of His greatness can overcome even unfavourable karmas and kal (Gadhada I-72), and that one should not become elated or disheartened by God’s display of powers, but instead remain steadfast in faith (Gadhada I-63). He also emphasizes the importance of associating with the Sant to develop firm faith in God, which leads to spiritual progress (Vartal 12). Furthermore, Bhagwan Swaminarayan explains that faith in God and faith in dharma are intertwined, and that one can maintain both by understanding that God possesses the 39 redemptive attributes that support all forms of dharma (Gadhada II-16).\n\n' +
      'May the wisdom of Bhagwan Swaminarayan’s teachings bring strength and comfort to those struggling with depression, guiding them towards the path of unwavering faith and spiritual growth.',
  },
};

function friendlyRef(ref) {
  const m = ref.match(/^([A-Z]+)-?(\d+)$/i);
  if (!m) return ref;
  return `${SECTION_LABELS[m[1].toUpperCase()] || m[1]} ${m[2]}`;
}

function stripDiacritics(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function tokenise(text) {
  return stripDiacritics(text).toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function score(discourse, queryTokens) {
  const field = discourse.en;
  const haystack = stripDiacritics(`${field.title} ${field.text}`).toLowerCase();
  let total = 0;
  for (const tok of queryTokens) {
    const matches = haystack.match(new RegExp(tok, 'g'));
    if (matches) total += matches.length;
  }
  return total;
}

function topMatches(query, n = 5) {
  const tokens = tokenise(query);
  return corpus
    .map(d => ({ d, score: score(d, tokens) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map(x => x.d);
}

function cleanText(text) {
  return (text || '').replace(/\s+/g, ' ').replace(/^\d+\s+/, '').trim();
}

function teachingExcerpt(text, maxLen = 1000) {
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
  const transition = text.match(/(?:gathered|seated|present)\s+before\s+[Hh]im[.,]\s*([\s\S]+)/);
  if (transition && transition.index < 700) {
    const after = transition[1].replace(/^\d+\s+/, '').trimStart();
    if (after.length > 50) return focusEnglishTeaching(after).slice(0, maxLen);
  }
  const numbered = text.match(/(?:^|\n)\s*1\s+([A-Z"'""“‘])/m);
  if (numbered && numbered.index < 900) {
    return text.slice(numbered.index).replace(/^\s*1\s+/, '').trimStart().slice(0, maxLen);
  }
  const said = text.search(/(?:Shrij|Mahārāj|Swāmi Shri)[^\n]*said/);
  if (said > 0 && said < 700) return text.slice(said).slice(0, maxLen);
  const dot = text.indexOf('. ', 50);
  if (dot > 0 && dot < 350) return text.slice(dot + 2).trimStart().slice(0, maxLen);
  return text.slice(0, maxLen);
}

function gujaratiTeachingExcerpt(text, maxLen = 1100) {
  const markers = ['પછી શ્રીજીમહારાજ', 'ત્યારે શ્રીજીમહારાજ', 'પછી મુક્તાનંદ સ્વામીએ', 'પછી'];
  for (const marker of markers) {
    const idx = (text || '').indexOf(marker);
    if (idx > 80 && idx < 1300) return text.slice(idx, idx + maxLen);
  }
  return cleanText(text).slice(0, maxLen);
}

function isIntroSentence(sentence, lang) {
  if (lang === 'gu') {
    return /પ્રશ્ન પૂછ|ઉત્તર કર્યો|થયો નહીં|લ્યો, અમે ઉત્તર કરીએ|પૂછ્યું જે/.test(sentence);
  }
  return /\?|asked|raised a question|answered according|satisfactory reply|allow me to answer|please describe/i.test(sentence);
}

function takeSentences(text, count = 3, maxLen = 700, lang = 'en') {
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

function discourseSummary(d, lang) {
  const field = lang === 'gu' && d.gu && d.gu.text ? d.gu : d.en;
  const core = lang === 'gu'
    ? gujaratiTeachingExcerpt(field.text, 1200)
    : teachingExcerpt(field.text, 1200);
  return takeSentences(core, 3, lang === 'gu' ? 760 : 700, lang);
}

function moodAnswer(mood, matches, lang) {
  if (MOOD_OVERRIDES[lang] && MOOD_OVERRIDES[lang][mood]) return MOOD_OVERRIDES[lang][mood];
  const theme = MOOD_THEMES[lang][mood];
  const points = matches.slice(0, 4).map(d => {
    const field = lang === 'gu' && d.gu && d.gu.text ? d.gu : d.en;
    const core = lang === 'gu'
      ? gujaratiTeachingExcerpt(field.text, 700)
      : teachingExcerpt(field.text, 700);
    return `${takeSentences(core, 1, lang === 'gu' ? 260 : 240, lang)} (${friendlyRef(d.reference)})`;
  });
  const closing = lang === 'gu'
    ? 'આ વચનો સાથે ધીમે ધીમે મનને ભગવાન તરફ પાછું વાળો.'
    : 'Let these teachings gently turn the mind back toward God, one steady step at a time.';
  return [theme, ...points, closing].join('\n\n');
}

function buildSummaries() {
  const summaries = {};
  for (const d of corpus) {
    summaries[d.reference] = {
      en: discourseSummary(d, 'en'),
      gu: discourseSummary(d, 'gu'),
    };
  }
  return summaries;
}

function buildMoodSummaries() {
  const moods = {};
  for (const mood of Object.keys(MOOD_KEYWORDS)) {
    const matches = topMatches(MOOD_KEYWORDS[mood], 5);
    moods[mood] = {
      citations: matches.map(d => ({
        reference: d.reference,
        friendlyRef: friendlyRef(d.reference),
        title: d.en.title,
      })),
      en: moodAnswer(mood, matches, 'en'),
      gu: moodAnswer(mood, matches, 'gu'),
    };
  }
  return moods;
}

fs.writeFileSync(SUMMARIES_PATH, `${JSON.stringify(buildSummaries(), null, 2)}\n`);
fs.writeFileSync(MOODS_PATH, `${JSON.stringify(buildMoodSummaries(), null, 2)}\n`);

console.log(`Wrote ${SUMMARIES_PATH}`);
console.log(`Wrote ${MOODS_PATH}`);
