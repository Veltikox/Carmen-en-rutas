import {ROUTES,routeGeometry,pointAt,busPositions,arrivals} from './model.mjs';
import {RealMap} from './real-map.mjs';
import {LocationController,nearestRoutePoint,formatMeters} from './geolocation.mjs';
import {DriverTracker} from './driver.mjs';
import {fleetRequest,visibleBuses,LIVE_STALE} from './live-fleet.mjs';
import {EtaTracker,etaUnavailableMessage} from './eta.mjs';

const $=id=>document.getElementById(id);
const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const pad=n=>String(n).padStart(2,'0');
const params=new URLSearchParams(location.search);
const staticSite=document.querySelector('meta[name=hosting-mode]')?.content==='static';
let dataMode=staticSite||params.get('modo')==='demo'?'demo':'live';
let fleet=[],fleetLoaded=false,fleetError='',fleetBusy=false,canDrive=false,serverOffset=0;
const routeParam=params.get('ruta');
const stopParam=Number(params.get('parada'));
let routeId=Object.hasOwn(ROUTES,routeParam)?routeParam:'1';
let stopId=Number.isInteger(stopParam)&&stopParam>=1&&stopParam<=ROUTES[routeId].points.length?stopParam-1:3;
let reverse=false;
let geometry,elapsedMinutes=0,zoom=1,picking=false,toastTimer,realMap=null,schemeView=false;
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let paused=reducedMotion;
let favorites=[],storageAvailable=true;
try {
  const saved=JSON.parse(localStorage.getItem('axc-ordered-favorites-v2')||'[]');
  if(Array.isArray(saved)) favorites=saved.filter(x=>x&&Object.hasOwn(ROUTES,x.route)&&Number.isInteger(x.stop)&&x.stop>=0&&x.stop<ROUTES[x.route].points.length&&typeof x.reverse==='boolean').slice(0,48);
} catch {storageAvailable=false;}
const currentRoute=()=>ROUTES[routeId];
const currentStop=()=>geometry.stops.find(x=>x.id===stopId);
const unitName=id=>`Unidad ${pad(id+1)}`;
const favoriteKey=x=>`${x.route}-${x.stop}-${x.reverse}`;
const currentFavorite=()=>({route:routeId,stop:stopId,reverse});
const isSaved=()=>favorites.some(x=>favoriteKey(x)===favoriteKey(currentFavorite()));
const userLocation=new LocationController({onChange:renderLocation});
let nearestPoint=null;
let etaTarget='manual';
const etaTracker=new EtaTracker();
const driver=new DriverTracker({onChange:renderDriver});

