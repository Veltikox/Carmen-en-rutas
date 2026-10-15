import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {handleFleetRequest} from '../server/fleet.mjs';

const now=1700000000000;
function setup() {
  const sqlite=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(name=>name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  }
  const db={prepare(sql){let values=[];return {
    bind(...input){values=input;return this;},
    async run(){const result=sqlite.prepare(sql).run(...values);return {meta:{changes:Number(result.changes)}};},
    async all(){return {results:sqlite.prepare(sql).all(...values)};},
  };}};
  const defaults={db,user:{userId:'driver-a',email:'conductor@example.test'},allowedEmails:'conductor@example.test, otro@example.test',now};
  async function call(method='GET',body,token,override={},headers={}) {
    const request=new Request('https://example.test/api/fleet',{method,
      headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:`Bearer ${token}`}:{}) ,...headers},body:body?JSON.stringify(body):undefined});
    const response=await handleFleetRequest(request,{...defaults,...override});
    return {status:response.status,body:await response.json()};
  }
  const fix={routeId:'1',unit:1,latitude:18.643,longitude:-91.832,accuracy:10,sampledAt:now,sequence:1};
  return {call,sqlite,fix};
}

test('Una unidad se publica después de una lectura real y caduca sin historial público',async t=>{
  const {call,sqlite,fix}=setup();t.after(()=>sqlite.close());
  const started=await call('POST',{routeId:'1',unit:1});assert.equal(started.status,201);
  assert.deepEqual((await call()).body.buses,[]);
  assert.equal((await call('PUT',fix,started.body.token)).status,200);
  const fleet=await call();assert.equal(fleet.body.buses.length,1);
  assert.deepEqual(fleet.body.buses[0].latlng,[fix.latitude,fix.longitude]);
  assert.equal(JSON.stringify(fleet).includes(started.body.token),false);
  assert.equal(JSON.stringify(fleet).includes('driver-a'),false);
  assert.equal(JSON.stringify(fleet).includes('session_hash'),false);
  assert.equal((await call('GET',null,null,{now:now+31000})).body.buses.length,1);
  assert.equal((await call('GET',null,null,{now:now+91000})).body.buses.length,0);
  assert.equal((await call('DELETE',{routeId:'1',unit:1},started.body.token)).status,200);
  assert.equal(sqlite.prepare('SELECT latitude FROM live_buses').get().latitude,null);
  assert.deepEqual((await call()).body.buses,[]);
});

test('No se puede duplicar una unidad ni reemplazar la sesión de otro dispositivo',async t=>{
  const {call,sqlite,fix}=setup();t.after(()=>sqlite.close());
  const started=await call('POST',{routeId:'1',unit:1});
  assert.equal((await call('POST',{routeId:'1',unit:1})).status,409);
  assert.equal((await call('POST',{routeId:'1',unit:2})).status,201);
  assert.equal((await call('PUT',fix,'a'.repeat(72))).status,409);
  assert.equal((await call('PUT',fix,started.body.token,{user:{userId:'driver-b',email:'otro@example.test'}})).status,409);
  const replacement=await call('POST',{routeId:'1',unit:1},null,{now:now+91000});
  assert.equal(replacement.status,201);
  assert.equal((await call('PUT',{...fix,sampledAt:now+91000},started.body.token,{now:now+91000})).status,409);
});

test('Lecturas fuera de orden no sobrescriben una posición reciente ni reactivan un viaje finalizado',async t=>{
  const {call,sqlite,fix}=setup();t.after(()=>sqlite.close());
  const {token}= (await call('POST',{routeId:'1',unit:1})).body;
  assert.equal((await call('PUT',{...fix,sequence:2,latitude:18.65},token)).status,200);
  assert.equal((await call('PUT',fix,token)).status,409);
  assert.equal((await call()).body.buses[0].latlng[0],18.65);
  await call('DELETE',{routeId:'1',unit:1},token);
  assert.equal((await call('PUT',{...fix,sequence:3},token)).status,409);
});

test('El servidor comprueba autorización, origen, ruta, unidad, coordenadas y frescura',async t=>{
  const {call,sqlite,fix}=setup();t.after(()=>sqlite.close());
  assert.equal((await call('POST',{routeId:'1',unit:1},null,{user:null})).status,403);
  assert.equal((await call('POST',{routeId:'1',unit:1},null,{allowedEmails:''})).status,403);
  assert.equal((await call('POST',{routeId:'1',unit:1},null,{}, {origin:'https://other.test'})).status,403);
  for(const body of [{routeId:'4',unit:1},{routeId:'1',unit:4},{routeId:'1',unit:0}])assert.equal((await call('POST',body)).status,400);
  const {token}=(await call('POST',{routeId:'1',unit:1})).body;
  for(const change of [{latitude:100},{longitude:null},{accuracy:-1},{sampledAt:now-31000},{sequence:0}])assert.equal((await call('PUT',{...fix,...change},token)).status,400);
  assert.equal((await call('PUT',fix)).status,401);
  assert.equal((await call('GET',null,null,{user:null})).body.canDrive,false);
  assert.equal((await call()).body.canDrive,true);
});

test('La API conserva velocidad y rumbo opcionales y permite teléfonos antiguos sin esos datos',async t=>{
  const {call,sqlite,fix}=setup();t.after(()=>sqlite.close());
  const {token}=(await call('POST',{routeId:'1',unit:1})).body;
  assert.equal((await call('PUT',{...fix,speedMps:10,heading:0},token)).status,200);
  const live=(await call()).body.buses[0];assert.equal(live.speedMps,10);assert.equal(live.heading,0);
  for(const change of [{speedMps:-1},{speedMps:51},{heading:360},{heading:'90'}])assert.equal((await call('PUT',{...fix,...change,sequence:2},token)).status,400);
  assert.equal((await call('PUT',{...fix,sequence:2},token)).status,200);
  const legacy=(await call()).body.buses[0];assert.equal(legacy.speedMps,null);assert.equal(legacy.heading,null);
});
