import test from 'node:test';
import assert from 'node:assert/strict';
import {ROUTES,routeGeometry,busPositions,arrivals,geographicPointAt,pointAt,metersBetween} from '../web/model.mjs';
import {GEO_ROUTES} from '../web/routes-geo.mjs';
const expected={
 '1':['Calle 22','Calle 47','Calle 26','Playa Norte','Malecón Costero','P. del Mar','Av. Amado Nervo','Av. Nardos','Av. Constelación'],
 '2':['Paradero Mercado AFA','Malecón del Centro','Calle 25','Calle 24','Monumento a la Bandera','Calle 28 x 17','Parque del Pescador','Avenida 10 de Julio','Calle 40','Calle Independencia','Calle Constitución','Vicente Guerrero','Balneario de la Manigua','Av. 16 de Septiembre','Calle Satélite','Miguel de la Madrid','Calle Albatros','Calle Tijerilla','Francisco Javier Mina','Capilla San Judas Tadeo','Calle 17-D','Av. 10 de Julio','Calle 16 de Septiembre','Av. Las Américas','C. José María Morelos y Pavón','Calle 19','Calle 42','Calle 31','Calle 22','Calle 39'],
 '3':['Calle 31','Periférica Norte','Av. Concordia','Av. Corregidora','Calle 37','Boquerón del Palmar','Carretera Carmen–Puerto Real','Calle Escárcega','Av. Puerto de Campeche','Av. Abasolo','Av. Contadores','Av. Central','Campus III']
};
test('The user-provided street order and three colors are preserved',()=>{
 for(const id of Object.keys(expected)) assert.deepEqual(ROUTES[id].pointNames,expected[id]);
 assert.deepEqual(Object.values(ROUTES).map(r=>r.color),['#ca3d83','#188574','#4e65cf']);
 assert.deepEqual(ROUTES['2'].pointKinds,Array(11).fill('paradero').concat(Array(19).fill('tramo')));
});
for(const id of Object.keys(expected)) {
 const route=ROUTES[id];
 test(`${route.name}: connected start-to-final geometry and ordered street stages`,()=>{
  const g=routeGeometry(route),data=GEO_ROUTES[id].ida;
  assert.notDeepEqual(g.geographic.path[0],g.geographic.path.at(-1));
  assert.equal(g.stops[0].progress,0);assert.equal(g.stops.at(-1).progress,1);
  assert.equal(g.stops.length,expected[id].length);
  assert.deepEqual(data.stages.map(s=>s.name),expected[id]);
  for(let i=1;i<g.geographic.path.length;i++) {
   assert.ok(g.geographic.distances[i]>g.geographic.distances[i-1]);
   assert.ok(metersBetween(g.geographic.path[i-1],g.geographic.path[i])<1000);
  }
  for(let i=0;i<g.stops.length;i++) {
   const stop=g.stops[i];
   assert.ok(metersBetween(geographicPointAt(g,stop.progress),stop.latlng)<.02);
   const p=pointAt(g,stop.progress);
   assert.ok(Math.hypot(p.x-stop.point[0],p.y-stop.point[1])<.03);
   if(i)assert.ok(stop.progress>=g.stops[i-1].progress);
   assert.ok(data.stages[i].endIndex>=data.stages[i].startIndex);
  }
 });
 test(`${route.name}: vehicles finish and do not loop into future arrivals`,()=>{
  const g=routeGeometry(route);
  assert.ok(busPositions(route,route.minutes+1).every(bus=>bus.finished&&bus.progress===1));
  for(const stop of g.stops)assert.deepEqual(arrivals(route,g,stop.id,route.minutes+1),[]);
  for(const elapsed of [0,3,route.minutes/2])for(const stop of g.stops) {
   const result=arrivals(route,g,stop.id,elapsed);
   assert.ok(result.every(bus=>!bus.finished&&bus.progress<=stop.progress&&bus.minutes>=0));
   for(let i=1;i<result.length;i++)assert.ok(result[i].minutes>=result[i-1].minutes);
  }
 });
}
