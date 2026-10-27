/* Free weather forecasts with no account or API key required. */
(() => {
  'use strict';
  const CACHE_KEY = 'faifaWeatherCalmV3';
  const CACHE_TTL = 30 * 60 * 1000;
  const MAX_CACHE_AGE = 24 * 60 * 60 * 1000;
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
  let period = 120;
  let inFlight = null;
  let currentIndex = -1;
  let hourIndexes = [];
  let cacheStale = false;


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
    const node = $('sky-status');
    node.dataset.state = state;
    node.hidden = state === 'ready';
    node.textContent = state === 'ready' ? '' : message;
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
    url.searchParams.set('hourly', 'temperature_2m,relative_humidity_2m,dew_point_2m,surface_pressure,cloud_cover,cloud_cover_low,cloud_cover_mid,cloud_cover_high,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m');
    return url;
  }
  function renderHome() {
    const code = valueAt('weather_code', currentIndex);
    const temp = valueAt('temperature_2m', currentIndex);
    const today = forecast.daily?.time?.indexOf(dateKey()) ?? -1;
    set('v2-temp', `${format(temp)}°`);
    $('v2-icon').innerHTML = icon(code);
    set('v2-desc', currentIndex < 0 ? 'لا تتوفر توقعات لهذه الساعة' : forecast.hourly.weather_description?.[currentIndex] || condition(code)[1]);
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
    set('sky-condition', i < 0 ? 'لا تتوفر توقعات لهذه الساعة' : forecast.hourly.weather_description?.[i] || condition(valueAt('weather_code', i))[1]);
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
    const start = period === 120 && currentIndex >= 0 ? forecast.hourly.time.findIndex((t) => t.startsWith(dateKey())) : currentIndex;
    hourIndexes = start < 0 || currentIndex < 0 ? [] : Array.from({ length: Math.min(period, forecast.hourly.time.length - start) }, (_, i) => start + i);
    const nextHours = currentIndex < 0 ? [] : Array.from({ length: Math.min(12, forecast.hourly.time.length - currentIndex) }, (_, i) => currentIndex + i);
    $('sky-hours').innerHTML = nextHours.map((i) => `<div class="sky-hour"><span class="sky-hour-time">${hourFormat.format(new Date(epoch(forecast.hourly.time[i])))}</span>${icon(valueAt('weather_code', i))}<strong class="sky-hour-temp">${format(valueAt('temperature_2m', i))}°</strong><span class="sky-hour-rain">${format(valueAt('precipitation', i), 1)} ملم</span></div>`).join('');
    renderChart();
  }
  function renderChart() {
    const target = $('sky-chart');
    if (!hourIndexes.length) { target.innerHTML = '<p class="sky-chart-empty">لا تتوفر توقعات للساعات المطلوبة.</p>'; $('sky-table-body').replaceChildren(); return; }
    const points = hourIndexes, times = points.map((i) => forecast.hourly.time[i]);
    const temperatures = points.map((i) => valueAt('temperature_2m', i));
    const rain = points.map((i) => valueAt('precipitation', i));
    const speed = (key, i) => { const v = valueAt(key, i), unit = forecast.hourly_units?.[key]; return v === null ? null : unit === 'm/s' ? v * 3.6 : unit === 'km/h' ? v : null; };
    const wind = points.map((i) => speed('wind_speed_10m', i)), gust = points.map((i) => speed('wind_gusts_10m', i));
    const finite = temperatures.filter((v) => v !== null);
    const minimum = finite.length ? Math.floor((Math.min(...finite) - 3) / 5) * 5 : 0;
    const maximum = finite.length ? Math.ceil((Math.max(...finite) + 5) / 5) * 5 : 35;
    const rainMax = Math.max(5, Math.ceil(Math.max(0, ...rain.filter((v) => v !== null))));
    const windMax = Math.max(50, Math.ceil(Math.max(0, ...wind.filter((v) => v !== null), ...gust.filter((v) => v !== null)) / 25) * 25);
    const width = 1560, height = 1010, left = 100, right = 1455;
    const panels = [{ top: 150, bottom: 365, min: minimum, max: maximum }, { top: 425, bottom: 640, min: 0, max: rainMax }, { top: 700, bottom: 890, min: 0, max: windMax }];
    const step = (right - left) / points.length;
    const x = (n) => left + (n + .5) * step;
    const y = (v, p) => p.bottom - (v - p.min) / (p.max - p.min) * (p.bottom - p.top);
    const groups = [];
    times.forEach((time, n) => { const date = time.slice(0, 10); let group = groups.at(-1); if (!group || group.date !== date) { group = { date, start: n, end: n }; groups.push(group); } group.end = n; });
    const daylight = new Map();
    const isDay = (time) => {
      const key = time.slice(0,10), d = forecast.daily?.time?.indexOf(key) ?? -1;
      if (!daylight.has(key)) {
        let rise = epoch(forecast.daily?.sunrise?.[d]), set = epoch(forecast.daily?.sunset?.[d]);
        if ((!Number.isFinite(rise) || !Number.isFinite(set)) && window.SunCalc) {
          const solar = SunCalc.getTimes(new Date(key+'T12:00:00+03:00'),17.2478,43.1035); rise=solar.sunrise.getTime();set=solar.sunset.getTime();
        }
        daylight.set(key,[rise,set]);
      }
      const [rise,set] = daylight.get(key), t=epoch(time); return t>=rise && t<set;
    };
    const chartTitle = period === 120 ? 'توقعات فيفاء · خمسة أيام' : `توقعات فيفاء · ${format(period)} ساعة`;
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" style="font-family:Tahoma,Arial,sans-serif" role="img" aria-labelledby="sky-chart-title sky-chart-desc"><title id="sky-chart-title">${chartTitle}</title><desc id="sky-chart-desc">خلفية فاتحة وثلاثة رسوم متزامنة للحرارة والمطر وطبقات السحب والرياح. طبقات السحب فئات منخفضة ومتوسطة وعالية وليست قياس ارتفاع بالكيلومتر. القيم الناقصة لا ترسم. الوقت بتوقيت السعودية.</desc><defs><clipPath id="sky-temp-clip"><rect x="${left}" y="150" width="${right-left}" height="215"/></clipPath><linearGradient id="sky-temperature-colors" x1="0" y1="1" x2="0" y2="0">`;
    const stops = [[-10,'#6559ba'],[0,'#23bcbd'],[10,'#15b8a1'],[15,'#319a2d'],[20,'#9ef52b'],[25,'#f2ff10'],[30,'#ffbf00'],[35,'#ff7900'],[40,'#fa2920'],[50,'#b50930']];
    stops.forEach(([t,c]) => svg += `<stop offset="${Math.max(0,Math.min(100,(t-minimum)/(maximum-minimum)*100))}%" stop-color="${c}"/>`);
    svg += `</linearGradient></defs><rect width="${width}" height="${height}" fill="white"/><text x="${right}" y="40" text-anchor="end" fill="#18273a" font-size="27" font-weight="600">${chartTitle}</text><text x="${right}" y="73" text-anchor="end" fill="#596474" font-size="17">جبال فيفاء · ارتفاع الطلب ١٢٠٠ متر</text><text x="${left}" y="73" text-anchor="start" direction="ltr" fill="#596474" font-size="17">17.2478° N, 43.1035° E</text>`;
    panels.forEach((p, panelIndex) => {
      svg += `<rect x="${left}" y="${p.top}" width="${right-left}" height="${p.bottom-p.top}" fill="#fff"/>`;
      times.forEach((time,n) => { if (isDay(time)) svg += `<rect x="${left+n*step}" y="${p.top}" width="${step+.2}" height="${p.bottom-p.top}" fill="#f3f7c8"/>`; });
      for(let row=0;row<=5;row++) {
        const v=p.min+(p.max-p.min)*row/5, py=y(v,p);
        svg += `<line x1="${left}" x2="${right}" y1="${py}" y2="${py}" stroke="#555" stroke-width=".7" stroke-dasharray="1 4"/><text x="${left-12}" y="${py+6}" text-anchor="end" fill="#222" font-size="19">${format(v,panelIndex===1?1:0)}</text>`;
      }
      groups.forEach((g) => { const px=left+g.start*step;svg+=`<line x1="${px}" x2="${px}" y1="${p.top}" y2="${p.bottom}" stroke="#333" stroke-width="1"/>`; });
      times.forEach((time,n) => {
        const hour=Number(time.slice(11,13));
        if(hour%3===0) svg+=`<line x1="${x(n)}" x2="${x(n)}" y1="${p.bottom-9}" y2="${p.bottom}" stroke="#222"/>`;
        if(hour%6===0) svg+=`<text x="${x(n)}" y="${p.bottom+27}" text-anchor="middle" fill="#222" font-size="18">${String(hour).padStart(2,'0')}</text>`;
      });
      svg+=`<rect x="${left}" y="${p.top}" width="${right-left}" height="${p.bottom-p.top}" fill="none" stroke="#333"/>`;
    });
    groups.forEach((g) => { const date=new Date(epoch(g.date+'T12:00')), center=left+(g.start+g.end+1)*step/2;svg+=`<text x="${center}" y="112" text-anchor="middle" fill="#222" font-size="23">${dayFormat.format(date)}</text><text x="${center}" y="140" text-anchor="middle" fill="#222" font-size="19">${g.date.slice(8,10)}.${g.date.slice(5,7)}</text>`; });
    const pathFor = (values,p,maxGap=1) => { let path='', previous=null;values.forEach((v,n)=>{if(v===null)return;const connect=previous!==null&&n-previous<=maxGap;path+=`${connect?'L':'M'}${x(n).toFixed(2)} ${y(v,p).toFixed(2)} `;previous=n;});return path; };
    // Each contiguous segment gets its own area; missing hours remain real gaps.
    let segment=[];
    const fillSegment=()=>{if(!segment.length)return;const p=panels[0];let d=`M${x(segment[0][0])} ${p.bottom} `;segment.forEach(([n,v])=>d+=`L${x(n)} ${y(v,p)} `);d+=`L${x(segment.at(-1)[0])} ${p.bottom}Z`;svg+=`<path d="${d}" fill="url(#sky-temperature-colors)" clip-path="url(#sky-temp-clip)"/>`;segment=[];};
    temperatures.forEach((v,n)=>{if(v===null)fillSegment();else segment.push([n,v]);});fillSegment();
    svg+=`<path d="${pathFor(temperatures,panels[0])}" fill="none" stroke="#f3130c" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`;
    const weatherGlyph = (index, n) => {
      const code=valueAt('weather_code',index), night=!isDay(times[n]);
      const kind=condition(code)[0];if(kind==='unknown')return '';
      let paths=iconPaths[kind];
      if(night&&kind==='sun')paths='<path d="M31 5a19 19 0 1 0 9 32A19 19 0 0 1 31 5Z" fill="#f7f7ee"/>';
      else if(kind==='sun')paths='<circle cx="24" cy="24" r="9" fill="#ffe551"/>'+iconPaths.sun;
      const py=Math.max(158,Math.min(310,y(temperatures[n]??minimum,panels[0])-43));
      return `<svg x="${x(n)-22}" y="${py}" width="44" height="44" viewBox="0 0 48 48" fill="none" stroke="${kind==='sun'&&!night?'#c9a923':'#596878'}" stroke-width="2" aria-hidden="true">${paths}</svg>`;
    };
    points.forEach((index,n)=>{if(Number(times[n].slice(11,13))%6===0)svg+=weatherGlyph(index,n);});
    groups.forEach((g)=>{
      const available=temperatures.slice(g.start,g.end+1).map((v,k)=>({v,n:g.start+k})).filter(({v})=>v!==null);
      if(!available.length)return;
      for(const mode of ['min','max']){const best=available.reduce((a,b)=>mode==='min'?(a.v<b.v?a:b):(a.v>b.v?a:b));svg+=`<text x="${x(best.n)}" y="${Math.max(175,Math.min(357,y(best.v,panels[0])+(mode==='min'?22:27)))}" fill="#171717" text-anchor="middle" font-size="21">${format(best.v)}</text>`;}
    });
    const layers=[['cloud_cover_high','عالية'],['cloud_cover_mid','متوسطة'],['cloud_cover_low','منخفضة']];
    layers.forEach(([key,label],layer)=>{
      const cy=panels[1].top+25+layer*59;
      [[10,'#dedede'],[25,'#bcbcbc'],[50,'#969696'],[75,'#737373'],[90,'#505050']].forEach(([threshold,color])=>{
        let run=[];
        const finish=()=>{if(!run.length)return;let d=`M${x(run[0].n)-step/2} ${cy} `;for(const {n,v} of run)d+=`L${x(n)} ${cy-(5+12*(v-threshold)/(100-threshold))} `;d+=`L${x(run.at(-1).n)+step/2} ${cy} `;for(const {n,v} of [...run].reverse())d+=`L${x(n)} ${cy+(5+12*(v-threshold)/(100-threshold))} `;svg+=`<path d="${d}Z" fill="${color}"><title>سحب ${label}: تغطية ${format(threshold)}٪ فأكثر</title></path>`;run=[];};
        points.forEach((index,n)=>{const v=valueAt(key,index);if(v===null||v<threshold)finish();else run.push({n,v});});finish();
      });
      svg+=`<text x="${right+10}" y="${cy+5}" fill="#444" font-size="16">${label}</text>`;
    });
    rain.forEach((v,n)=>{if(v===null||v<=0)return;const py=y(v,panels[1]);svg+=`<rect x="${x(n)-Math.max(2,step*.25)}" y="${py}" width="${Math.max(4,step*.5)}" height="${panels[1].bottom-py}" fill="#1739ff"><title>${format(v,1)} ملم · ${times[n]}</title></rect>`;});
    svg+=`<path d="${pathFor(wind,panels[2])}" fill="none" stroke="#40b5ff" stroke-width="4"/><path d="${pathFor(gust,panels[2],forecast.sampling?.wind_gusts_10m_hours===3?3:1)}" fill="none" stroke="#159da2" stroke-width="3"/>`;
    points.forEach((index,n)=>{const d=valueAt('wind_direction_10m',index);if(d===null||Number(times[n].slice(11,13))%3!==0)return;svg+=`<g transform="translate(${x(n)},719) rotate(${d+180})" fill="none" stroke="#111" stroke-width="2.7"><title>رياح قادمة من ${format(d)}°</title><path d="M0 13V-13m-5 7 5-7 5 7"/></g>`;});
    const now=(Date.now()-epoch(times[0]))/3600000;
    if(now>=0&&now<points.length){const px=left+(now+.5)*step;panels.forEach((p)=>svg+=`<line x1="${px}" x2="${px}" y1="${p.top}" y2="${p.bottom}" stroke="#111" stroke-width="2" stroke-dasharray="7 5"/>`);svg+=`<text x="${px}" y="94" text-anchor="middle" fill="#333" font-size="15">الآن</text>`;}
    for(const [label,p,color] of [['الحرارة °م',panels[0],'#222'],['المطر ملم/ساعة',panels[1],'#1739ff'],['سرعة الرياح كم/س',panels[2],'#40b5ff']])svg+=`<text transform="translate(30 ${(p.top+p.bottom)/2}) rotate(-90)" text-anchor="middle" fill="${color}" font-size="22">${label}</text>`;
    svg+=`<text transform="translate(1530 530) rotate(90)" text-anchor="middle" fill="#444" font-size="19">طبقات السحب</text><text transform="translate(1520 795) rotate(90)" text-anchor="middle" fill="#159da2" font-size="20">هبّات الرياح كم/س</text>`;
    for(let row=0;row<=2;row++){const v=windMax*row/2;svg+=`<text x="${right+12}" y="${y(v,panels[2])+6}" fill="#159da2" font-size="18">${format(v)}</text>`;}
    [[10,25,'#dedede'],[25,50,'#bcbcbc'],[50,75,'#969696'],[75,90,'#737373'],[90,100,'#505050']].forEach(([a,b,c],i)=>{const px=left+50+i*155;svg+=`<circle cx="${px}" cy="947" r="9" fill="${c}"/><text x="${px+17}" y="953" fill="#444" font-size="16">${a}–${b}%</text>`;});
    svg+=`<text x="${left}" y="990" fill="#777" font-size="16">وقت جلب البيانات: ${stampFormat.format(new Date(fetchedAt))} · توقيت السعودية</text><text x="${right}" y="990" text-anchor="end" fill="#555" font-size="16">الرمادي: كثافة السحب · الأزرق: المطر · الخلفية الفاتحة: النهار</text></svg>`;
    target.innerHTML=svg;
    if (forecast.sampling?.cloud_cover_hours===3) { const note=document.createElement('p');note.className='sky-sampling-note';note.textContent='الحرارة والمطر كل ساعة · السحب والهبّات كل ٣ ساعات';target.append(note); }
    $('sky-table-body').innerHTML=points.map((i)=>`<tr><td>${dateFormat.format(new Date(epoch(forecast.hourly.time[i])))} · ${hourFormat.format(new Date(epoch(forecast.hourly.time[i])))}</td><td>${format(valueAt('temperature_2m',i),1)}</td><td>${format(valueAt('precipitation',i),1)}</td><td>${format(valueAt('cloud_cover',i))}</td><td>${format(speed('wind_speed_10m',i))}</td><td>${format(speed('wind_gusts_10m',i))}</td></tr>`).join('');
    $('sky-chart-expand').disabled=false;
  }
  function renderDays() {
    const daily = forecast.daily;
    if (!Array.isArray(daily?.time)) {
      $('sky-days').innerHTML = '<p class="sky-chart-empty">التوقعات اليومية غير متاحة.</p>';
      return;
    }
    const days = daily.time.map((time, i) => ({ time, i })).filter(({ time }) => time >= dateKey()).slice(0, 5);
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
      status(offline ? 'نسخة محفوظة دون اتصال؛ راجع وقت الجلب قبل الاعتماد عليها.' : '', offline ? 'stale' : 'ready');
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
        status('', 'ready');
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
    $('sky-chart-expand').addEventListener('click', () => {
      const chart = $('sky-chart').querySelector('svg'); if (!chart) return;
      $('sky-chart-large').replaceChildren(chart.cloneNode(true));
      // Clone-local IDs prevent duplicate SVG gradients and accessible titles.
      const clone = $('sky-chart-large').querySelector('svg');
      for (const node of clone.querySelectorAll('[id]')) node.id += '-large';
      clone.setAttribute('aria-labelledby', 'sky-chart-title-large sky-chart-desc-large');
      for (const node of clone.querySelectorAll('[fill],[clip-path]')) for (const attr of ['fill','clip-path']) { const v=node.getAttribute(attr); if(v?.startsWith('url(#')) node.setAttribute(attr,v.replace(')', '-large)')); }
      $('sky-chart-dialog').showModal();
    });
    $('sky-chart-close').addEventListener('click', () => $('sky-chart-dialog').close());
    window.addEventListener('online', () => load(true));
    // Freshen both the chosen hour and the forecast after the tab returns from sleep.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
    setInterval(() => { if (!document.hidden) load(); }, 5 * 60 * 1000);
  });
})();
