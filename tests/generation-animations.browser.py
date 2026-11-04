"""Generation status regressions using the production Molten Forge CSS.

Run: python tests/generation-animations.browser.py (Playwright + Chromium).
The spinner rotates, while the Working/Composing highlight clips only text glyphs.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
STYLES = (ROOT / 'src/styles.css').read_text(encoding='utf-8')

DOCUMENT = '''<!doctype html><html data-theme="dark"><head></head><body>
<strong class="molten-forge-title">Molten Forge</strong>
<div class="generation-status">
  <span class="generating-radix-spinner" role="status" aria-label="Loading">
    ''' + ''.join(f'<span class="generating-radix-spinner-leaf" style="--spinner-index:{i};opacity:{.28+i*.09}"></span>' for i in range(8)) + '''
  </span>
  <span class="generating-gradient-text">
    <span>Composing</span>
    <span class="generation-shimmer-highlight" aria-hidden="true">Composing</span>
  </span>
</div></body></html>'''

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    for theme in ('dark', 'light'):
        for reduced in (False, True):
            page = browser.new_page(reduced_motion='reduce' if reduced else 'no-preference')
            page.set_content(DOCUMENT)
            page.add_style_tag(content=STYLES)
            page.evaluate('(theme) => { document.documentElement.dataset.theme = theme; }', theme)
            result = page.evaluate('''async () => {
                const source = document.querySelector('.generating-gradient-text');
                const base = source.querySelector('span:first-child');
                const overlay = source.querySelector('.generation-shimmer-highlight');
                const shimmer = overlay.getAnimations()[0];
                const samples = [];
                if (shimmer) {
                    shimmer.pause();
                    for (const t of [0, 216, 900, 1584, 1799]) {
                        shimmer.currentTime = t;
                        await new Promise(requestAnimationFrame);
                        samples.push(getComputedStyle(overlay).clipPath);
                    }
                }
                const names = sel => [...document.querySelectorAll(sel)].flatMap(
                    el => el.getAnimations().map(a => a.animationName)
                );
                const prop = (sel, key) => getComputedStyle(document.querySelector(sel)).getPropertyValue(key).trim();
                const width = el => el.getBoundingClientRect().width;
                return {
                    title: names('.molten-forge-title'),
                    titleBackground: prop('.molten-forge-title','background-image'),
                    spinner: names('.generating-radix-spinner'),
                    leaves: names('.generating-radix-spinner-leaf'),
                    text: names('.generating-gradient-text'),
                    overlay: names('.generation-shimmer-highlight'),
                    overlayBackground: prop('.generation-shimmer-highlight','background-image'),
                    overlayFill: prop('.generation-shimmer-highlight','-webkit-text-fill-color'),
                    widths: [width(source), width(base), width(overlay)],
                    samples,
                };
            }''')
            assert result['title'] == [], result
            assert result['spinner'] == ['molten-radix-spinner-rotate'], result
            assert result['leaves'] == [], result
            assert result['text'] == [], result
            assert result['overlayBackground'] == 'none', result
            assert result['overlayFill'] != 'transparent', result
            assert max(result['widths']) - min(result['widths']) < .1, result
            assert result['titleBackground'] != 'none' if theme == 'dark' else result['titleBackground'] == 'none', result
            if reduced:
                assert result['overlay'] == [], result
            else:
                assert result['overlay'] == ['mf-working-highlight-sweep'], result
                assert result['samples'][0] == 'inset(0px 100% 0px 0px)', result
                assert '99.' in result['samples'][-1] or '100%' in result['samples'][-1], result
            print(f'PASS: {theme} theme, reduced motion={reduced}')
            page.close()
    browser.close()
print('PASS: rotating spinner, text-only loopable highlight, no gradient backing layer')
