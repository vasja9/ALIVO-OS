import { request as nodeHttpsRequest } from "node:https";
import type { RequestOptions } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";

export const PINTEREST_THUMBNAIL_MAX_BYTES = 256 * 1024;
export const PINTEREST_THUMBNAIL_TOTAL_MAX_BYTES = 6 * 1024 * 1024;
export const PINTEREST_THUMBNAIL_MAX_CONCURRENCY = 4;
export const PINTEREST_THUMBNAIL_TIMEOUT_MS = 8_000;

export type PinterestThumbnailMimeType = "image/jpeg" | "image/png" | "image/webp";
export interface PinterestSafeThumbnail { readonly mimeType:PinterestThumbnailMimeType; readonly base64:string; }
export interface PinterestThumbnailSource { readonly url:string; readonly width:number; readonly height:number; }

type RequestFactory=(url:URL,options:RequestOptions,onResponse:(response:IncomingMessage)=>void)=>ClientRequest;

const object=(value:unknown):Record<string,unknown>|undefined=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
const boundedDimension=(value:unknown):value is number=>Number.isInteger(value)&&Number(value)>0&&Number(value)<=10_000;

export function selectPinterestThumbnail(media:unknown):PinterestThumbnailSource|undefined {
  const root=object(media),images=object(root?.images);
  if(root?.media_type!=="image"||!images)return undefined;
  for(const size of ["400x300","150x150"]){
    const candidate=object(images[size]);
    if(typeof candidate?.url==="string"&&boundedDimension(candidate.width)&&boundedDimension(candidate.height)&&canonicalPinterestThumbnailUrl(candidate.url))return Object.freeze({url:candidate.url,width:candidate.width as number,height:candidate.height as number});
  }
  return undefined;
}

export function canonicalPinterestThumbnailUrl(value:unknown):URL|undefined {
  if(typeof value!=="string"||value.length===0||value.length>2048)return undefined;
  try{
    const parsed=new URL(value);
    if(parsed.protocol!=="https:"||parsed.hostname!=="i.pinimg.com"||parsed.username||parsed.password||parsed.port||parsed.hash||!parsed.pathname||parsed.pathname==="/"||parsed.href!==value)return undefined;
    let decoded:string;try{decoded=decodeURIComponent(parsed.pathname);}catch{return undefined;}
    if(decoded.includes("\\")||decoded.split("/").some(segment=>segment==="."||segment===".."))return undefined;
    if(/%(?:2e|2f|5c|25)/i.test(parsed.pathname))return undefined;
    return parsed;
  }catch{return undefined;}
}

function detectedMimeType(contentType:string|undefined,body:Buffer):PinterestThumbnailMimeType|undefined {
  const declared=contentType?.split(";",1)[0].trim().toLowerCase();
  const jpeg=body.length>=4&&body[0]===0xff&&body[1]===0xd8&&body[2]===0xff&&body[body.length-2]===0xff&&body[body.length-1]===0xd9;
  const pngEnd=Buffer.from([0x00,0x00,0x00,0x00,0x49,0x45,0x4e,0x44,0xae,0x42,0x60,0x82]);
  const png=body.length>=20&&body.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))&&body.subarray(-12).equals(pngEnd);
  const webp=body.length>=12&&body.subarray(0,4).toString("ascii")==="RIFF"&&body.subarray(8,12).toString("ascii")==="WEBP"&&body.readUInt32LE(4)+8===body.length;
  if(declared==="image/jpeg"&&jpeg)return "image/jpeg";
  if(declared==="image/png"&&png)return "image/png";
  if(declared==="image/webp"&&webp)return "image/webp";
  return undefined;
}

export function safeThumbnailDto(value:unknown):PinterestSafeThumbnail|null {
  const candidate=object(value);
  if(!candidate||!(["image/jpeg","image/png","image/webp"] as unknown[]).includes(candidate.mimeType)||typeof candidate.base64!=="string"||candidate.base64.length===0||candidate.base64.length>Math.ceil(PINTEREST_THUMBNAIL_MAX_BYTES/3)*4)return null;
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(candidate.base64))return null;
  const decoded=Buffer.from(candidate.base64,"base64");
  if(decoded.length===0||decoded.length>PINTEREST_THUMBNAIL_MAX_BYTES||decoded.toString("base64")!==candidate.base64)return null;
  const mimeType=detectedMimeType(candidate.mimeType as string,decoded);
  return mimeType?Object.freeze({mimeType,base64:candidate.base64}):null;
}

export function fetchPinterestThumbnail(source:PinterestThumbnailSource,requestFactory:RequestFactory=nodeHttpsRequest):Promise<PinterestSafeThumbnail|null>{
  const parsed=canonicalPinterestThumbnailUrl(source.url);if(!parsed)return Promise.resolve(null);
  return new Promise(resolve=>{
    let settled=false;const finish=(value:PinterestSafeThumbnail|null)=>{if(settled)return;settled=true;resolve(value);};
    const request=requestFactory(parsed,{method:"GET",headers:{Accept:"image/jpeg, image/png, image/webp"},timeout:PINTEREST_THUMBNAIL_TIMEOUT_MS},response=>{
      if(response.statusCode!==200){response.resume();request.destroy();finish(null);return;}
      const declaredLength=Number(response.headers["content-length"]);if(Number.isFinite(declaredLength)&&declaredLength>PINTEREST_THUMBNAIL_MAX_BYTES){response.destroy();request.destroy();finish(null);return;}
      const chunks:Buffer[]=[];let bytes=0;
      response.on("data",chunk=>{const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);bytes+=buffer.length;if(bytes>PINTEREST_THUMBNAIL_MAX_BYTES){response.destroy();request.destroy();finish(null);return;}chunks.push(buffer);});
      response.on("end",()=>{if(bytes===0){finish(null);return;}const body=Buffer.concat(chunks,bytes),mimeType=detectedMimeType(typeof response.headers["content-type"]==="string"?response.headers["content-type"]:undefined,body);finish(mimeType?safeThumbnailDto({mimeType,base64:body.toString("base64")}):null);});
      response.on("error",()=>finish(null));response.on("aborted",()=>finish(null));
    });
    request.on("timeout",()=>{request.destroy();finish(null);});
    request.on("error",()=>finish(null));
    request.end();
  });
}

export async function fetchPinterestThumbnails<T>(items:readonly T[],source:(item:T)=>PinterestThumbnailSource|undefined,fetcher:(source:PinterestThumbnailSource)=>Promise<PinterestSafeThumbnail|null>=fetchPinterestThumbnail):Promise<readonly (PinterestSafeThumbnail|null)[]>{
  const output:(PinterestSafeThumbnail|null)[]=Array(items.length).fill(null);let cursor=0,total=0;
  const worker=async()=>{while(true){const index=cursor++;if(index>=items.length)return;const selected=source(items[index]);if(!selected)continue;let thumbnail:PinterestSafeThumbnail|null;try{thumbnail=safeThumbnailDto(await fetcher(selected));}catch{continue;}if(!thumbnail)continue;const bytes=Buffer.from(thumbnail.base64,"base64").length;if(total+bytes>PINTEREST_THUMBNAIL_TOTAL_MAX_BYTES)continue;total+=bytes;output[index]=thumbnail;}};
  await Promise.all(Array.from({length:Math.min(PINTEREST_THUMBNAIL_MAX_CONCURRENCY,items.length)},worker));
  return Object.freeze(output);
}
