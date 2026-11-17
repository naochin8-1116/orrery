const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
test('PowerShell files with non-ASCII text have a UTF-8 BOM for Windows PowerShell 5.1',()=>{
 for(const directory of ['src','tools'])for(const name of fs.readdirSync(path.join(__dirname,'..',directory))){if(!name.endsWith('.ps1'))continue;const data=fs.readFileSync(path.join(__dirname,'..',directory,name));if(/[^\x00-\x7F]/.test(data.toString('utf8').replace(/^\uFEFF/,'')))assert.equal(data.subarray(0,3).toString('hex'),'efbbbf',name);}
});
