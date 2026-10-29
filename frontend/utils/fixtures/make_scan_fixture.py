#!/usr/bin/env python3
"""
Builds the synthetic SCANNED legal template used by scanTemplate.test.ts.

It is a fictional 3-page Hindi bail application (court heading, party block, bold + underlined headings,
numbered paragraphs with (क)(ख) sub-paragraphs, a ruled table, a prayer, signature block, verification
and annexure list). Chrome renders the pages (so Devanagari is shaped correctly), then PIL turns them into
grayscale scans. Ground truth (line boxes + styles) is measured from the DOM, so tests can check the
pixel analysis against what was really drawn.

Usage:  python3 make_scan_fixture.py          (needs Google Chrome on macOS and Pillow)
Writes: scan-template-p1.png .. p3.png (clean), scan-template-skewed-p1.jpg (1.4deg + noise), scan-template-gt.json
"""
import html, json, os, random, subprocess, sys
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
SCALE = 1240 / 794  # 150 dpi A4
W, H = 794, 1123
LM, RM, TM = 80, 80, 90
FONT = "'Kohinoor Devanagari','Devanagari Sangam MN',sans-serif"

# (kind, text, align, left_px, bold, underline, gap_before_px, para_start)
P1 = [
    ('court_heading', 'न्यायालय श्रीमान् सत्र न्यायाधीश महोदय, जिला रायगढ़ (छ.ग.)', 'center', 0, True, False, 0, True),
    ('other', 'जमानत आवेदन क्रमांक ........ /2025', 'right', 0, False, False, 14, True),
    ('party', 'रमेश कुमार पटेल पिता स्व. श्री गोपाल पटेल, उम्र 34 वर्ष,', 'left', 0, False, False, 18, True),
    ('party', 'निवासी ग्राम सरिया, जिला रायगढ़ (छ.ग.)  ........ आवेदक/अभियुक्त', 'left', 0, False, False, 0, False),
    ('other', 'विरुद्ध', 'center', 0, False, False, 10, True),
    ('party', 'छत्तीसगढ़ राज्य द्वारा थाना प्रभारी सरिया  ........ अनावेदक', 'left', 0, False, False, 10, True),
    ('title', 'आवेदन पत्र अंतर्गत धारा 483 बीएनएसएस, 2023 नियमित जमानत हेतु', 'center', 0, True, True, 22, True),
    ('para', 'अपराध क्रमांक 145/2025, थाना सरिया, धारा 305(a), 331(4) भारतीय न्याय संहिता', 'left', 0, False, False, 14, True),
    ('para', 'माननीय महोदय,', 'left', 0, False, False, 14, True),
    ('para', 'आवेदक की ओर से निवेदन है कि –', 'left', 0, False, False, 4, True),
    ('numbered', '1.   यह कि, आवेदक को पुलिस थाना सरिया द्वारा दिनांक 14/03/2025 को', 'left', 0, False, False, 14, True),
    ('numbered', 'गिरफ्तार किया गया है तथा तब से वह न्यायिक अभिरक्षा में निरुद्ध है।', 'left', 46, False, False, 0, False),
    ('numbered', '2.   यह कि, आवेदक के विरुद्ध झूठा प्रकरण दर्ज किया गया है, जबकि उसका', 'left', 0, False, False, 12, True),
    ('numbered', 'घटना से कोई संबंध नहीं है। प्रथम सूचना रिपोर्ट में आवेदक का नाम विलंब से', 'left', 46, False, False, 0, False),
    ('numbered', 'जोड़ा गया है और अन्य कोई स्वतंत्र साक्षी नहीं है।', 'left', 46, False, False, 0, False),
    ('subpara', '(क)  आवेदक का कोई पूर्व आपराधिक इतिहास नहीं है।', 'left', 46, False, False, 8, True),
    ('subpara', '(ख)  आवेदक स्थायी निवासी है और फरार होने की कोई संभावना नहीं है।', 'left', 46, False, False, 6, True),
]
P2 = [
    ('numbered', '3.   यह कि, प्रकरण का अन्वेषण पूर्ण हो चुका है एवं आवेदक से कोई जप्ती शेष', 'left', 0, False, False, 0, True),
    ('numbered', 'नहीं है। आवेदक को अभिरक्षा में रखने से अभियोजन को कोई लाभ नहीं होगा।', 'left', 46, False, False, 0, False),
    ('numbered', '4.   यह कि, आवेदक पर परिवार के पालन-पोषण का दायित्व है। उसके वृद्ध माता-', 'left', 0, False, False, 12, True),
    ('numbered', 'पिता एवं दो अवयस्क बच्चे उसी पर आश्रित हैं तथा आवेदक की अनुपस्थिति में', 'left', 46, False, False, 0, False),
    ('numbered', 'परिवार को आर्थिक संकट का सामना करना पड़ रहा है।', 'left', 46, False, False, 0, False),
    ('heading', 'सह-अभियुक्तगण का विवरण', 'center', 0, True, True, 22, True),
    ('table', 'TABLE', 'left', 0, False, False, 12, True),
    ('numbered', '5.   यह कि, माननीय उच्च न्यायालय एवं माननीय सर्वोच्च न्यायालय द्वारा समय-समय पर', 'left', 0, False, False, 18, True),
    ('numbered', 'यह सिद्धांत प्रतिपादित किया गया है कि जमानत नियम है और जेल अपवाद है।', 'left', 46, False, False, 0, False),
]
P3 = [
    ('heading', 'प्रार्थना', 'center', 0, True, True, 0, True),
    ('para', 'अतः माननीय न्यायालय से विनम्र प्रार्थना है कि आवेदक को नियमित जमानत पर', 'left', 0, False, False, 14, True),
    ('para', 'मुक्त करने का आदेश देने की कृपा करें।', 'left', 0, False, False, 0, False),
    ('signature', 'आवेदक', 'right', 0, False, False, 28, True),
    ('signature', 'द्वारा अधिवक्ता', 'right', 0, False, False, 0, True),
    ('other', 'स्थान :- रायगढ़', 'left', 0, False, False, 14, True),
    ('other', 'दिनांक :- 20/03/2025', 'left', 0, False, False, 0, True),
    ('verification_heading', 'सत्यापन', 'center', 0, True, True, 30, True),
    ('verification', 'मैं रमेश कुमार पटेल सत्यापित करता हूँ कि उपरोक्त कथन मेरी जानकारी एवं', 'left', 0, False, False, 14, True),
    ('verification', 'विश्वास में सत्य हैं। आज दिनांक 20/03/2025 को रायगढ़ में हस्ताक्षरित।', 'left', 0, False, False, 0, False),
    ('signature', 'आवेदक', 'right', 0, False, False, 20, True),
    ('annexure_heading', 'अनुलग्नक', 'left', 0, True, True, 26, True),
    ('annexure', '1.   प्रथम सूचना रिपोर्ट की प्रति', 'left', 0, False, False, 8, True),
    ('annexure', '2.   आधार कार्ड की प्रति', 'left', 0, False, False, 0, True),
]
TABLE = [['क्र.', 'सह-अभियुक्त का नाम', 'वर्तमान स्थिति'],
         ['1', 'दिनेश कुमार साहू', 'जमानत पर'],
         ['2', 'मोहन लाल निषाद', 'न्यायिक अभिरक्षा']]
