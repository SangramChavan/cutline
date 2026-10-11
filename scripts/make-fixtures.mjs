import zlib from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import JSZip from 'jszip'

const signature = Buffer.from([137,80,78,71,13,10,26,10])
const table = (()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})()
const crc32 = buf => { let c=0xffffffff; for(const b of buf) c=table[(c^b)&0xff]^(c>>>8); return (c^0xffffffff)>>>0 }
const chunk = (type,data) => { const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const body=Buffer.concat([Buffer.from(type),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(body));return Buffer.concat([len,body,crc]) }

function png(width,height,shade){
  const raw=Buffer.alloc((width*4+1)*height)
  for(let y=0;y<height;y++){
    const row=y*(width*4+1);raw[row]=0
    for(let x=0;x<width;x++){
      const i=row+1+x*4
      const isQr=((x>>4)+(y>>4))%2===0
      raw[i]=shade[0];raw[i+1]=shade[1];raw[i+2]=shade[2];raw[i+3]=shade[3]
      if(shade[3]===0&&(x<width/4||x>width*3/4||y<height/4||y>height*3/4)){raw[i]=30;raw[i+1]=35;raw[i+2]=40;raw[i+3]=255}
      if(shade[3]!==0&&isQr){raw[i]=Math.min(255,shade[0]+70);raw[i+1]=Math.min(255,shade[1]+70);raw[i+2]=Math.min(255,shade[2]+70)}
    }
  }
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6
  return Buffer.concat([signature,chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))])
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" fill="#2f6f4e"/><polygon points="32,4 60,56 4,56" fill="#f7f2e8"/></svg>`

const zip=new JSZip()
zip.file('batch/square-40.png',png(200,200,[210,120,90,255]))
zip.file('batch/qr-tag-A.png',png(160,160,[20,24,28,255]))
zip.file('batch/qr-tag-B.png',png(160,160,[40,80,140,255]))
zip.file('batch/plaque.png',png(240,160,[230,220,200,255]))
zip.file('batch/traced-outline.png',png(256,256,[0,0,0,0]))
zip.file('batch/logo-triangle.svg',svg)
zip.file('batch/settings.csv','path,width,height,quantity,shape,radius\nbatch/square-40.png,50,50,6,rectangle,0\nbatch/qr-tag-A.png,30,30,8,circle,0\nbatch/qr-tag-B.png,30,30,8,circle,0\nbatch/plaque.png,60,40,3,rounded,6\nbatch/traced-outline.png,45,45,4,polygon,0\nbatch/logo-triangle.svg,40,40,4,svg,0\n')
const out=await zip.generateAsync({type:'nodebuffer'})
mkdirSync(new URL('../fixtures',import.meta.url),{recursive:true})
writeFileSync(new URL('../fixtures/acrylic-batch.zip',import.meta.url),out)
console.log('wrote fixtures/acrylic-batch.zip', out.length, 'bytes')
