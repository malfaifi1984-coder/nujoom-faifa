/* Source-independent forecast presentation. Network access belongs to the controller. */
const NS = 'http://www.w3.org/2000/svg';
const number = new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 0 });
const amount = new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 2 });
const percentage = new Intl.NumberFormat('ar-SA', { style: 'percent', maximumFractionDigits: 0 });
const zone = 'Asia/Riyadh';
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
const weekday = new Intl.DateTimeFormat('ar-SA', { timeZone: zone, weekday: 'long' });
const hour = new Intl.DateTimeFormat('ar-SA', { timeZone: zone, hour: 'numeric', hour12: true });
const finite = value => typeof value === 'number' && Number.isFinite(value);
const validProbability = value => finite(value) && value >= 0 && value <= 100;
const temp = value => finite(value) ? `${number.format(value)}°` : '—';
const percent = value => validProbability(value) ? percentage.format(value / 100) : '—';
const rainAmount = value => value > 0 && value < .1 ? 'أقل من ٠٫١' : amount.format(value);
const validDate = value => value != null && Number.isFinite(new Date(value).getTime());
const hourLabel = value => validDate(value) ? hour.format(new Date(value)) : '—';

const shapes = {
  temperature: '<path d="M26 38V15a6 6 0 0 1 12 0v23a13 13 0 1 1-12 0Z"/><path d="M32 22v25M43 18h7M43 27h5"/><circle cx="32" cy="48" r="5"/>',
  rain: '<path class="wc-rain-cloud" d="M17 40h31a10 10 0 0 0 1-20 15 15 0 0 0-28-4 12 12 0 0 0-4 24Z"/><path class="wc-rain-drops" d="m20 47-4 9m17-9-4 9m17-9-4 9"/>',
  wind: '<path d="M9 24h32a7 7 0 1 0-7-7M9 34h42a6 6 0 1 1-6 6M9 44h15a7 7 0 1 1-7 7"/>',
  gust: '<path d="M7 20h35a7 7 0 1 0-7-7M7 31h43a6 6 0 1 1-6 6M7 42h24a7 7 0 1 1-7 7M7 53h8"/>',
  pin: '<path d="M32 57S13 37 13 24a19 19 0 0 1 38 0c0 13-19 33-19 33Z"/><circle cx="32" cy="24" r="6"/>',
  clock: '<circle cx="32" cy="32" r="23"/><path d="M32 16v17l11 7"/>',
  refresh: '<path d="M52 29a21 21 0 1 0-7 20M52 12v17H35"/>'
};

