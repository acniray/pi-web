import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createJiti } from 'jiti';
const jiti=createJiti(import.meta.url,{tsconfigPaths:true});
const {allowFileRoot}=await jiti.import('./file-access.ts');
const {PATCH,PUT}=await jiti.import('../app/api/subagents/profiles/route.ts');
const {parseFrontmatter}=await jiti.import('./frontmatter.ts');

test('real profile PATCH and PUT carry authored scope and foreign aliases through transport',async()=>{
  const cwd=await mkdtemp(join(tmpdir(),'scope-route-'));
  try {
    allowFileRoot(cwd);
    await mkdir(join(cwd,'.pi/agents'),{recursive:true});
    const file=join(cwd,'.pi/agents/scoped.md');
    await writeFile(file,'---\nextensions: Foo, @Team/Adapter, foo\nload_extensions: false\nskills: [foreign]\nexclude_extensions: [other]\n---\nPrompt');
    const req=body=>new Request('http://localhost/api/subagents/profiles',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    for(const enabled of [false,true]) {
      const response=await PATCH(req({cwd,scope:'project',name:'scoped',enabled}));
      assert.equal(response.status,200);
      const {profile}=await response.json();
      assert.deepEqual(profile.extensionScope,['foo','@team/adapter']);
      assert.equal(profile.loadExtensions,false);
      const stored=parseFrontmatter(await readFile(file,'utf8')).data;
      assert.equal(stored.extensions,'Foo, @Team/Adapter, foo');
      assert.deepEqual(stored.skills,['foreign']);
      assert.deepEqual(stored.exclude_extensions,['other']);
      const saved=await PUT(req({cwd,scope:'project',profile:{...profile,loadExtensions:true}}));
      assert.equal(saved.status,200);
      assert.deepEqual((await saved.json()).profile.extensionScope,['foo','@team/adapter']);
      // Reset activation without erasing selection, like the existing form toggle.
      profile.loadExtensions=false;
      assert.equal((await PUT(req({cwd,scope:'project',profile}))).status,200);
    }
    const malformed=await PUT(req({cwd,scope:'project',profile:{name:'scoped',displayName:'scoped',description:'scoped',systemPrompt:'Prompt',tools:[],extensionScope:[42]}}));
    assert.equal(malformed.status,400);
    assert.match((await malformed.json()).error,/extensionScope/);
  } finally {await rm(cwd,{recursive:true,force:true})}
});
