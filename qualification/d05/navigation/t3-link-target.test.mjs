import test from 'node:test';
import assert from 'node:assert/strict';
import { pagePath, linkTarget, fragmentExists } from './t3-link-target.mjs';
const origin = 'http://127.0.0.1:34567';
const base = origin + '/catalog/';
const options = { origin, canonical: 'https://cehovod.ru', pages: new Set(['/', '/catalog/', '/tools/', '/workspace/', '/404.html', '/workspace/isolated-signed-workspace.html']), files: new Set(['/docs/example.pdf']), protectedPages: new Set(['/workspace/', '/workspace/isolated-signed-workspace.html']) };
const get = (href, source = base) => linkTarget(href, source, options);
test('same page, relative and root links preserve path and fragment', () => {
  assert.deepEqual(get('#details'), { kind:'page', request:'/catalog/', href:'/catalog/#details', fragment:'details', path:'/catalog/', localClick:true });
  assert.equal(get('../tools?case=a#result').href, '/tools?case=a#result');
  assert.equal(get('../tools?case=a#result').path, '/tools/');
  assert.equal(get('/').kind, 'page');
});
test('canonical absolute links and aliases are verified locally but not clicked against production', () => {
  for (const href of ['https://cehovod.ru/tools/', 'http://www.cehovod.ru/tools/', '//cehovod.ru/tools/']) {
    assert.equal(get(href).kind, 'page');
    assert.equal(get(href).localClick, false);
  }
  assert.equal(get('https://cehovod.ru.example/tools/').kind, 'external');
  assert.equal(get('https://cehovod.ru:444/tools/').kind, 'external');
});
test('explicit index, absent slash and encoded anchors are understood', () => {
  assert.equal(pagePath('/catalog/index.html'), '/catalog/');
  assert.equal(get('/tools/index.html?q=1#%D1%86%D0%B5%D0%BD%D0%B0').fragment, 'цена');
  assert.equal(get('/tools').request, '/tools');
  assert.equal(get('/tools/').path, '/tools/');
});
test('protected routes are reported separately and assets remain HTTP targets', () => {
  assert.equal(get('/workspace/#/domain').kind, 'protected');
  assert.equal(get('/workspace/isolated-signed-workspace.html').kind, 'protected');
  assert.throws(() => get('/404.html'), /NOT_FOUND_TARGET/);
  assert.throws(() => get('/404/'), /NOT_FOUND_TARGET/);
  assert.equal(get('/docs/example.pdf?x=1').kind, 'asset');
  assert.throws(() => get('/workspace/missing/'), /UNDECLARED_TARGET/);
  assert.throws(() => get('/docs/missing.pdf'), /UNDECLARED_TARGET/);
});
test('invalid, missing, credential and executable links fail rather than being ignored', () => {
  for (const href of ['', ' ', 'javascript:alert(1)', 'data:text/html,x', 'https://u:p@cehovod.ru/tools/', '/missing/', '#%FF']) assert.throws(() => get(href));
  assert.equal(get('mailto:hello@example.com').kind, 'contact');
  assert.equal(get('tel:+123456789').kind, 'contact');
  assert.throws(() => get('mailto:'), /EMPTY_CONTACT/);
});
test('anchors use exact decoded IDs or legacy named anchors, not substring matches', () => {
  assert.equal(fragmentExists('detail', ['detail'], []), true);
  assert.equal(fragmentExists('Detail', ['detail'], []), false);
  assert.equal(fragmentExists('old', [], ['old']), true);
  assert.equal(fragmentExists('top', [], []), true);
  assert.equal(fragmentExists('', [], []), true);
  assert.equal(fragmentExists('missing', ['missing-more'], []), false);
});
