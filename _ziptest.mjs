import { writeFileSync } from 'fs';
function crc32(buf){let c=~0;for(let i=0;i<buf.length;i++){c^=buf[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1));}return ~c>>>0;}
function buildZip(files){
  const enc=new TextEncoder();const chunks=[];const central=[];let offset=0;
  for(const f of files){
    const nameBytes=enc.encode(f.name);const crc=crc32(f.data);const size=f.data.length;
    const lh=new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true);lh.setUint16(4,20,true);lh.setUint16(6,0x0800,true);
    lh.setUint16(8,0,true);lh.setUint16(10,0,true);lh.setUint16(12,0,true);
    lh.setUint32(14,crc,true);lh.setUint32(18,size,true);lh.setUint32(22,size,true);
    lh.setUint16(26,nameBytes.length,true);lh.setUint16(28,0,true);
    const local=new Uint8Array(lh.buffer);chunks.push(local,nameBytes,f.data);
    const cd=new DataView(new ArrayBuffer(46));
    cd.setUint32(0,0x02014b50,true);cd.setUint16(4,20,true);cd.setUint16(6,20,true);cd.setUint16(8,0x0800,true);
    cd.setUint16(10,0,true);cd.setUint16(12,0,true);cd.setUint16(14,0,true);
    cd.setUint32(16,crc,true);cd.setUint32(20,size,true);cd.setUint32(24,size,true);
    cd.setUint16(28,nameBytes.length,true);cd.setUint16(30,0,true);cd.setUint16(32,0,true);
    cd.setUint16(34,0,true);cd.setUint16(36,0,true);cd.setUint32(38,0,true);cd.setUint32(42,offset,true);
    central.push(new Uint8Array(cd.buffer),nameBytes);
    offset+=local.length+nameBytes.length+f.data.length;
  }
  const centralStart=offset;let centralSize=0;central.forEach(c=>centralSize+=c.length);
  const eocd=new DataView(new ArrayBuffer(22));
  eocd.setUint32(0,0x06054b50,true);eocd.setUint16(4,0,true);eocd.setUint16(6,0,true);
  eocd.setUint16(8,files.length,true);eocd.setUint16(10,files.length,true);
  eocd.setUint32(12,centralSize,true);eocd.setUint32(16,centralStart,true);eocd.setUint16(20,0,true);
  const parts=[...chunks,...central,new Uint8Array(eocd.buffer)];
  let total=0;parts.forEach(p=>total+=p.length);const all=new Uint8Array(total);let o=0;
  parts.forEach(p=>{all.set(p,o);o+=p.length;});return all;
}
const enc=new TextEncoder();
const zip=buildZip([
  {name:'Газпром/договор.txt',data:enc.encode('Привет, мир! Hello world.')},
  {name:'Без контрагента/заметка.txt',data:enc.encode('test data 123')},
]);
writeFileSync('./_test.zip',zip);
console.log('zip bytes', zip.length);
