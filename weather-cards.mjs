/* Source-independent presentation. No provider credentials or network requests. */
const NS = 'http://www.w3.org/2000/svg';
const number = new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 0 });
const amount = new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 1 });
const percentage = new Intl.NumberFormat('ar-SA', { style: 'percent', maximumFractionDigits: 0 });
const zone = 'Asia/Riyadh';
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
const weekday = new Intl.DateTimeFormat('ar-SA', { timeZone: zone, weekday: 'long' });
const hour = new Intl.DateTimeFormat('ar-SA', { timeZone: zone, hour: 'numeric', hour12: true });
const finite = value => typeof value === 'number' && Number.isFinite(value);
const temp = value => finite(value) ? `${number.format(value)}°` : '—';
const percent = value => finite(value) && value >= 0 && value <= 100 ? percentage.format(value / 100) : '—';

const shapes = {
  sun: '<circle class="wc-sun" cx="32" cy="28" r="12"/><path class="wc-sun-rays" d="M32 5v6m0 34v6M9 28h6m34 0h6M16 12l4 4m24 24 4 4M16 44l4-4m24-24 4-4"/>',
  moon: '<path class="wc-moon" d="M43 10a22 22 0 1 0 11 37A24 24 0 0 1 43 10Z"/>',
  cloud: '<path class="wc-cloud" d="M17 50h30a10 10 0 0 0 1-20 15 15 0 0 0-28-4 12 12 0 0 0-3 24Z"/>',
  rain: '<path class="wc-rain" d="m22 51-3 6m14-6-3 6m14-6-3 6"/>',
  wind: '<path d="M9 24h32a7 7 0 1 0-7-7M9 34h42a6 6 0 1 1-6 6M9 44h15a7 7 0 1 1-7 7"/>',
  pin: '<path d="M32 57S13 37 13 24a19 19 0 0 1 38 0c0 13-19 33-19 33Z"/><circle cx="32" cy="24" r="6"/>',
  clock: '<circle cx="32" cy="32" r="23"/><path d="M32 16v17l11 7"/>',
  calendar: '<rect x="10" y="14" width="44" height="42" rx="7"/><path d="M10 26h44M22 8v13M42 8v13"/>',
  refresh: '<path d="M52 29a21 21 0 1 0-7 20M52 12v17H35"/>',
  unknown: '<circle cx="32" cy="32" r="22"/><path d="M25 24a7 7 0 1 1 11 6c-4 3-4 5-4 7M32 44v1"/>',
  snow: '<path d="M32 7v50M10 19l44 26M10 45l44-26M27 12l5 5 5-5M27 52l5-5 5 5M13 25l7-1-1-7M45 47l-1-7 7-1M13 39l7 1-1 7M45 17l-1 7 7 1"/>',
  fog: '<path d="M10 35h44M15 44h34M9 53h46"/>',
  storm: '<path class="wc-lightning" d="m33 39-8 12h8l-4 11 14-17h-9l4-6"/>'
};

export function weatherIcon(kind = 'cloudy', isDay = true) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('class', 'wc-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  let content;
  if (shapes[kind] && !['sun', 'moon', 'cloud', 'rain'].includes(kind)) content = shapes[kind];
  else if (kind === 'clear') content = isDay ? shapes.sun : shapes.moon;
  else if (kind === 'partly-cloudy') content = `${isDay ? shapes.sun : shapes.moon}${shapes.cloud}`;
  else if (kind === 'rain' || kind === 'showers') content = `${kind === 'showers' && isDay ? shapes.sun : ''}${shapes.cloud}${shapes.rain}`;
  else if (kind === 'thunderstorm') content = `${shapes.cloud}${shapes.storm}`;
  else if (kind === 'snowy') content = shapes.snow;
  else if (kind === 'foggy') content = shapes.fog;
  else content = shapes.cloud;
  svg.innerHTML = content;
  return svg;
}

function text(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value ?? '';
  return node;
}

