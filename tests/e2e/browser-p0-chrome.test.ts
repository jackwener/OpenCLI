/** Real CLI -> daemon -> extension -> Chrome, using only temporary profiles/ports. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let temp = '';
let port: number;
let chrome: ChildProcess | undefined;
let daemon: ChildProcess | undefined;
let site: ReturnType<typeof createServer>;
let siteUrl: string;
let stderr = '';
const env = () => ({...process.env, HOME:path.join(temp,'home'), OPENCLI_DAEMON_PORT:'', OPENCLI_PROFILE:'', OPENCLI_NO_UPDATE_CHECK:'1'});
async function cli(args: string[]) {
  try {
    const result = await exec(process.execPath,[path.join(temp,'app/dist/src/main.js'),...args],{env:env(),timeout:30_000,maxBuffer:4*1024*1024});
    const envelope = JSON.parse(result.stdout);
    expect(envelope.ok).toBe(true);
    return envelope.data;
  } catch (error: any) { throw new Error(`${args.join(' ')}: ${error.stdout} ${error.stderr}`); }
}
async function failure(args: string[]) {
  let caught: any;
  try { await exec(process.execPath, [path.join(temp, 'app/dist/src/main.js'), ...args], { env: env(), timeout: 30_000 }); }
  catch (error) { caught = error; }
  expect(caught, `Expected failure for ${args.join(' ')}`).toBeTruthy();
  const result = JSON.parse(caught.stdout);
  expect(result.ok).toBe(false);
  expect(result.error.exitCode).toBe(caught.code);
  return result.error;
}
const native = (method: string,args: unknown[]) => cli(['browser','chrome','call',method,JSON.stringify(args)]);
async function until(check: () => Promise<boolean>, label: string) {
  const start = Date.now();
  while (Date.now()-start < 25_000) {
    if (await check().catch(() => false)) return;
    await new Promise(resolve => setTimeout(resolve,200));
  }
  throw new Error(`Timed out: ${label}\n${stderr.slice(-2500)}`);
}
async function stop(child?: ChildProcess) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([new Promise(resolve => child.once('exit',resolve)),new Promise(resolve => setTimeout(resolve,3000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

beforeAll(async () => {
  const executable = process.env.CHROME_PATH;
  if (!executable || !fs.existsSync(executable)) throw new Error('Set CHROME_PATH to Chrome for Testing or Chromium for this opt-in smoke.');
  temp = fs.mkdtempSync(path.join(os.tmpdir(),'opencli-p0-chrome-'));
  const app = path.join(temp,'app');
  fs.mkdirSync(path.join(temp,'home'),{recursive:true});
  fs.mkdirSync(app);
  fs.cpSync(path.join(root,'dist'),path.join(app,'dist'),{recursive:true});
  for (const file of ['package.json','cli-manifest.json']) fs.copyFileSync(path.join(root,file),path.join(app,file));
  for (const dir of ['node_modules','clis']) fs.symlinkSync(path.join(root,dir),path.join(app,dir),'dir');
  const extension = path.join(temp,'extension');
  fs.mkdirSync(path.join(extension,'dist'),{recursive:true});
  for (const file of ['manifest.json','popup.html','popup.js']) if (fs.existsSync(path.join(root,'extension',file))) fs.copyFileSync(path.join(root,'extension',file),path.join(extension,file));
  fs.cpSync(path.join(root,'extension/icons'),path.join(extension,'icons'),{recursive:true});
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0,'127.0.0.1',resolve));
  port = (reservation.address() as any).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  // Product keeps its fixed port; patch only the disposable test installation.
  const constants = path.join(app,'dist/src/constants.js');
  fs.writeFileSync(constants,fs.readFileSync(constants,'utf8').replace(/19825/g,String(port)));
  fs.writeFileSync(path.join(extension,'dist/background.js'),fs.readFileSync(path.join(root,'extension/dist/background.js'),'utf8').replace(/19825/g,String(port)));
  daemon = spawn(process.execPath,[path.join(app,'dist/src/daemon.js')],{env:env(),stdio:['ignore','ignore','pipe']});
  daemon.stderr?.on('data',chunk => {stderr += chunk;});
  await until(async () => (await fetch(`http://127.0.0.1:${port}/ping`)).ok,'daemon');
  chrome = spawn(executable,[`--user-data-dir=${path.join(temp,'profile')}`,`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,
    '--headless=new','--no-sandbox','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-sync','about:blank'],{stdio:['ignore','ignore','pipe']});
  chrome.stderr?.on('data',chunk => {stderr = (stderr+chunk).slice(-10_000);});
  await until(async () => (await (await fetch(`http://127.0.0.1:${port}/status`,{headers:{'X-OpenCLI':'1'}})).json() as any).extensionConnected,'extension');
  site = createServer((req,res) => {
    if (req.url === '/app.js') {
      res.setHeader('content-type','application/javascript');
      res.end("fetch('/api/items').then(r=>r.json()); function latent(id) { return fetch(`/api/items/${id}`); }");
    } else if (req.url === '/api/items') {
      res.setHeader('content-type','application/json'); res.end('[{"id":42,"title":"fixture"}]');
    } else { res.setHeader('content-type','text/html'); res.end('<!doctype html><title>P0 fixture</title><script src="/app.js"></script><h1>Fixture</h1><button id=save onclick="this.textContent=\'Saved\'">Save</button>'); }
  });
  await new Promise<void>(resolve => site.listen(0,'127.0.0.1',resolve));
  siteUrl = `http://127.0.0.1:${(site.address() as any).port}/`;
},60_000);

afterAll(async () => {
  await stop(chrome); await stop(daemon);
  if (site) await new Promise<void>(resolve => site.close(() => resolve()));
  if (temp) fs.rmSync(temp,{recursive:true,force:true,maxRetries:3,retryDelay:200});
});

describe('P0 real Chrome', () => {
  it('creates, renames, recolors, moves and dissolves a group through the CLI', async () => {
    const info = await cli(['browser','chrome','describe','tabGroups.update']);
    expect(info.available).toBe(true);
    expect(info.grantedPermissions.permissions).toContain('tabGroups');
    const win = await native('windows.create',[{url:'about:blank',focused:false}]);
    try {
      const first = win.tabs[0];
      const second = await native('tabs.create',[{windowId:win.id,url:'about:blank',active:false}]);
      const groupId = await native('tabs.group',[{tabIds:[first.id,second.id],createProperties:{windowId:win.id}}]);
      expect(typeof groupId).toBe('number');
      await native('tabGroups.update',[groupId,{title:'P0 research',color:'blue',collapsed:true}]);
      expect(await native('tabGroups.get',[groupId])).toMatchObject({title:'P0 research',color:'blue',collapsed:true});
      await native('tabGroups.move',[groupId,{index:0}]);
      expect(await native('tabs.query',[{groupId}])).toHaveLength(2);
      await native('tabs.ungroup',[[first.id,second.id]]);
      expect(await native('tabGroups.query',[{windowId:win.id}])).toEqual([]);
    } finally { await native('windows.remove',[win.id]); }
  },60_000);

  it('merges live requests with script AST evidence and reuses the network cache', async () => {
    await cli(['browser','open',siteUrl,'--session','p0discover']);
    await until(async () => {
      const state = await cli(['browser','eval','document.readyState','--session','p0discover']);
      return JSON.stringify(state).includes('complete');
    },'page');
    const report = await cli(['browser','network','--static','--session','p0discover']);
    expect(report.analysisComplete).toBe(true);
    expect(report.endpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({method:'GET',url:`${siteUrl}api/items`,evidence:'network+static'}),
      expect.objectContaining({url:'/api/items/EXPR',evidence:'static',unresolved:true}),
    ]));
    const managed = await native('tabs.query',[{url:siteUrl}]);
    await expect(native('tabs.remove',[managed[0].id])).rejects.toThrow('managed_resource_conflict');
    const cached = await cli(['browser','network','--static','--session','p0discover']);
    expect(cached.networkSource).toBe('cache');
    expect(cached.endpoints.some((e: any) => e.url === `${siteUrl}api/items`)).toBe(true);
  },60_000);
  it('recovers from a stale ref using page facts and semantic locators', async () => {
    await cli(['browser', 'open', siteUrl, '--session', 'ax']);
    const state = await cli(['browser', 'state', '--diagnostics', '--session', 'ax']);
    expect(state.diagnostics.title).toBe('P0 fixture');
    expect((await failure(['browser', 'click', '99999', '--session', 'ax'])).code).toMatch(/not_found|stale_ref/);
    const found = await cli(['browser', 'find', '--role', 'button', '--name', 'Save', '--session', 'ax']);
    expect(JSON.stringify(found)).toContain('Save');
    await cli(['browser', 'click', '--role', 'button', '--name', 'Save', '--session', 'ax']);
    expect(await cli(['browser', 'eval', 'document.querySelector("#save").textContent', '--session', 'ax'])).toBe('Saved');
    await cli(['browser', 'close', '--session', 'ax']);
  }, 30_000);

  it('returns one actionable envelope for parser and scope errors', async () => {
    expect((await failure(['browser', 'state'])).code).toBe('usage_error');
    expect((await failure(['browser', 'state', '--unexpected'])).code).toContain('commander.');
    expect((await failure(['browser', 'chrome', 'call', 'tabs.query', '{}'])).code).toBe('invalid_args');
  });

  it('runs unchanged JS adapter contracts for Node and browser execution', async () => {
    const dir = path.join(temp,'home/.opencli/clis/p0fixture');
    fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'local.js'), `import {cli,Strategy} from '@jackwener/opencli/registry';
      cli({site:'p0fixture',name:'local',description:'Fixture',access:'read',browser:false,strategy:Strategy.PUBLIC,
        args:[{name:'id',type:'int',default:7}],func:async args => [{id:args.id}]});`);
    fs.writeFileSync(path.join(dir,'browser.js'), `import {cli,Strategy} from '@jackwener/opencli/registry';
      cli({site:'p0fixture',name:'browser',description:'Fixture',access:'read',browser:true,navigateBefore:false,
        func:async (page,args) => { await page.goto(${JSON.stringify(siteUrl)}); return page.evaluate('fetch("/api/items").then(r => r.json())'); }});`);
    fs.writeFileSync(path.join(dir, 'stream.js'), `import {cli,Strategy} from '@jackwener/opencli/registry';
      cli({site:'p0fixture',name:'stream',description:'Raw export fixture',access:'read',browser:false,strategy:Strategy.PUBLIC,
        args:[{name:'stdout',type:'boolean',default:false}],func:async args => {
          if(args.stdout){process.stdout.write('# fixture\\n');return null;} return 'fixture'; }});`);
    const streamed = await exec(process.execPath, [path.join(temp, 'app/dist/src/main.js'), 'p0fixture', 'stream', '--stdout', 'true'], { env: env() });
    expect(streamed.stdout).toBe('# fixture\n');
    const capabilities = await cli(['list', 'local', '--site', 'p0fixture']);
    expect(capabilities.commands[0].command).toBe('p0fixture local');
    const help = await exec(process.execPath, [path.join(temp, 'app/dist/src/main.js'), 'p0fixture', 'local', '--help', '-f', 'json'], { env: env() });
    expect(JSON.parse(help.stdout).command_options.some((option: any) => option.name === 'id')).toBe(true);
    expect((await cli(['adapter', 'check', 'p0fixture/local'])).ok).toBe(true);
    expect(await cli(['p0fixture','local','--id','42','-f','json'])).toEqual([{id:42}]);
    expect(await cli(['adapter', 'test', 'p0fixture/local', '--args', '{"id":42}'])).toMatchObject({ name: 'p0fixture/local', rows: 1, result: [{ id: 42 }] });
    expect(await cli(['p0fixture','browser','-f','json'])).toEqual([{id:42,title:'fixture'}]);
  },30_000);

});
