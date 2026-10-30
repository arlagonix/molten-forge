"""Guard the pre-v0.36.88 user-message palette, without reintroducing blur.

The foreground palette change intentionally excludes wallpaper pane tints.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
css = (ROOT / 'src/styles.css').read_text(encoding='utf-8')
html = '''<!doctype html><html data-theme="dark"><body>
<div class="user-bubble">Existing user message</div>
<div class="tool">Tool content</div>
</body></html>'''

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page()
    page.set_content(html)
    page.add_style_tag(content=css)
    for theme in ('dark', 'light'):
        page.evaluate('(theme) => document.documentElement.dataset.theme = theme', theme)
        values = page.evaluate('''() => {
          const bubble = getComputedStyle(document.querySelector('.user-bubble'));
          const tool = getComputedStyle(document.querySelector('.tool'));
          return {bubble: bubble.backgroundColor, tool: tool.backgroundColor,
            blur: bubble.backdropFilter || bubble.webkitBackdropFilter || 'none'};
        }''')
        assert values['blur'] == 'none', f'User message backdrop blur in {theme}: {values}'
        assert values['bubble'] != values['tool'], f'User bubble wrongly shares generic card/tool fill in {theme}: {values}'
        if values['bubble'].startswith('rgba('):
            alpha = float(values['bubble'].split(',')[-1].strip(' )'))
        else:
            assert values['bubble'].startswith('oklch(') and '/' in values['bubble'], (
                f'Original user message alpha lost in {theme}: {values}'
            )
            alpha = float(values['bubble'].rsplit('/', 1)[-1].strip(' )'))
        expected = .64 if theme == 'dark' else .90
        assert abs(alpha - expected) < .005, f'{theme} original user message opacity lost: {values}'
        if theme == 'dark':
            assert values['bubble'].startswith('rgba(52, 55, 59,'), f'Dark user message gray hue changed: {values}'
        print(f'{theme}: original user message background {values["bubble"]}, blur none')
    browser.close()
print('PASS: original user-message palette restored in both themes')
