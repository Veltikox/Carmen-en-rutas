import {GEO_ROUTES} from './routes-geo.mjs';
import {ROUTE_METADATA} from './route-metadata.mjs';
// Ordered reference geometry. busPositions and arrivals implement the optional simulation.
export const ROUTES = ROUTE_METADATA;
export function routeGeometry(route, reverse = false) {
  const stops=route.points.map((point,id)=>({point,id,name:route.pointNames[id]}));
  if(reverse) stops.reverse();
  const source=GEO_ROUTES[route.id][reverse?'vuelta':'ida'];
  const distances=[0];
  for(let i=1;i<source.path.length;i++) distances.push(distances[i-1]+metersBetween(source.path[i-1],source.path[i]));
  const distance=distances.at(-1);
  for(let i=0;i<stops.length;i++) {
    stops[i].distance=distances[source.stopIndices[i]];
    stops[i].latlng=source.path[source.stopIndices[i]];
  }
  for(const stop of stops) stop.progress=stop.distance/distance;
  return {stops,length:distance,diagramPath:reverse?route.diagramPath.slice().reverse():route.diagramPath,geographic:{path:source.path,distances}};
}
export function metersBetween(a,b) {
  const radians=Math.PI/180;
  const dLat=(b[0]-a[0])*radians,dLon=(b[1]-a[1])*radians;
  const h=Math.sin(dLat/2)**2+Math.cos(a[0]*radians)*Math.cos(b[0]*radians)*Math.sin(dLon/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
export function geographicPointAt(geometry,progress) {
  const {path,distances}=geometry.geographic;
  const target=Math.max(0,Math.min(1,progress))*geometry.length;
  let low=1,high=path.length-1;
  while(low<high) {const mid=(low+high)>>1;if(distances[mid]<target) low=mid+1;else high=mid;}
  const span=distances[low]-distances[low-1];
  const ratio=span?(target-distances[low-1])/span:0;
  return [path[low-1][0]+(path[low][0]-path[low-1][0])*ratio,path[low-1][1]+(path[low][1]-path[low-1][1])*ratio];
}
export function pointAt(geometry,progress) {
  const target=Math.max(0,Math.min(1,progress))*geometry.length;
  const {distances}=geometry.geographic;
  let low=1,high=distances.length-1;
  while(low<high) {const mid=(low+high)>>1;if(distances[mid]<target)low=mid+1;else high=mid;}
  const a=geometry.diagramPath[low-1],b=geometry.diagramPath[low];
  const span=distances[low]-distances[low-1];
  const ratio=span?(target-distances[low-1])/span:0;
  return {x:a[0]+(b[0]-a[0])*ratio,y:a[1]+(b[1]-a[1])*ratio,angle:Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI};
}
export function busPositions(route, elapsedMinutes) {
  return route.buses.map((start,id)=>{
    const progress=Math.min(1,Math.max(0,start+elapsedMinutes/route.minutes));
    return {id,progress,finished:progress>=1};
  });
}
export function arrivals(route, geometry, stopId, elapsedMinutes) {
  const stop=geometry.stops.find(x=>x.id===stopId);
  return busPositions(route,elapsedMinutes).filter(bus=>!bus.finished&&bus.progress<=stop.progress).map(bus=>{
    const gap=stop.progress-bus.progress;
    return {...bus,minutes:gap*route.minutes};
  }).sort((a,b)=>a.minutes-b.minutes);
}
