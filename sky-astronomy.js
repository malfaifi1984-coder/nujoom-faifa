/* Local astronomical estimates for Faifa. Times do not account for mountain horizons. */
(() => {
  'use strict';
  const lat = 17.2478, lon = 43.1035, zone = 'Asia/Riyadh';
  const $ = (id) => document.getElementById(id);
  const clock = new Intl.DateTimeFormat('ar-SA', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: true });
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const valid = (date) => date instanceof Date && Number.isFinite(date.getTime());
  const time = (date) => valid(date) ? clock.formatToParts(date).map((part) => part.type === 'dayPeriod' ? (part.value.startsWith('ص') ? 'صباحًا' : 'مساءً') : part.value).join('') : 'لا يحدث اليوم';
  const phases = ['محاق', 'هلال متزايد', 'تربيع أول', 'أحدب متزايد', 'بدر', 'أحدب متناقص', 'تربيع أخير', 'هلال متناقص'];
  const faces = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
  let boundaryTimer;
  function marker(id, progress, visible) {
    const p = Math.max(0, Math.min(1, progress));
    const x = 298 - 276 * p, y = 108 - 320 * p * (1 - p);
    const node = $(id);
    if (!node.dataset.ready) {
      node.style.transition = 'none';
      node.dataset.ready = 'true';
      requestAnimationFrame(() => requestAnimationFrame(() => node.style.removeProperty('transition')));
    }
    node.style.transform = `translate(${x}px,${y}px)`;
    node.style.opacity = visible ? '1' : '0';
    node.dataset.progress = p.toFixed(5);
    node.dataset.visible = String(visible);
  }
  function solarDay(date) {
    const key = dayKey.format(date);
    const solar = SunCalc.getTimes(new Date(`${key}T12:00:00+03:00`), lat, lon);
    const astronomy = window.Astronomy;
    if (astronomy) {
      const observer = new astronomy.Observer(lat, lon, 1200);
      const start = new Date(`${key}T00:00:00+03:00`);
      for (const [name, direction] of [['sunrise', 1], ['sunset', -1]]) {
        const event = astronomy.SearchRiseSet(astronomy.Body.Sun, observer, direction, start, 1);
        // Match the minute displayed in the card, instead of switching partway through it.
        if (event) solar[name] = new Date(Math.floor(event.date.getTime() / 60000) * 60000);
      }
    }
    const prayer = window.FaifaPrayerDays?.[key] || (window.FaifaPrayerDay?.date === key ? window.FaifaPrayerDay : null);
    if (prayer) {
      if (/^\d{2}:\d{2}$/.test(prayer.timings?.Sunrise)) solar.sunrise = new Date(`${key}T${prayer.timings.Sunrise}:00+03:00`);
      if (/^\d{2}:\d{2}$/.test(prayer.timings?.Maghrib)) solar.sunset = new Date(`${key}T${prayer.timings.Maghrib}:00+03:00`);
    }
    return solar;
  }
  function update(now = new Date()) {
    if (!$('sky-sun-marker') || !window.SunCalc) return;
    const key = dayKey.format(now), start = new Date(`${key}T00:00:00+03:00`);
    const solar = solarDay(now);
    const duration = solar.sunset - solar.sunrise;
    const sunlight = valid(solar.sunrise) && valid(solar.sunset) && now >= solar.sunrise && now < solar.sunset;
    marker('sky-sun-marker', duration > 0 ? (now - solar.sunrise) / duration : 0, sunlight);
    $('sky-sun-rise').textContent = time(solar.sunrise);
    $('sky-sun-set').textContent = time(solar.sunset);
    $('sky-sun-status').textContent = sunlight ? 'الشمس فوق الأفق' : 'الشمس تحت الأفق';
    $('sky-sun-state').textContent = sunlight ? 'نهار فيفاء' : 'ليل فيفاء';
    $('sky-sun-card').hidden = !sunlight;
    $('sky-moon-card').hidden = sunlight;
    const astronomy = window.Astronomy;
    const light = astronomy ? {
      phase: astronomy.MoonPhase(now) / 360,
      fraction: astronomy.Illumination(astronomy.Body.Moon, now).phase_fraction
    } : SunCalc.getMoonIllumination(now);
    const phase = Math.round(light.phase * 8) % 8;
    $('sky-moon-phase').textContent = phases[phase];
    $('sky-moon-illumination').textContent = `${Math.round(light.fraction * 100).toLocaleString('ar-SA')}٪ إضاءة`;
    $('sky-moon-face').textContent = faces[phase];
    $('sky-moon-moving-face').textContent = faces[phase];
    // This is a night-progress indicator. Its endpoints are Maghrib and sunrise,
    // not the physical Moon's rise/set times (which can occur during daylight).
    const beforeSunrise = now < solar.sunrise;
    const nightStart = beforeSunrise ? solarDay(new Date(start.getTime() - 86400000)).sunset : solar.sunset;
    const nightEnd = beforeSunrise ? solar.sunrise : solarDay(new Date(start.getTime() + 86400000)).sunrise;
    const cycleTime = (date) => `${time(date)}${dayKey.format(date) > key ? ' غدًا' : dayKey.format(date) < key ? ' أمس' : ''}`;
    $('sky-moon-rise').textContent = cycleTime(nightStart);
    $('sky-moon-set').textContent = cycleTime(nightEnd);
    const progress = (now - nightStart) / (nightEnd - nightStart);
    marker('sky-moon-marker', progress, !sunlight && now >= nightStart && now < nightEnd);
    $('sky-moon-status').textContent = 'مسار الليل حتى الشروق';
    if (arguments.length === 0) {
      clearTimeout(boundaryTimer);
      const nextBoundary = sunlight ? solar.sunset : nightEnd;
      if (valid(nextBoundary)) boundaryTimer = setTimeout(() => update(), Math.max(1, nextBoundary - now));
    }
  }
  window.FaifaAstronomy = Object.freeze({ update });
  window.addEventListener('faifa-prayer-times', () => update());
  document.addEventListener('DOMContentLoaded', () => {
    update();
    setInterval(() => { if (!document.hidden) update(); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); });
  });
})();
