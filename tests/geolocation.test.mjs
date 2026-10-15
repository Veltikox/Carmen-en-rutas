import test from 'node:test';
import assert from 'node:assert/strict';
import {LocationController, LOCATION_OPTIONS, readPosition, nearestRoutePoint} from '../web/geolocation.mjs';
import {ROUTES, routeGeometry} from '../web/model.mjs';

const reading = {coords: {latitude: 18.642, longitude: -91.833, accuracy: 25}, timestamp: 1234};

test('No pide ubicación hasta una acción; una lectura conserva coordenadas y precisión', () => {
  let calls = 0, success, options;
  const controller = new LocationController({secure: true, geolocation: {
    getCurrentPosition(onSuccess, _onError, supplied) {calls++; success = onSuccess; options = supplied;},
  }});
  assert.equal(calls, 0);
  controller.request();
  assert.equal(controller.state.status, 'requesting');
  controller.request();
  assert.equal(calls, 1);
  assert.deepEqual(options, LOCATION_OPTIONS);
  success(reading);
  assert.equal(controller.state.status, 'ready');
  assert.deepEqual(controller.state.position, {latlng: [18.642, -91.833], accuracy: 25, timestamp: 1234});
});

test('Rechazo, ubicación no disponible y timeout dejan reintentar sin inventar una posición', () => {
  for (const code of [1, 2, 3]) {
    let fail, success;
    const controller = new LocationController({secure: true, geolocation: {
      getCurrentPosition(onSuccess, onError) {success = onSuccess; fail = onError;},
    }});
    controller.request(); fail({code});
    assert.equal(controller.state.status, 'error');
    assert.equal(controller.state.position, null);
    assert.ok(controller.state.error.length > 10);
    controller.request(); success(reading);
    assert.equal(controller.state.status, 'ready');
  }
});

test('Quitar ubicación invalida respuestas tardías de una solicitud anterior', () => {
  const callbacks = [];
  const controller = new LocationController({secure: true, geolocation: {
    getCurrentPosition(success, error) {callbacks.push({success, error});},
  }});
  controller.request(); controller.clear(); controller.request();
  callbacks[0].success(reading);
  callbacks[0].error({code: 1});
  assert.equal(controller.state.status, 'requesting');
  assert.equal(controller.state.position, null);
  callbacks[1].success(reading);
  controller.clear();
  assert.deepEqual(controller.state, {status: 'idle', position: null, error: ''});
});

test('HTTPS, navegador sin geolocalización y excepciones tienen estados de error', () => {
  let called = false;
  const insecure = new LocationController({secure: false, geolocation: {
    getCurrentPosition() {called = true;},
  }});
  insecure.request();
  assert.equal(called, false);
  assert.match(insecure.state.error, /HTTPS/);
  const unavailable = new LocationController({secure: true, geolocation: {}});
  unavailable.request(); assert.equal(unavailable.state.status, 'error');
  const throwing = new LocationController({secure: true, geolocation: {
    getCurrentPosition() {throw new Error('Blocked');},
  }});
  throwing.request(); assert.equal(throwing.state.status, 'error');
});

test('Solo admite coordenadas numéricas válidas y acepta el ecuador y meridiano cero', () => {
  for (const coords of [null, {}, {latitude: NaN, longitude: -91, accuracy: 5},
    {latitude: 100, longitude: -91, accuracy: 5}, {latitude: 18, longitude: -200, accuracy: 5},
    {latitude: 18, longitude: -91, accuracy: -1}, {latitude: '18', longitude: -91, accuracy: 5}]) {
    assert.throws(() => readPosition({coords}));
  }
  assert.deepEqual(readPosition({coords: {latitude: 0, longitude: 0, accuracy: 0}, timestamp: 0}),
    {latlng: [0, 0], accuracy: 0, timestamp: 0});
  let success;
  const controller = new LocationController({secure: true, geolocation: {
    getCurrentPosition(callback) {success = callback;},
  }});
  controller.request(); success({coords: {latitude: null}});
  assert.equal(controller.state.status, 'error');
  assert.equal(controller.state.position, null);
});

test('Laguna propone sus paraderos; las otras rutas conservan puntos de referencia', () => {
  const laguna = ROUTES['2'], geometry = routeGeometry(laguna);
  const nearest = nearestRoutePoint(laguna, geometry, {latlng: geometry.stops[29].latlng});
  assert.equal(laguna.pointKinds[nearest.stop.id], 'paradero');
  assert.equal(nearest.isParadero, true);
  for (const id of ['1', '3']) {
    const route = ROUTES[id], g = routeGeometry(route);
    const point = nearestRoutePoint(route, g, {latlng: g.stops.at(-1).latlng});
    assert.equal(point.stop.id, g.stops.at(-1).id);
    assert.equal(point.distance, 0);
    assert.equal(point.isParadero, false);
  }
});
