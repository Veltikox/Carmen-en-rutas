import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '../../chatgpt-auth';
import {handleFleetRequest} from '../../../server/fleet.mjs';

export const dynamic='force-dynamic';
async function handle(request: Request) {
  try {
    return await handleFleetRequest(request,{db:env.DB,user:await getChatGPTUser(),allowedEmails:env.DRIVER_ALLOWED_EMAILS||''});
  } catch (error) {
    console.error('Fleet API failed',error instanceof Error?error.message:'unknown');
    return Response.json({error:'No se pudo consultar el servicio GPS. Intenta de nuevo.'},{status:503,headers:{'Cache-Control':'no-store'}});
  }
}
export {handle as GET,handle as POST,handle as PUT,handle as DELETE};
