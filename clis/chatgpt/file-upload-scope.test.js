import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadChatGPTImages, uploadChatGPTFiles, sendChatGPTMessage, getVisibleMessages } from './utils.js';
const dirs = [];
const doms = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive:true,force:true }); for(const dom of doms.splice(0))dom.window.close(); });
function fixture(extra = '', form = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-file-scope-')); dirs.push(dir);
  const file = path.join(dir, 'notes.txt'); fs.writeFileSync(file, 'Synthetic attachment');
  const dom = new JSDOM(`${extra}<form data-chatgpt-composer><div id="prompt-textarea" class="ProseMirror" contenteditable="true" role="textbox"><p><br></p></div><input type="file" multiple>${form}<button data-testid="send-button">Send</button></form>`,{url:'https://chatgpt.com/c/test-conversation',runScripts:'outside-only'});
  doms.push(dom);
  const document = dom.window.document;
  for(const node of document.querySelectorAll('*')){
    node.getBoundingClientRect=()=>({left:10,top:10,width:120,height:36});
    node.scrollIntoView=()=>{};
    Object.defineProperty(node,'isContentEditable',{get:()=>node.getAttribute('contenteditable')==='true'});
  }
  const page={evaluate:vi.fn(async script=>dom.window.eval(script)),evaluateOnce:vi.fn(async script=>dom.window.eval(script)),sleep:vi.fn(),wait:vi.fn(),setFileInput:vi.fn()};
  return {page,dom,document,file,scope:document.querySelector('form[data-chatgpt-composer]')};
}
function chip(document,scope,name='notes.txt') {const n=document.createElement('div');n.setAttribute('role','group');n.setAttribute('aria-label',name);n.getBoundingClientRect=()=>({width:120,height:36});scope.append(n);return n;}
describe('ChatGPT file upload scope',()=>{
  it('transfers files larger than the bridge request limit in bounded chunks and commits exact bytes once',async()=>{
    const f=fixture();
    const bytes=Buffer.alloc(1200001);for(let i=0;i<bytes.length;i++)bytes[i]=i%251;fs.writeFileSync(f.file,bytes);
    const second=path.join(path.dirname(f.file),'empty.txt');fs.writeFileSync(second,'');
    const input=f.scope.querySelector('input');Object.defineProperty(input,'files',{writable:true,value:[]});
    f.dom.window.File=File;
    f.dom.window.DataTransfer=class {constructor(){this.files=[];this.items={add:file=>this.files.push(file)};}};
    const changed=vi.fn(()=>{chip(f.document,f.scope);chip(f.document,f.scope,'empty.txt');});
    input.__reactProps$test={onChange:changed};
    f.page.setFileInput.mockRejectedValue(new Error('fileChooserOpened not received within 5s'));
    await expect(uploadChatGPTFiles(f.page,[f.file,second])).resolves.toMatchObject({ok:true});
    expect(changed).toHaveBeenCalledTimes(1);
    expect(input.files.map(file=>file.name)).toEqual(['notes.txt','empty.txt']);
    expect(Buffer.from(await input.files[0].arrayBuffer()).equals(bytes)).toBe(true);
    expect(input.files[1].size).toBe(0);
    expect(Math.max(...f.page.evaluate.mock.calls.map(([script])=>Buffer.byteLength(JSON.stringify({code:script}))))).toBeLessThan(400000);
    expect(input.__opencliFileChunks).toBeUndefined();
  });
  it('cleans staged chunks and never commits or confirms a partial transfer',async()=>{
    const f=fixture();const input=f.scope.querySelector('input');
    f.page.setFileInput.mockRejectedValue(new Error('fileChooserOpened not received within 5s'));
    const evaluate=f.page.evaluate.getMockImplementation();
    f.page.evaluate.mockImplementation(async script=>{if(script.includes('.chunks[0] ='))throw new Error('transport interrupted');return evaluate(script);});
    await expect(uploadChatGPTFiles(f.page,[f.file])).rejects.toThrow('transport interrupted');
    expect(input.files.length).toBe(0);
    expect(input.__opencliFileChunks).toBeUndefined();
  });
  it('pins the upload input to the active composer instead of an earlier unrelated input',async()=>{
    const f=fixture('<form id="other"><input type="file"></form>');
    f.page.setFileInput.mockImplementation(async(files,selector)=>{
      expect(f.document.querySelector(selector)).toBe(f.scope.querySelector('input'));
      chip(f.document,f.scope);
    });
    await expect(uploadChatGPTFiles(f.page,[f.file])).resolves.toMatchObject({ok:true});
  });
  it('selects the document input when camera and photo inputs precede it',async()=>{
    const f=fixture();
    for(const html of ['<input type="file" accept="image/*" capture>','<input type="file" accept="image/*,video/*">'])f.scope.insertAdjacentHTML('afterbegin',html);
    f.page.setFileInput.mockImplementation(async(files,selector)=>{expect(f.document.querySelector(selector).getAttribute('accept')).toBeNull();chip(f.document,f.scope);});
    await expect(uploadChatGPTFiles(f.page,[f.file])).resolves.toMatchObject({ok:true});
  });
  it.each(['<article><div role="group" aria-label="notes.txt">notes.txt</div></article>','<img src="avatar.png">','<form><div role="group" aria-label="notes.txt">notes.txt</div></form>'])('ignores historical text, old media and unrelated forms: %s',async html=>{
    const f=fixture(html);
    await expect(uploadChatGPTFiles(f.page,[f.file])).resolves.toMatchObject({ok:false});
  });
  it('recognizes modern attachment buttons only inside the composer attachment surface',async()=>{
    const f=fixture();f.page.setFileInput.mockImplementation(async()=>{
      f.scope.insertAdjacentHTML('beforeend','<div data-composer-attachments><span class="group/composer-attachment"><button aria-label="notes.txt"></button><button aria-label="Remove notes.txt"></button></span></div>');
      f.scope.querySelector('[data-composer-attachments] button').getBoundingClientRect=()=>({width:120,height:36});
    });
    await expect(uploadChatGPTFiles(f.page,[f.file])).resolves.toMatchObject({ok:true});
  });
  it('accepts current image role-button cards only within the active composer attachment surface',async()=>{
    const f=fixture('<div role="button" aria-label="notes.txt">Unrelated history</div>');
    f.page.setFileInput.mockImplementation(async()=>{
      f.scope.insertAdjacentHTML('beforeend','<div data-composer-attachments><div role="button" class="group/composer-attachment" aria-label="notes.txt"><img alt="notes.txt"></div></div>');
      f.scope.querySelector('[role="button"]').getBoundingClientRect=()=>({width:120,height:36});
    });
    await expect(uploadChatGPTFiles(f.page,[f.file])).resolves.toMatchObject({ok:true});
  });
  it('accepts a server deduplication suffix on a newly uploaded filename',async()=>{
    const f=fixture();f.page.setFileInput.mockImplementation(async()=>chip(f.document,f.scope,'notes(1).txt'));
    await expect(uploadChatGPTFiles(f.page,[f.file])).resolves.toMatchObject({ok:true});
  });
  it('does not accept a different filename containing the requested name',async()=>{
    const f=fixture();f.page.setFileInput.mockImplementation(async()=>chip(f.document,f.scope,'notes-extra.txt'));
    await expect(uploadChatGPTFiles(f.page,[f.file])).resolves.toMatchObject({ok:false});
  });
  it('ignores an existing attachment with the same filename',async()=>{
    const f=fixture('', '<div role="group" aria-label="notes.txt">notes.txt</div>');
    await expect(uploadChatGPTFiles(f.page,[f.file])).resolves.toMatchObject({ok:false});
  });
  it('waits for a new aria-only attachment to finish uploading',async()=>{
    const f=fixture();let n;
    f.page.setFileInput.mockImplementation(async()=>{n=chip(f.document,f.scope);n.setAttribute('aria-busy','true');});
    let polls=0;f.page.sleep.mockImplementation(async()=>{if(++polls===3)n.removeAttribute('aria-busy');});
    await expect(uploadChatGPTFiles(f.page,[f.file])).resolves.toMatchObject({ok:true});
    expect(polls).toBe(3);
  });
  it.each(['hidden','aria-hidden','error','progress'])('rejects a new %s attachment',async state=>{
    const f=fixture();f.page.setFileInput.mockImplementation(async()=>{const n=chip(f.document,f.scope);if(state==='hidden')n.hidden=true;else if(state==='aria-hidden')n.setAttribute('aria-hidden','true');else n.innerHTML=state==='error'?'<span role="alert">Failed</span>':'<span role="progressbar"></span>';});
    await expect(uploadChatGPTFiles(f.page,[f.file])).resolves.toMatchObject({ok:false});
  });
  it('rejects an ambiguous portal input before uploading',async()=>{
    const f=fixture('<input type="file"><input type="file">');f.scope.querySelector('input').remove();
    await expect(uploadChatGPTFiles(f.page,[f.file])).resolves.toMatchObject({ok:false});
    expect(f.page.setFileInput).not.toHaveBeenCalled();
  });
  it('does not replay final file assignment after an uncertain transport failure', async () => {
    const f = fixture();
    const input = f.scope.querySelector('input');
    Object.defineProperty(input, 'files', { writable: true, value: [] });
    f.dom.window.DataTransfer = class { constructor() { this.files=[]; this.items={add:file=>this.files.push(file)}; } };
    const changed = vi.fn();
    input.__reactProps$test = { onChange: changed };
    f.page.setFileInput.mockRejectedValue(new Error('Unknown action: set-file-input'));
    f.page.evaluateOnce.mockImplementation(async script => {
      f.dom.window.eval(script);
      throw new Error('Execution context was destroyed after assignment');
    });
    await expect(uploadChatGPTFiles(f.page, [f.file])).rejects.toThrow('after assignment');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(f.page.evaluateOnce).toHaveBeenCalledTimes(1);
    expect(input.__opencliFileChunks).toBeUndefined();
  });
  it('does not retry an uncertain native upload failure', async () => {
    const f = fixture();
    f.page.setFileInput.mockRejectedValue(new Error('Connection lost after upload'));
    await expect(uploadChatGPTFiles(f.page, [f.file])).rejects.toThrow('Connection lost');
    expect(f.page.evaluateOnce).not.toHaveBeenCalled();
  });
  it('matches overlapping server suffixes to distinct physical cards', async () => {
    const f = fixture();
    const second = path.join(path.dirname(f.file), 'notes(1).txt');
    fs.writeFileSync(second, 'Second file');
    f.page.setFileInput.mockImplementation(async () => {
      chip(f.document, f.scope, 'notes(1).txt');
      chip(f.document, f.scope, 'notes(2).txt');
    });
    await expect(uploadChatGPTFiles(f.page, [f.file, second])).resolves.toMatchObject({ ok: true });
  });
  it.each([true, false])('handles a duplicate composer with transparent=%s', async transparent => {
    const f = fixture();
    const clone = f.scope.cloneNode(true);
    if (transparent) clone.style.opacity = '0';
    for (const node of clone.querySelectorAll('*')) node.getBoundingClientRect = () => ({width:120,height:36});
    f.document.body.prepend(clone);
    f.page.setFileInput.mockImplementation(async (_, selector) => {
      expect(f.document.querySelector(selector)).toBe(f.scope.querySelector('input'));
      chip(f.document, f.scope);
    });
    await expect(uploadChatGPTFiles(f.page, [f.file])).resolves.toMatchObject({ ok: transparent });
    expect(f.page.setFileInput).toHaveBeenCalledTimes(transparent ? 1 : 0);
  });
  it('does not count two labels on one physical card as two uploaded files', async () => {
    const f = fixture();
    const second = path.join(path.dirname(f.file), 'notes(1).txt');
    fs.writeFileSync(second, 'Second file');
    f.page.setFileInput.mockImplementation(async () => {
      const card = chip(f.document, f.scope, 'notes(1).txt');
      chip(f.document, card, 'notes(1).txt');
    });
    await expect(uploadChatGPTFiles(f.page, [f.file, second])).resolves.toMatchObject({ ok: false });
  });
  it('does not upload through a sole input belonging to another form', async () => {
    const f = fixture('<form id="other"><input type="file" multiple></form>');
    f.scope.querySelector('input').remove();
    await expect(uploadChatGPTFiles(f.page, [f.file])).resolves.toMatchObject({ ok: false });
    expect(f.page.setFileInput).not.toHaveBeenCalled();
  });
  it('rejects multiple files when the input accepts only one', async () => {
    const f = fixture();
    f.scope.querySelector('input').multiple = false;
    const second = path.join(path.dirname(f.file), 'other.txt');
    fs.writeFileSync(second, 'Other file');
    await expect(uploadChatGPTFiles(f.page, [f.file, second])).resolves.toMatchObject({ ok: false });
    expect(f.page.setFileInput).not.toHaveBeenCalled();
  });
  it('does not confirm attachments from a replacement composer', async () => {
    const f = fixture();
    f.page.setFileInput.mockImplementation(async () => {
      const replacement = f.scope.cloneNode(true);
      replacement.removeAttribute('data-opencli-file-scope');
      for (const node of replacement.querySelectorAll('*')) node.getBoundingClientRect = () => ({ width:120,height:36 });
      f.scope.replaceWith(replacement);
      chip(f.document, replacement);
    });
    await expect(uploadChatGPTFiles(f.page, [f.file])).resolves.toMatchObject({ ok: false });
  });
  it('does not turn body role-like headings into message metadata',async()=>{
    const f=fixture('<h4>You said:</h4><p>Unrelated</p><div data-chatgpt-search-unit-key="turn:assistant"><h4 data-conversation-role="assistant">ChatGPT said:</h4><div data-markdown-text-style="assistant-message"><h4>You said:</h4><p>Quoted example</p></div></div>');
    expect((await getVisibleMessages(f.page)).map(({Role,Text})=>({Role,Text}))).toEqual([{Role:'Assistant',Text:'You said:Quoted example'}]);
  });
  it('fallback input and submission use the same visible composer despite hidden and unrelated candidates',async()=>{
    const f=fixture('<form id="unrelated"><button data-testid="send-button">Wrong</button></form><div contenteditable="true" role="textbox" style="display:none">Hidden</div>');
    f.document.execCommand=vi.fn(()=>true);
    const correct=vi.fn();const wrong=vi.fn();f.scope.querySelector('button').onclick=correct;f.document.querySelector('#unrelated button').onclick=wrong;
    await expect(sendChatGPTMessage(f.page,'Synthetic prompt')).resolves.toBe(true);
    expect(f.document.activeElement).toBe(f.scope.querySelector('[contenteditable]'));
    expect(correct).toHaveBeenCalledTimes(1);expect(wrong).not.toHaveBeenCalled();
  });
});

