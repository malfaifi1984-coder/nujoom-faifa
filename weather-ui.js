/* Forecast data stays with Open-Meteo / ECMWF. No synthetic values or API key. */
(() => {
  'use strict';
  const CACHE_KEY = 'faifaWeatherCalmV2';
  const CACHE_TTL = 30 * 60 * 1000;
  const MAX_CACHE_AGE = 24 * 60 * 60 * 1000;
  const LOCATION = { latitude: 17.2478, longitude: 43.1035, elevation: 1200 };
  const TIME_ZONE = 'Asia/Riyadh';
  const $ = (id) => document.getElementById(id);
  const number = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const format = (value, digits = 0) => number(value) === null ? '—' : value.toLocaleString('ar-SA', { maximumFractionDigits: digits });
  const epoch = (time) => typeof time === 'string' ? Date.parse(time + (/[Zz]|[+-]\d\d:\d\d$/.test(time) ? '' : '+03:00')) : NaN;
  const hourFormat = new Intl.DateTimeFormat('ar-SA', { hour: 'numeric', hour12: true, timeZone: TIME_ZONE });
  const dayFormat = new Intl.DateTimeFormat('ar-SA', { weekday: 'long', timeZone: TIME_ZONE });
  const dateFormat = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', timeZone: TIME_ZONE });
  const stampFormat = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: TIME_ZONE });
  const dateKey = () => new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  let forecast = null;
  let fetchedAt = null;
  let period = 48;
  let inFlight = null;
  let currentIndex = -1;
  let hourIndexes = [];
  let cacheStale = false;
  let rainMap = null;
  let rainLayer = null;
  let mapForecasts = [];
  let mapSavedAt = null;
  let mapLoading = false;
  let mapHour = 0;

  const iconPaths = {
    sun: '<circle cx="24" cy="24" r="8"/><path d="M24 3v6m0 30v6M3 24h6m30 0h6M9 9l4 4m22 22 4 4M9 39l4-4M35 13l4-4"/>',
    cloud: '<path d="M12 35h24a8 8 0 0 0 1-16 13 13 0 0 0-25-2 9 9 0 0 0 0 18Z"/>',
    rain: '<path d="M12 29h24a7 7 0 0 0 1-14 12 12 0 0 0-23-2 8 8 0 0 0-2 16Z"/><path d="m17 35-3 6m12-6-3 6m12-6-3 6"/>',
    fog: '<path d="M12 25h24a7 7 0 0 0 1-14 12 12 0 0 0-23-2 8 8 0 0 0-2 16Z"/><path d="M7 33h34M10 40h28"/>',
    storm: '<path d="M12 28h24a7 7 0 0 0 1-14 12 12 0 0 0-23-2 8 8 0 0 0-2 16Z"/><path d="m25 29-7 9h8l-4 8"/>',
    snow: '<path d="M12 28h24a7 7 0 0 0 1-14 12 12 0 0 0-23-2 8 8 0 0 0-2 16Z"/><path d="M17 34v10m-4-7 8 4m-8 0 8-4m13-3v10m-4-7 8 4m-8 0 8-4"/>',
    unknown: '<circle cx="24" cy="24" r="17"/><path d="M17 24h14"/>'
  };
  function condition(code) {
    if (number(code) === null) return ['unknown', 'الحالة غير متاحة'];
    if (code === 0) return ['sun', 'سماء صافية'];
    if (code === 1) return ['sun', 'صحو غالبًا'];
    if (code === 2) return ['cloud', 'غائم جزئيًا'];
    if (code === 3) return ['cloud', 'غائم'];
    if ([45, 48].includes(code)) return ['fog', 'ضباب'];
    if (code >= 95) return ['storm', 'عواصف رعدية'];
    if ([71, 73, 75, 77, 85, 86].includes(code)) return ['snow', 'ثلوج'];
    if ([51, 53, 55, 56, 57].includes(code)) return ['rain', 'رذاذ'];
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return ['rain', 'أمطار'];
    return ['unknown', 'الحالة غير متاحة'];
  }
  const icon = (code) => `<svg viewBox="0 0 48 48" aria-hidden="true">${iconPaths[condition(code)[0]]}</svg>`;
  const valueAt = (key, index) => number(forecast?.hourly?.[key]?.[index]);
  function sum(values) {
    return values.length && values.every((v) => number(v) !== null) ? values.reduce((a, b) => a + b, 0) : null;
  }
  function set(id, text) { if ($(id)) $(id).textContent = text; }
  function status(message, state) {
    set('sky-status', message);
    $('sky-status').dataset.state = state;
  }
  function chooseIndex(times, now = Date.now()) {
    // Never substitute the first forecast hour when a saved forecast has expired.
    const index = times.findIndex((time) => { const t = epoch(time); return t <= now && now < t + 3600000; });
    return index;
  }
  function validData(data) {
    const times = data?.hourly?.time;
    if (!Array.isArray(times) || !times.length || times.some((time) => !Number.isFinite(epoch(time)))) return false;
    return ['temperature_2m', 'precipitation', 'weather_code'].every((key) => Array.isArray(data.hourly[key]) && data.hourly[key].length === times.length)
      && data.hourly.temperature_2m.some((v) => number(v) !== null);
  }
  function readCache() {
    try {
      const cache = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (number(cache?.savedAt) !== null && cache.savedAt <= Date.now() && Date.now() - cache.savedAt < MAX_CACHE_AGE && validData(cache.data)) return cache;
    } catch (_) { /* Storage may be unavailable. Networking remains usable. */ }
    return null;
  }
  function requestUrl() {
    // Retain the repository's model and request location; limit long-range display to seven days.
    const url = new URL(WEATHER_URL);
    url.searchParams.set('forecast_days', '7');
    url.searchParams.delete('current');
    url.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,weather_code,sunrise,sunset,precipitation_sum');
    url.searchParams.set('hourly', 'temperature_2m,relative_humidity_2m,dew_point_2m,surface_pressure,cloud_cover,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m');
    return url;
  }
  function renderHome() {
    const code = valueAt('weather_code', currentIndex);
    const temp = valueAt('temperature_2m', currentIndex);
    const today = forecast.daily?.time?.indexOf(dateKey()) ?? -1;
    set('v2-temp', `${format(temp)}°`);
    $('v2-icon').innerHTML = icon(code);
    set('v2-desc', currentIndex < 0 ? 'لا تتوفر توقعات لهذه الساعة' : condition(code)[1]);
    set('v2-hilo', `العظمى ${format(number(forecast.daily?.temperature_2m_max?.[today]))}° · الصغرى ${format(number(forecast.daily?.temperature_2m_min?.[today]))}°`);
    set('sky-home-update', `${cacheStale ? 'بيانات محفوظة · ' : ''}جُلبت ${stampFormat.format(new Date(fetchedAt))} · توقعات فيفاء`);
  }
  function renderCurrent() {
    const i = currentIndex;
    const today = forecast.daily?.time?.indexOf(dateKey()) ?? -1;
    const speed = valueAt('wind_speed_10m', i);
    const unit = forecast.hourly_units?.wind_speed_10m;
    const kmh = speed === null ? null : unit === 'm/s' ? speed * 3.6 : unit === 'km/h' ? speed : null;
    set('sky-temp', `${format(valueAt('temperature_2m', i))}°`);
    set('sky-condition', i < 0 ? 'لا تتوفر توقعات لهذه الساعة' : condition(valueAt('weather_code', i))[1]);
    $('sky-icon').innerHTML = icon(valueAt('weather_code', i));
    set('sky-high', `${format(number(forecast.daily?.temperature_2m_max?.[today]))}°`);
    set('sky-low', `${format(number(forecast.daily?.temperature_2m_min?.[today]))}°`);
    set('sky-wind', format(kmh));
    set('sky-humidity', format(valueAt('relative_humidity_2m', i)));
    // Open-Meteo precipitation is the sum of the preceding hour. Start at the
    // next timestamp to cover 24 complete forecast hours from the current hour.
    const rainWindow = i < 0 ? [] : forecast.hourly.precipitation.slice(i + 1, i + 25);
    set('sky-rain', rainWindow.length === 24 ? format(sum(rainWindow), 1) : '—');
    set('sky-updated', `جُلبت البيانات ${stampFormat.format(new Date(fetchedAt))} بتوقيت السعودية${cacheStale ? ' · نسخة محفوظة' : ''}`);
    set('sky-forecast-time', i < 0 ? 'توقعات النموذج' : `توقعات الساعة ${hourFormat.format(new Date(epoch(forecast.hourly.time[i])))}`);
    // Visibility is null for this model. Do not turn a missing value into a zero or fog warning.
    const lat = number(forecast.latitude), lon = number(forecast.longitude);
    set('sky-grid-location', lat !== null && lon !== null ? `${lat.toFixed(3)}° N · ${lon.toFixed(3)}° E` : 'غير متاحة');
    set('sky-grid-elevation', number(forecast.elevation) === null ? 'غير متاح' : `${format(forecast.elevation)} متر`);
  }
  function renderHours() {
    hourIndexes = currentIndex < 0 ? [] : Array.from({ length: Math.min(period, forecast.hourly.time.length - currentIndex) }, (_, i) => currentIndex + i);
    $('sky-hours').innerHTML = hourIndexes.slice(0, 12).map((i) => `<div class="sky-hour"><span class="sky-hour-time">${hourFormat.format(new Date(epoch(forecast.hourly.time[i])))}</span>${icon(valueAt('weather_code', i))}<strong class="sky-hour-temp">${format(valueAt('temperature_2m', i))}°</strong><span class="sky-hour-rain">${format(valueAt('precipitation', i), 1)} ملم</span></div>`).join('');
    renderChart();
  }
  function renderChart() {
    const target = $('sky-chart');
    if (!hourIndexes.length) {
      target.innerHTML = '<p class="sky-chart-empty">لا تتوفر توقعات للساعات المطلوبة. أعد تحديث البيانات.</p>';
      $('sky-table-body').replaceChildren(); return;
    }
    const points = hourIndexes;
    const temps = points.map((i) => valueAt('temperature_2m', i));
    const rains = points.map((i) => valueAt('precipitation', i));
    const speed = (key, i) => {
      const value = valueAt(key, i), unit = forecast.hourly_units?.[key];
      return value === null ? null : unit === 'm/s' ? value * 3.6 : unit === 'km/h' ? value : null;
    };
    const winds = points.map((i) => speed('wind_speed_10m', i));
    const gusts = points.map((i) => speed('wind_gusts_10m', i));
    const finite = temps.filter((v) => v !== null);
    const min = finite.length ? Math.floor(Math.min(...finite) - 2) : 0;
    const max = finite.length ? Math.ceil(Math.max(...finite) + 2) : 10;
    const rainMax = Math.max(1, ...rains.filter((v) => v !== null));
    const windMax = Math.max(20, Math.ceil(Math.max(...winds, ...gusts) / 10) * 10);
    const w = Math.max(640, points.length * (period === 120 ? 14 : 20) + 90), h = 610;
    const left = 48, right = w - 47;
    const x = (n) => left + n * (right - left) / Math.max(1, points.length - 1);
    const panels = [{ top: 38, bottom: 176, min, max, color: '#d8bb84', label: 'الحرارة °م' }, { top: 245, bottom: 355, min: 0, max: rainMax, color: '#92c6ed', label: 'المطر ملم/ساعة · السحب ٪' }, { top: 429, bottom: 551, min: 0, max: windMax, color: '#96badc', label: 'الرياح والهبّات كم/س' }];
    const y = (value, panel) => panel.bottom - (value - panel.min) / (panel.max - panel.min) * (panel.bottom - panel.top);
    const title = period === 120 ? 'توقعات خمسة أيام' : `توقعات ${format(period)} ساعة`;
    let svg = `<svg viewBox="0 0 ${w} ${h}" style="width:${w}px;min-width:${w}px" role="img" aria-labelledby="sky-chart-title sky-chart-desc"><title id="sky-chart-title">${title}: الحرارة والمطر والسحب والرياح</title><desc id="sky-chart-desc">ثلاثة رسوم متزامنة. الوقت من اليسار إلى اليمين بتوقيت السعودية. المطر كمية الساعة المنتهية عند الوقت المعروض. السحب نسبة غطاء سحابي وليست ارتفاع السحب. جدول القيم متاح أسفل الرسم.</desc>`;
    points.forEach((index, n) => {
      const time = forecast.hourly.time[index], day = time.slice(0, 10);
      const dailyIndex = forecast.daily?.time?.indexOf(day) ?? -1;
      const sunrise = epoch(forecast.daily?.sunrise?.[dailyIndex]);
      const sunset = epoch(forecast.daily?.sunset?.[dailyIndex]);
      const instant = epoch(time);
      if (instant >= sunrise && instant < sunset) svg += `<rect x="${x(n) - 1}" y="29" width="${(right - left) / points.length + 2}" height="530" fill="#e5cc95" opacity=".035"/>`;
      if (n === 0 || time.slice(11, 13) === '00') {
        svg += `<line x1="${x(n)}" x2="${x(n)}" y1="26" y2="565" stroke="#566580" stroke-width=".7"/><text x="${x(n) + 5}" y="15" text-anchor="start" fill="#c2d1e4" font-size="10">${dateFormat.format(new Date(instant))}</text>`;
      }
    });
    panels.forEach((panel, panelIndex) => {
      svg += `<text x="${left}" y="${panel.top - 10}" fill="${panel.color}" font-size="11">${panel.label}</text>`;
      for (let row = 0; row <= 3; row++) {
        const value = panel.max - row * (panel.max - panel.min) / 3, py = y(value, panel);
        svg += `<line x1="${left}" x2="${right}" y1="${py}" y2="${py}" stroke="#2b3a50" stroke-dasharray="3 5"/><text x="${left - 9}" y="${py + 4}" text-anchor="end" fill="#aab9cc" font-size="10">${format(value, panelIndex === 1 ? 1 : 0)}</text>`;
      }
      points.forEach((index, n) => {
        if (n % (period === 120 ? 12 : period === 48 ? 8 : 4) === 0 || n === points.length - 1) svg += `<text x="${x(n)}" y="${panel.bottom + 19}" text-anchor="middle" fill="#aab9cc" font-size="10">${hourFormat.format(new Date(epoch(forecast.hourly.time[index])))}</text>`;
      });
    });
    const line = (values, panel, color, width) => {
      let path = '', connected = false;
      values.forEach((value, n) => { if (value === null) { connected = false; return; } path += `${connected ? 'L' : 'M'}${x(n).toFixed(1)} ${y(value, panel).toFixed(1)} `; connected = true; });
      return `<path d="${path}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round"/>`;
    };
    svg += line(temps, panels[0], '#d8bb84', 2.5);
    points.forEach((index, n) => {
      const rain = rains[n], cloud = valueAt('cloud_cover', index);
      if (cloud !== null) svg += `<rect x="${x(n) - 3}" y="${panels[1].top}" width="${Math.max(5, (right - left) / points.length)}" height="16" fill="#bec9d8" opacity="${Math.min(1, Math.max(0, cloud / 100)) * .65}"><title>الغطاء السحابي: ${format(cloud)}٪</title></rect>`;
      if (rain !== null && rain > 0) svg += `<rect x="${x(n) - 3}" y="${y(rain, panels[1])}" width="6" height="${panels[1].bottom - y(rain, panels[1])}" rx="2" fill="#7bb8e3"><title>${format(rain, 1)} ملم</title></rect>`;
      if (temps[n] !== null && n % (period === 120 ? 4 : 1) === 0) svg += `<circle cx="${x(n)}" cy="${y(temps[n], panels[0])}" r="2.3" fill="#d8bb84"><title>${hourFormat.format(new Date(epoch(forecast.hourly.time[index])))}: ${format(temps[n], 1)}°</title></circle>`;
      const direction = valueAt('wind_direction_10m', index);
      if (direction !== null && n % (period === 120 ? 6 : 3) === 0) svg += `<g transform="translate(${x(n)},409) rotate(${direction + 180})" stroke="#b9cce1" fill="none" stroke-width="1.3"><title>رياح قادمة من ${format(direction)} درجة</title><path d="M0 7V-7m-4 4 4-4 4 4"/></g>`;
    });
    svg += line(winds, panels[2], '#92c6ed', 2.4) + line(gusts, panels[2], '#9ac7b5', 1.8);
    svg += `<text x="${left}" y="593" fill="#92c6ed" font-size="10">الأزرق: سرعة الرياح</text><text x="${left + 165}" y="593" fill="#9ac7b5" font-size="10">الأخضر: الهبّات</text><text x="${left + 330}" y="593" fill="#bec9d8" font-size="10">الرمادي: الغطاء السحابي</text>`;
    target.innerHTML = svg + '</svg>';
    $('sky-table-body').innerHTML = points.map((i) => `<tr><td>${dateFormat.format(new Date(epoch(forecast.hourly.time[i])))} · ${hourFormat.format(new Date(epoch(forecast.hourly.time[i])))}</td><td>${format(valueAt('temperature_2m', i), 1)}</td><td>${format(valueAt('precipitation', i), 1)}</td><td>${format(valueAt('cloud_cover', i))}</td><td>${format(speed('wind_speed_10m', i))}</td><td>${format(speed('wind_gusts_10m', i))}</td></tr>`).join('');
  }
  function renderDays() {
    const daily = forecast.daily;
    if (!Array.isArray(daily?.time)) {
      $('sky-days').innerHTML = '<p class="sky-chart-empty">التوقعات اليومية غير متاحة.</p>';
      return;
    }
    const days = daily.time.map((time, i) => ({ time, i })).filter(({ time }) => time >= dateKey()).slice(0, 7);
    $('sky-days').innerHTML = days.length ? days.map(({ time, i }) => {
      const date = new Date(epoch(time + 'T12:00'));
      const rain = number(daily.precipitation_sum?.[i]);
      return `<div class="sky-day"><div class="sky-day-name">${time === dateKey() ? 'اليوم' : dayFormat.format(date)}<small>${dateFormat.format(date)}</small></div><span role="img" aria-label="${condition(number(daily.weather_code?.[i]))[1]}">${icon(number(daily.weather_code?.[i]))}</span><div class="sky-day-temp" aria-label="الصغرى ثم العظمى"><span class="low">${format(number(daily.temperature_2m_min?.[i]))}°</span><span class="high">${format(number(daily.temperature_2m_max?.[i]))}°</span></div><div class="sky-day-rain">${format(rain, 1)} ملم</div></div>`;
    }).join('') : '<p class="sky-chart-empty">التوقعات اليومية المحفوظة انتهت. أعد التحديث.</p>';
  }
  function render(data, savedAt, stale) {
    forecast = data;
    fetchedAt = savedAt;
    cacheStale = stale;
    currentIndex = chooseIndex(data.hourly.time);
    // Keep existing sun/prayer helpers supplied with the same forecast data.
    _wxData = data;
    renderCurrent(); renderHours(); renderDays(); renderHome();
    if (!stale && typeof checkWeatherNotifications === 'function') checkWeatherNotifications(data);
  }
  async function load(force = false) {
    if (inFlight) return inFlight;
    const cache = readCache();
    if (!force && cache && Date.now() - cache.savedAt < CACHE_TTL && chooseIndex(cache.data.hourly.time) >= 0) {
      const offline = navigator.onLine === false;
      render(cache.data, cache.savedAt, offline);
      status(offline ? 'نسخة محفوظة دون اتصال؛ راجع وقت الجلب قبل الاعتماد عليها.' : 'توقعات فيفاء · توقيت السعودية · تقديرات نموذجية وليست رصدًا من محطة محلية.', offline ? 'stale' : 'ready');
      return;
    }
    if (cache && !forecast) render(cache.data, cache.savedAt, true);
    $('sky-refresh').disabled = true;
    set('sky-refresh-label', 'جارٍ التحديث');
    status('جارٍ جلب توقعات فيفاء…', 'loading');
    inFlight = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(requestUrl(), { signal: controller.signal });
        if (!response.ok) throw new Error(`Weather HTTP ${response.status}`);
        const data = await response.json();
        if (!validData(data) || chooseIndex(data.hourly.time) < 0) throw new Error('Forecast does not cover the current hour');
        const savedAt = Date.now();
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt, data })); } catch (_) { /* Optional cache. */ }
        render(data, savedAt, false);
        status('توقعات فيفاء · توقيت السعودية · تقديرات نموذجية وليست رصدًا من محطة محلية.', 'ready');
      } catch (_) {
        const fallback = readCache();
        if (fallback) {
          render(fallback.data, fallback.savedAt, true);
          status('تعذر التحديث. المعروض نسخة محفوظة؛ راجع وقت الجلب قبل الاعتماد عليها.', 'stale');
        } else {
          forecast = null;
          resetDisplay();
          status('تعذر الاتصال بمصدر الطقس. لا توجد بيانات محفوظة؛ أعد المحاولة عند توفر الاتصال.', 'error');
          set('v2-desc', 'تعذر تحميل التوقعات');
          set('sky-home-update', 'البيانات غير متاحة · أعد المحاولة من صفحة الطقس');
        }
      } finally {
        clearTimeout(timer);
        $('sky-refresh').disabled = false;
        set('sky-refresh-label', 'تحديث');
        inFlight = null;
      }
    })();
    return inFlight;
  }
  function resetDisplay() {
    ['sky-temp', 'sky-high', 'sky-low', 'sky-wind', 'sky-humidity', 'sky-rain', 'v2-temp'].forEach((id) => set(id, '—'));
    set('sky-condition', 'البيانات غير متاحة');
    set('sky-updated', 'لم تُجلب بيانات متاحة للعرض');
    $('sky-icon').innerHTML = icon(null);
    $('v2-icon').innerHTML = icon(null);
    set('v2-hilo', 'العظمى — · الصغرى —');
    $('sky-hours').replaceChildren();
    $('sky-days').innerHTML = '<p class="sky-chart-empty">تظهر التوقعات هنا بعد الاتصال بالمصدر.</p>';
    $('sky-chart').innerHTML = '<p class="sky-chart-empty">لا توجد بيانات لرسم التوقعات.</p>';
    $('sky-table-body').replaceChildren();
  }
  function mapNotice(message) {
    $('sky-map-notice').hidden = false;
    set('sky-map-notice', message);
  }
  function rainColor(rain) {
    if (rain === null) return '#a9b0ba';
    if (rain === 0) return '#607388';
    if (rain < 1) return '#85c9ed';
    if (rain < 5) return '#458ee0';
    if (rain < 10) return '#b3a0eb';
    return '#e3ab6d';
  }
  function renderRainMap() {
    if (!rainLayer || !mapForecasts.length) return;
    const base = Math.floor(Date.now() / 3600000) * 3600000;
    const selectedTime = base + (mapHour + 1) * 3600000;
    rainLayer.clearLayers();
    mapForecasts.forEach((point) => {
      const index = point.hourly.time.findIndex((time) => epoch(time) === selectedTime);
      const rain = number(point.hourly.precipitation[index]);
      const label = `خلية النموذج ${point.latitude.toFixed(2)}° N، ${point.longitude.toFixed(2)}° E: ${rain === null ? 'بيانات غير متاحة' : format(rain, 1) + ' ملم خلال الساعة'}`;
      const marker = L.circleMarker([point.latitude, point.longitude], { radius: 14, color: rainColor(rain), fillColor: rainColor(rain), fillOpacity: rain === null || rain === 0 ? .18 : .65, weight: 2, dashArray: rain === null ? '3 3' : null });
      marker.bindTooltip(label, { direction: 'top' }).bindPopup(label).addTo(rainLayer);
    });
    set('sky-map-time', stampFormat.format(new Date(selectedTime)) + ' · نهاية ساعة التوقع');
    set('sky-map-data-note', `جُلبت ${stampFormat.format(new Date(mapSavedAt))} · ${format(mapForecasts.length)} نقاط نموذج · توقيت السعودية`);
    // The equivalent table is usable without tiles, hover or map interaction.
    $('sky-map-table-body').innerHTML = mapForecasts.map((point) => {
      const index = point.hourly.time.findIndex((time) => epoch(time) === selectedTime);
      return `<tr><td dir="ltr">${point.latitude.toFixed(2)}° N, ${point.longitude.toFixed(2)}° E</td><td>${format(number(point.hourly.precipitation[index]), 1)}</td></tr>`;
    }).join('');
  }
  async function loadMap() {
    if (mapLoading) return;
    if (!window.L) {
      mapNotice('تعذر تحميل مكوّن الخريطة المحلي. أعد تحميل الصفحة.');
      return;
    }
    if (!rainMap) {
      $('sky-map-placeholder').hidden = true;
      $('sky-rain-map').hidden = false;
      rainMap = L.map('sky-rain-map', { scrollWheelZoom: false, attributionControl: true }).setView([LOCATION.latitude, LOCATION.longitude], 9);
      const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 13,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
      }).addTo(rainMap);
      let tileWarning = false;
      tiles.on('tileerror', () => { tileWarning = true; mapNotice('تعذر تحميل بعض صور الخريطة الأساسية. نقاط التوقعات والجدول قد يظلان متاحين؛ لا تعتبر الخلفية الفارغة خريطة مكتملة.'); });
      tiles.on('load', () => { if (!tileWarning && mapForecasts.length) mapNotice('النقاط تمثل مواقع خلايا النموذج، وليست رادارًا أو قياسات مطر فعلية. قرّب الخريطة واختر نقطة لعرض الكمية.'); });
      L.circleMarker([LOCATION.latitude, LOCATION.longitude], { radius: 5, color: '#111e30', weight: 2, fillColor: '#e2bc73', fillOpacity: 1 }).bindTooltip('فيفاء · موقع الطلب', { permanent: true, direction: 'bottom' }).addTo(rainMap);
      rainLayer = L.layerGroup().addTo(rainMap);
      setTimeout(() => rainMap.invalidateSize(), 0);
    }
    mapLoading = true;
    $('sky-map-refresh').disabled = true;
    mapNotice('جارٍ جلب كميات المطر المتوقعة حول فيفاء…');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      // Nine point forecasts, fetched only on request. No spatial interpolation or simulated radar.
      const points = [-.3, 0, .3].flatMap((lat) => [-.3, 0, .3].map((lon) => [LOCATION.latitude + lat, LOCATION.longitude + lon]));
      const url = new URL('https://api.open-meteo.com/v1/ecmwf');
      url.search = new URLSearchParams({ latitude: points.map((p) => p[0].toFixed(4)).join(','), longitude: points.map((p) => p[1].toFixed(4)).join(','), hourly: 'precipitation', forecast_days: '2', timezone: TIME_ZONE });
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Rain map HTTP ${response.status}`);
      const data = await response.json();
      const base = (Math.floor(Date.now() / 3600000) + 1) * 3600000;
      const valid = Array.isArray(data) ? data.filter((point) => number(point.latitude) !== null && number(point.longitude) !== null && Array.isArray(point.hourly?.time) && Array.isArray(point.hourly?.precipitation) && point.hourly.time.length === point.hourly.precipitation.length && point.hourly.time.some((time, i) => epoch(time) === base && number(point.hourly.precipitation[i]) !== null)) : [];
      if (!valid.length) throw new Error('Rain map has no usable current forecast');
      // The provider can return the same grid cell for two requested points.
      const unique = new Map(valid.map((point) => [`${point.latitude},${point.longitude}`, point]));
      mapForecasts = [...unique.values()];
      mapSavedAt = Date.now();
      $('sky-map-controls').hidden = false;
      $('sky-map-table').hidden = false;
      mapNotice('النقاط تمثل مواقع خلايا النموذج، وليست رادارًا أو قياسات مطر فعلية. إذا لم تظهر الخلفية الجغرافية فراجع جدول النقاط أدناه.');
      renderRainMap();
    } catch (_) {
      mapNotice(mapForecasts.length ? 'تعذر تحديث نقاط المطر. المعروض من الجلب السابق؛ راجع وقته أسفل الخريطة.' : 'تعذر جلب نقاط توقع المطر. ظهور الخريطة الأساسية وحدها لا يعني توفر بيانات المطر. أعد المحاولة.');
    } finally {
      clearTimeout(timeout);
      mapLoading = false;
      $('sky-map-refresh').disabled = false;
      $('sky-map-refresh').hidden = false;
    }
  }

  // Replace the old loader before its DOMContentLoaded handler runs. All callers share one request.
  window.loadWeather = load;
  document.addEventListener('DOMContentLoaded', () => {
    $('sky-date').textContent = dateFormat.format(new Date());
    $('sky-refresh').addEventListener('click', () => load(true));
    document.querySelectorAll('[data-sky-period]').forEach((button) => button.addEventListener('click', () => {
      period = Number(button.dataset.skyPeriod);
      document.querySelectorAll('[data-sky-period]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
      if (forecast) renderHours();
    }));
    $('sky-load-map').addEventListener('click', loadMap);
    $('sky-map-refresh').addEventListener('click', loadMap);
    $('sky-map-hour').addEventListener('input', (event) => { mapHour = Number(event.target.value); renderRainMap(); });
    $('sky-map-now').addEventListener('click', () => { mapHour = 0; $('sky-map-hour').value = '0'; renderRainMap(); });
    window.addEventListener('online', () => load(true));
    // Freshen both the chosen hour and the forecast after the tab returns from sleep.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
    setInterval(() => { if (!document.hidden) load(); }, 5 * 60 * 1000);
  });
})();
