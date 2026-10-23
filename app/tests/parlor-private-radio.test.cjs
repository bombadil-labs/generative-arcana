const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync,mkdtempSync,mkdirSync,writeFileSync,readdirSync,rmSync}=require('node:fs');
const {join,resolve}=require('node:path');
const {tmpdir}=require('node:os');
const {createHash}=require('node:crypto');
const {execFileSync}=require('node:child_process');

test('radio asset is the exact approved Library MP3; static Pages publication removes all private asset types',()=>{
  const bytes=readFileSync(resolve(__dirname,'../public/assets/parlor-radio-recording.mp3'));
  assert.equal(bytes.length,4321442);assert.equal(createHash('sha256').update(bytes).digest('hex'),'db3cb19e62445d751962f0bc57789bf07ca32113f7bad3cb53733dc8f17d5215');
  const root=mkdtempSync(join(tmpdir(),'arcana-radio-publication-'));
  try{
    mkdirSync(join(root,'tools'));mkdirSync(join(root,'app/dist/assets'),{recursive:true});
    const script=readFileSync(resolve(__dirname,'../../tools/strip-private-parlor.mjs'));
    writeFileSync(join(root,'tools/strip-private-parlor.mjs'),script);
    for(const name of ['parlor-radio-recording.mp3','parlor-chunk.js','parlor-style.css','parlor-future.bin','app.js'])writeFileSync(join(root,'app/dist/assets',name),'fixture');
    execFileSync(process.execPath,[join(root,'tools/strip-private-parlor.mjs')]);
    assert.deepEqual(readdirSync(join(root,'app/dist/assets')),['app.js']);
  }finally{rmSync(root,{recursive:true,force:true});}
});
