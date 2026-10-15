import test from 'node:test';
import assert from 'node:assert/strict';
import {DriverTracker} from '../web/driver.mjs';
import {visibleBuses,fleetRequest} from '../web/live-fleet.mjs';
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function setup() {
  let now=1700000000000,success,failure,cleared=false,timerCleared=false;
  const calls=[];
  const tracker=new DriverTracker({secure:true,now:()=>now,
    geolocation:{watchPosition(ok,fail){success=ok;failure=fail;return 0;},clearWatch(id){assert.equal(id,0);cleared=true;}},
    request:async(method,body,token)=>{calls.push({method,body,token});return method==='POST'?{token:'test-token'}:{};},
    setTimer:()=>7,clearTimer:id=>{assert.equal(id,7);timerCleared=true;}});
  return {tracker,calls,success:()=>success,failure:()=>failure,advance:ms=>{now+=ms;},now:()=>now,
    stopped:()=>cleared&&timerCleared};
}

test('El conductor transmite bajo demanda y finalizar cancela GPS, temporizador y sesión',async()=>{
  const s=setup();assert.equal(s.calls.length,0);
  await s.tracker.start('2',2);assert.equal(s.tracker.state.status,'sharing');
  const fix={coords:{latitude:18.64,longitude:-91.83,accuracy:8},timestamp:s.now()};
  s.success()(fix);await tick();
  assert.equal(s.calls[1].method,'PUT');assert.equal(s.calls[1].body.routeId,'2');
  assert.equal(s.tracker.state.lastSentAt,s.now());
  await s.tracker.stop();assert.equal(s.stopped(),true);assert.equal(s.calls.at(-1).method,'DELETE');
  const count=s.calls.length;s.success()(fix);await tick();assert.equal(s.calls.length,count);
  assert.equal(s.tracker.fix,null);
});

test('La transmisión limita envíos y no vuelve a publicar una lectura vieja',async()=>{
  const s=setup();await s.tracker.start('1',1);
  s.success()({coords:{latitude:18.64,longitude:-91.83,accuracy:8},timestamp:s.now()});await tick();
  await s.tracker.pulse();assert.equal(s.calls.filter(x=>x.method==='PUT').length,1);
  s.advance(5000);await s.tracker.pulse();assert.equal(s.calls.filter(x=>x.method==='PUT').length,2);
  s.advance(21000);await s.tracker.pulse();assert.equal(s.calls.filter(x=>x.method==='PUT').length,2);
  await s.tracker.stop();
});

test('Denegar el permiso detiene la sesión sin publicar ubicaciones ficticias',async()=>{
  const s=setup();await s.tracker.start('1',1);s.failure()({code:1});await tick();
  assert.equal(s.tracker.state.status,'error');assert.equal(s.stopped(),true);
  assert.equal(s.calls.some(x=>x.method==='PUT'),false);
});

test('Cancelar durante la conexión elimina la sesión aunque responda más tarde',async()=>{
  let resolveStart;const calls=[];
  const tracker=new DriverTracker({secure:true,geolocation:{watchPosition(){throw Error('No debe iniciarse');}},
    request:(method)=>{calls.push(method);return method==='POST'?new Promise(r=>{resolveStart=r;}):Promise.resolve({});}});
  const started=tracker.start('1',1);await tracker.stop();resolveStart({token:'late'});await started;
  assert.deepEqual(calls,['POST','DELETE']);assert.equal(tracker.state.status,'idle');
});

test('El pasajero filtra por ruta y oculta posiciones caducadas aunque la conexión falle',()=>{
  const now=1700000000000;
  const fleet=[{routeId:'1',sampledAt:now,updatedAt:now},{routeId:'2',sampledAt:now,updatedAt:now},
    {routeId:'1',sampledAt:now-91000,updatedAt:now},{routeId:'1',sampledAt:now,updatedAt:now-91000}];
  assert.equal(visibleBuses(fleet,'1',now).length,1);
  assert.equal(visibleBuses(fleet,'1',now+91000).length,0);
});

test('Las API del navegador conservan su contexto al iniciar y finalizar la transmisión',async()=>{
  const originalSet=globalThis.setInterval,originalClear=globalThis.clearInterval;
  let started=false,cleared=false;
  globalThis.setInterval=function(callback,delay) {
    if(this!==globalThis)throw new TypeError('Illegal invocation');
    assert.equal(typeof callback,'function');assert.equal(delay,5000);started=true;return 42;
  };
  globalThis.clearInterval=function(id) {
    if(this!==globalThis)throw new TypeError('Illegal invocation');
    assert.equal(id,42);cleared=true;
  };
  const geo={watchPosition(){assert.equal(this,geo);return 0;},clearWatch(id){assert.equal(this,geo);assert.equal(id,0);}};
  try {
    const driver=new DriverTracker({secure:true,geolocation:geo,
      request:async method=>method==='POST'?{token:'test-token'}:{}});
    await driver.start('1',1);
    assert.equal(driver.state.status,'sharing',driver.state.message);
    assert.equal(started,true);
    await driver.stop();
    assert.equal(driver.state.status,'idle');assert.equal(cleared,true);
  } finally {globalThis.setInterval=originalSet;globalThis.clearInterval=originalClear;}
});

test('Las solicitudes GPS conservan el contexto de fetch del navegador',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async function(path,options) {
    if(this!==globalThis)throw new TypeError('Illegal invocation');
    assert.equal(path,'/api/fleet');assert.equal(options.credentials,'same-origin');
    return Response.json({buses:[],canDrive:false,serverTime:Date.now()});
  };
  try {assert.deepEqual((await fleetRequest()).buses,[]);}
  finally {globalThis.fetch=original;}
});