function routeBuses(){return visibleBuses(fleet,routeId,Date.now()+serverOffset);}
function renderDriver(state=driver.state) {
  const busy=['starting','sharing','stopping'].includes(state.status);
  $('open-driver').textContent=staticSite?'Acerca del GPS':state.status==='sharing'?'Conductor · transmisión activa':busy?'Conductor · conectando…':'Soy conductor';
  $('driver-start').disabled=!canDrive||busy;
  $('driver-stop').hidden=!busy;
  $('driver-stop').disabled=state.status==='stopping';
  $('driver-route').disabled=busy;$('driver-unit').disabled=busy;
  $('driver-status').textContent=state.message;
  $('driver-status').classList.toggle('location-error',state.status==='error');
  $('driver-last-fix').textContent=state.lastSentAt?`Último envío: ${new Date(state.lastSentAt).toLocaleTimeString('es-MX')} · Precisión aproximada ±${formatMeters(state.accuracy)}.`:'';
  $('driver-access').textContent=canDrive?'Tu cuenta tiene acceso de conductor.':fleetError?'No se pudo comprobar el acceso. Revisa la conexión y vuelve a intentarlo.':fleetLoaded?'Tu cuenta necesita acceso de conductor para transmitir.':'Comprobando acceso de conductor…';
  $('driver-signin').hidden=staticSite||canDrive||!fleetLoaded;
  if(staticSite){
    $('driver-access').textContent='El GPS compartido necesita un servidor y no está disponible en GitHub Pages.';
    $('driver-status').textContent='Puedes explorar las rutas y usar la simulación de prueba.';
  }
}
function renderFleet() {
  const buses=routeBuses(),now=Date.now()+serverOffset;
  const stale=buses.filter(bus=>now-bus.sampledAt>LIVE_STALE).length;
  realMap?.renderLiveBuses(buses,now);
  if(dataMode==='live') {
    $('unit-count').textContent=String(buses.length);
    $('fleet-summary').textContent=fleetError?'No se pudo actualizar el GPS. Las últimas lecturas caducarán si no se recupera la conexión.':!fleetLoaded?'Consultando unidades con GPS…':buses.length?`${buses.length} unidad${buses.length===1?'':'es'} con posición compartida.${stale?` ${stale} con GPS desactualizado.`:''}`:'No hay unidades transmitiendo en esta ruta. Puedes explorar el recorrido o usar la simulación.';
  } else $('fleet-summary').textContent='Las posiciones y llegadas de este modo son simuladas.';
  $('live-status').textContent=fleetError?'GPS sin conexión':!fleetLoaded?'Consultando GPS…':buses.length?`GPS · ${buses.length} unidad${buses.length===1?'':'es'}${stale?' · sin actualizar':''}`:'Sin unidades GPS';
  $('live-status').classList.toggle('gps-warning',!!fleetError||!!stale);
  $('center-live-buses').hidden=dataMode!=='live'||!buses.length;
  updateArrival();
}
async function refreshFleet() {
  if(staticSite||fleetBusy||document.hidden)return;
  fleetBusy=true;
  try {
    const result=await fleetRequest();
    if(!Array.isArray(result.buses)||!Number.isFinite(result.serverTime))throw Error('Invalid fleet response');
    fleet=result.buses;etaTracker.update(fleet);serverOffset=result.serverTime-Date.now();canDrive=result.canDrive===true;fleetLoaded=true;fleetError='';
  } catch(error){fleetError=error.message;}
  finally{fleetBusy=false;renderFleet();renderDriver();}
}
function setDataMode(mode) {
  dataMode=staticSite||mode==='demo'?'demo':'live';
  $('data-mode').value=dataMode;
  $('unit-type').textContent=dataMode==='demo'?'unidades demo':'unidades GPS';
  $('arrival-source').textContent=dataMode==='demo'?'DEMO':'GPS';
  $('eta-context').hidden=dataMode==='demo';
  document.querySelector('.arrival-card').classList.toggle('live-eta',dataMode==='live');
  $('pause-simulation').hidden=dataMode!=='demo';
  $('live-status').hidden=dataMode!=='live';
  $('direction-button').hidden=dataMode!=='demo';
  $('direction-button').previousElementSibling.textContent=dataMode==='demo'?'Simulación de inicio a final':'Recorrido de inicio a final';
  $('map-buses').toggleAttribute('hidden',dataMode!=='demo');
  document.querySelector('.demo-speed').textContent=dataMode==='demo'?'Tiempo demo ×10':'GPS · consulta cada 5 s';
  document.querySelector('.demo-badge').childNodes.forEach(node=>{if(node.nodeType===Node.TEXT_NODE&&node.textContent.trim())node.textContent=dataMode==='demo'?' PROTOTIPO INTERACTIVO ':' GPS DE CONDUCTORES ';});
  realMap?.setDataMode(dataMode);
  $('route-notice').textContent=(currentRoute().approximateSegments.length?'Continuación de Calle 37 punteada: referencia pendiente de validar. ':'Posiciones de paraderos de referencia. ')+(dataMode==='demo'?'Camiones y tiempos simulados.':'Las unidades GPS muestran lecturas compartidas por los conductores.');
  if(dataMode==='demo')$('unit-count').textContent=String(currentRoute().buses.length);
  renderFleet();updateUrl();
}

