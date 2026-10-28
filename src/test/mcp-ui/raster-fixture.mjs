/** Test-only native raster generator. No licensed maps, interpolation or network. */
import {deflateSync} from 'node:zlib';
const cache=new Map();
function crc32(bytes){
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function chunk(type,data){
  const name=Buffer.from(type),length=Buffer.alloc(4),checksum=Buffer.alloc(4);
  length.writeUInt32BE(data.length);checksum.writeUInt32BE(crc32(Buffer.concat([name,data])));
  return Buffer.concat([length,name,data,checksum]);
}
export function nativeRaster(scale=2){
  if(cache.has(scale))return cache.get(scale);
  const width=1024*scale,height=768*scale,stride=width*3+1,raw=Buffer.alloc(stride*height),header=Buffer.alloc(13);
  header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const index=y*stride+1+x*3,grid=x%(64*scale)<scale||y%(64*scale)<scale;
    raw[index]=grid?203:241;raw[index+1]=grid?213:245;raw[index+2]=grid?225:249;
  }
  const value=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]).toString('base64');
  cache.set(scale,value);return value;
}
