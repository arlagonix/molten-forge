"""Chromium regression: content cards stay opaque without backdrop blur.
Run with: python tests/opaque-surfaces.browser.py
"""
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
css = (root / 'src/styles.css').read_text(encoding='utf-8')
selectors = ['.chat-header', '.composer',
             '.context-popover.context-popover-portal', '.runtime-group', '.thinking', '.tool',
             '.settings-dialog',
             '.model-popover', '.chat-code-header']
document = '<!doctype html><html data-theme="dark"><head></head><body>' + ''.join(
    f'<div class="{sel[1:].replace(".", " ")}">content</div>' for sel in selectors
) + '</body></html>'

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page()
    page.set_content(document)
    page.add_style_tag(content=css)
    for theme in ('dark', 'light'):
        page.evaluate('(theme) => { document.documentElement.dataset.theme = theme; }', theme)
        surfaces = page.evaluate('''(selectors) => Object.fromEntries(selectors.map(selector => {
          const computed = getComputedStyle(document.querySelector(selector));
          return [selector, { background: computed.backgroundColor,
            blur: computed.backdropFilter || computed.webkitBackdropFilter || 'none' }];
        }))''', selectors)
        for selector, surface in surfaces.items():
            bg = surface['background']
            assert bg != 'rgba(0, 0, 0, 0)' and bg != 'transparent', f'{theme} {selector} transparent: {surface}'
            assert not bg.startswith('rgba(') or float(bg.split(',')[-1].strip(' )')) == 1, f'{theme} {selector} alpha: {surface}'
            assert surface['blur'] == 'none', f'{theme} {selector} backdrop blur: {surface}'
        print(theme, {k: v['background'] for k, v in surfaces.items()})
    browser.close()
print('PASS: foreground cards are opaque with no backdrop blur')
