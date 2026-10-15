import {ROUTES,routeGeometry} from './model.mjs';
import {LIVE_STALE} from './live-fleet.mjs';

const RAD=Math.PI/180;
const angleDifference=(a,b)=>Math.abs(((a-b+540)%360)-180);
const finitePoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);

// Project onto the ordered route, retaining distance along its road geometry.
// A previous observation helps distinguish repeated streets and intersections.
export function projectToRoute(geometry,point,{accuracy=0,previous=null,elapsed=0,heading=null,speedMps=null}={}) {
  if(!finitePoint(point))return null;
  const {path,distances}=geometry.geographic;
  const cos=Math.cos(point[0]*RAD),candidates=[];
  const hasHeading=Number.isFinite(heading)&&Number.isFinite(speedMps)&&speedMps>=.7;
  for(let i=1;i<path.length;i++) {
    const a=path[i-1],b=path[i];
    const ax=(a[1]-point[1])*111320*cos,ay=(a[0]-point[0])*111320;
    const dx=(b[1]-a[1])*111320*cos,dy=(b[0]-a[0])*111320;
    const length2=dx*dx+dy*dy;if(!length2)continue;
    const t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/length2));
    const offset=Math.hypot(ax+t*dx,ay+t*dy);
    const bearing=(Math.atan2(dx,dy)/RAD+360)%360;
    candidates.push({distance:distances[i-1]+t*(distances[i]-distances[i-1]),offset,bearing,index:i,
      headingError:hasHeading?angleDifference(heading,bearing):null});
  }
  if(!candidates.length)return null;
  const minimum=Math.min(...candidates.map(c=>c.offset));
  let nearby=candidates.filter(c=>c.offset<=minimum+Math.max(8,accuracy*.5));
  let jump=false;
  if(previous&&elapsed>0&&elapsed<=30) {
    const plausible=nearby.filter(c=>Math.abs(c.distance-previous.distance)<=40*elapsed+accuracy*2+30);
    if(plausible.length)nearby=plausible;else jump=true;
  }
  for(const c of nearby)c.score=c.offset+(c.headingError??0)*.15+
    (previous&&elapsed<=30?Math.abs(c.distance-previous.distance)*.08:0);
  nearby.sort((a,b)=>a.score-b.score);
  const best=nearby[0];
  const ambiguous=!previous&&nearby.some(c=>Math.abs(c.distance-best.distance)>120&&
    Math.abs(c.offset-best.offset)<=Math.max(5,accuracy*.4)&&
    (!hasHeading||Math.abs(c.headingError-best.headingError)<40));
  return {...best,ambiguous,jump};
}