describe('ChatGPT image chunk fallback', () => {
  function imageFixture() {
    const f = fixture();
    const image = path.join(path.dirname(f.file), 'reference.png');
    const bytes = Buffer.alloc(1500001);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    fs.writeFileSync(image, bytes);
    const input = f.scope.querySelector('input');
    Object.defineProperty(input, 'files', { writable: true, value: [] });
    f.dom.window.File = File;
    f.dom.window.DataTransfer = class { constructor() { this.files = []; this.items = { add: file => this.files.push(file) }; } };
    const changed = vi.fn(() => chip(f.document, f.scope, 'reference.png'));
    input.__reactProps$test = { onChange: changed };
    f.page.setFileInput.mockRejectedValue(new Error('fileChooserOpened not received within 5s'));
    return { ...f, image, bytes, input, changed };
  }
  it('preserves large image bytes and MIME in bounded requests with one final change', async () => {
    const f = imageFixture();
    await expect(uploadChatGPTImages(f.page, [f.image])).resolves.toMatchObject({ ok: true });
    expect(f.input.files[0].type).toBe('image/png');
    expect(Buffer.from(await f.input.files[0].arrayBuffer()).equals(f.bytes)).toBe(true);
    expect(f.changed).toHaveBeenCalledTimes(1);
    expect(f.page.evaluateOnce).toHaveBeenCalledTimes(1);
    expect(Math.max(...f.page.evaluate.mock.calls.map(([script]) => Buffer.byteLength(JSON.stringify({ code: script }))))).toBeLessThan(400000);
    expect(f.input.__opencliFileChunks).toBeUndefined();
  });
  it('cleans incomplete image chunks without assigning any files', async () => {
    const f = imageFixture();
    const evaluate = f.page.evaluate.getMockImplementation();
    f.page.evaluate.mockImplementation(script => { if (script.includes('.chunks[1] =')) throw new Error('transfer interrupted'); return evaluate(script); });
    await expect(uploadChatGPTImages(f.page, [f.image])).rejects.toThrow('transfer interrupted');
    expect(f.input.files).toEqual([]);
    expect(f.changed).not.toHaveBeenCalled();
    expect(f.page.evaluateOnce).not.toHaveBeenCalled();
    expect(f.input.__opencliFileChunks).toBeUndefined();
  });
  it('never retries a final assignment whose response was lost', async () => {
    const f = imageFixture();
    const once = f.page.evaluateOnce.getMockImplementation();
    f.page.evaluateOnce.mockImplementation(async script => { await once(script); throw new Error('response lost'); });
    await expect(uploadChatGPTImages(f.page, [f.image])).rejects.toThrow('response lost');
    expect(f.changed).toHaveBeenCalledTimes(1);
    expect(f.page.evaluateOnce).toHaveBeenCalledTimes(1);
    expect(f.input.__opencliFileChunks).toBeUndefined();
  });
  it('does not fall back on an uncertain native upload failure', async () => {
    const f = imageFixture();
    f.page.setFileInput.mockRejectedValue(new Error('transport closed after dispatch'));
    await expect(uploadChatGPTImages(f.page, [f.image])).rejects.toThrow('transport closed');
    expect(f.page.evaluate).not.toHaveBeenCalled();
    expect(f.page.evaluateOnce).not.toHaveBeenCalled();
  });
});
