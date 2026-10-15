import {readPosition,locationErrorMessage} from './geolocation.mjs';
import {fleetRequest} from './live-fleet.mjs';

export function readDriverFix(position) {
  const fix=readPosition(position),{speed,heading}=position.coords;
  return {...fix,speedMps:Number.isFinite(speed)&&speed>=0&&speed<=50?speed:null,
    heading:Number.isFinite(heading)&&heading>=0&&heading<360?heading:null};
}

export class DriverTracker {
  constructor({geolocation=globalThis.navigator?.geolocation,secure=globalThis.isSecureContext,
    request=fleetRequest,onChange=()=>{},now=Date.now,
    setTimer=(callback,delay)=>globalThis.setInterval(callback,delay),
    clearTimer=id=>globalThis.clearInterval(id)}={}) {
    Object.assign(this,{geolocation,secure,request,onChange,now,setTimer,clearTimer});
    this.generation=0;this.session=null;this.watchId=null;this.timer=null;this.fix=null;
    this.inFlight=false;this.refreshing=false;this.lastAttempt=-Infinity;this.sequence=0;
    this.state={status:'idle',message:'Elige la ruta y la unidad que vas a conducir.',lastSentAt:null};
  }
  emit(change) {this.state={...this.state,...change};this.onChange(this.state);}
  async start(routeId,unit) {
    if(this.session||['starting','stopping'].includes(this.state.status))return;
    if(!this.secure||!this.geolocation?.watchPosition) {
      this.emit({status:'error',message:'Necesitas HTTPS, un navegador con ubicación y permiso del dispositivo.'});return;
    }
    const run=++this.generation;
    this.emit({status:'starting',message:'Conectando la unidad…',routeId,unit,lastSentAt:null});
    try {
      const result=await this.request('POST',{routeId,unit});
      const session={routeId,unit,token:result.token};
      if(run!==this.generation) {await this.request('DELETE',{routeId,unit},session.token).catch(()=>{});return;}
      this.session=session;this.sequence=0;this.fix=null;this.lastAttempt=-Infinity;
      this.emit({status:'sharing',message:'Acepta el permiso del navegador. Esperando una lectura GPS…'});
      const success=position=>{
        if(run!==this.generation)return;
        try {this.fix=readDriverFix(position);}
        catch {this.emit({message:'La lectura GPS no es válida. Esperando otra lectura…'});return;}
        this.pulse();
      };
      const failure=error=>{
        if(run!==this.generation)return;
        if(error.code===1) {this.stop().then(()=>this.emit({status:'error',message:locationErrorMessage(error)}));}
        else this.emit({message:locationErrorMessage(error)+' La última lectura caducará si no se recupera.'});
      };
      const watchId=this.geolocation.watchPosition(success,failure,{enableHighAccuracy:true,timeout:15000,maximumAge:5000});
      if(run!==this.generation) {this.geolocation.clearWatch(watchId);return;}
      this.watchId=watchId;
      this.timer=this.setTimer(()=>this.pulse(),5000);
    } catch(error) {
      if(run!==this.generation)return;
      if(this.session)await this.stop();
      this.emit({status:'error',message:error.message||'No se pudo iniciar la transmisión.'});
    }
  }
  async pulse() {
    const session=this.session,run=this.generation;
    if(!session)return;
    const now=this.now();
    if((!this.fix||now-this.fix.timestamp>10000)&&!this.refreshing&&this.geolocation.getCurrentPosition) {
      this.refreshing=true;
      try {
        this.geolocation.getCurrentPosition(position=>{
          if(run!==this.generation)return;
          this.refreshing=false;
          try {this.fix=readDriverFix(position);}catch{return;}
          this.pulse();
        },()=>{if(run===this.generation)this.refreshing=false;},{enableHighAccuracy:true,timeout:10000,maximumAge:5000});
      } catch {this.refreshing=false;}
    }
    if(this.inFlight||!this.fix||now-this.fix.timestamp>20000||now-this.lastAttempt<5000)return;
    this.inFlight=true;this.lastAttempt=now;
    const fix=this.fix;
    try {
      await this.request('PUT',{routeId:session.routeId,unit:session.unit,
        latitude:fix.latlng[0],longitude:fix.latlng[1],accuracy:fix.accuracy,speedMps:fix.speedMps,heading:fix.heading,sampledAt:fix.timestamp,sequence:++this.sequence},session.token);
      if(run===this.generation)this.emit({lastSentAt:this.now(),accuracy:fix.accuracy,
        message:'Ubicación compartida. Mantén esta página abierta y la pantalla encendida.'});
    } catch(error) {
      if(run!==this.generation)return;
      if([401,403,409].includes(error.status)) {await this.stop();this.emit({status:'error',message:error.message});}
      else this.emit({message:'No se pudo enviar la lectura. Se reintentará; los pasajeros verán cuándo se actualizó por última vez.'});
    } finally {this.inFlight=false;}
  }
  async stop({unload=false}={}) {
    ++this.generation;
    if(this.watchId!==null)this.geolocation.clearWatch(this.watchId);
    if(this.timer!==null)this.clearTimer(this.timer);
    const session=this.session;
    this.session=null;this.watchId=null;this.timer=null;this.fix=null;this.refreshing=false;
    this.emit({status:'stopping',message:'Finalizando transmisión…'});
    let notified=true;
    if(session)try {await this.request('DELETE',{routeId:session.routeId,unit:session.unit},session.token,{keepalive:unload});}
    catch {notified=false;}
    this.emit({status:'idle',lastSentAt:null,message:notified?'Transmisión finalizada. Se dejó de compartir tu ubicación.':'Se detuvo el GPS en este teléfono. No se pudo avisar al servidor; la última posición desaparecerá al caducar, en un máximo de 90 segundos.'});
  }
}
