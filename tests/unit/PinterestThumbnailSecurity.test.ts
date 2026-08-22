import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { readFileSync } from "node:fs";
import {
  PINTEREST_THUMBNAIL_MAX_BYTES,
  canonicalPinterestThumbnailUrl,
  fetchPinterestThumbnail,
  fetchPinterestThumbnails,
  safeThumbnailDto,
  selectPinterestThumbnail,
} from "../../src/integrations/pinterest/PinterestThumbnailSecurity.ts";
import { mergePinThumbnails } from "../../src/integrations/pinterest/PinterestElectronComposition.ts";
import { COMPLETE_JPEG, COMPLETE_JPEG_BASE64, COMPLETE_PNG, COMPLETE_WEBP } from "../fixtures/PinterestThumbnailFixtures.ts";

const jpeg=COMPLETE_JPEG;
const png=COMPLETE_PNG;
const webp=COMPLETE_WEBP;
const source={url:"https://i.pinimg.com/400x300/safe.jpg",width:400,height:300};

test("production HTTPS binding uses the CommonJS-safe named Node request export",()=>{
  const implementation=readFileSync(new URL("../../src/integrations/pinterest/PinterestThumbnailSecurity.ts",import.meta.url),"utf8");
  assert.match(implementation,/import \{ request as nodeHttpsRequest \} from "node:https"/);
  assert.match(implementation,/requestFactory:RequestFactory=nodeHttpsRequest/);
  assert.doesNotMatch(implementation,/import https from "node:https"|https\.request/);
});

function requestFactory(status:number,contentType:string,parts:readonly Buffer[],capture?:(options:Record<string,unknown>)=>void,timeout=false){
  return ((url:URL,options:Record<string,unknown>,callback:(response:PassThrough&{statusCode?:number;headers:Record<string,string>})=>void)=>{
    capture?.(options);
    const request=new EventEmitter() as EventEmitter&{end():void;destroy():void};let destroyed=false;
    request.destroy=()=>{destroyed=true;};
    request.end=()=>queueMicrotask(()=>{
      if(timeout){request.emit("timeout");return;}
      const response=new PassThrough() as PassThrough&{statusCode?:number;headers:Record<string,string>};response.statusCode=status;response.headers={"content-type":contentType};callback(response);
      if(!destroyed){for(const part of parts)response.write(part);response.end();}
    });
    return request;
  }) as never;
}

test("thumbnail selection prefers validated 400x300 and falls back to 150x150",()=>{
  const fallback={url:"https://i.pinimg.com/150x150/fallback.png",width:150,height:150};
  assert.deepEqual(selectPinterestThumbnail({media_type:"image",images:{"400x300":source,"150x150":fallback}}),source);
  assert.deepEqual(selectPinterestThumbnail({media_type:"image",images:{"400x300":{...source,width:0},"150x150":fallback}}),fallback);
  assert.equal(selectPinterestThumbnail({media_type:"video",images:{"400x300":source}}),undefined);
  assert.equal(selectPinterestThumbnail({media_type:"image",images:{"400x300":{...source,height:10001}}}),undefined);
});

test("thumbnail URL allowlist is exact, canonical, credential-free, and traversal-safe",()=>{
  assert.equal(canonicalPinterestThumbnailUrl(source.url)?.href,source.url);
  for(const value of ["http://i.pinimg.com/a.jpg","file:///a.jpg","data:image/png;base64,AA==","blob:https://i.pinimg.com/id","https://localhost/a.jpg","https://127.0.0.1/a.jpg","https://pinimg.com/a.jpg","https://sub.i.pinimg.com/a.jpg","https://i.pinimg.com.evil.example/a.jpg","https://evil-i.pinimg.com/a.jpg","https://user:pass@i.pinimg.com/a.jpg","https://i.pinimg.com:443/a.jpg","https://i.pinimg.com/a.jpg#fragment","https://i.pinimg.com/%2e%2e/secret","https://i.pinimg.com/%252e%252e/secret","https://i.pinimg.com/a%2Fb.jpg","https://i.pinimg.com/%zz.jpg","https://I.PINIMG.COM/a.jpg","https://i.pinimg.com/"])assert.equal(canonicalPinterestThumbnailUrl(value),undefined,value);
});

test("main-process request is GET-only with a fixed Accept header and no ambient authorization data",async()=>{
  let options:Record<string,unknown>|undefined;
  const result=await fetchPinterestThumbnail(source,requestFactory(200,"image/jpeg",[jpeg],value=>{options=value;}));
  assert.deepEqual(result,{mimeType:"image/jpeg",base64:jpeg.toString("base64")});
  assert.equal(options?.method,"GET");
  assert.deepEqual(options?.headers,{Accept:"image/jpeg, image/png, image/webp"});
  assert.equal(/authorization|cookie|referer|oauth|provider/i.test(JSON.stringify(options)),false);
});

