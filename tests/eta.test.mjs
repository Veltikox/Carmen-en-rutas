import test from 'node:test';
import assert from 'node:assert/strict';
import {EtaTracker,projectToRoute,etaUnavailableMessage} from '../web/eta.mjs';
import {metersBetween,geographicPointAt} from '../web/model.mjs';
import {readDriverFix} from '../web/driver.mjs';

const now=1700000000000;
function geometry(path=[[0,0],[0,.05]]) {
  const distances=[0];
  for(let i=1;i<path.length;i++)distances.push(distances[i-1]+metersBetween(path[i-1],path[i]));
  return {length:distances.at(-1),geographic:{path,distances}};
}
const g=geometry();
const point=distance=>geographicPointAt(g,distance/g.length);
function bus(distance=100,change={}) {
  return {id:'1-1',routeId:'1',unit:1,latlng:point(distance),accuracy:5,sampledAt:now,updatedAt:now,speedMps:10,heading:90,...change};
}
const tracker=()=>new EtaTracker({getGeometry:()=>g});

test('ETA usa distancia restante por el recorrido y velocidad en metros por segundo',()=>{
  const t=tracker();t.update([bus(100)]);
  const next=t.arrivals('1',1000,now).next;
  assert.ok(Math.abs(next.remaining-900)<.01);
  assert.ok(Math.abs(next.minutes-1.5)<.001);
  assert.equal(next.source,'sensor');
  assert.ok(next.range[0]<=next.minutes&&next.range[1]>=next.minutes);
});

test('Se obtiene velocidad y sentido con dos lecturas si el teléfono no informa movimiento',()=>{
  const t=tracker();t.update([bus(100,{speedMps:null,heading:null})]);
  assert.equal(t.arrivals('1',1000,now).next,null);
  t.update([bus(150,{speedMps:null,heading:null,sampledAt:now+5000,updatedAt:now+5000})]);
  const next=t.arrivals('1',1000,now+5000).next;
  assert.equal(next.source,'observed');assert.ok(Math.abs(next.speed-10)<.01);
  assert.ok(Math.abs(next.minutes-850/10/60)<.001);
});

test('La unidad con menor ETA puede estar más lejos que otra que avanza lentamente',()=>{
  const t=tracker();t.update([bus(100,{speedMps:20}),bus(400,{id:'1-2',unit:2,speedMps:4})]);
  const result=t.arrivals('1',1000,now);
  assert.equal(result.next.bus.id,'1-1');assert.equal(result.estimates.length,2);
});

test('No se predice una vuelta para unidades que ya pasaron ni para sentido contrario',()=>{
  const t=tracker();t.update([bus(1300),bus(100,{id:'1-2',unit:2,heading:270})]);
  const result=t.arrivals('1',1000,now);
  assert.equal(result.next,null);assert.equal(result.excluded.passed,1);assert.equal(result.excluded.reverse,1);
});

test('GPS desactualizado, poco preciso y fuera de la ruta no producen ETA',()=>{
  const t=tracker();t.update([bus(100),bus(100,{id:'1-2',unit:2,accuracy:150}),bus(100,{id:'1-3',unit:3,latlng:[.01,.001]})]);
  const result=t.arrivals('1',1000,now+31000);assert.equal(result.next,null);assert.equal(result.excluded.stale,3);
  const fresh=t.arrivals('1',1000,now);assert.equal(fresh.estimates.length,1);assert.equal(fresh.excluded.inaccurate,1);assert.equal(fresh.excluded.offroute,1);
});

test('Un camión detenido no se mueve artificialmente para generar un número',()=>{
  const t=tracker();t.update([bus(100,{speedMps:0,heading:null})]);
  let result=t.arrivals('1',1000,now);assert.equal(result.next,null);assert.equal(result.excluded.stopped,1);
  const observed=tracker();observed.update([bus(100,{speedMps:null,heading:null})]);
  observed.update([bus(100,{speedMps:null,heading:null,sampledAt:now+15000,updatedAt:now+15000})]);
  result=observed.arrivals('1',1000,now+15000);assert.equal(result.excluded.stopped,1);
});

test('Una lectura cercana al punto se identifica como llegada aproximada',()=>{
  const t=tracker();t.update([bus(995,{speedMps:0,heading:null})]);
  const next=t.arrivals('1',1000,now).next;assert.equal(next.arriving,true);assert.equal(next.minutes,0);
});

test('Una curva se mide siguiendo las calles, sin usar la línea recta al destino',()=>{
  const corner=geometry([[0,0],[0,.01],[.01,.01]]);
  const t=new EtaTracker({getGeometry:()=>corner});
  t.update([{...bus(),latlng:[0,0]}]);
  const next=t.arrivals('1',corner.length,now).next;
  assert.ok(next.remaining>metersBetween([0,0],[.01,.01])*1.3);
});

test('Se rechaza un salto de GPS imposible entre dos lecturas',()=>{
  const t=tracker();t.update([bus(100)]);
  t.update([bus(3000,{sampledAt:now+5000,updatedAt:now+5000})]);
  const result=t.arrivals('1',4000,now+5000);assert.equal(result.next,null);assert.equal(result.excluded.jump,1);
});

test('Los tramos repetidos son ambiguos hasta disponer de contexto suficiente',()=>{
  const loop=geometry([[0,0],[0,.01],[.01,.01],[.01,0],[0,0],[0,.01]]);
  const p=[0,.002];
  assert.equal(projectToRoute(loop,p,{accuracy:5}).ambiguous,true);
  const contextual=projectToRoute(loop,p,{accuracy:5,previous:{distance:100},elapsed:5,heading:90,speedMps:20});
  assert.equal(contextual.ambiguous,false);assert.ok(contextual.distance<500);
});

test('El rumbo GPS distingue las dos ramas de una intersección',()=>{
  const crossing=geometry([[-.005,-.005],[.005,.005],[-.005,.005],[.005,-.005]]);
  const p=projectToRoute(crossing,[0,0],{accuracy:5,heading:45,speedMps:10});
  assert.equal(p.ambiguous,false);assert.equal(p.index,1);
});

test('Lecturas repetidas no fabrican velocidad y una unidad eliminada pierde su estado',()=>{
  const t=tracker(),reading=bus(100,{speedMps:null,heading:null});
  t.update([reading]);t.update([reading]);assert.equal(t.arrivals('1',1000,now+5000).next,null);
  t.update([]);assert.equal(t.entries.size,0);
});

test('La velocidad cero y rumbo norte cero se conservan; valores ausentes permanecen nulos',()=>{
  const raw={coords:{latitude:18.64,longitude:-91.83,accuracy:5,speed:0,heading:0},timestamp:now};
  assert.equal(readDriverFix(raw).speedMps,0);assert.equal(readDriverFix(raw).heading,0);
  const missing=readDriverFix({...raw,coords:{latitude:18.64,longitude:-91.83,accuracy:5}});
  assert.equal(missing.speedMps,null);assert.equal(missing.heading,null);
});

test('El motivo de una estimación no disponible se explica al pasajero',()=>{
  for(const key of ['stopped','learning','stale','inaccurate','ambiguous','offroute','reverse','passed'])assert.ok(etaUnavailableMessage({[key]:1}).length>15);
});