export function weatherIcon(kind = 'temperature') {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('class', 'wc-icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = shapes[kind] ?? shapes.temperature;
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
  node.setAttribute('role', 'group');
  node.append(text('span', 'wc-low', temp(low)), text('b', 'wc-high', temp(high)));
  node.setAttribute('aria-label', `العظمى ${temp(high)}، الصغرى ${temp(low)}`);
  return node;
}

function periodLabel(start, end) {
  return validDate(start) && validDate(end) ? `من ${hourLabel(start)} إلى ${hourLabel(end)}` : '';
}

/** Render normalized forecasts; the caller owns retrieval and freshness. */
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
    <article class="wc-overview" aria-label="درجة الحرارة">
      <div class="wc-overview-main"><div class="wc-overview-values"><h1 class="wc-condition">درجة الحرارة الآن</h1><div class="wc-temperature">—</div><p class="wc-apparent">المحسوسة —</p><p class="wc-range">العظمى — · الصغرى —</p></div><div class="wc-main-icon"></div></div>
      <svg class="wc-mountains" viewBox="0 0 600 160" preserveAspectRatio="none" aria-hidden="true"><path d="M0 95 40 69 78 88 120 40 170 84 208 52 262 104 310 58 350 88 391 32 433 91 480 66 530 107 578 64 600 90V160H0Z"/><path d="m0 120 47-28 52 35 57-50 45 27 45-18 73 40 62-43 49 37 52-30 53 37 65-22v55H0Z"/></svg>
    </article>
    <article class="wc-rain-card" aria-labelledby="wc-rain-title">
      <div class="wc-rain-overview"><div class="wc-rain-heading"><h2 id="wc-rain-title">فرصة المطر</h2></div><strong class="wc-rain-probability is-unavailable">الاحتمال غير متاح</strong><p class="wc-rain-probability-label" hidden>أعلى احتمال ساعي خلال الفترة</p></div>
      <div class="wc-rain-details"><p class="wc-rain-window">بيانات المطر غير متاحة حاليًا</p><p class="wc-rain-amount" hidden></p></div>
    </article>
    <div class="wc-metrics">
      <article class="wc-metric wc-metric-wind"><div class="wc-metric-heading"><span>الرياح</span></div><strong class="wc-metric-value">—</strong><p class="wc-metric-detail">—</p></article>
      <article class="wc-metric wc-metric-gust"><div class="wc-metric-heading"><span>هبّات الرياح</span></div><strong class="wc-metric-value">—</strong><p class="wc-metric-detail">أقصى سرعة للهبات</p></article>
    </div>
    <section class="wc-section wc-hourly" aria-labelledby="wc-hours-title"><header class="wc-section-title"><h2 id="wc-hours-title">الساعات القادمة</h2></header><div class="wc-hours" tabindex="0" role="region" aria-label="توقعات الحرارة واحتمال المطر، قابلة للسحب أفقيًا"></div><p class="wc-hour-rain-label">احتمال المطر</p></section>
    <section class="wc-section wc-daily" aria-label="توقعات درجات الحرارة للأيام القادمة"><div class="wc-day-columns"><span aria-hidden="true"></span><div class="wc-day-headings"><span>الصغرى</span><span>العظمى</span></div></div><div class="wc-days"></div></section>
    <p class="wc-update" hidden></p>`;
  const $ = selector => root.querySelector(selector);
  $('.wc-location-name').prepend(weatherIcon('pin'));
  $('.wc-refresh').append(weatherIcon('refresh'));
  $('.wc-main-icon').append(weatherIcon('temperature'));
  $('.wc-rain-heading').append(weatherIcon('rain'));
  $('.wc-metric-wind .wc-metric-heading').append(weatherIcon('wind'));
  $('.wc-metric-gust .wc-metric-heading').append(weatherIcon('gust'));
  $('.wc-hourly .wc-section-title').append(weatherIcon('clock'));
  if (onRefresh) $('.wc-refresh').addEventListener('click', onRefresh);

  function setStatus(message = '', state = 'ready') {
    root.dataset.state = state;
    $('.wc-status').dataset.state = state;
    $('.wc-status').textContent = message;
    $('.wc-status').hidden = !message;
    root.setAttribute('aria-busy', String(state === 'loading'));
    $('.wc-refresh').disabled = state === 'loading';
  }

  function renderRain(rain = {}) {
    const probabilityKnown = validProbability(rain.probability);
    const amountKnown = finite(rain.amount) && rain.amount >= 0;
    const available = probabilityKnown || amountKnown;
    const probabilityNode = $('.wc-rain-probability');
    probabilityNode.textContent = probabilityKnown ? percent(rain.probability) : 'الاحتمال غير متاح';
    probabilityNode.classList.toggle('is-unavailable', !probabilityKnown);
    probabilityNode.setAttribute('aria-label', probabilityKnown ? `أعلى احتمال ساعي للمطر خلال الفترة ${percent(rain.probability)}` : 'الاحتمال غير متاح');
    $('.wc-rain-probability-label').hidden = !probabilityKnown;
    $('.wc-rain-window').textContent = available ? (rain.windowLabel || periodLabel(rain.start, rain.end) || 'الفترة غير متاحة') : 'بيانات المطر غير متاحة حاليًا';
    const amountNode = $('.wc-rain-amount');
    amountNode.hidden = !available;
    if (amountKnown) amountNode.replaceChildren(document.createTextNode('الكمية خلال الفترة: '), text('bdi', '', rainAmount(rain.amount)), document.createTextNode(' مم'));
    else amountNode.textContent = 'الكمية غير متاحة';
    const rainCard = $('.wc-rain-card');
    rainCard.dataset.available = String(available);
    for (const [key, value] of [['periodStart', rain.start], ['periodEnd', rain.end]]) {
      if (validDate(value)) rainCard.dataset[key] = new Date(value).toISOString();
      else delete rainCard.dataset[key];
    }
  }

  function renderWind(selector, value) {
    const node = $(selector);
    node.replaceChildren(text('bdi', '', finite(value) && value >= 0 ? number.format(value) : '—'), text('span', 'wc-unit', 'كم/س'));
  }

  function render(data) {
    const current = data.current ?? {};
    const daily = Array.isArray(data.daily) ? data.daily.slice(0, 5) : [];
    const hourly = Array.isArray(data.hourly) ? data.hourly.slice(0, 12) : [];
    $('.wc-temperature').textContent = temp(current.temperature);
    $('.wc-temperature').setAttribute('aria-label', finite(current.temperature) ? `${number.format(current.temperature)} درجة مئوية` : 'درجة الحرارة غير متاحة');
    $('.wc-apparent').textContent = `المحسوسة ${temp(current.apparentTemperature)}`;
    $('.wc-range').textContent = `العظمى ${temp(daily[0]?.high)} · الصغرى ${temp(daily[0]?.low)}`;
    renderRain(data.rain ?? {});
    renderWind('.wc-metric-wind .wc-metric-value', current.windSpeed);
    renderWind('.wc-metric-gust .wc-metric-value', current.windGusts);
    $('.wc-metric-wind .wc-metric-detail').textContent = current.windDirectionLabel ?? 'الاتجاه غير متاح';
    $('.wc-metric-gust .wc-metric-detail').textContent = finite(current.windGusts) && current.windGusts >= 0 ? 'أقصى سرعة للهبات' : 'بيانات الهبّات غير متاحة';

    $('.wc-hours').replaceChildren(...hourly.map(item => {
      const node = text('article', 'wc-hour');
      const probabilityNode = text('span', 'wc-hour-rain', percent(item.rainProbability));
      const period = periodLabel(item.rainPeriodStart, item.rainPeriodEnd);
      probabilityNode.setAttribute('aria-label', validProbability(item.rainProbability) ? `احتمال المطر ${percent(item.rainProbability)}${period ? `، ${period}` : ''}` : 'احتمال المطر غير متاح');
      node.append(text('time', 'wc-hour-time', item.isCurrent ? 'الآن' : hourLabel(item.time)), text('bdi', 'wc-hour-temperature', temp(item.temperature)), probabilityNode);
      if (validDate(item.time)) node.querySelector('time').dateTime = new Date(item.time).toISOString();
      if (item.isCurrent) node.setAttribute('aria-current', 'time');
      return node;
    }));
    $('.wc-hourly').hidden = hourly.length === 0;

    const displayTime = validDate(data.displayTime) ? new Date(data.displayTime) : new Date();
    const today = dayKey.format(displayTime);
    const tomorrow = dayKey.format(new Date(new Date(`${today}T12:00:00+03:00`).getTime() + 86400000));
    $('.wc-days').replaceChildren(...daily.map(item => {
      const node = text('article', 'wc-day');
      const date = new Date(`${item.date}T12:00:00+03:00`);
      const label = item.date === today ? 'اليوم' : item.date === tomorrow ? 'غدًا' : validDate(date) ? weekday.format(date) : '—';
      node.append(text('span', 'wc-day-name', label), temperatureRange(item.high, item.low));
      return node;
    }));
    $('.wc-daily').hidden = daily.length === 0;
    setStatus(data.status ?? '', data.state ?? 'ready');
  }
  setStatus('جارٍ تحميل التوقعات', 'loading');
  return { render, setStatus };
}