test("response validation accepts matching JPEG, PNG, and WebP signatures only",async()=>{
  for(const [mime,body] of [["image/jpeg",jpeg],["image/png",png],["image/webp",webp]] as const)assert.equal((await fetchPinterestThumbnail(source,requestFactory(200,mime,[body])))?.mimeType,mime);
  for(const [mime,body] of [["image/svg+xml",Buffer.from("<svg/>")],["image/gif",Buffer.from("GIF89a")],["text/html",Buffer.from("<html>")],["application/json",Buffer.from("{}")],["image/png",jpeg],["image/jpeg",Buffer.alloc(0)],["image/jpeg",jpeg.subarray(0,-2)],["image/png",png.subarray(0,-12)],["image/webp",webp.subarray(0,-1)]] as const)assert.equal(await fetchPinterestThumbnail(source,requestFactory(200,mime,[body])),null);
  assert.equal(await fetchPinterestThumbnail(source,requestFactory(302,"image/jpeg",[jpeg])),null);
});

test("timeout and streaming byte limits abort safely",async()=>{
  assert.equal(await fetchPinterestThumbnail(source,requestFactory(200,"image/jpeg",[],undefined,true)),null);
  const oversized=Buffer.alloc(PINTEREST_THUMBNAIL_MAX_BYTES+1);oversized.set(jpeg);
  assert.equal(await fetchPinterestThumbnail(source,requestFactory(200,"image/jpeg",[oversized.subarray(0,100),oversized.subarray(100)])),null);
});

test("request and worker failures become no-thumbnail results",async()=>{
  assert.equal(await fetchPinterestThumbnail(source,(()=>{throw new Error("safe mock failure");}) as never).catch(()=>null),null);
  const results=await fetchPinterestThumbnails([1],()=>source,async()=>{throw new Error("safe mock failure");});assert.deepEqual(results,[null]);
});

test("thumbnail pool limits concurrency to four and total snapshot data to 6 MiB",async()=>{
  let active=0,maximum=0;
  const items=Array.from({length:12},(_,index)=>index);
  const results=await fetchPinterestThumbnails(items,()=>source,async()=>{active++;maximum=Math.max(maximum,active);await new Promise(resolve=>setTimeout(resolve,2));active--;return {mimeType:"image/jpeg",base64:jpeg.toString("base64")};});
  assert.equal(maximum,4);assert.equal(results.filter(Boolean).length,12);
  const full=Buffer.alloc(PINTEREST_THUMBNAIL_MAX_BYTES);full.set(jpeg.subarray(0,3));full.set([0xff,0xd9],full.length-2);const thumbnail={mimeType:"image/jpeg" as const,base64:full.toString("base64")};
  const pins=Array.from({length:25},(_,index)=>({pinId:`pin-${index}`,boardName:"Board",thumbnail:null}));
  const merged=await mergePinThumbnails(pins,new Map(pins.map(pin=>[pin.pinId,{media_type:"image",images:{"400x300":source}}])),[],async()=>thumbnail);
  assert.equal(merged.filter(pin=>pin.thumbnail).length,24);
});

test("safe DTO boundary rejects malformed, oversized, and mismatched thumbnail data",()=>{
  assert.deepEqual(safeThumbnailDto({mimeType:"image/jpeg",base64:jpeg.toString("base64"),url:source.url,headers:{cookie:"secret"}}),{mimeType:"image/jpeg",base64:jpeg.toString("base64")});
  assert.equal(safeThumbnailDto({mimeType:"image/png",base64:jpeg.toString("base64")}),null);
  assert.equal(safeThumbnailDto({mimeType:"image/jpeg",base64:"%%%"}),null);
  assert.equal(safeThumbnailDto({mimeType:"image/jpeg",base64:COMPLETE_JPEG_BASE64.slice(0,-4)}),null);
  assert.equal(safeThumbnailDto({mimeType:"image/png",base64:png.subarray(0,-12).toString("base64")}),null);
  assert.equal(safeThumbnailDto({mimeType:"image/webp",base64:webp.subarray(0,-1).toString("base64")}),null);
  const oversized=Buffer.alloc(PINTEREST_THUMBNAIL_MAX_BYTES+1);oversized.set(jpeg.subarray(0,3));oversized.set([0xff,0xd9],oversized.length-2);assert.equal(safeThumbnailDto({mimeType:"image/jpeg",base64:oversized.toString("base64")}),null);
});

test("realistic complete JPEG base64 remains byte-identical and longer than the native truncation boundary",()=>{
  assert.equal(COMPLETE_JPEG.length,731);assert.equal(COMPLETE_JPEG_BASE64.length,976);assert.ok(COMPLETE_JPEG_BASE64.length>240);
  assert.deepEqual(safeThumbnailDto({mimeType:"image/jpeg",base64:COMPLETE_JPEG_BASE64}),{mimeType:"image/jpeg",base64:COMPLETE_JPEG_BASE64});
});

test("existing safe thumbnails survive a temporary fetch failure and provider URLs never enter the DTO",async()=>{
  const thumbnail={mimeType:"image/jpeg" as const,base64:jpeg.toString("base64")};
  const pin={pinId:"pin-1",title:"Safe",boardName:"Board",thumbnail:null};
  const media=new Map([[pin.pinId,{media_type:"image",images:{"400x300":source},access_token:"secret"}]]);
  const first=await mergePinThumbnails([pin],media,[],async()=>thumbnail);
  let calls=0;const repeated=await mergePinThumbnails([pin],media,first,async()=>{calls++;return null;});
  assert.equal(calls,0);assert.deepEqual(repeated,first);
  assert.equal(/pinimg|access_token|https:|headers|url/i.test(JSON.stringify(first)),false);
  assert.deepEqual(Object.keys(first[0].thumbnail??{}),["mimeType","base64"]);
});