export class EtaTracker {
  constructor({getGeometry=id=>routeGeometry(ROUTES[id])}={}) {
    this.getGeometry=getGeometry;this.geometries=new Map();this.entries=new Map();
  }
  update(buses) {
    const ids=new Set(buses.map(bus=>bus.id));
    for(const id of this.entries.keys())if(!ids.has(id))this.entries.delete(id);
    for(const bus of buses) {
      const old=this.entries.get(bus.id);
      if(old&&old.bus.sampledAt===bus.sampledAt&&old.bus.latlng[0]===bus.latlng[0]&&old.bus.latlng[1]===bus.latlng[1])continue;
      if(!this.geometries.has(bus.routeId))this.geometries.set(bus.routeId,this.getGeometry(bus.routeId));
      const geometry=this.geometries.get(bus.routeId);
      const entry={bus,projection:null,speed:null,direction:0,source:null,status:'learning',anchor:null};
      this.entries.set(bus.id,entry);
      if(!geometry||!finitePoint(bus.latlng)||!Number.isFinite(bus.accuracy)||bus.accuracy>80) {entry.status='inaccurate';continue;}
      const elapsed=old?(bus.sampledAt-old.bus.sampledAt)/1000:0;
      const previous=old?.projection&&!old.projection.ambiguous&&!old.projection.jump&&elapsed>0&&elapsed<=30?old:null;
      const p=projectToRoute(geometry,bus.latlng,{accuracy:bus.accuracy,previous:previous?.projection,
        elapsed,heading:bus.heading,speedMps:bus.speedMps});
      entry.projection=p;
      if(!p||p.offset>Math.max(45,bus.accuracy*1.5)) {entry.status='offroute';continue;}
      if(p.ambiguous) {entry.status='ambiguous';continue;}
      if(p.jump) {entry.status='jump';continue;}
      const anchor=previous?.anchor||{distance:previous?.projection.distance??p.distance,
        time:previous?.bus.sampledAt??bus.sampledAt,accuracy:previous?.bus.accuracy??bus.accuracy};
      const span=(bus.sampledAt-anchor.time)/1000,delta=p.distance-anchor.distance;
      const moved=span>=3&&span<=40&&Math.abs(delta)>Math.max(10,(anchor.accuracy+bus.accuracy)/2);
      const observed=moved?Math.abs(delta)/span:null;
      entry.anchor=moved||span>40?{distance:p.distance,time:bus.sampledAt,accuracy:bus.accuracy}:anchor;
      if(observed!==null&&observed>35) {entry.status='jump';continue;}
      const native=Number.isFinite(bus.speedMps)&&bus.speedMps>=0&&bus.speedMps<=35?bus.speedMps:null;
      const headingDirection=native>=.7&&p.headingError!==null?(p.headingError<=60?1:p.headingError>=120?-1:0):0;
      const observedDirection=moved?Math.sign(delta):0;
      if(headingDirection&&observedDirection&&headingDirection!==observedDirection) {entry.status='learning';continue;}
      entry.direction=observedDirection||headingDirection||previous?.direction||0;
      if(native!==null) {entry.speed=native;entry.source='sensor';}
      else if(observed!==null) {
        entry.speed=previous?.speed>0&&previous.direction===entry.direction?previous.speed*.6+observed*.4:observed;
        entry.source='observed';
      } else if(span>=15) {entry.speed=0;entry.source='observed';}
      entry.status=entry.direction<0?'reverse':entry.speed!==null&&entry.speed<.7?'stopped':
        entry.direction===1&&entry.speed>=.7?'moving':'learning';
    }
  }
  arrivals(routeId,targetDistance,now=Date.now()) {
    const estimates=[],excluded={};
    const exclude=status=>excluded[status]=(excluded[status]||0)+1;
    for(const entry of this.entries.values()) {
      const {bus,projection:p}=entry;if(bus.routeId!==routeId)continue;
      if(now-bus.sampledAt>LIVE_STALE||now-bus.updatedAt>LIVE_STALE) {exclude('stale');continue;}
      if(['inaccurate','offroute','ambiguous','jump'].includes(entry.status)) {exclude(entry.status);continue;}
      if(!p) {exclude('learning');continue;}
      if(entry.direction<0) {exclude('reverse');continue;}
      const remaining=targetDistance-p.distance,radius=Math.max(25,bus.accuracy);
      if(remaining < -radius) {exclude('passed');continue;}
      if(Math.abs(remaining)<=radius&&bus.accuracy<=40) {
        estimates.push({bus,minutes:0,range:[0,1],remaining:0,source:entry.source,arriving:true});continue;
      }
      if(entry.status!=='moving') {exclude(entry.status);continue;}
      const minutes=remaining/entry.speed/60;
      const uncertainty=Math.max(.5,minutes*.25,bus.accuracy/entry.speed/60);
      estimates.push({bus,minutes,range:[Math.max(1,Math.floor(minutes-uncertainty)),Math.max(1,Math.ceil(minutes+uncertainty))],
        remaining,speed:entry.speed,source:entry.source,arriving:false});
    }
    estimates.sort((a,b)=>a.minutes-b.minutes||a.bus.unit-b.bus.unit);
    return {next:estimates[0]||null,estimates,excluded};
  }
}

export function etaUnavailableMessage(excluded) {
  if(excluded.stopped)return 'Camión detenido; esperando que reanude el avance.';
  if(excluded.learning)return 'Calculando sentido y velocidad. Esperando nuevas lecturas GPS…';
  if(excluded.stale)return 'GPS sin actualizar. Esperando una lectura reciente.';
  if(excluded.inaccurate)return 'La precisión del GPS no permite estimar la llegada.';
  if(excluded.ambiguous||excluded.jump)return 'Validando el tramo del recorrido con nuevas lecturas GPS…';
  if(excluded.offroute)return 'Las unidades están fuera del trazado de referencia.';
  if(excluded.reverse)return 'Las unidades no avanzan en el sentido de este recorrido.';
  if(excluded.passed)return 'Las unidades ya pasaron por este punto en este viaje.';
  return 'No hay unidades transmitiendo en esta ruta.';
}