function temperatureRange(high, low) {
  const node = text('span', 'wc-day-range');
  node.append(text('span', 'wc-low', temp(low)), text('b', 'wc-high', temp(high)));
  node.setAttribute('aria-label', `العظمى ${temp(high)}، الصغرى ${temp(low)}`);
  return node;
}

/** Render normalized forecasts; the caller owns data retrieval and freshness. */
export function mountWeatherCards(root, { showHeader = true, onRefresh } = {}) {
  if (!root.parentElement?.closest('.weather-cards-page')) root.classList.add('weather-cards-page');
  root.classList.add('weather-cards-content');
  root.dir = 'rtl';
  root.innerHTML = `
    <header class="wc-header" ${showHeader ? '' : 'hidden'}>
      <a class="wc-brand" href="/?page=home"><img src="/assets/brand-mark.svg" width="40" height="40" alt=""><span>نجوم مذاري فيفاء</span></a>
      <span class="wc-page-label">الطقس</span>
    </header>
    <div class="wc-location"><strong class="wc-location-name">فيفاء</strong><span class="wc-location-caption">اليوم</span><button class="wc-refresh" type="button" aria-label="تحديث التوقعات" ${onRefresh ? '' : 'hidden'}></button></div>
    <p class="wc-status" role="status" aria-live="polite" hidden></p>
    <article class="wc-overview" aria-label="حالة الطقس">
      <div class="wc-overview-main"><div class="wc-overview-values"><div class="wc-temperature">—</div><h1 class="wc-condition">توقعات فيفاء</h1><p class="wc-range">العظمى — · الصغرى —</p></div><div class="wc-main-icon"></div></div>
      <svg class="wc-mountains" viewBox="0 0 600 160" preserveAspectRatio="none" aria-hidden="true"><path d="M0 95 40 69 78 88 120 40 170 84 208 52 262 104 310 58 350 88 391 32 433 91 480 66 530 107 578 64 600 90V160H0Z" fill="#1a3048"/><path d="m0 120 47-28 52 35 57-50 45 27 45-18 73 40 62-43 49 37 52-30 53 37 65-22v55H0Z" fill="#101f32"/></svg>
      <div class="wc-summary"><p>جارٍ تحميل التوقعات</p></div>
    </article>
    <div class="wc-metrics">
      <article class="wc-metric wc-metric-rain"><div class="wc-metric-heading"><span>فرصة المطر</span></div><strong class="wc-metric-value">—</strong><p class="wc-metric-detail">—</p></article>
      <article class="wc-metric wc-metric-wind"><div class="wc-metric-heading"><span>الرياح</span></div><strong class="wc-metric-value">—</strong><p class="wc-metric-detail">—</p></article>
    </div>
    <section class="wc-section wc-hourly" aria-labelledby="wc-hours-title"><header class="wc-section-title"><h2 id="wc-hours-title">الساعات القادمة</h2></header><div class="wc-hours" tabindex="0" role="region" aria-label="توقعات الساعات القادمة، قابلة للسحب أفقيًا"></div></section>
    <section class="wc-section wc-daily" aria-labelledby="wc-days-title"><header class="wc-section-title"><h2 id="wc-days-title">الأيام الخمسة</h2></header><div class="wc-days"></div></section>
    <p class="wc-attribution" hidden></p>`;
  const $ = selector => root.querySelector(selector);
  $('.wc-location-name').prepend(weatherIcon('pin'));
  $('.wc-refresh').append(weatherIcon('refresh'));
  $('.wc-main-icon').append(weatherIcon('unknown'));
  $('.wc-metric-rain .wc-metric-heading').append(weatherIcon('rain'));
  $('.wc-metric-wind .wc-metric-heading').append(weatherIcon('wind'));
  $('.wc-hourly .wc-section-title').append(weatherIcon('clock'));
  $('.wc-daily .wc-section-title').append(weatherIcon('calendar'));
  if (onRefresh) $('.wc-refresh').addEventListener('click', onRefresh);

  function setStatus(message = '', state = 'ready') {
    root.dataset.state = state;
    $('.wc-status').dataset.state = state;
    $('.wc-status').textContent = message;
    $('.wc-status').hidden = !message;
    root.setAttribute('aria-busy', String(state === 'loading'));
    $('.wc-refresh').disabled = state === 'loading';
  }

  function render(data) {
    const current = data.current ?? {};
    const daily = Array.isArray(data.daily) ? data.daily.slice(0, 5) : [];
    const hourly = Array.isArray(data.hourly) ? data.hourly.slice(0, 12) : [];
    $('.wc-temperature').textContent = temp(current.temperature);
    $('.wc-condition').textContent = current.condition?.label ?? 'الحالة غير متاحة';
    $('.wc-range').textContent = `العظمى ${temp(daily[0]?.high)} · الصغرى ${temp(daily[0]?.low)}`;
    $('.wc-main-icon').replaceChildren(weatherIcon(current.condition?.kind ?? 'unknown', current.isDay !== false));
    $('.wc-summary').replaceChildren(weatherIcon(data.summaryIcon ?? current.condition?.kind ?? 'unknown', current.isDay !== false), text('p', '', data.summary ?? 'تفاصيل التوقعات خلال اليوم'));
    $('.wc-metric-rain .wc-metric-value').textContent = percent(data.rain?.probability);
    const rainfall = data.rain?.precipitation;
    $('.wc-metric-rain .wc-metric-detail').textContent = `${data.rain?.windowLabel ?? 'الفترة غير متاحة'}${finite(rainfall) ? ` · ${amount.format(rainfall)} مم متوقعة` : ''}`;
    $('.wc-metric-wind .wc-metric-value').replaceChildren(text('bdi', '', finite(current.windSpeed) ? number.format(current.windSpeed) : '—'), text('span', 'wc-unit', 'كم/س'));
    $('.wc-metric-wind .wc-metric-detail').textContent = current.windDirectionLabel ?? 'الاتجاه غير متاح';

    $('.wc-hours').replaceChildren(...hourly.map(item => {
      const node = text('article', 'wc-hour');
      node.append(text('time', 'wc-hour-time', item.isCurrent ? 'الآن' : hour.format(new Date(item.time))), weatherIcon(item.condition?.kind, item.isDay !== false), text('bdi', 'wc-hour-temperature', temp(item.temperature)), text('span', 'wc-hour-rain', finite(item.rainProbability) ? percent(item.rainProbability) : '—'));
      node.querySelector('time').dateTime = item.time;
      node.querySelector('.wc-hour-rain').setAttribute('aria-label', `احتمال المطر ${finite(item.rainProbability) ? percent(item.rainProbability) : 'غير متاح'} للساعة المنتهية عند ${hour.format(new Date(item.rainPeriodEnd ?? item.time))}`);
      node.querySelector('svg').setAttribute('role', 'img');
      node.querySelector('svg').setAttribute('aria-label', item.condition?.label ?? 'الحالة غير متاحة');
      node.querySelector('svg').removeAttribute('aria-hidden');
      return node;
    }));
    $('.wc-hourly').hidden = hourly.length === 0;

    const today = dayKey.format(new Date(data.displayTime ?? Date.now()));
    const tomorrow = dayKey.format(new Date(new Date(`${today}T12:00:00+03:00`).getTime() + 86400000));
    $('.wc-days').replaceChildren(...daily.map(item => {
      const node = text('article', 'wc-day');
      const label = item.date === today ? 'اليوم' : item.date === tomorrow ? 'غدًا' : weekday.format(new Date(`${item.date}T12:00:00+03:00`));
      node.append(text('span', 'wc-day-name', label), weatherIcon(item.condition?.kind), text('span', 'wc-day-rain', finite(item.rainProbability) ? percent(item.rainProbability) : '—'), temperatureRange(item.high, item.low));
      node.setAttribute('aria-label', `${label}، ${item.condition?.label ?? 'الحالة غير متاحة'}`);
      return node;
    }));
    $('.wc-daily').hidden = daily.length === 0;
    setStatus(data.status ?? '', data.state ?? 'ready');
  }
  setStatus('جارٍ تحميل التوقعات', 'loading');
  return { render, setStatus };
}