LINE_H = 29


def page_html(pno, rows):
    out = []
    for kind, text, align, left, bold, ul, gap, start in rows:
        if kind == 'table':
            out.append(f'<table style="margin:{gap}px 0 0 0;width:{W-LM-RM}px;border-collapse:collapse;font-size:16px" data-k="table">')
            for r in TABLE:
                out.append('<tr>' + ''.join(f'<td style="border:1.5px solid #000;padding:4px 8px;height:30px">{html.escape(c)}</td>' for c in r) + '</tr>')
            out.append('</table>')
            continue
        st = f'margin:{gap}px 0 0 {left}px;text-align:{align};'
        cls = ('b ' if bold else '') + ('u ' if ul else '')
        out.append(f'<div class="ln {cls}" style="{st}" data-k="{kind}" data-start="{int(start)}"><span>{html.escape(text)}</span></div>')
    return f'''<!doctype html><html><head><meta charset="utf-8"><style>
html,body{{margin:0;padding:0;background:#fff}}
.page{{width:{W}px;height:{H}px;box-sizing:border-box;padding:{TM}px {RM}px 0 {LM}px;font:16px/{LINE_H}px {FONT};color:#111}}
.ln{{white-space:pre;height:{LINE_H}px}}
.b{{font-weight:700}}
.u span{{text-decoration:underline;text-decoration-skip-ink:none;text-underline-offset:3px;text-decoration-thickness:1.4px}}
</style></head><body><div class="page" id="pg">{''.join(out)}</div>
<script>
const gt=[];const pg=document.getElementById('pg').getBoundingClientRect();
document.querySelectorAll('.ln').forEach(el=>{{const s=el.querySelector('span').getBoundingClientRect();
gt.push({{page:{pno},kind:el.dataset.k,text:el.innerText,start:el.dataset.start==='1',bold:el.classList.contains('b'),underline:el.classList.contains('u'),align:el.style.textAlign,x:s.left-pg.left,y:s.top-pg.top+3,w:s.width,h:{LINE_H}-6}});}});
document.querySelectorAll('table').forEach(el=>{{const r=el.getBoundingClientRect();gt.push({{page:{pno},kind:'table',text:'',x:r.left-pg.left,y:r.top-pg.top,w:r.width,h:r.height}});}});
const pre=document.createElement('pre');pre.id='gt';pre.textContent=JSON.stringify(gt);document.body.appendChild(pre);
</script></body></html>'''


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, check=False)


