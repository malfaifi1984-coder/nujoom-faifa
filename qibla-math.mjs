export const KAABA = Object.freeze({ latitude: 21.422487, longitude: 39.826206 });
export const normalize = (angle) => ((angle % 360) + 360) % 360;
export const difference = (target, heading) => normalize(target - heading + 180) - 180;
export function validCoordinates(latitude, longitude) {
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
}
export function parseCoordinate(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim()
    .replace(/[\u061c\u200e\u200f]/g, '')
    .replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (digit) => String(digit.charCodeAt(0) % 16))
    .replace(/\u2212/g, '-')
    .replace(/[\u066b,]/g, '.');
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}
export function parseCoordinates(latitude, longitude) {
  const lat = parseCoordinate(latitude), lon = parseCoordinate(longitude);
  return validCoordinates(lat, lon) ? { latitude: lat, longitude: lon } : null;
}
export function bearing(latitude, longitude) {
  if (!validCoordinates(latitude, longitude)) throw new Error('Invalid coordinates');
  const r = Math.PI / 180, from = latitude * r, to = KAABA.latitude * r, delta = (KAABA.longitude - longitude) * r;
  return normalize(Math.atan2(Math.sin(delta) * Math.cos(to), Math.cos(from) * Math.sin(to) - Math.sin(from) * Math.cos(to) * Math.cos(delta)) / r);
}
export function distance(latitude, longitude) {
  const r = Math.PI / 180, a = (KAABA.latitude - latitude) * r, b = (KAABA.longitude - longitude) * r;
  const h = Math.sin(a / 2) ** 2 + Math.cos(latitude * r) * Math.cos(KAABA.latitude * r) * Math.sin(b / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function trustworthyHeading(event, screenAngle = 0) {
  // A relative alpha value has no north reference. Landscape and steep tilts
  // also require a different projection, so never present them as a live compass.
  if (normalize(screenAngle) !== 0) return null;
  if (Number.isFinite(event.beta) && Math.abs(event.beta) > 45) return null;
  if (Number.isFinite(event.gamma) && Math.abs(event.gamma) > 45) return null;
  if (Number.isFinite(event.webkitCompassHeading)) {
    if (!Number.isFinite(event.webkitCompassAccuracy) || event.webkitCompassAccuracy < 0 || event.webkitCompassAccuracy > 20) return null;
    return normalize(event.webkitCompassHeading);
  }
  return event.absolute === true && Number.isFinite(event.alpha) ? normalize(360 - event.alpha) : null;
}