function renderLocation(state=userLocation.state) {
  const busy=state.status==='requesting';
  $('locate-user').disabled=busy;
  $('locate-user').setAttribute('aria-busy',String(busy));
  $('locate-label').textContent=busy?'Buscando tu ubicación…':state.position?'Actualizar ubicación':'Usar mi ubicación';
  $('location-details').hidden=!state.position;
  $('center-user').hidden=!state.position;
  $('clear-location').hidden=state.status==='idle';
  $('location-status').classList.toggle('location-error',state.status==='error');
  if(state.status==='ready') {
    switchView(false);
    realMap?.setUserLocation(state.position);
    $('location-status').textContent='Tu ubicación está marcada en azul. Actualízala si te desplazas.';
    etaTarget='user';
    updateNearbyPoint();
  } else {
    etaTarget='manual';
    nearestPoint=null;
    realMap?.clearUserLocation();
    $('location-status').textContent=busy?'Acepta el permiso del navegador. Estamos intentando obtener una lectura de tu ubicación.':state.error||'Permite el acceso para ver dónde estás y encontrar una referencia cercana en esta ruta.';
  }
  updateArrival();
}
function updateNearbyPoint() {
  const position=userLocation.state.position;
  if(!position||!geometry)return;
  nearestPoint=nearestRoutePoint(currentRoute(),geometry,position);
  $('location-accuracy').textContent=`Precisión aproximada: ±${formatMeters(position.accuracy)}.${position.accuracy>500?' La lectura es poco precisa; intenta actualizarla desde tu celular.':''}`;
  $('location-nearest').textContent=nearestPoint?`${nearestPoint.isParadero?'Paradero de referencia':'Punto de referencia'} más cercano: ${nearestPoint.stop.name}, a ${formatMeters(nearestPoint.distance)} en línea recta. ${nearestPoint.distance>20000?'Tu ubicación está lejos de esta ruta. ':''}El acceso a pie y el lugar de ascenso requieren confirmación.`:'No hay puntos disponibles para esta ruta.';
  $('select-nearest-point').hidden=!nearestPoint;
  if(etaTarget==='user'&&nearestPoint&&stopId!==nearestPoint.stop.id)selectStop(nearestPoint.stop.id,{fromLocation:true,pan:false});
}

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').querySelector('span').textContent=message;
  $('toast').hidden=false;
  toastTimer=setTimeout(()=>$('toast').hidden=true,3400);
}
function updateUrl() {
  const url=new URL(location.href);
  url.searchParams.set('ruta',routeId);
  url.searchParams.set('parada',String(stopId+1));
  url.searchParams.set('sentido',reverse?'vuelta':'ida');
  url.searchParams.set('modo',dataMode);
  history.replaceState(null,'',url);
}
function renderFavoriteState() {
  const saved=isSaved();
  $('save-stop').classList.toggle('saved',saved);
  $('save-stop').setAttribute('aria-pressed',String(saved));
  $('save-stop').querySelector('span').textContent=saved?'Punto guardado':'Guardar punto';
  $('favorites-count').textContent=String(favorites.length);
  $('favorites-count').hidden=!favorites.length;
}
function persistFavorites() {
  try {localStorage.setItem('axc-ordered-favorites-v2',JSON.stringify(favorites));storageAvailable=true;}
  catch {storageAvailable=false;}
  renderFavoriteState();
  renderFavorites();
}
function renderFavorites() {
  const list=$('favorites-list');
  if(!favorites.length) {
    list.innerHTML=`<div class="empty-state">${icon('star')}<h3>Tu próximo viaje empieza aquí.</h3><p>Elige un punto del recorrido y pulsa<br>«Guardar punto» para encontrarla aquí.</p><button class="primary-button" id="empty-explore">Explorar rutas ${icon('arrow')}</button></div>`;
    $('empty-explore').addEventListener('click',()=>$('favorites-dialog').close());
  } else {
    list.innerHTML=favorites.map((favorite,index)=>{
      const route=ROUTES[favorite.route];
      return `<div class="favorite-card"><button data-favorite="${index}" aria-label="Abrir ${route.pointNames[favorite.stop]}, ${route.name}, ${favorite.reverse?'reproducción inversa':'recorrido de la imagen'}"><span class="route-number" style="color:${route.color};background:${route.soft}">${pad(Number(favorite.route))}</span><span class="favorite-info">${route.pointNames[favorite.stop]}<small>${route.name} · ${favorite.reverse?'Inverso · demo':'Original'}</small></span></button><button class="icon-button" data-remove-favorite="${index}" aria-label="Eliminar ${route.pointNames[favorite.stop]} de favoritas">${icon('close')}</button></div>`;
    }).join('');
  }
  $('favorites-dialog').querySelector('.local-note').textContent=storageAvailable?'Tus puntos se guardan solo en este navegador.':'Tus puntos se conservan durante esta visita; el navegador no permite guardarlas.';
}
function renderRoute() {
  const route=currentRoute();
  geometry=routeGeometry(route,reverse);
  document.documentElement.style.setProperty('--route',route.color);
  document.documentElement.style.setProperty('--route-soft',route.soft);
  $('route-select').value=routeId;
  $('route-point-count').textContent=String(route.points.length);
  $('points-list-count').textContent=String(route.points.length);
  $('map-route-legend').innerHTML=Object.values(ROUTES).map(r=>`<button data-route="${r.id}" aria-pressed="${r.id===routeId}" aria-label="Mostrar ${r.name}" style="--legend-color:${r.color}"><i></i>${r.id==='2'?'Laguna':r.shortName}</button>`).join('');
  $('route-number').textContent=pad(Number(routeId));
  $('route-subtitle').textContent=route.subtitle;
  $('unit-count').textContent=String(route.buses.length);
  $('route-origin').textContent=route.origin;
  $('route-destination').textContent=route.destination;
  $('route-notice').textContent=route.approximateSegments.length?'Continuación de Calle 37 punteada: trazado de referencia sin conexión completa en OSM. Camiones y tiempos simulados.':'Orden de calles proporcionado por ti. La posición exacta de los paraderos es de referencia. Camiones y tiempos simulados.';
  $('direction-label').textContent='Reiniciar demo';
  $('direction-button').setAttribute('aria-label',`Reiniciar la simulación desde el inicio`);
  $('map-route-id').textContent=`R${pad(Number(routeId))}`;
  const options=stops=>stops.map(stop=>`<option value="${stop.id}">${stop.name}${stop.id===0?' · Inicio':stop.id===route.points.length-1?' · Final':''}</option>`).join('');
  $('stop-select').innerHTML=routeId==='2'?`<optgroup label="Paraderos">${options(geometry.stops.filter(s=>route.pointKinds[s.id]==='paradero'))}</optgroup><optgroup label="Calles por las que transita">${options(geometry.stops.filter(s=>route.pointKinds[s.id]!=='paradero'))}</optgroup>`:options(geometry.stops);
  const points=geometry.diagramPath.map(x=>x.join(',')).join(' ');
  let arrows='';
  for(const p of [.18,.52,.86]) {
    const point=pointAt(geometry,p);
    arrows+=`<path d="m-4-4 4 4-4 4" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" transform="translate(${point.x} ${point.y}) rotate(${point.angle})"/>`;
  }
  $('route-lines').innerHTML=`<polyline points="${points}" fill="none" stroke="#ffffff" stroke-opacity=".7" stroke-width="19" stroke-linejoin="round" stroke-linecap="round"/><polyline points="${points}" fill="none" stroke="${route.color}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>${arrows}`;
  $('map-buses').innerHTML=route.buses.map((_,id)=>`<g class="bus-marker" data-bus="${id}" role="button" tabindex="0" aria-label="${unitName(id)}, camión simulado"><circle r="29" fill="${route.color}" opacity=".1"/><rect class="bus-body" x="-21" y="-21" width="42" height="42" rx="12" fill="#193d32" stroke="#fff" stroke-width="3" filter="url(#marker-shadow)"/><g fill="none" stroke="#dcf3b7" stroke-width="1.5" stroke-linecap="round"><rect x="-8" y="-12" width="16" height="21" rx="4"/><path d="M-8-1H8M-5 9v3m10-3v3M-4-8h8M-4 5h.5m7 0H4"/></g><rect x="7" y="9" width="19" height="15" rx="6" fill="#fff"/><text x="16.5" y="19.5" text-anchor="middle" fill="#39583b" font-family="Arial,sans-serif" font-size="9" font-weight="700">${pad(id+1)}</text></g>`).join('');
  if(realMap) realMap.renderRoute(route,geometry,stopId);
  renderStop(false);
  updateMotion();
  updateNearbyPoint();
  setDataMode(dataMode);
}
function renderStop(pan=true) {
  const route=currentRoute();
  const stop=currentStop();
  $('stop-select').value=String(stopId);
  $('arrival-stop').title=stop.name;
  $('arrival-stop').innerHTML=`a ${stop.name} ${icon('arrow')}`;
  $('stop-list').innerHTML=geometry.stops.map((s,index)=>`${routeId==='2'&&(index===0||index===11)?`<p class="stop-group-label">${index===0?'Paraderos':'Calles por las que transita'}</p>`:''}<button class="stop-item${s.id===stopId?' active':''}" data-stop="${s.id}" aria-pressed="${s.id===stopId}"><span class="stop-point"></span>${s.name}<small>${s.id===stopId?'Tu punto':index===0?'Inicio':index===geometry.stops.length-1?'Final':'Referencia'}</small></button>`).join('');
  $('map-stops').innerHTML=geometry.stops.map((s,index)=>`<g class="svg-stop" data-stop="${s.id}" role="button" tabindex="0" aria-pressed="${s.id===stopId}" aria-label="Seleccionar ${s.name}${index===0?', inicio':index===geometry.stops.length-1?', final':''}" transform="translate(${s.point[0]} ${s.point[1]})"><circle class="stop-hit" r="21" fill="transparent"/><circle r="${s.id===stopId?17:12}" fill="#fff" opacity="${s.id===stopId?.8:.6}"/><circle class="stop-dot" r="${s.id===stopId?9:7}" fill="${s.id===stopId?'#193d32':'#fff'}" stroke="${s.id===stopId?'#fff':route.color}" stroke-width="3"/><text x="0" y="${index%2?29:-21}" text-anchor="middle" font-size="10" font-weight="600" fill="#6f8568">${pad(s.id+1)}</text></g>`).join('');
  const labelX=Math.min(900,Math.max(100,stop.point[0]));
  $('selected-stop-label').innerHTML=`<g transform="translate(${labelX} ${stop.point[1]-50})" pointer-events="none" filter="url(#marker-shadow)"><rect x="-102" y="-15" width="204" height="34" rx="9" fill="#fff"/><path d="m-5 19 5 6 5-6" fill="#fff"/><circle cx="-86" cy="2" r="3.5" fill="${route.color}"/><text x="-74" y="6" font-size="11" font-weight="600" font-family="Arial,sans-serif" fill="#365334">${pad(stop.id+1)} · ${stop.name.length>25?stop.name.slice(0,24)+'…':stop.name}</text></g>`;
  renderFavoriteState();
  realMap?.selectStop(stopId,pan);
  updateArrival();
  updateUrl();
}
function selectStop(id,{fromLocation=false,pan=true}={}) {
  if(!Number.isInteger(id)||id<0||id>=currentRoute().points.length) return;
  if(!fromLocation)etaTarget='manual';
  stopId=id;
  picking=false;
  $('map-pick-notice').hidden=true;
  $('map-viewport').classList.remove('picking');
  renderStop(pan);
}
function updateMotion() {
  if(dataMode!=='demo')return;
  const buses=busPositions(currentRoute(),elapsedMinutes);
  realMap?.updateBuses(buses);
  buses.forEach(bus=>{
    const point=pointAt(geometry,bus.progress);
    const marker=$('map-buses').querySelector(`[data-bus="${bus.id}"]`);
    marker.setAttribute('transform',`translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})`);
  });
}
function updateArrival() {
  if(dataMode==='live') {
    const position=userLocation.state.position;
    const setText=(id,value)=>{if($(id).textContent!==value)$(id).textContent=value;};
    const target=currentStop();
    const locationText=etaTarget==='user'&&nearestPoint?`Cerca de ti: ${target.name}, a ${formatMeters(nearestPoint.distance)} en línea recta. No incluye el tiempo a pie.`:`Hasta ${target.name}. Usa tu ubicación para elegir una referencia cercana.`;
    setText('eta-target',locationText);
    let locationProblem='';
    if(etaTarget==='user') {
      if(!position||Date.now()-position.timestamp>300000)locationProblem='Actualiza tu ubicación para volver a calcular el ETA cercano a ti.';
      else if(position.accuracy>150)locationProblem='Tu ubicación es poco precisa. Actualízala o elige un punto manualmente.';
      else if(nearestPoint?.distance>1000)locationProblem='Estás lejos de los puntos de esta ruta. Elige otra ruta o un punto manualmente.';
    }
    const result=etaTracker.arrivals(routeId,target.distance,Date.now()+serverOffset);
    const next=locationProblem?null:result.next;
    realMap?.highlightEtaBus(next?.bus.id||null);
    if(!next) {
      setText('eta','—');
      $('eta').nextElementSibling.innerHTML='min<span>estimación pendiente</span>';
      setText('next-bus',fleetLoaded?'Sin ETA disponible':'Consultando GPS');
      setText('eta-explanation',locationProblem||(fleetError?'No se pudo actualizar el GPS. Esperando conexión y lecturas recientes.':!fleetLoaded?'Esperando datos GPS de los conductores…':etaUnavailableMessage(result.excluded)));
      $('eta').setAttribute('aria-label','Tiempo de llegada no disponible. '+$('eta-explanation').textContent);
      setText('arrival-source','GPS');
      return;
    }
    setText('eta',next.arriving?'0':String(Math.max(1,Math.ceil(next.minutes))));
    $('eta').nextElementSibling.innerHTML=next.arriving?'min<span>cerca del punto</span>':'min<span>aproximadamente</span>';
    setText('next-bus',`Unidad ${pad(next.bus.unit)}`);
    setText('arrival-source','GPS · APROX.');
    const withoutEstimate=Object.entries(result.excluded).filter(([reason])=>!['passed','reverse'].includes(reason)).reduce((sum,[,count])=>sum+count,0);
    setText('eta-explanation',next.arriving?'La última lectura sitúa al camión cerca del punto. Confirma su posición en el mapa.':
      `Rango orientativo: ${next.range[0]}–${next.range[1]} min · ${formatMeters(next.remaining)} por el recorrido. Basado en ${next.source==='sensor'?'velocidad GPS':'avance observado'}. Las paradas y el tráfico pueden cambiarlo.${withoutEstimate?' Hay otras unidades sin estimación.':''}`);
    $('eta').setAttribute('aria-label',next.arriving?`${$('next-bus').textContent} cerca de ${target.name}.`:`${Math.max(1,Math.ceil(next.minutes))} minutos aproximadamente hasta ${target.name}.`);
    return;
  }
  realMap?.highlightEtaBus(null);
  const next=arrivals(currentRoute(),geometry,stopId,elapsedMinutes)[0];
  const unit=$('eta').nextElementSibling;
  if(!next) {
    $('eta').textContent='—';
    unit.innerHTML='sin paso<span>en este viaje de la demo</span>';
    $('next-bus').textContent=busPositions(currentRoute(),elapsedMinutes).every(b=>b.finished)?'Recorrido finalizado':'Sin próximas unidades';
    $('eta').setAttribute('aria-label','Ninguna unidad pendiente de pasar por este punto en este viaje.');
    return;
  }
  unit.innerHTML='min<span>de espera simulada</span>';
  $('eta').textContent=String(Math.max(0,Math.ceil(next.minutes)));
  $('next-bus').textContent=unitName(next.id);
  $('eta').setAttribute('aria-label',`${Math.max(0,Math.ceil(next.minutes))} minutos de espera simulada`);
}
function setPaused(value) {
  paused=value;
  $('pause-simulation').classList.toggle('paused',paused);
  $('pause-simulation').setAttribute('aria-pressed',String(paused));
  $('pause-simulation').setAttribute('aria-label',paused?'Reanudar simulación':'Pausar simulación');
  $('simulation-text').textContent=paused?'Simulación pausada':'Simulación activa';
  $('pause-icon').textContent=paused?'▷':'Ⅱ';
}
function setZoom(value) {
  zoom=Math.max(.8,Math.min(1.8,Math.round(value*10)/10));
  $('map-transform').setAttribute('transform',`translate(500 370) scale(${zoom}) translate(-500 -370)`);
  updateZoomButtons();
}
function updateZoomButtons() {
  $('zoom-in').disabled=schemeView?zoom===1.8:realMap?realMap.getZoom()>=19:false;
  $('zoom-out').disabled=schemeView?zoom===.8:realMap?realMap.getZoom()<=3:false;
}
$('map-route-legend').addEventListener('click',event=>{const button=event.target.closest('[data-route]');if(button){$('route-select').value=button.dataset.route;$('route-select').dispatchEvent(new Event('change'));}});
$('show-all-routes').addEventListener('change',event=>realMap?.setShowAll(event.target.checked));
$('view-reference').addEventListener('click',()=>{const route=currentRoute();$('reference-title').textContent=route.name;$('reference-image').src=route.image;$('reference-image').alt=`Imagen de referencia de ${route.name}`;$('reference-streets').innerHTML=route.streets.map((street,i)=>`${route.id==='2'&&(i===0||i===11)?`<strong class="reference-group-label">${i===0?'Paraderos':'Calles por las que transita'}</strong>`:''}<span>${i+1}. ${street}</span>`).join('');showDialog('reference-dialog');});
function showDialog(id) {
  if(id==='favorites-dialog') renderFavorites();
  $(id).showModal();
}
function handleMapActivation(target) {
  const stop=target.closest('[data-stop]');
  if(stop) {selectStop(Number(stop.dataset.stop));return;}
  const bus=target.closest('[data-bus]');
  if(bus) {
    const id=Number(bus.dataset.bus);
    const next=arrivals(currentRoute(),geometry,stopId,elapsedMinutes).find(x=>x.id===id);
    const bus=busPositions(currentRoute(),elapsedMinutes).find(b=>b.id===id);
    toast(bus.finished?`${unitName(id)}: recorrido finalizado en ${currentRoute().destination}.`:next?`${unitName(id)} · ${Math.ceil(next.minutes)} min a este punto (simulado).`:`${unitName(id)} ya pasó por este punto en este viaje.`);
  }
}

