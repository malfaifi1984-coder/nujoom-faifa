/* Home presents the shared forecast; this component never starts a request. */
const number = new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 0 });
const clock = new Intl.DateTimeFormat('ar-SA', { timeZone: 'Asia/Riyadh', hour: 'numeric', minute: '2-digit' });
const datedClock = new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { timeZone: 'Asia/Riyadh', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' });
const finite = value => typeof value === 'number' && Number.isFinite(value);

export function mountHomeWeatherSummary(root) {
  if (!root) return null;
  const temperature = root.querySelector('#home-weather-temperature');
  const wind = root.querySelector('#home-weather-wind');
  const status = root.querySelector('#home-weather-status');
  if (!temperature || !wind || !status) return null;

  function render(forecast, { state = 'ready', fetchedAt } = {}) {
    const current = forecast?.current;
    const knownTemperature = finite(current?.temperature);
    const knownWind = finite(current?.windSpeed);
    const hasData = knownTemperature;
    const stamp = finite(fetchedAt) && fetchedAt > 0
      ? (dayKey.format(new Date(fetchedAt)) === dayKey.format(new Date()) ? clock : datedClock).format(new Date(fetchedAt)) : '';
    temperature.textContent = knownTemperature ? `${number.format(current.temperature)}°` : '—';
    wind.textContent = hasData
      ? knownWind ? `رياح ${number.format(current.windSpeed)} كم/س` : 'الرياح غير متاحة'
      : 'اضغط لعرض التفاصيل';

    let message;
    if (state === 'loading') message = hasData ? 'جارٍ التحديث · بيانات محفوظة' : 'جارٍ تحميل الطقس…';
    else if (state === 'offline') message = hasData ? 'دون اتصال · بيانات محفوظة' : 'يلزم اتصال لعرض الطقس';
    else if (state === 'stale' || (state === 'error' && hasData)) message = `بيانات محفوظة${stamp ? ` · ${stamp}` : ''}`;
    else if (state === 'error' || !hasData) message = 'الطقس غير متاح حاليًا';
    else message = stamp ? `جُلبت ${stamp}` : 'عرض تفاصيل الطقس';
    status.textContent = message;
    root.dataset.state = state;
    root.setAttribute('aria-busy', String(state === 'loading'));
    root.setAttribute('aria-label', hasData
      ? `طقس فيفاء، الحرارة ${number.format(current.temperature)} درجة مئوية${knownWind ? `، الرياح ${number.format(current.windSpeed)} كيلومترًا في الساعة` : ''}، فتح تفاصيل الطقس`
      : 'فتح تفاصيل طقس فيفاء');
  }
  render(null, { state: 'loading' });
  return { render };
}
