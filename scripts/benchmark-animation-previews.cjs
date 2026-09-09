
const fs = require('node:fs');
const sharp = require('sharp');
const dir=process.argv[2] || '/tmp/wenyousite-preview-benchmark'; fs.mkdirSync(dir,{recursive:true});
sharp.cache(false); sharp.concurrency(1);
async function make(name,w,h,n,delay,loop) {
 const frames=[];
 for(let frame=0;frame<n;frame++){
  if(name==='text-ui') {
   const svg='<svg xmlns="http://www.w3.org/2000/svg" width="'+w+'" height="'+h+'"><rect width="100%" height="100%" fill="white"/><path d="M20 60 H900 M20 180 H900 M20 300 H900" stroke="#ccc"/><text x="30" y="100" font-size="38" font-family="sans-serif">Forum cover '+frame+' / '+n+'</text><text x="30" y="220" font-size="18" font-family="sans-serif">Small text, lines and counters 0123456789</text><rect x="'+(30+frame*42)+'" y="340" width="100" height="70" fill="#336699"/></svg>';
   frames.push(await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer());
  } else {
   const data=Buffer.alloc(w*h*4);
   for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const at=(y*w+x)*4;
    if(name==='transparent-motion'){
     const inside=(x-(100+frame*35))**2+(y-180)**2<90**2;
     data[at]=240;data[at+1]=60;data[at+2]=30;data[at+3]=inside?255:0;
    } else {
     const xx=(x+frame*13)%w, yy=(y+frame*5)%h;
     const noise=((xx*73856093)^(yy*19349663))&31;
     data[at]=(xx/w*190+noise)|0;
     data[at+1]=(yy/h*190+noise)|0;
     data[at+2]=((xx+yy)/(w+h)*180+noise)|0;data[at+3]=255;
    }
   }
   frames.push(data);
  }
 }
 const source=await sharp(Buffer.concat(frames),{raw:{width:w,height:h*n,channels:4,pageHeight:h}}).gif({loop,delay,effort:4,dither:0}).toBuffer();
 fs.writeFileSync(dir+'/'+name+'.gif',source);
 return source;
}
async function score(source,preview,edge){
 const a=await sharp(source,{animated:true,limitInputPixels:100000000}).resize(edge,edge,{fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const b=await sharp(preview,{animated:true,limitInputPixels:100000000}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 if(a.data.length!==b.data.length) return null;
 let square=0,count=0,alphaError=0;
 for(let i=0;i<a.data.length;i+=4){
  alphaError+=Math.abs(a.data[i+3]-b.data[i+3]);
  for(let c=0;c<3;c++){const aa=a.data[i+3]/255,ba=b.data[i+3]/255;const d=a.data[i+c]*aa-b.data[i+c]*ba;square+=d*d;count++;}
 }
 return {psnr: square? +(10*Math.log10(255*255/(square/count))).toFixed(2):99,alphaMae:+(alphaError/(a.data.length/4)).toFixed(4)};
}
(async()=>{
 const reports=[];
 for(const [name,w,h,n] of [['text-ui',960,540,12],['textured-motion',960,540,12],['transparent-motion',800,500,12],['small-animation',160,100,6]]){
  const delays=Array.from({length:n},(_,i)=>[60,90,120,150][i%4]);
  const source=await make(name,w,h,n,delays,3);
  const before=await sharp(source).metadata();
  for(const edge of [480,800]){
   const started=performance.now();
   const preview=await sharp(source,{animated:true,limitInputPixels:100000000}).resize(edge,edge,{fit:'inside',withoutEnlargement:true}).webp({quality:75,alphaQuality:100,effort:4}).toBuffer();
   const ms=Math.round(performance.now()-started), after=await sharp(preview).metadata();
   fs.writeFileSync(dir+'/'+name+'-'+edge+'.webp',preview);
   reports.push({name,edge,sourceBytes:source.length,previewBytes:preview.length,ratio:+(preview.length/source.length).toFixed(3),ms,width:after.width,height:after.height,pages:after.pages,loop:after.loop,beforeLoop:before.loop,delaysEqual:JSON.stringify(after.delay)===JSON.stringify(before.delay),...await score(source,preview,edge)});
  }
  global.gc?.();
 }
 fs.writeFileSync(dir+'/report.json',JSON.stringify({versions:sharp.versions,quality:75,reports},null,2));
 console.log(JSON.stringify(reports));
const report=[];
for(const name of ['text-ui','textured-motion','transparent-motion']){
 const source=fs.readFileSync(dir+'/'+name+'.gif'), before=await sharp(source).metadata();
 for(const quality of [70,75,80]) for(const edge of [480,800]){
  const t=performance.now();
  const bytes=await sharp(source,{animated:true}).resize(edge,edge,{fit:'inside',withoutEnlargement:true}).webp({quality,alphaQuality:100,effort:4,loop:before.loop,delay:before.delay}).toBuffer();
  const meta=await sharp(bytes).metadata();
  report.push({name,quality,edge,ms:Math.round(performance.now()-t),sourceBytes:source.length,bytes:bytes.length,width:meta.width,height:meta.height,pages:meta.pages,delay:meta.delay,loop:meta.loop,eligible:bytes.length<source.length});
 }
 const cells=[];
 for(const [row,frame] of [0,4,8].entries()){
  for(const [col,file] of [name+'.gif',name+'-480.webp',name+'-800.webp'].entries()){
   const png=await sharp(dir+'/'+file,{page:frame,pages:1}).resize(300,190,{fit:'contain',background:{r:238,g:238,b:238,alpha:1}}).png().toBuffer();
   fs.writeFileSync(dir+'/'+name+'-frame'+frame+'-'+col+'.png',png);
   cells.push({input:png,left:col*300,top:row*190});
  }
 }
 await sharp({create:{width:900,height:570,channels:4,background:'#eeeeee'}}).composite(cells).png().toFile(dir+'/'+name+'-comparison.png');
}
fs.writeFileSync(dir+'/quality-comparison.json',JSON.stringify(report,null,2));


})().catch(e=>{console.error(e.message);process.exitCode=1});
