#!/usr/bin/env python3
"""
build_search_index.py — regenerate assets/js/search-index.js

The site is several static HTML pages, so the browser cannot search other pages' DOM.
This tool reads every page's <main> content (plus the C++ files in assets/js/code-data.js)
and writes a flat list of searchable entries that assets/js/search.js loads on demand.

    python3 tools/build_search_index.py

Run it again whenever you edit page content or add a page. It uses only the Python standard
library, plus `node` (to read code-data.js).

Each entry looks like:
    {"p": "cpp", "f": "cpp-revision.html", "ty": "resource", "ti": "Intro",
     "cx": "Videos by Dr. Ibrahim Albluwi", "s": ".chip", "n": 3}
  p/f  page id and file          ty  type (topic, section, lab, exam, text, resource, code-file, code)
  ti   title shown in results    cx  context (the card/step the text belongs to)
  s/n  CSS selector and index: document.querySelectorAll(s)[n] is the element to scroll to
  Code entries instead carry  tab  (and  ln / tx  for a single matching line).
Nothing here edits content — the index only copies text that already exists on the site.
"""
import json
import pathlib
import re
import subprocess
from html.parser import HTMLParser

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGES = [  # (id, file, label) — keep in sync with assets/js/config.js
    ('home', 'index.html', 'Home'), ('cpp', 'cpp-revision.html', 'C++ Revision'),
    ('classes', 'class-basics.html', 'Class Basics'), ('const', 'const-static.html', 'Const & Static'),
    ('composition', 'composition.html', 'Composition'),
    ('dma', 'dynamic-memory.html', 'Dynamic Memory'), ('this', 'this-pointer.html', 'this Pointer'),
    ('friend', 'friend-functions.html', 'Friend Functions'), ('inheritance', 'inheritance.html', 'Inheritance'),
    ('polymorphism', 'polymorphism.html', 'Polymorphism'), ('operators', 'operator-overloading.html', 'Operator Overloading'),
    ('labs', 'labs.html', 'Labs'),
    ('code', 'code-files.html', 'Code Files'), ('quizzes', 'examination-hall.html', 'Examination Hall'),
    ('links', 'all-links.html', 'All Links'),
]

# class name -> (entry type, CSS selector). Elements with these classes are indexed as a whole.
BY_CLASS = {
    'pg-title': ('topic', '.pg-title'), 'pg-by': ('text', '.pg-by'),
    'st-title': ('section', '.st-title'), 'sbox-title': ('section', '.sbox-title'),
    'section-tag': ('section', '.section-tag'), 'lcol-label': ('section', '.lcol-label'),
    's-label': ('section', '.s-label'), 'q-title': ('section', '.q-title'),
    'home-lede': ('text', '.home-lede'), 'how-step': ('text', '.how-step'),
    't-name': ('topic', '.t-name'), 'step-note': ('text', '.step-note'), 'pull': ('text', '.pull'),
    'chip': ('resource', '.chip'), 'vl': ('resource', '.vl'),
}
# <a> inside these containers is a resource link: container class -> selector
LINKS_IN = {'qcard': '.qcard li a', 'lcol': '.lcol li a', 's-links': '.s-links a', 'sbox': '.sbox li a'}
CONTAINERS = {'qcard', 'study-step', 'lcol', 'sbox', 's-sec'}
HEADINGS = {'st-title', 'q-title', 'lcol-label', 'sbox-title', 's-label'}
VOID = {'meta', 'link', 'br', 'img', 'input', 'hr', 'use', 'path', 'circle', 'rect'}


def norm(s):
    """Collapse whitespace."""
    return re.sub(r'\s+', ' ', s).strip()


