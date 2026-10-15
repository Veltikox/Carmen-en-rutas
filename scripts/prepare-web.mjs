import {cp, mkdir, rm} from 'node:fs/promises';
const destination=new URL('../public/',import.meta.url);
await rm(destination,{recursive:true,force:true});
await mkdir(destination,{recursive:true});
await cp(new URL('../web/',import.meta.url),destination,{recursive:true});
await rm(new URL('index.html',destination),{force:true});
