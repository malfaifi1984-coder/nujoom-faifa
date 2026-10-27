import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
const require = createRequire(import.meta.url);
const SunCalc = require('../assets/vendor/suncalc/suncalc.js');
const Astronomy = require('../assets/vendor/astronomy-engine/astronomy.browser.min.js');
function card() {
  const nodes = new Map();
  const document = { getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, { style: { removeProperty() {} }, dataset: {}, hidden: false, textContent: '' });
    return nodes.get(id);
  }, addEventListener() {} };
  const window = { SunCalc, Astronomy, addEventListener() {} };
  runInNewContext(readFileSync(new URL('../sky-astronomy.js', import.meta.url), 'utf8'), { window, document, SunCalc, Date, Intl, Math, requestAnimationFrame: (fn) => fn() });
  return { window, node: (id) => document.getElementById(id), update: window.FaifaAstronomy.update };
}
function x(node) { return Number(/translate\(([-\d.]+)px/.exec(node.style.transform)[1]); }
test('Faifa solar path begins on the right, ends on the left, and switches cards at Maghrib', () => {
  const { window, node, update } = card();
  window.FaifaPrayerDay = { date: '2026-10-27', timings: { Sunrise: '06:05', Maghrib: '17:40' } };
  update(new Date('2026-10-27T06:05:00+03:00'));
  assert.equal(x(node('sky-sun-marker')), 298);
  assert.equal(node('sky-sun-card').hidden, false);
  assert.equal(node('sky-moon-card').hidden, true);
  assert.match(node('sky-sun-rise').textContent, /صباحًا/);
  update(new Date('2026-10-27T17:39:59+03:00'));
  assert.ok(x(node('sky-sun-marker')) < 23);
  update(new Date('2026-10-27T17:40:00+03:00'));
  assert.equal(node('sky-sun-card').hidden, true);
  assert.equal(node('sky-moon-card').hidden, false);
  assert.match(node('sky-sun-set').textContent, /مساءً/);
});
test('Faifa Moon follows the actual overnight cycle and labels the next morning explicitly', () => {
  const { node, update } = card();
  update(new Date('2026-10-27T19:00:00+03:00'));
  const first = x(node('sky-moon-marker'));
  assert.equal(node('sky-moon-marker').dataset.aboveHorizon, 'true');
  assert.match(node('sky-moon-rise').textContent, /مساءً/);
  assert.match(node('sky-moon-set').textContent, /صباحًا غدًا/);
  // Independent PyEphem calculation: 2026-10-28 08:12:37 KSA at sea level.
  assert.match(node('sky-moon-set').textContent, /٨:١٢/);
  update(new Date('2026-10-28T05:00:00+03:00'));
  assert.ok(x(node('sky-moon-marker')) < first);
  assert.match(node('sky-moon-rise').textContent, /أمس/);
  assert.doesNotMatch(node('sky-moon-set').textContent, /غدًا/);
  update(new Date('2026-10-28T12:00:00+03:00'));
  assert.equal(node('sky-moon-marker').style.opacity, '0');
  assert.equal(node('sky-moon-status').textContent, 'القمر تحت الأفق');
});
