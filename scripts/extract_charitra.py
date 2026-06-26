#!/usr/bin/env python3
"""
Extract Sahajanand Charitra text into structured JSON.
29 chapters (Samvat 1858–1886 / 1801–1830 CE), each with titled incidents.
"""
import pdfplumber, re, json

PDF = "/Users/tarun/Downloads/267704941-sahajanandcharitra-eng.pdf"
OUT = "/Users/tarun/ShriHari Vani/charitra_corpus.json"

import re as _re
def _title_case(s):
    """Title-case handling both ASCII and Unicode apostrophes correctly."""
    result = _re.sub(r"[A-Za-z]+(?:['’][A-Za-z]+)?", lambda m: m.group(0).capitalize(), s)
    return result

CE_START     = 1801
SAMVAT_START = 1858

CHAPTER_RE   = re.compile(r'^CHAPTER\s+(\d+)\s*$')
# Match "N. TITLE TEXT" — allow any non-newline chars (handles Unicode quotes, dashes)
INCIDENT_RE  = re.compile(r'^(\d+)\.\s+(.+)$')
# Page headers look like "Title Case Text 42" or "42 Sahajanand Charitra"
PAGE_HDR_A   = re.compile(r'^[A-Z][A-Za-z\s‘’“”,\-\.]+ \d+$')
PAGE_HDR_B   = re.compile(r'^\d+ Sahajanand Charitra\s*$')
SEPARATOR_RE = re.compile(r'^\*+\s*\*+|^[*✦•]+$')

def is_mostly_upper(s):
    letters = [c for c in s if c.isalpha()]
    if len(letters) < 3: return False
    return sum(1 for c in letters if c.isupper()) / len(letters) > 0.75

def extract_pages():
    pages = []
    with pdfplumber.open(PDF) as pdf:
        for i, pg in enumerate(pdf.pages):
            t = pg.extract_text()
            if t:
                pages.append((i + 1, t))
    return pages

def find_chapter_page(pages, ch_num):
    target = f'CHAPTER {ch_num}'
    for page_num, text in pages:
        lines = [l.strip() for l in text.split('\n') if l.strip()]
        for i, line in enumerate(lines):
            if line == target:
                # Look ahead for a numbered incident heading
                for j in range(i + 1, min(i + 5, len(lines))):
                    m = INCIDENT_RE.match(lines[j])
                    if m and is_mostly_upper(m.group(2)):
                        return page_num
    return None

def parse_all(pages):
    page_map = {p: t for p, t in pages}

    # Find start page for each chapter
    chapter_starts = {}
    for ch in range(1, 30):
        p = find_chapter_page(pages, ch)
        chapter_starts[ch] = p
        status = f'page {p}' if p else 'NOT FOUND'
        print(f'  Chapter {ch:2d} → {status}')

    chapters = []
    max_page = max(page_map.keys())

    for ch_num in range(1, 30):
        start_page = chapter_starts.get(ch_num)
        if not start_page:
            continue

        # End just before the next found chapter
        next_start = None
        for n in range(ch_num + 1, 31):
            if chapter_starts.get(n):
                next_start = chapter_starts[n]
                break
        end_page = (next_start - 1) if next_start else max_page

        ce     = CE_START + ch_num - 1
        samvat = SAMVAT_START + ch_num - 1

        chapter = {
            'chapter': ch_num,
            'samvat': samvat,
            'ce': ce,
            'ce_label': f'{ce}–{ce+1} CE',
            'incidents': []
        }

        current_incident = None
        in_chapter = False

        for page_num in range(start_page, end_page + 1):
            if page_num not in page_map:
                continue
            raw_lines = page_map[page_num].split('\n')
            lines = [l.strip() for l in raw_lines]

            for line in lines:
                if not line:
                    continue
                if PAGE_HDR_A.match(line) or PAGE_HDR_B.match(line):
                    continue
                if SEPARATOR_RE.match(line):
                    continue
                if CHAPTER_RE.match(line):
                    continue

                m = INCIDENT_RE.match(line)
                if m and is_mostly_upper(m.group(2)):
                    in_chapter = True
                    current_incident = {
                        'num': int(m.group(1)),
                        'title': _title_case(m.group(2).strip()),
                        'text': ''
                    }
                    chapter['incidents'].append(current_incident)
                    continue

                if not in_chapter:
                    continue

                if current_incident is not None:
                    current_incident['text'] = (current_incident['text'] + ' ' + line).strip()

        # Clean text
        for inc in chapter['incidents']:
            t = inc['text']
            t = re.sub(r'  +', ' ', t)
            t = re.sub(r'(\w)-\s+(\w)', r'\1\2', t)
            inc['text'] = t.strip()

        chapters.append(chapter)
        print(f'  Ch {ch_num:2d} ({ce}–{ce+1} CE): {len(chapter["incidents"])} incidents')

    return chapters

def main():
    print('Extracting pages...')
    pages = extract_pages()
    print(f'  {len(pages)} pages extracted\n')
    print('Finding chapters...')
    chapters = parse_all(pages)

    total = sum(len(ch['incidents']) for ch in chapters)
    print(f'\nTotal: {total} incidents across {len(chapters)} chapters')

    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(chapters, f, ensure_ascii=False, indent=2)
    print(f'Saved → {OUT}')

if __name__ == '__main__':
    main()
