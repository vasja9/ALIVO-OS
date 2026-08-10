import { inflateRawSync } from "node:zlib";

const signature=(buffer:Buffer,offset:number,value:number)=>buffer.readUInt32LE(offset)===value;
const table=Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
export const crc32=(data:Buffer):number=>{let c=0xffffffff;for(const byte of data)c=table[(c^byte)&0xff]^(c>>>8);return(c^0xffffffff)>>>0;};

/** Minimal deterministic ZIP writer. Entries are stored (not compressed) so recovery has no third-party dependency. */
export function writeZip(entries:ReadonlyMap<string,Buffer>):Buffer{
  const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
  for(const [name,data] of entries){
    const filename=Buffer.from(name),crc=crc32(data),header=Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0,6);header.writeUInt16LE(0,8);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
    local.push(header,filename,data);
    const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50,0);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(filename.length,28);directory.writeUInt32LE(offset,42);central.push(directory,filename);offset+=header.length+filename.length+data.length;
  }
  const body=Buffer.concat(local),index=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.size,8);end.writeUInt16LE(entries.size,10);end.writeUInt32LE(index.length,12);end.writeUInt32LE(body.length,16);return Buffer.concat([body,index,end]);
}

/** Reads ordinary stored or deflated ZIP entries and rejects traversal, encryption, duplicates and invalid CRCs. */
export function readZip(archive:Buffer):Map<string,Buffer>{
  const end=archive.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));if(end<0||end+22>archive.length)throw new Error("ZIP end record is missing");
  const count=archive.readUInt16LE(end+10),centralOffset=archive.readUInt32LE(end+16),entries=new Map<string,Buffer>();let cursor=centralOffset;
  for(let i=0;i<count;i++){
    if(!signature(archive,cursor,0x02014b50))throw new Error("ZIP central directory is unreadable");const flags=archive.readUInt16LE(cursor+8),method=archive.readUInt16LE(cursor+10),expectedCrc=archive.readUInt32LE(cursor+16),compressed=archive.readUInt32LE(cursor+20),size=archive.readUInt32LE(cursor+24),nameLength=archive.readUInt16LE(cursor+28),extra=archive.readUInt16LE(cursor+30),comment=archive.readUInt16LE(cursor+32),localOffset=archive.readUInt32LE(cursor+42),name=archive.subarray(cursor+46,cursor+46+nameLength).toString();
    if(flags&1)throw new Error("Encrypted ZIP entries are unsupported");if(method!==0&&method!==8)throw new Error("Unsupported ZIP compression");if(name.startsWith("/")||name.includes("..")||name.includes("\\")||entries.has(name))throw new Error("Unsafe ZIP entry name");if(!signature(archive,localOffset,0x04034b50))throw new Error("ZIP local entry is unreadable");const localName=archive.readUInt16LE(localOffset+26),localExtra=archive.readUInt16LE(localOffset+28),start=localOffset+30+localName+localExtra,packed=archive.subarray(start,start+compressed),data=method===0?Buffer.from(packed):inflateRawSync(packed);if(data.length!==size||crc32(data)!==expectedCrc)throw new Error(`ZIP checksum failure: ${name}`);entries.set(name,data);cursor+=46+nameLength+extra+comment;
  }return entries;
}
