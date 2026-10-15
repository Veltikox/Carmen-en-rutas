export const LIVE_TTL=90000;
export const LIVE_STALE=30000;
export function visibleBuses(buses,routeId,now=Date.now()) {
  return buses.filter(bus=>bus.routeId===routeId&&Number.isFinite(bus.sampledAt)&&
    now-bus.sampledAt<=LIVE_TTL&&now-bus.updatedAt<=LIVE_TTL);
}
export async function fleetRequest(method='GET',body,token,{keepalive=false,fetcher=(...args)=>globalThis.fetch(...args)}={}) {
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),10000);
  try {
    const response=await fetcher('/api/fleet',{method,credentials:'same-origin',cache:'no-store',
      headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},
      body:body?JSON.stringify(body):undefined,signal:controller.signal,keepalive});
    let result;
    try {result=await response.json();}
    catch {throw new Error('El servicio GPS no respondió. Revisa tu conexión e inicio de sesión.');}
    if(!response.ok) {const error=new Error(result.error||'No se pudo conectar al servicio GPS.');error.status=response.status;throw error;}
    return result;
  } finally {clearTimeout(timeout);}
}