$('route-select').addEventListener('change',event=>{
  routeId=event.target.value;
  stopId=Math.min(stopId,currentRoute().points.length-1);
  elapsedMinutes=0;
  setZoom(1);
  renderRoute();
});
$('stop-select').addEventListener('change',event=>selectStop(Number(event.target.value)));
$('data-mode').addEventListener('change',event=>setDataMode(event.target.value));
$('open-driver').addEventListener('click',()=>{if(!driver.session)$('driver-route').value=routeId;renderDriver();showDialog('driver-dialog');});
$('center-live-buses').addEventListener('click',()=>{switchView(false);realMap?.fitLiveBuses();});
$('driver-start').addEventListener('click',()=>{
  $('route-select').value=$('driver-route').value;$('route-select').dispatchEvent(new Event('change'));
  setDataMode('live');driver.start($('driver-route').value,Number($('driver-unit').value));
});
$('driver-stop').addEventListener('click',async()=>{await driver.stop();refreshFleet();});
$('locate-user').addEventListener('click',()=>{
  if(!realMap) {$('location-status').textContent='No se pudo iniciar el mapa. Recarga la página o elige un punto manualmente.';return;}
  userLocation.request();
});
$('center-user').addEventListener('click',()=>{switchView(false);realMap?.centerUser();});
$('clear-location').addEventListener('click',()=>{userLocation.clear();realMap?.fitRoute();});
$('select-nearest-point').addEventListener('click',()=>{
  if(!nearestPoint)return;
  etaTarget='user';
  selectStop(nearestPoint.stop.id,{fromLocation:true});
  switchView(false);
  realMap?.fitUserAndStop(nearestPoint.stop.id);
});
$('direction-button').addEventListener('click',()=>{elapsedMinutes=0;setPaused(false);updateMotion();updateArrival();toast('Simulación reiniciada. Las unidades terminan en la parada final.');});
$('stop-list').addEventListener('click',event=>handleMapActivation(event.target));
$('city-map').addEventListener('click',event=>handleMapActivation(event.target));
$('city-map').addEventListener('keydown',event=>{
  if((event.key==='Enter'||event.key===' ')&&event.target.closest('[role="button"]')) {
    event.preventDefault();
    const selected=event.target.closest('[data-stop]')?.dataset.stop;
    handleMapActivation(event.target);
    if(selected!==undefined) $('map-stops').querySelector(`[data-stop="${selected}"]`).focus({preventScroll:true});
  }
});
$('save-stop').addEventListener('click',()=>{
  const favorite=currentFavorite(),saved=isSaved();
  if(saved) favorites=favorites.filter(x=>favoriteKey(x)!==favoriteKey(favorite));
  else favorites.push(favorite);
  persistFavorites();
  toast(saved?'Punto eliminado de tus favoritos.':storageAvailable?'Punto guardado. Encuéntralo en Mis paradas.':'Punto guardado durante esta visita.');
});
$('favorites-list').addEventListener('click',event=>{
  const remove=event.target.closest('[data-remove-favorite]');
  if(remove) {favorites.splice(Number(remove.dataset.removeFavorite),1);persistFavorites();toast('Punto eliminado de tus favoritos.');return;}
  const open=event.target.closest('[data-favorite]');
  if(open) {
    const favorite=favorites[Number(open.dataset.favorite)];
    routeId=favorite.route;stopId=favorite.stop;reverse=favorite.reverse;elapsedMinutes=0;setZoom(1);renderRoute();$('favorites-dialog').close();
    $('route-select').focus({preventScroll:true});
    document.querySelector('.travel-workspace').scrollIntoView({behavior:reducedMotion?'instant':'smooth',block:'start'});
  }
});
$('share-route').addEventListener('click',async()=>{
  updateUrl();
  try {
    if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(location.href);
    else {
      const text=document.createElement('textarea');text.value=location.href;text.style.position='fixed';text.style.opacity='0';document.body.append(text);text.select();const ok=document.execCommand('copy');text.remove();if(!ok) throw Error('Copy unavailable');
    }
    toast('Enlace a tu ruta y punto copiado.');
  } catch {toast('Copia el enlace desde la barra de dirección para compartir esta parada.');}
});
$('pause-simulation').addEventListener('click',()=>setPaused(!paused));
$('zoom-in').addEventListener('click',()=>{if(!schemeView&&realMap)realMap.zoomBy(1);else setZoom(zoom+.2);});
$('zoom-out').addEventListener('click',()=>{if(!schemeView&&realMap)realMap.zoomBy(-1);else setZoom(zoom-.2);});
$('recenter').addEventListener('click',()=>{if(!schemeView&&realMap)realMap.fitRoute();else setZoom(1);toast('Recorrido centrado.');});
$('pick-map').addEventListener('click',()=>{
  picking=!picking;
  $('map-pick-notice').hidden=!picking;
  $('map-viewport').classList.toggle('picking',picking);
  if(picking) {
    $('map-panel').scrollIntoView({behavior:reducedMotion?'instant':'smooth',block:'center'});
    if(schemeView) $('map-stops').querySelector(`[data-stop="${stopId}"]`).focus({preventScroll:true});
    else realMap?.stops.get(stopId).getElement().focus({preventScroll:true});
  }
});
function switchView(scheme) {
  if(!scheme&&!realMap) {toast('El mapa no pudo iniciarse. Recarga la página para volver a intentarlo.');return;}
  schemeView=scheme;
  $('city-map').toggleAttribute('hidden',!scheme);
  document.querySelector('.geography').setAttribute('hidden','');
  document.querySelector('.schematic-grid').removeAttribute('hidden');
  realMap?.show(!scheme);
  $('map-service-status').classList.toggle('scheme-hidden',scheme);
  $('map-route-stamp').hidden=!scheme;
  $('map-description').textContent=scheme?(dataMode==='live'?'Esquema del recorrido · Las unidades GPS se ven en Mapa real':'Vista esquemática · Trazados de referencia'):'Cartografía real · Trazados de referencia';
  $('view-map').classList.toggle('active',!scheme);$('view-map').setAttribute('aria-pressed',String(!scheme));
  $('view-scheme').classList.toggle('active',scheme);$('view-scheme').setAttribute('aria-pressed',String(scheme));
  updateZoomButtons();
}
$('view-map').addEventListener('click',()=>switchView(false));
$('view-scheme').addEventListener('click',()=>switchView(true));
document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',()=>{
  const action=button.dataset.action;
  if(action==='favorites') showDialog('favorites-dialog');
  if(action==='about') showDialog('about-dialog');
  if(action==='explore') document.querySelector('.travel-workspace').scrollIntoView({behavior:reducedMotion?'instant':'smooth',block:'start'});
}));
document.querySelectorAll('.close-modal').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));
document.querySelectorAll('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{
  if(event.target===dialog) {
    const box=dialog.getBoundingClientRect();
    if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom) dialog.close();
  }
}));
let previous=performance.now(),lastPaint=0,lastArrival=0;
function animate(now) {
  const delta=Math.min((now-previous)/1000,.2);
  previous=now;
  if(dataMode==='demo'&&!paused&&!document.hidden) elapsedMinutes+=delta/60*10;
  if(now-lastPaint>32) {updateMotion();lastPaint=now;}
  if(now-lastArrival>300) {updateArrival();lastArrival=now;}
  requestAnimationFrame(animate);
}
try {
  realMap=new RealMap({onSelectStop:selectStop,onSelectBus:id=>handleMapActivation($('map-buses').querySelector(`[data-bus="${id}"]`)),onZoom:updateZoomButtons,onSelectRoute:id=>{ $('route-select').value=id;$('route-select').dispatchEvent(new Event('change')); }});
} catch(error) {
  console.error('No fue posible iniciar el mapa.',error);
  $('real-map').hidden=true;
  switchView(true);
  toast('El mapa no pudo iniciarse. Puedes usar el esquema y recargar para reintentar.');
}
renderRoute();
setPaused(paused);
const mobileViewport=window.matchMedia('(max-width:700px)');
function resizeMap() {$('city-map').setAttribute('viewBox',mobileViewport.matches?'65 35 900 800':'0 0 1000 740');}
mobileViewport.addEventListener('change',resizeMap);
resizeMap();
requestAnimationFrame(animate);
if(staticSite){
  const liveOption=$('data-mode').querySelector('[value=live]');
  liveOption.disabled=true;liveOption.textContent='GPS compartido · requiere servidor';
  $('open-driver').textContent='Acerca del GPS';
}
renderDriver();refreshFleet();
setInterval(refreshFleet,5000);
setInterval(()=>{if(!document.hidden)renderFleet();},1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshFleet();driver.pulse();}});
window.addEventListener('pagehide',()=>{driver.stop({unload:true});});
if(params.get('conductor')==='1')showDialog('driver-dialog');
