import {metersBetween} from './model.mjs';

export const LOCATION_OPTIONS = Object.freeze({
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 30000,
});

export function readPosition(position) {
  const {latitude, longitude, accuracy} = position?.coords || {};
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      !Number.isFinite(accuracy) || accuracy < 0) {
    throw new Error('La ubicación recibida no es válida. Vuelve a intentarlo.');
  }
  return {latlng: [latitude, longitude], accuracy,
    timestamp: Number.isFinite(position.timestamp) ? position.timestamp : Date.now()};
}

export function locationErrorMessage(error) {
  if (error?.code === 1) return 'El permiso de ubicación está bloqueado. Actívalo en los permisos del sitio y vuelve a intentarlo.';
  if (error?.code === 2) return 'No se pudo obtener tu ubicación. Activa la ubicación del dispositivo y vuelve a intentarlo.';
  if (error?.code === 3) return 'Se agotó el tiempo de espera. Intenta de nuevo, preferentemente desde tu celular.';
  return 'No se pudo obtener tu ubicación. Vuelve a intentarlo o elige un punto del recorrido manualmente.';
}

// A single reading, requested by a user action. No tracking or persistence.
export class LocationController {
  constructor({geolocation = globalThis.navigator?.geolocation,
    secure = globalThis.isSecureContext, onChange = () => {}} = {}) {
    this.geolocation = geolocation;
    this.secure = secure;
    this.onChange = onChange;
    this.requestId = 0;
    this.state = {status: 'idle', position: null, error: ''};
  }
  update(state) {this.state = state; this.onChange(state);}
  request() {
    if (this.state.status === 'requesting') return;
    const fail = error => this.update({status: 'error', position: null, error});
    if (!this.secure) {
      fail('Abre el sitio con HTTPS o desde localhost para usar tu ubicación.');
      return;
    }
    if (typeof this.geolocation?.getCurrentPosition !== 'function') {
      fail('Este navegador no permite obtener tu ubicación. Puedes elegir un punto del recorrido manualmente.');
      return;
    }
    const id = ++this.requestId;
    this.update({status: 'requesting', position: null, error: ''});
    const onError = error => {
      if (id === this.requestId) fail(locationErrorMessage(error));
    };
    try {
      this.geolocation.getCurrentPosition(position => {
        if (id !== this.requestId) return;
        let normalized;
        try {normalized = readPosition(position);}
        catch (error) {fail(error.message); return;}
        this.update({status: 'ready', position: normalized, error: ''});
      }, onError, LOCATION_OPTIONS);
    } catch (error) {onError(error);}
  }
  clear() {
    this.requestId++;
    this.update({status: 'idle', position: null, error: ''});
  }
}

// On Laguna, consider its named paraderos; streets are not boarding stops.
// Other routes expose reference points until their boarding stops are verified.
export function nearestRoutePoint(route, geometry, position) {
  const paraderos = geometry.stops.filter(stop => route.pointKinds[stop.id] === 'paradero');
  const candidates = paraderos.length ? paraderos : geometry.stops;
  return candidates.reduce((best, stop) => {
    const distance = metersBetween(position.latlng, stop.latlng);
    return !best || distance < best.distance
      ? {stop, distance, isParadero: paraderos.length > 0} : best;
  }, null);
}

export function formatMeters(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.max(1, Math.round(meters))} m`;
}
