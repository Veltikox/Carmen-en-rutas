export const FLEET_TTL = 90000;
export const STALE_AFTER = 30000;
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const problem=(message,status)=>json({error:message},status);

export async function hashToken(value) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function isDriver(user,allowedEmails='') {
  return !!user?.userId && !!user?.email && allowedEmails.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).includes(user.email.toLowerCase());
}
export function validateUnit(body) {
  return ['1','2','3'].includes(body?.routeId) && Number.isInteger(body?.unit) && body.unit>=1 && body.unit<=3;
}
export function validFix(body,now) {
  return Number.isFinite(body?.latitude)&&Math.abs(body.latitude)<=90&&
    Number.isFinite(body?.longitude)&&Math.abs(body.longitude)<=180&&
    Number.isFinite(body?.accuracy)&&body.accuracy>=0&&
    (body.speedMps==null||(Number.isFinite(body.speedMps)&&body.speedMps>=0&&body.speedMps<=50))&&
    (body.heading==null||(Number.isFinite(body.heading)&&body.heading>=0&&body.heading<360))&&
    Number.isFinite(body?.sampledAt)&&body.sampledAt>=now-30000&&body.sampledAt<=now+10000&&
    Number.isSafeInteger(body?.sequence)&&body.sequence>0;
}

/**
 * @param {Request} request
 * @param {{db: any, user?: {userId:string,email:string}|null, allowedEmails?:string, now?:number}} options
 */
export async function handleFleetRequest(request,{db,user=null,allowedEmails='',now=Date.now()}) {
  if(!db)return problem('El servicio GPS no está disponible.',503);
  const canDrive=isDriver(user,allowedEmails);
  if(request.method==='GET') {
    const {results}=await db.prepare(`SELECT id,route_id,unit,latitude,longitude,accuracy,speed_mps,heading,sampled_at,updated_at
      FROM live_buses WHERE active=1 AND latitude IS NOT NULL AND sampled_at>=? AND updated_at>=?`).bind(now-FLEET_TTL,now-FLEET_TTL).all();
    const buses=results.map(row=>({id:row.id,routeId:row.route_id,unit:row.unit,
      latlng:[row.latitude,row.longitude],accuracy:row.accuracy,speedMps:row.speed_mps,heading:row.heading,sampledAt:row.sampled_at,updatedAt:row.updated_at}));
    return json({buses,canDrive,serverTime:now});
  }
  if(!['POST','PUT','DELETE'].includes(request.method))return problem('Método no permitido.',405);
  const origin=request.headers.get('origin');
  if(origin && origin!==new URL(request.url).origin)return problem('Solicitud de otro origen rechazada.',403);
  if(!canDrive)return problem('Tu cuenta no tiene acceso de conductor.',403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))return problem('Se requiere JSON.',415);
  if(Number(request.headers.get('content-length')||0)>4096)return problem('Solicitud demasiado grande.',413);
  let body;
  try {const text=await request.text();if(text.length>4096)return problem('Solicitud demasiado grande.',413);body=JSON.parse(text);}
  catch{return problem('La solicitud no contiene JSON válido.',400);}
  if(!validateUnit(body))return problem('Elige una ruta y una unidad del 1 al 3.',400);
  const id=`${body.routeId}-${body.unit}`;
  if(request.method==='POST') {
    const token=crypto.randomUUID()+crypto.randomUUID();
    const hash=await hashToken(token);
    const result=await db.prepare(`INSERT INTO live_buses(id,route_id,unit,owner_id,session_hash,updated_at,sequence,active)
      VALUES(?,?,?,?,?,?,0,1) ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id,session_hash=excluded.session_hash,
      latitude=NULL,longitude=NULL,accuracy=NULL,speed_mps=NULL,heading=NULL,sampled_at=NULL,updated_at=excluded.updated_at,sequence=0,active=1
      WHERE live_buses.active=0 OR live_buses.updated_at<?`).bind(id,body.routeId,body.unit,user.userId,hash,now,now-FLEET_TTL).run();
    if(!result.meta.changes)return problem('Esta unidad ya está transmitiendo. Elige otra o espera a que finalice.',409);
    return json({token,id,serverTime:now},201);
  }
  const token=request.headers.get('authorization')?.match(/^Bearer ([a-zA-Z0-9-]{50,100})$/)?.[1];
  if(!token)return problem('La sesión del conductor no es válida.',401);
  const hash=await hashToken(token);
  if(request.method==='DELETE') {
    const result=await db.prepare(`UPDATE live_buses SET active=0,latitude=NULL,longitude=NULL,accuracy=NULL,speed_mps=NULL,heading=NULL,
      sampled_at=NULL,session_hash='',owner_id='',updated_at=? WHERE id=? AND owner_id=? AND session_hash=? AND active=1`)
      .bind(now,id,user.userId,hash).run();
    return result.meta.changes?json({stopped:true}):problem('La sesión ya terminó o pertenece a otro dispositivo.',409);
  }
  if(!validFix(body,now))return problem('La ubicación no es válida o está desactualizada. Revisa la ubicación y la hora de tu teléfono.',400);
  const result=await db.prepare(`UPDATE live_buses SET latitude=?,longitude=?,accuracy=?,speed_mps=?,heading=?,sampled_at=?,updated_at=?,sequence=?
    WHERE id=? AND owner_id=? AND session_hash=? AND active=1 AND sequence<? AND updated_at>=?`)
    .bind(body.latitude,body.longitude,body.accuracy,body.speedMps??null,body.heading??null,body.sampledAt,now,body.sequence,id,user.userId,hash,body.sequence,now-FLEET_TTL).run();
  if(!result.meta.changes)return problem('La sesión caducó o la lectura ya fue reemplazada. Finaliza y vuelve a iniciar.',409);
  return json({received:true,serverTime:now});
}
