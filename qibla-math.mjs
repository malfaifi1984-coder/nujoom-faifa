export const KAABA = Object.freeze({ latitude: 21.422487, longitude: 39.826206 });
export const normalize = (angle) => ((angle % 360) + 360) % 360;
export const difference = (target, heading) => normalize(target - heading + 180) - 180;
export function validCoordinates(latitude, longitude) {
  return Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180;
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
  // Native WebKit heading includes a calibration accuracy. Do not discard that
  // reading using the flat-device constraints needed for the raw alpha path.
  if (normalize(screenAngle) !== 0) return null;
  if (Number.isFinite(event.webkitCompassHeading)) {
    if (!Number.isFinite(event.webkitCompassAccuracy) || event.webkitCompassAccuracy < 0 || event.webkitCompassAccuracy > 20) return null;
    return normalize(event.webkitCompassHeading);
  }
  // Relative alpha has no north reference; steep tilts need another projection.
  if (Number.isFinite(event.beta) && Math.abs(event.beta) > 45) return null;
  if (Number.isFinite(event.gamma) && Math.abs(event.gamma) > 45) return null;
  return event.absolute === true && Number.isFinite(event.alpha) ? normalize(360 - event.alpha) : null;
}
