(() => {
"use strict";
const $ = s => document.querySelector(s);
const VERSION = "0.5.0";
const DB_NAME = "nmt-codepad";
const STORE = "workspace";
const state = { files:new Map(), activeId:null, treeCollapsed:new Set(), previewHasRun:false, db:null, timer:null, worker:null };
let toastTimer;

const id = () => crypto?.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
const ext = n => { const i=(n||"").lastIndexOf("."); return i>0?n.slice(i+1).toLowerCase():""; };
const active = () => state.files.get(state.activeId) || null;

function toast(message) {
  $("#toast").textContent=message; $("#toast").classList.add("show");
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>$("#toast").classList.remove("show"),2800);
}
function labels() {
  const f=active(); $("#activeFileName").textContent=f?.name||"새 문서";
  $("#languageLabel").textContent=ext(f?.name).toUpperCase()||"TEXT";
  $("#dirtyMark").textContent=f?.dirty?"●":"";
  if(f?.dirty) $("#saveStatus").textContent="수정됨";
}
function cursor() {
  const t=$("#editor").value, p=$("#editor").selectionStart||0, b=t.slice(0,p);
  $("#cursorLabel").textContent=`Ln ${b.split("\n").length}, Col ${b.length-b.lastIndexOf("\n")}`;
}
function sync() { const f=active(); if(f) f.content=$("#editor").value; }
function persistSoon() { clearTimeout(state.timer); state.timer=setTimeout(persist,300); }

function openDB() {
  return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,1);
    r.onupgradeneeded=()=>r.result.createObjectStore(STORE);
    r.onsuccess=()=>resolve(r.result); r.onerror=()=>reject(r.error);
  });
}
async function persist() {
  if(!state.db) return;
  const payload={files:[...state.files.values()],activeId:state.activeId,updated:Date.now()};
  const write=data=>new Promise((resolve,reject)=>{
    const tx=state.db.transaction(STORE,"readwrite");
    tx.objectStore(STORE).put(data,"current");
    tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error);
  });
  try { await write(payload); }
  catch(e) {
    // 일부 브라우저에서 파일 핸들 직렬화가 실패하면 핸들을 빼고 편집 내용만 저장
    try { await write({...payload,files:payload.files.map(({handle,...f})=>f)}); }
    catch(err) { console.warn("임시 저장 실패",err); }
  }
}
async function restore() {
  if(!state.db) return false;
  const data=await new Promise((resolve,reject)=>{
    const tx=state.db.transaction(STORE,"readonly"), r=tx.objectStore(STORE).get("current");
    r.onsuccess=()=>resolve(r.result||null); r.onerror=()=>reject(r.error);
  });
  if(!data?.files?.length) return false;
  state.files=new Map(data.files.map(f=>[f.id,{...f,handle:f.handle||null,dirty:!!f.dirty}]));
  state.activeId=state.files.has(data.activeId)?data.activeId:state.files.keys().next().value;
  const f=active(); $("#editor").value=f?.content||""; labels(); cursor(); renderTree();
  $("#saveStatus").textContent=f?.dirty?"임시 저장된 수정 내용 복구됨":(f?.handle?"파일 연결 복구됨":"작업 내용 복구됨");
  return true;
}
function addFile(name,content="",path=name,handle=null) {
  const file={id:id(),name,path,content,handle,dirty:false}; state.files.set(file.id,file); return file.id;
}
function setActive(fileId) {
  sync(); const f=state.files.get(fileId); if(!f)return;
  state.activeId=fileId; $("#editor").value=f.content||""; labels(); cursor(); renderTree();
  $("#saveStatus").textContent=f.dirty?"수정됨":(f.handle?"원본 파일 연결됨":"불러옴");
  persistSoon();
}
function newDocument() {
  sync(); const fileId=addFile("새 문서","","새 문서");
  state.activeId=fileId; $("#editor").value=""; labels(); cursor(); renderTree(); persistSoon();
  $("#saveStatus").textContent="새 문서"; $("#editor").focus(); toast("새 문서를 만들었습니다.");
}
function renderTree() {
  const root=$("#treeRoot"); root.replaceChildren();
  if(!state.files.size){const p=document.createElement("p");p.className="empty-tree";p.textContent="불러온 파일이 여기에 표시됩니다.";root.append(p);return;}
  const tree={};
  for(const f of state.files.values()){
    const parts=(f.path||f.name).split("/").filter(Boolean); let n=tree;
    parts.forEach((part,i)=>{n[part] ||= {children:{}};if(i===parts.length-1)n[part].file=f;n=n[part].children;});
  }
  const draw=(node,parent,prefix="")=>{
    Object.entries(node).sort((a,b)=>!!a[1].file-!!b[1].file||a[0].localeCompare(b[0])).forEach(([name,item])=>{
      const path=prefix?`${prefix}/${name}`:name, has=Object.keys(item.children).length>0, isFile=!!item.file;
      const wrap=document.createElement("div"), row=document.createElement("div"); row.className="tree-item"+(isFile&&item.file.id===state.activeId?" selected":"");row.setAttribute("role","button");row.tabIndex=0;
      const caret=document.createElement("span");caret.className="tree-caret";caret.textContent=has?(state.treeCollapsed.has(path)?"▸":"▾"):"";
      const ico=document.createElement("span");ico.className="tree-icon";ico.textContent=isFile?"▤":"▰";
      const label=document.createElement("span");label.textContent=name+(isFile&&item.file.dirty?" ●":"");row.append(caret,ico,label);wrap.append(row);parent.append(wrap);
      const activate=()=>{if(isFile)setActive(item.file.id);else if(has){state.treeCollapsed.has(path)?state.treeCollapsed.delete(path):state.treeCollapsed.add(path);renderTree();}};
      row.addEventListener("click",activate);row.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();activate();}});
      if(has&&!state.treeCollapsed.has(path)){const child=document.createElement("div");child.className="tree-children";wrap.append(child);draw(item.children,child,path);}
    });
  }; draw(tree,root);
}
function safeName(n){return n.trim().replace(/[\\/:*?"<>|]/g,"_").replace(/\.+$/,"");}
function downloadFile(name,content) {
  const url=URL.createObjectURL(new Blob([content],{type:"text/plain;charset=utf-8"}));
  const a=document.createElement("a");a.href=url;a.download=name;a.style.display="none";document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
function currentContent(){sync();return $("#editor").value;}
function openSaveDialog(){
  const f=active(), old=f?.name||"새 문서", e=ext(old);
  $("#saveName").value=e?old.slice(0,-(e.length+1)):old;$("#saveExtension").value=e?`.${e}`:"";
  $("#customExtensionWrap").hidden=true;$("#customExtension").value="";$("#saveDialog").hidden=false;$("#saveName").focus();$("#saveName").select();
}
function closeSaveDialog(){$("#saveDialog").hidden=true;}
function applySavedName(name,content,handle=null){
  let f=active();if(!f){const fid=addFile(name,content,name,handle);state.activeId=fid;f=active();}
  else{Object.assign(f,{name,path:name,content,handle,dirty:false});}
  labels();renderTree();persistSoon();
}
async function permissionForWrite(handle){
  if(typeof handle.queryPermission!=="function")return true;
  let p=await handle.queryPermission({mode:"readwrite"});
  if(p!=="granted"&&typeof handle.requestPermission==="function")p=await handle.requestPermission({mode:"readwrite"});
  return p==="granted";
}
async function writeHandle(handle,content){
  const w=await handle.createWritable();
  try{await w.write(content);await w.close();}catch(e){try{await w.abort();}catch(_){}throw e;}
}
async function saveCurrent(){
  const f=active();if(!f){openSaveDialog();return;}const content=currentContent();
  if(f.handle&&typeof f.handle.createWritable==="function"){
    try{
      if(!await permissionForWrite(f.handle)){toast("원본 파일 쓰기 권한이 없습니다. 다른 이름으로 저장해 주세요.");$("#saveStatus").textContent="원본 저장 권한 없음";return;}
      await writeHandle(f.handle,content);f.dirty=false;labels();$("#saveStatus").textContent="원본 파일에 저장됨";renderTree();persistSoon();toast(`${f.name} 원본 파일에 저장했습니다.`);return;
    }catch(e){console.error(e);$("#saveStatus").textContent="원본 저장 실패";toast("원본 저장에 실패했습니다. 다른 이름으로 저장해 주세요.");return;}
  }
  downloadFile(f.name,content);f.dirty=false;labels();$("#saveStatus").textContent="파일 내보내기 요청됨";renderTree();persistSoon();
  toast(`${f.name} 다운로드를 요청했습니다. 저장 위치를 확인해 주세요.`);
}
async function saveAs(name,extension){
  const clean=safeName(name);let e=extension.trim();if(!e.startsWith("."))e=`.${e}`;
  if(!clean){toast("파일 이름을 입력해 주세요.");return false;}
  if(!/^\.[a-zA-Z0-9_-]+$/.test(e)){toast("확장자 형식을 확인해 주세요.");return false;}
  const full=clean.replace(/\.[^.]+$/,"")+e,content=currentContent();
  if(typeof window.showSaveFilePicker==="function"){
    try{
      const h=await window.showSaveFilePicker({suggestedName:full,types:[{description:"텍스트 및 코드 파일",accept:{"text/plain":[e]}}]});
      await writeHandle(h,content);applySavedName(h.name||full,content,h);$("#saveStatus").textContent="파일 저장 완료";toast(`${h.name||full} 저장 완료`);return true;
    }catch(err){if(err?.name==="AbortError")return false;console.warn(err);toast("저장 선택기를 사용할 수 없어 다운로드로 전환합니다.");}
  }
  downloadFile(full,content);applySavedName(full,content,null);$("#saveStatus").textContent="파일 내보내기 요청됨";
  toast(`${full} 다운로드를 요청했습니다. 저장 위치를 확인해 주세요.`);return true;
}
async function readFile(file,path,handle=null){
  const content=await file.text(), existing=[...state.files.values()].find(f=>f.path===path);
  if(existing){Object.assign(existing,{name:file.name,content,handle,dirty:false});return existing.id;}
  return addFile(file.name,content,path,handle);
}
async function importInputFiles(list){
  const files=[...list];if(!files.length)return;let first=null,failed=0;
  for(const file of files){try{const fid=await readFile(file,file.webkitRelativePath||file.name,null);if(!first)first=fid;}catch(e){failed++;console.warn(e);}}
  if(first){setActive(first);toggleFilePanel(true);}persistSoon();
  toast(`${files.length-failed}개 파일을 불러왔습니다.${failed?` (${failed}개 실패)`:""}`);
  $("#fileInput").value="";$("#folderInput").value="";
}
async function importWithPicker(){
  if(typeof window.showOpenFilePicker!=="function"){$("#fileInput").click();return;}
  try{const handles=await window.showOpenFilePicker({multiple:true});let first=null;
    for(const h of handles){const f=await h.getFile(),fid=await readFile(f,f.name,h);if(!first)first=fid;}
    if(first){setActive(first);toggleFilePanel(true);}persistSoon();toast(`${handles.length}개 파일을 불러왔습니다.`);
  }catch(e){if(e?.name!=="AbortError"){console.error(e);toast("파일을 불러오지 못했습니다.");}}
}
async function walkDirectory(dir,prefix=""){
  for await(const [name,h] of dir.entries()){const path=prefix?`${prefix}/${name}`:name;
    if(h.kind==="directory")await walkDirectory(h,path);
    else try{await readFile(await h.getFile(),path,h);}catch(e){console.warn(path,e);}
  }
}
async function importFolderWithPicker(){
  if(typeof window.showDirectoryPicker!=="function"){$("#folderInput").click();return;}
  try{const dir=await window.showDirectoryPicker({mode:"readwrite"});await walkDirectory(dir);
    const f=[...state.files.values()].find(x=>x.path.includes("/"));if(f){setActive(f.id);toggleFilePanel(true);}
    persistSoon();toast("폴더를 불러왔습니다.");
  }catch(e){if(e?.name!=="AbortError"){console.error(e);toast("폴더를 불러오지 못했습니다.");}}
}
function togglePreview(force){
  const pane=$("#previewPane"),btn=$("#togglePreviewBtn");
  const collapse=typeof force==="boolean"?!force:!pane.classList.contains("collapsed");
  pane.classList.toggle("collapsed",collapse);btn.setAttribute("aria-expanded",String(!collapse));
  btn.setAttribute("aria-label",collapse?"미리보기 펼치기":"미리보기 접기");btn.title=collapse?"미리보기 펼치기":"미리보기 접기";
}
function runPreview(){
  const source=currentContent();if(!source.trim()){toast("실행할 내용이 없습니다.");return;}
  const html=/(<!doctype|<html[\s>])/i.test(source)?source:`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${source}</body></html>`;
  $("#previewPlaceholder").classList.add("hidden");$("#previewFrame").srcdoc=html;state.previewHasRun=true;togglePreview(true);toast("미리보기를 실행했습니다.");
}
function toggleFilePanel(force){
  const panel=$("#filePanel"),back=$("#drawerBackdrop"),open=typeof force==="boolean"?force:panel.classList.contains("collapsed");
  panel.classList.toggle("collapsed",!open);back.classList.toggle("hidden",!open);$("#menuToggle").setAttribute("aria-expanded",String(open));
}
function updateViewport(){const h=window.visualViewport?.height||window.innerHeight;document.documentElement.style.setProperty("--visible-height",`${h}px`);}

function setupEvents(){
  $("#menuToggle").addEventListener("click",()=>toggleFilePanel());$("#drawerBackdrop").addEventListener("click",()=>toggleFilePanel(false));
  $("#openBtn").addEventListener("click",()=>{const m=$("#openMenu"),o=m.hidden;m.hidden=!o;$("#openBtn").setAttribute("aria-expanded",String(o));});
  $("#openFilesBtn").addEventListener("click",()=>{$("#openMenu").hidden=true;$("#openBtn").setAttribute("aria-expanded","false");importWithPicker();});
  $("#openFolderBtn").addEventListener("click",()=>{$("#openMenu").hidden=true;$("#openBtn").setAttribute("aria-expanded","false");importFolderWithPicker();});
  document.addEventListener("click",e=>{if(!e.target.closest(".open-menu-wrap")){$("#openMenu").hidden=true;$("#openBtn").setAttribute("aria-expanded","false");}});
  $("#fileInput").addEventListener("change",e=>importInputFiles(e.target.files));$("#folderInput").addEventListener("change",e=>importInputFiles(e.target.files));
  $("#editor").addEventListener("input",()=>{const f=active();if(f){f.content=$("#editor").value;f.dirty=true;labels();renderTree();persistSoon();}cursor();});
  ["click","keyup","select"].forEach(t=>$("#editor").addEventListener(t,cursor));
  $("#newBtn").addEventListener("click",newDocument);$("#saveBtn").addEventListener("click",saveCurrent);$("#saveAsBtn").addEventListener("click",openSaveDialog);
  $("#runBtn").addEventListener("click",runPreview);$("#refreshBtn").addEventListener("click",runPreview);$("#togglePreviewBtn").addEventListener("click",()=>togglePreview());
  $("#saveExtension").addEventListener("change",()=>{$("#customExtensionWrap").hidden=$("#saveExtension").value!=="custom";if($("#saveExtension").value==="custom")$("#customExtension").focus();});
  $("#cancelSaveBtn").addEventListener("click",closeSaveDialog);$("#saveDialog").addEventListener("click",e=>{if(e.target===$("#saveDialog"))closeSaveDialog();});
  $("#saveForm").addEventListener("submit",async e=>{e.preventDefault();let x=$("#saveExtension").value;if(x==="custom")x=$("#customExtension").value;if(!x){toast("확장자를 선택하거나 입력해 주세요.");return;}if(await saveAs($("#saveName").value,x))closeSaveDialog();});
  $("#applyUpdateBtn").addEventListener("click",()=>state.worker?.postMessage({type:"SKIP_WAITING"}));
  $("#dismissUpdateBtn").addEventListener("click",()=>$("#updateBanner").hidden=true);
  window.addEventListener("beforeunload",e=>{sync();persist();if([...state.files.values()].some(f=>f.dirty)){e.preventDefault();e.returnValue="";}});
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden"){sync();persist();}});
  window.addEventListener("resize",updateViewport);window.visualViewport?.addEventListener("resize",updateViewport);window.visualViewport?.addEventListener("scroll",updateViewport);
}
async function setupSW(){
  if(!("serviceWorker"in navigator)||!/^https?:$/.test(location.protocol))return;
  try{const reg=await navigator.serviceWorker.register("./sw.js",{scope:"./"});reg.update().catch(()=>{});
    const show=()=>{if(reg.waiting&&navigator.serviceWorker.controller){state.worker=reg.waiting;$("#updateBanner").hidden=false;}};show();
    reg.addEventListener("updatefound",()=>{const w=reg.installing;w?.addEventListener("statechange",()=>{if(w.state==="installed"&&navigator.serviceWorker.controller){state.worker=w;$("#updateBanner").hidden=false;}});});
    navigator.serviceWorker.addEventListener("controllerchange",()=>location.reload());
  }catch(e){console.warn("서비스 워커 등록 실패",e);}
}
async function init(){
  $("#versionLabel").textContent=`v${VERSION}`;setupEvents();updateViewport();
  try{state.db=await openDB();if(await restore())toast("이전 작업 내용을 복구했습니다.");else{const fid=addFile("새 문서","","새 문서");setActive(fid);$("#saveStatus").textContent="새 문서";}}
  catch(e){console.warn("임시 저장 미지원",e);const fid=addFile("새 문서","","새 문서");setActive(fid);$("#saveStatus").textContent="새 문서 · 임시 저장 미지원";}
  togglePreview(false);setupSW();
}
document.addEventListener("DOMContentLoaded",init);
})();