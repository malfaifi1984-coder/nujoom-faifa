/* Local astronomical estimates for Faifa. Times do not account for mountain horizons. */
(() => {
  'use strict';
  const lat = 17.2478, lon = 43.1035, zone = 'Asia/Riyadh';
  const $ = (id) => document.getElementById(id);
  const clock = new Intl.DateTimeFormat('ar-SA', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true });
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const valid = (date) => date instanceof Date && Number.isFinite(date.getTime());
  const time = (date) => valid(date) ? clock.format(date) : 'لا يحدث اليوم';
  const phases = ['محاق', 'هلال متزايد', 'تربيع أول', 'أحدب متزايد', 'بدر', 'أحدب متناقص', 'تربيع أخير', 'هلال متناقص'];
  const faces = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
  function marker(id, progress, visible) {
    const p = Math.max(0, Math.min(1, progress));
    const x = 22 + 276 * p, y = 108 - 320 * p * (1 - p);
    const node = $(id);
    if (!node.dataset.ready) {
      node.style.transition = 'none';
      node.dataset.ready = 'true';
      requestAnimationFrame(() => requestAnimationFrame(() => node.style.removeProperty('transition')));
    }
    node.style.transform = `translate(${x}px,${y}px)`;
    node.style.opacity = visible ? '1' : '.32';
    node.dataset.progress = p.toFixed(5);
    node.dataset.aboveHorizon = String(visible);
  }
  function moonEvents(start) {
    const events = [];
    // Gather surrounding UTC days, then select the actual Saudi calendar window.
    for (let offset = -2; offset <= 2; offset++) {
      const date = new Date(start.getTime() + offset * 86400000 + 12 * 3600000);
      const times = SunCalc.getMoonTimes(date, lat, lon, true);
      for (const kind of ['rise', 'set']) if (valid(times[kind])) events.push({ kind, at: times[kind] });
    }
    return events.sort((a, b) => a.at - b.at);
  }
  function update(now = new Date()) {
    if (!$('sky-sun-marker') || !window.SunCalc) return;
    const key = dayKey.format(now), start = new Date(`${key}T00:00:00+03:00`), end = start.getTime() + 86400000;
    const solar = SunCalc.getTimes(new Date(`${key}T12:00:00+03:00`), lat, lon);
    const duration = solar.sunset - solar.sunrise;
    const sunlight = valid(solar.sunrise) && valid(solar.sunset) && now >= solar.sunrise && now <= solar.sunset;
    marker('sky-sun-marker', duration > 0 ? (now - solar.sunrise) / duration : 0, sunlight);
    $('sky-sun-rise').textContent = time(solar.sunrise);
    $('sky-sun-set').textContent = time(solar.sunset);
    $('sky-sun-status').textContent = sunlight ? 'الشمس فوق الأفق' : 'الشمس تحت الأفق';
    $('sky-sun-state').textContent = sunlight ? 'نهار فيفاء' : 'ليل فيفاء';
    const light = SunCalc.getMoonIllumination(now);
    const phase = Math.round(light.phase * 8) % 8;
    $('sky-moon-phase').textContent = phases[phase];
    $('sky-moon-illumination').textContent = `${Math.round(light.fraction * 100).toLocaleString('ar-SA')}٪ إضاءة`;
    $('sky-moon-face').textContent = faces[phase];
    $('sky-moon-moving-face').textContent = faces[phase];
    const events = moonEvents(start), today = events.filter((e) => e.at >= start && e.at < end);
    $('sky-moon-rise').textContent = time(today.find((e) => e.kind === 'rise')?.at);
    $('sky-moon-set').textContent = time(today.find((e) => e.kind === 'set')?.at);
    const above = SunCalc.getMoonPosition(now, lat, lon).altitude > .133 * Math.PI / 180;
    const previousRise = events.filter((e) => e.kind === 'rise' && e.at <= now).at(-1);
    const nextSet = events.find((e) => e.kind === 'set' && e.at > now);
    const progress = above && previousRise && nextSet ? (now - previousRise.at) / (nextSet.at - previousRise.at) : 0;
    marker('sky-moon-marker', progress, above);
    $('sky-moon-status').textContent = above ? 'القمر فوق الأفق' : 'القمر تحت الأفق';
    $('sky-astro-updated').textContent = `الموقع محسوب حسب وقتك الآن · ${clock.format(now)} بتوقيت السعودية`;
  }
  window.FaifaAstronomy = Object.freeze({ update });
  document.addEventListener('DOMContentLoaded', () => {
    update();
    setInterval(() => { if (!document.hidden) update(); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
  });
})();
