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
test('night indicator runs from Maghrib to next sunrise and switches exactly at its endpoint', () => {
  const { window, node, update } = card();
  window.FaifaPrayerDays = {
    '2026-10-27': { timings: { Sunrise: '06:03', Maghrib: '17:40' } },
    '2026-10-28': { timings: { Sunrise: '06:04', Maghrib: '17:39' } },
    '2026-10-29': { timings: { Sunrise: '06:07', Maghrib: '17:38' } }
  };
  update(new Date('2026-10-27T17:40:00+03:00'));
  assert.equal(x(node('sky-moon-marker')), 298);
  assert.equal(node('sky-moon-marker').style.opacity, '1');
  assert.match(node('sky-moon-set').textContent, /٦:٠٤ صباحًا غدًا/);
  update(new Date('2026-10-27T23:59:59+03:00'));
  const beforeMidnight = x(node('sky-moon-marker'));
  update(new Date('2026-10-28T00:00:00+03:00'));
  assert.ok(Math.abs(x(node('sky-moon-marker')) - beforeMidnight) < 0.01);
  assert.match(node('sky-moon-rise').textContent, /أمس/);
  assert.doesNotMatch(node('sky-moon-set').textContent, /غدًا/);
  update(new Date('2026-10-28T06:03:59+03:00'));
  assert.ok(x(node('sky-moon-marker')) < 23);
  assert.equal(node('sky-moon-card').hidden, false);
  update(new Date('2026-10-28T06:04:00+03:00'));
  assert.equal(node('sky-moon-card').hidden, true);
  assert.equal(node('sky-sun-card').hidden, false);
  assert.equal(node('sky-moon-marker').style.opacity, '0');
  update(new Date('2026-10-28T17:39:00+03:00'));
  assert.equal(node('sky-moon-card').hidden, false);
  assert.match(node('sky-moon-set').textContent, /٦:٠٧ صباحًا غدًا/);
});
test('Faifa sunrise changes with the season without a fixed 06:04 setting', () => {
  const { node, update } = card();
  update(new Date('2026-10-27T20:00:00+03:00'));
  assert.match(node('sky-moon-set').textContent, /٦:٠٤ صباحًا غدًا/);
  update(new Date('2026-06-27T20:00:00+03:00'));
  const summer = node('sky-moon-set').textContent;
  assert.doesNotMatch(summer, /٦:٠٤/);
  assert.match(summer, /صباحًا غدًا/);
  update(new Date('2026-12-27T20:00:00+03:00'));
  assert.notEqual(node('sky-moon-set').textContent, summer);
});