def main():
    tmp = os.path.join(HERE, '.tmp'); os.makedirs(tmp, exist_ok=True)
    gt_all = []
    for n, rows in enumerate([P1, P2, P3], start=1):
        f = os.path.join(tmp, f'p{n}.html')
        open(f, 'w', encoding='utf8').write(page_html(n, rows))
        base = [CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files']
        dom = run(base + ['--virtual-time-budget=2000', '--dump-dom', 'file://' + f]).stdout
        a = dom.index('<pre id="gt">') + len('<pre id="gt">'); b = dom.index('</pre>', a)
        gt = json.loads(html.unescape(dom[a:b]))
        png = os.path.join(tmp, f'p{n}.png')
        run(base + [f'--force-device-scale-factor={SCALE}', f'--window-size={W},{H}', f'--screenshot={png}', 'file://' + f])
        img = Image.open(png).convert('L')
        img = img.resize((1240, 1754), Image.LANCZOS)
        img.save(os.path.join(HERE, f'scan-template-p{n}.png'), optimize=True)
        for g in gt:
            for k in ('x', 'y', 'w', 'h'):
                g[k] = round(g[k] * SCALE, 1)
            g['page'] = n
        gt_all += gt
    json.dump({'width': 1240, 'height': 1754, 'lines': gt_all}, open(os.path.join(HERE, 'scan-template-gt.json'), 'w'), ensure_ascii=False, indent=1)
    # a photographed-looking copy of page 1: rotated, noisy, grey paper, JPEG
    random.seed(7)
    base = Image.open(os.path.join(HERE, 'scan-template-p1.png')).convert('L')
    rot = base.rotate(-1.4, resample=Image.BICUBIC, expand=False, fillcolor=235)
    rot = rot.point(lambda v: int(v * 0.93 + 8)).filter(ImageFilter.GaussianBlur(0.6))
    px = rot.load()
    for _ in range(26000):
        x = random.randrange(rot.width); y = random.randrange(rot.height)
        px[x, y] = max(0, px[x, y] - random.randrange(20, 80))
    rot.save(os.path.join(HERE, 'scan-template-skewed-p1.jpg'), quality=72)
    for f in os.listdir(tmp): os.remove(os.path.join(tmp, f))
    os.rmdir(tmp)
    print('lines', len([g for g in gt_all if g['kind'] != 'table']), 'tables', len([g for g in gt_all if g['kind'] == 'table']))


if __name__ == '__main__':
    main()