class PageParser(HTMLParser):
    def __init__(self, page_id, file):
        super().__init__(convert_charrefs=True)
        self.page_id, self.file = page_id, file
        self.stack, self.entries, self.counts = [], [], {}
        self.in_main = False
        self.last_section = ''

    def handle_starttag(self, tag, attrs):
        if tag in VOID:
            return
        classes = set((dict(attrs).get('class') or '').split())
        if tag == 'main':
            self.in_main = True
        self.stack.append({'tag': tag, 'cls': classes, 'buf': [], 'ctx': '', 'num': ''})

    def handle_startendtag(self, tag, attrs):
        pass  # self-closing tags (svg <use/>) hold no text

    def handle_data(self, data):
        for node in self.stack:
            node['buf'].append(data)

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        for i in range(len(self.stack) - 1, -1, -1):  # tolerate sloppy nesting
            if self.stack[i]['tag'] == tag:
                node = self.stack[i]
                ancestors = self.stack[:i]
                del self.stack[i:]
                if self.in_main:
                    self.finish(node, ancestors)
                if tag == 'main':
                    self.in_main = False
                return

    def context_for(self, ancestors):
        """Heading of the closest enclosing card/step (falls back to the last section label)."""
        for a in reversed(ancestors):
            if a['cls'] & CONTAINERS and a['ctx']:
                return a['ctx']
        return self.last_section

    def finish(self, node, ancestors):
        text = norm(''.join(node['buf']))
        cls = node['cls']
        # remember card numbers ("Lab 03 ·") and headings for context
        if 'q-num' in cls:
            for a in reversed(ancestors):
                if a['cls'] & CONTAINERS:
                    a['num'] = text.rstrip(' ·').strip()
                    break
        if cls & HEADINGS:
            for a in reversed(ancestors):
                if a['cls'] & CONTAINERS and not a['ctx']:
                    a['ctx'] = (a['num'] + ' · ' if a['num'] else '') + text
                    break
        if 'section-tag' in cls or 'lcol-label' in cls:
            self.last_section = text
        if not text:
            return

        for c, (ty, sel) in BY_CLASS.items():
            if c in cls:
                if c == 'q-title':
                    ty = 'lab' if self.page_id == 'labs' else 'exam'
                    cx = next((a['num'] for a in reversed(ancestors) if a['cls'] & CONTAINERS), '')
                else:
                    cx = self.context_for(ancestors) if c not in ('pg-title', 't-name') else ''
                self.add(ty, text, cx, sel)
                return
        if node['tag'] == 'a':
            anc_cls = set().union(*[a['cls'] for a in ancestors]) if ancestors else set()
            if 'pull' in anc_cls:
                return
            for c, sel in LINKS_IN.items():
                if c in anc_cls:
                    ty = 'exam' if self.page_id == 'quizzes' else 'resource'
                    self.add(ty, text, self.context_for(ancestors), sel)
                    return

    def add(self, ty, title, cx, sel):
        n = self.counts.get(sel, 0)
        self.counts[sel] = n + 1
        self.entries.append({'p': self.page_id, 'f': self.file, 'ty': ty, 'ti': title, 'cx': cx, 's': sel, 'n': n})


def code_entries():
    """Code files: one entry per file plus one per non-blank source line."""
    js = (ROOT / 'assets/js/code-data.js').read_text(encoding='utf-8')
    script = "const src=require('fs').readFileSync(0,'utf8');" \
             "console.log(JSON.stringify(new Function(src+';return cf;')()))"
    cf = json.loads(subprocess.run(['node', '-e', script], input=js, capture_output=True, text=True, check=True).stdout)
    # tab labels as shown on the page
    html = (ROOT / 'code-files.html').read_text(encoding='utf-8')
    labels = {m.group(1): norm(m.group(2)) for m in re.finditer(r'data-tab="(\w+)"[^>]*>([^<]+)</button>', html)}
    out = []
    for tab, f in cf.items():
        label = labels.get(tab, f['name'])
        out.append({'p': 'code', 'f': 'code-files.html', 'ty': 'code-file', 'ti': label,
                    'cx': f['name'] if f['name'] != label else '', 'tab': tab})
        for i, line in enumerate(f['code'].split('\n'), 1):
            if line.strip():
                out.append({'p': 'code', 'f': 'code-files.html', 'ty': 'code', 'ti': f['name'], 'tab': tab,
                            'ln': i, 'tx': line.rstrip()[:140]})
    return out


def main():
    entries = []
    for pid, fname, _ in PAGES:
        parser = PageParser(pid, fname)
        parser.feed((ROOT / fname).read_text(encoding='utf-8'))
        entries += parser.entries
    entries += code_entries()
    header = ("/**\n * search-index.js — GENERATED by tools/build_search_index.py. Do not edit by hand.\n"
              " * Loaded on demand by search.js the first time the search dialog opens.\n */\n")
    body = 'OOP.searchIndex = [\n' + ',\n'.join(json.dumps(e, ensure_ascii=False) for e in entries) + '\n];\n'
    (ROOT / 'assets/js/search-index.js').write_text(header + body, encoding='utf-8')
    print(f'search-index.js: {len(entries)} entries')


if __name__ == '__main__':
    main()
