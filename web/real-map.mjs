import {MAP_CONFIG} from './maps-config.mjs';
import {geographicPointAt,ROUTES,routeGeometry} from './model.mjs';
import {formatMeters} from './geolocation.mjs';
import {LIVE_STALE} from './live-fleet.mjs';

export class RealMap {
  constructor({onSelectStop,onSelectBus,onZoom,onSelectRoute}) {
    const L=window.L;
    this.L=L;this.stops=new Map();this.buses=new Map();this.loadedTiles=0;
    this.map=L.map('real-map',{zoomControl:false,scrollWheelZoom:false,minZoom:MAP_CONFIG.minZoom,maxZoom:MAP_CONFIG.maxZoom,attributionControl:true}).setView(MAP_CONFIG.center,MAP_CONFIG.zoom);
    this.map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    this.tiles=L.tileLayer(MAP_CONFIG.tileUrl,{maxZoom:MAP_CONFIG.maxZoom,attribution:MAP_CONFIG.attribution,referrerPolicy:'strict-origin-when-cross-origin'}).addTo(this.map);
    this.network=L.layerGroup().addTo(this.map);
    this.layers=L.layerGroup().addTo(this.map);
    this.locationLayer=L.layerGroup().addTo(this.map);
    this.liveLayer=L.layerGroup().addTo(this.map);this.liveMarkers=new Map();this.dataMode='live';
    this.showAll=false;this.onSelectRoute=onSelectRoute;
    this.onSelectStop=onSelectStop;this.onSelectBus=onSelectBus;
    this.map.on('zoomend',onZoom);
    this.tiles.on('tileload',()=>{this.loadedTiles++;this.setStatus('');});
    this.tiles.on('load',()=>{if(!this.loadedTiles)this.showTileError();});
    this.tiles.on('tileerror',()=>{if(!this.loadedTiles)this.showTileError();});
    this.timeout=setTimeout(()=>{if(!this.loadedTiles)this.showTileError();},12000);
    this.setStatus('Cargando mapa de Ciudad del Carmen…');
    document.getElementById('retry-map').addEventListener('click',()=>{this.loadedTiles=0;this.setStatus('Cargando mapa de Ciudad del Carmen…');this.tiles.redraw();});
    if(typeof ResizeObserver!=='undefined') {
      this.observer=new ResizeObserver(()=>this.map.invalidateSize({pan:false}));
      this.observer.observe(document.getElementById('real-map'));
    }
  }
  setStatus(message,error=false) {
    const status=document.getElementById('map-service-status');
    status.hidden=!message;
    document.getElementById('map-service-message').textContent=message;
    document.getElementById('retry-map').hidden=!error;
  }
  showTileError() {this.setStatus('No se pudo cargar la cartografía. Revisa tu conexión o usa la vista Esquema.',true);}
  stopIcon(stop,selected,color) {
    return this.L.divIcon({className:'real-stop-marker',iconSize:[32,32],iconAnchor:[16,16],html:`<span class="real-stop-dot${selected?' selected':''}" style="--stop-color:${color}">${String(stop.id+1).padStart(2,'0')}${stop.id===0?'<small class="endpoint-badge">I</small>':stop.id===this.geometry.stops.length-1?'<small class="endpoint-badge end">F</small>':''}</span>`});
  }
  renderRoute(route,geometry,stopId) {
    this.geometry=geometry;this.route=route;
    this.layers.clearLayers();this.stops.clear();this.buses.clear();
    this.renderNetwork();
    this.L.polyline(geometry.geographic.path,{color:'#fff',weight:10,opacity:.9,interactive:false}).addTo(this.layers);
    this.L.polyline(geometry.geographic.path,{color:route.color,weight:5,opacity:1,interactive:false}).addTo(this.layers);
    if(route.approximateSegments.length) {
      for(const segment of route.approximateSegments) {
        this.L.polyline(segment,{color:'#fff',weight:7,interactive:false}).addTo(this.layers);
        this.L.polyline(segment,{color:route.color,weight:4,dashArray:'5 6'}).bindTooltip('Continuación de Calle 37 · Referencia por confirmar').addTo(this.layers);
      }
    }
    geometry.stops.forEach(stop=>{
      const marker=this.L.marker(stop.latlng,{icon:this.stopIcon(stop,stop.id===stopId,route.color),keyboard:true,title:`${stop.id===0?'Inicio: ':stop.id===geometry.stops.length-1?'Parada final: ':''}${stop.name}`,riseOnHover:true}).addTo(this.layers);
      marker.on('click',()=>this.onSelectStop(stop.id));
      const element=marker.getElement();
      element.setAttribute('aria-label',`${stop.name}, punto de referencia del recorrido. Seleccionar.`);
      element.addEventListener('keydown',event=>{if(event.key===' ') {event.preventDefault();this.onSelectStop(stop.id);}});
      this.stops.set(stop.id,marker);
    });
    route.buses.forEach((_,id)=>{
      const icon=this.L.divIcon({className:'real-bus-marker',iconSize:[38,42],iconAnchor:[19,21],html:`<span class="real-bus-body"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2" width="14" height="17" rx="4"/><path d="M5 11h14M8 19v2m8-2v2M9 6h6M8.5 15h.5m6 0h.5"/></svg><b>${id+1}</b></span>`});
      const marker=this.L.marker(geometry.stops[0].latlng,{icon,keyboard:true,title:`Unidad ${id+1} · Ubicación simulada`,zIndexOffset:500}).addTo(this.layers);
      marker.on('click',()=>this.onSelectBus(id));
      marker.getElement().setAttribute('aria-label',`Unidad ${id+1}, camión simulado. Ver llegada.`);
      marker.getElement().addEventListener('keydown',event=>{if(event.key===' ') {event.preventDefault();this.onSelectBus(id);}});
      this.buses.set(id,marker);
    });
    this.selectStop(stopId,false);
    this.setDataMode(this.dataMode);
    this.fitRoute();
  }
  selectStop(id,pan=true) {
    if(!this.geometry)return;
    this.geometry.stops.forEach(stop=>{
      const marker=this.stops.get(stop.id);
      marker.setIcon(this.stopIcon(stop,stop.id===id,this.route.color));
      marker.getElement().setAttribute('aria-pressed',String(stop.id===id));
      marker.unbindTooltip();
      if(stop.id===id) marker.bindTooltip(stop.name,{permanent:true,direction:'top',offset:[0,-15],className:'real-stop-tooltip'}).openTooltip();
    });
    if(pan&&!document.getElementById('real-map').hidden) this.map.panInside(this.stops.get(id).getLatLng(),{paddingTopLeft:[55,105],paddingBottomRight:[55,95]});
  }
  updateBuses(buses) {if(this.geometry) for(const bus of buses) this.buses.get(bus.id)?.setLatLng(geographicPointAt(this.geometry,bus.progress));}
  setDataMode(mode) {
    this.dataMode=mode;
    for(const marker of this.buses.values()) {
      if(mode==='demo')this.layers.addLayer(marker);
      else this.layers.removeLayer(marker);
    }
    if(mode==='demo') {this.liveLayer.clearLayers();this.liveMarkers.clear();}
  }
  renderLiveBuses(buses,now=Date.now()) {
    if(this.dataMode!=='live')return;
    const ids=new Set(buses.map(bus=>bus.id));
    for(const [id,entry] of this.liveMarkers)if(!ids.has(id)){this.liveLayer.removeLayer(entry.marker);this.liveMarkers.delete(id);}
    for(const bus of buses) {
      const stale=now-bus.sampledAt>LIVE_STALE;
      let entry=this.liveMarkers.get(bus.id);
      const icon=()=>this.L.divIcon({className:'real-bus-marker live-bus-marker',iconSize:[38,42],iconAnchor:[19,21],html:`<span class="real-bus-body${stale?' stale-gps':''}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2" width="14" height="17" rx="4"/><path d="M5 11h14M8 19v2m8-2v2M9 6h6M8.5 15h.5m6 0h.5"/></svg><b>${String(bus.unit).padStart(2,'0')}</b><small>GPS</small></span>`});
      if(!entry) {
        const marker=this.L.marker(bus.latlng,{icon:icon(),keyboard:true,zIndexOffset:700,title:`Unidad ${bus.unit} · GPS del conductor`}).addTo(this.liveLayer);
        entry={marker,stale};this.liveMarkers.set(bus.id,entry);
      }
      entry.marker.setLatLng(bus.latlng);
      if(entry.stale!==stale){entry.marker.setIcon(icon());entry.stale=stale;}
      const text=`Unidad ${String(bus.unit).padStart(2,'0')} · ${stale?'GPS desactualizado':'GPS del conductor'} · Lectura hace ${Math.max(0,Math.round((now-bus.sampledAt)/1000))} s · Precisión ±${formatMeters(bus.accuracy)}`;
      entry.marker.getElement()?.setAttribute('aria-label',text);
      if(!entry.marker.getTooltip())entry.marker.bindTooltip(text,{direction:'top',className:'real-stop-tooltip'});
      else entry.marker.setTooltipContent(text);
    }
  }
  fitLiveBuses() {
    const points=[...this.liveMarkers.values()].map(entry=>entry.marker.getLatLng());
    if(points.length)this.map.fitBounds(this.L.latLngBounds(points),{padding:[60,110],maxZoom:16,animate:false});
  }
  highlightEtaBus(id) {
    for(const [busId,entry] of this.liveMarkers)entry.marker.getElement()?.classList.toggle('eta-next',busId===id);
  }
  setUserLocation(position) {
    this.clearUserLocation();
    this.userPosition=position;
    this.userAccuracy=this.L.circle(position.latlng,{radius:position.accuracy,color:'#2878d2',weight:1,opacity:.65,fillColor:'#428fec',fillOpacity:.12,interactive:false}).addTo(this.locationLayer);
    const icon=this.L.divIcon({className:'user-location-marker',iconSize:[24,24],iconAnchor:[12,12],html:'<span class="user-location-dot"></span>'});
    this.userMarker=this.L.marker(position.latlng,{icon,keyboard:true,title:'Tu ubicación estimada',zIndexOffset:1000}).addTo(this.locationLayer);
    this.userMarker.bindTooltip(`Tu ubicación · Precisión aproximada ±${formatMeters(position.accuracy)}`,{direction:'top',offset:[0,-12],className:'real-stop-tooltip'});
    this.userMarker.getElement()?.setAttribute('aria-label',`Tu ubicación estimada. Precisión aproximada más o menos ${formatMeters(position.accuracy)}.`);
    this.centerUser();
  }
  centerUser() {
    if(!this.userPosition)return;
    this.map.invalidateSize({pan:false});
    if(this.userPosition.accuracy>100) this.map.fitBounds(this.userAccuracy.getBounds(),{padding:[45,90],maxZoom:16,animate:false});
    else this.map.setView(this.userPosition.latlng,16,{animate:false});
  }
  fitUserAndStop(stopId) {
    if(!this.userPosition||!this.geometry)return;
    const stop=this.geometry.stops.find(stop=>stop.id===stopId);
    if(stop)this.map.fitBounds(this.L.latLngBounds([this.userPosition.latlng,stop.latlng]),{paddingTopLeft:[45,100],paddingBottomRight:[45,110],maxZoom:16,animate:false});
  }
  clearUserLocation() {
    this.locationLayer.clearLayers();
    this.userPosition=null;this.userMarker=null;this.userAccuracy=null;
  }
  renderNetwork() {
    this.network.clearLayers();
    if(!this.showAll)return;
    for(const route of Object.values(ROUTES)) {
      if(route.id===this.route?.id)continue;
      const geometry=routeGeometry(route);
      this.L.polyline(geometry.geographic.path,{color:route.color,weight:4,opacity:.6}).bindTooltip(route.name).on('click',()=>this.onSelectRoute?.(route.id)).addTo(this.network);
      for(const segment of route.approximateSegments) {
        this.L.polyline(segment,{color:'#fff',weight:7,interactive:false}).addTo(this.network);
        this.L.polyline(segment,{color:route.color,weight:4,opacity:.6,dashArray:'5 6'}).bindTooltip('Calle 37 · Referencia por confirmar').on('click',()=>this.onSelectRoute?.(route.id)).addTo(this.network);
      }
    }
  }
  setShowAll(value) {this.showAll=value;this.renderNetwork();this.fitRoute();}
  fitRoute() {
    if(!this.geometry||document.getElementById('real-map').hidden)return;
    this.map.invalidateSize({pan:false});
    const paths=this.showAll?Object.values(ROUTES).flatMap(route=>routeGeometry(route).geographic.path):this.geometry.geographic.path;
    this.map.fitBounds(this.L.latLngBounds(paths),{paddingTopLeft:[50,100],paddingBottomRight:[50,110],maxZoom:15,animate:false});
  }
  show(visible) {
    document.getElementById('real-map').hidden=!visible;
    if(visible) this.fitRoute();
  }
  zoomBy(delta) {this.map.setZoom(this.map.getZoom()+delta);}
  getZoom() {return this.map.getZoom();}
}
