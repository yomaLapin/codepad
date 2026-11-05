(() => {
"use strict";
const $ = (selector) => document.querySelector(selector);
const state = {
  files: new Map(),
  activeId: null,
  dirty: false,
  treeCollapsed: new Set(),
  previewHasRun: false
};
const VERSION = "0.4.0";
let pendingWorker = null;
let toastTimer = null;

const makeId = () => (window.crypto && crypto.randomUUID)
  ? crypto.randomUUID()
  : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const extensionOf = (name = "") => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};
const isHtml = (name = "") => ["html", "htm"].includes(extensionOf(name));

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove("show"), 2600);
}
function setDirty(dirty) {
  state.dirty = dirty;
  $("#dirtyMark").textContent = dirty ? "●" : "";
  $("#saveStatus").textContent = dirty ? "수정됨" : "저장됨";
}
function addFile(name, content = "", path = name, handle = null) {
  const id = makeId();
  state.files.set(id, { id, name, path, content, handle });
  return id;
}
function activeFile() {
  return state.activeId ? state.files.get(state.activeId) || null : null;
}
function syncEditorToFile() {
  const file = activeFile();
  if (file) file.content = $("#editor").value;
}
function updateLabels() {
  const file = activeFile();
  const name = file?.name || "새 문서";
  $("#activeFileName").textContent = name;
  $("#languageLabel").textContent = extensionOf(name).toUpperCase() || "TEXT";
}
function setActive(id) {
  syncEditorToFile();
  const file = state.files.get(id);
  if (!file) return;
  state.activeId = id;
  $("#editor").value = file.content;
  updateLabels();
  setDirty(false);
  $("#saveStatus").textContent = file.handle ? "원본 파일 연결됨" : "불러옴";
  updateCursor();
  renderTree();
}
function newDocument() {
  syncEditorToFile();
  const id = addFile("새 문서", "", "새 문서");
  state.activeId = id;
  $("#editor").value = "";
  updateLabels();
  setDirty(false);
  $("#saveStatus").textContent = "새 문서";
  renderTree();
  $("#editor").focus();
  toast("새 문서를 만들었습니다.");
}
function updateCursor() {
  const text = $("#editor").value;
  const pos = $("#editor").selectionStart || 0;
  const before = text.slice(0, pos);
  const line = before.split("\n").length;
  const col = before.length - before.lastIndexOf("\n");
  $("#cursorLabel").textContent = `Ln ${line}, Col ${col}`;
}
function renderTree() {
  const root = $("#treeRoot");
  root.replaceChildren();
  if (!state.files.size) {
    const empty = document.createElement("p");
    empty.className = "empty-tree";
    empty.textContent = "불러온 파일이 여기에 표시됩니다.";
    root.append(empty);
    return;
  }
  const tree = {};
  for (const file of state.files.values()) {
    const parts = (file.path || file.name).split("/").filter(Boolean);
    let node = tree;
    parts.forEach((part, index) => {
      node[part] ||= { children: {} };
      if (index === parts.length - 1) node[part].file = file;
      node = node[part].children;
    });
  }
  const draw = (node, parent, prefix = "") => {
    Object.entries(node).sort((a, b) => {
      const aFile = !!a[1].file, bFile = !!b[1].file;
      return aFile === bFile ? a[0].localeCompare(b[0]) : aFile ? 1 : -1;
    }).forEach(([name, item]) => {
      const fullPath = prefix ? `${prefix}/${name}` : name;
      const hasChildren = Object.keys(item.children).length > 0;
      const isFile = !!item.file;
      const wrap = document.createElement("div");
      const row = document.createElement("div");
      row.className = "tree-item" + (isFile && item.file.id === state.activeId ? " selected" : "");
      row.setAttribute("role", "button");
      row.tabIndex = 0;
      const caret = document.createElement("span");
      caret.className = "tree-caret";
      caret.textContent = hasChildren ? (state.treeCollapsed.has(fullPath) ? "▸" : "▾") : "";
      const icon = document.createElement("span");
      icon.className = "tree-icon";
      icon.textContent = isFile ? "▤" : "▰";
      const label = document.createElement("span");
      label.textContent = name;
      row.append(caret, icon, label);
      wrap.append(row);
      parent.append(wrap);
      const activate = () => {
        if (isFile) {
          setActive(item.file.id);
        } else if (hasChildren) {
          state.treeCollapsed.has(fullPath)
            ? state.treeCollapsed.delete(fullPath)
            : state.treeCollapsed.add(fullPath);
          renderTree();
        }
      };
      row.addEventListener("click", activate);
      row.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      });
      if (hasChildren && !state.treeCollapsed.has(fullPath)) {
        const children = document.createElement("div");
        children.className = "tree-children";
        wrap.append(children);
        draw(item.children, children, fullPath);
      }
    });
  };
  draw(tree, root);
}

function safeFilename(name) {
  return name.trim().replace(/[\\/:*?"<>|]/g, "_").replace(/\.+$/, "");
}
function saveBlob(name, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function currentContent() {
  syncEditorToFile();
  return $("#editor").value;
}
function openSaveDialog() {
  const file = activeFile();
  const oldName = file?.name || "새 문서";
  const ext = extensionOf(oldName);
  $("#saveName").value = ext ? oldName.slice(0, -(ext.length + 1)) : oldName;
  $("#saveExtension").value = ext ? `.${ext}` : "";
  $("#customExtensionWrap").hidden = true;
  $("#customExtension").value = "";
  $("#saveDialog").hidden = false;
  $("#saveName").focus();
  $("#saveName").select();
}
function closeSaveDialog() {
  $("#saveDialog").hidden = true;
}
function applySavedName(fullName, content, handle = null) {
  let file = activeFile();
  if (!file) {
    const id = addFile(fullName, content, fullName, handle);
    state.activeId = id;
    file = state.files.get(id);
  } else {
    file.name = fullName;
    file.path = fullName;
    file.content = content;
    file.handle = handle;
  }
  updateLabels();
  setDirty(false);
  $("#saveStatus").textContent = "저장 완료";
  renderTree();
}
async function writeHandle(handle, content) {
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}
async function saveCurrent() {
  const file = activeFile();
  const content = currentContent();
  if (file?.handle && typeof file.handle.createWritable === "function") {
    try {
      await writeHandle(file.handle, content);
      setDirty(false);
      $("#saveStatus").textContent = "원본 파일에 저장됨";
      toast(`${file.name} 원본 파일에 저장했습니다.`);
      return;
    } catch (error) {
      console.error(error);
      toast("원본 파일 저장에 실패했습니다. 다른 이름으로 저장해 주세요.");
      return;
    }
  }
  if (file && extensionOf(file.name)) {
    saveBlob(file.name, content);
    setDirty(false);
    $("#saveStatus").textContent = "다운로드 완료";
    toast(`${file.name} 다운로드를 시작했습니다.`);
  } else {
    openSaveDialog();
  }
}
async function saveAs(name, extension) {
  const cleanName = safeFilename(name);
  let ext = extension.trim();
  if (!ext.startsWith(".")) ext = `.${ext}`;
  if (!cleanName) {
    toast("파일 이름을 입력해 주세요.");
    return false;
  }
  if (!/^\.[a-zA-Z0-9_-]+$/.test(ext)) {
    toast("확장자 형식을 확인해 주세요.");
    return false;
  }
  const fullName = cleanName.replace(/\.[^.]+$/, "") + ext;
  const content = currentContent();

  // 지원 브라우저에서는 저장 위치와 파일명을 직접 선택할 수 있습니다.
  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fullName,
        types: [{ description: "텍스트 파일", accept: { "text/plain": [ext] } }]
      });
      await writeHandle(handle, content);
      applySavedName(handle.name || fullName, content, handle);
      toast(`${handle.name || fullName} 저장 완료`);
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return false;
      console.warn("파일 저장 선택기 사용 실패, 다운로드로 전환", error);
    }
  }
  saveBlob(fullName, content);
  applySavedName(fullName, content, null);
  toast(`${fullName} 다운로드 완료`);
  return true;
}

async function readFile(file, path, handle = null) {
  const content = await file.text();
  const existing = [...state.files.values()].find(item => item.path === path);
  if (existing) {
    existing.name = file.name;
    existing.content = content;
    existing.handle = handle || existing.handle;
    return existing.id;
  }
  return addFile(file.name, content, path, handle);
}
async function importInputFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  let first = null, failed = 0;
  for (const file of files) {
    try {
      const path = file.webkitRelativePath || file.name;
      const id = await readFile(file, path);
      if (!first) first = id;
    } catch (error) {
      failed++;
      console.warn("파일 읽기 실패", file.name, error);
    }
  }
  if (first) {
    setActive(first);
    $("#filePanel").classList.remove("collapsed");
  }
  toast(`${files.length - failed}개 파일을 불러왔습니다.${failed ? ` (${failed}개 실패)` : ""}`);
  $("#fileInput").value = "";
  $("#folderInput").value = "";
}
async function importWithPicker() {
  if (typeof window.showOpenFilePicker !== "function") {
    $("#fileInput").click();
    return;
  }
  try {
    const handles = await window.showOpenFilePicker({ multiple: true });
    let first = null;
    for (const handle of handles) {
      const file = await handle.getFile();
      const id = await readFile(file, file.name, handle);
      if (!first) first = id;
    }
    if (first) {
      setActive(first);
      $("#filePanel").classList.remove("collapsed");
    }
    toast(`${handles.length}개 파일을 불러왔습니다.`);
  } catch (error) {
    if (error?.name !== "AbortError") toast("파일을 불러오지 못했습니다.");
  }
}
async function walkDirectory(directoryHandle, prefix = "") {
  for await (const [name, handle] of directoryHandle.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "directory") {
      await walkDirectory(handle, path);
    } else if (handle.kind === "file") {
      try {
        const file = await handle.getFile();
        await readFile(file, path, handle);
      } catch (error) {
        console.warn("폴더 내 파일 읽기 실패", path, error);
      }
    }
  }
}
async function importFolderWithPicker() {
  if (typeof window.showDirectoryPicker !== "function") {
    $("#folderInput").click();
    return;
  }
  try {
    const directory = await window.showDirectoryPicker({ mode: "readwrite" });
    const before = state.files.size;
    await walkDirectory(directory);
    const added = state.files.size - before;
    const first = [...state.files.values()].find(file => file.path.includes("/"));
    if (first) {
      setActive(first.id);
      $("#filePanel").classList.remove("collapsed");
    }
    toast(`폴더를 불러왔습니다. 파일 ${added}개`);
  } catch (error) {
    if (error?.name !== "AbortError") toast("폴더를 불러오지 못했습니다.");
  }
}

function togglePreview(forceOpen) {
  const pane = $("#previewPane");
  const button = $("#togglePreviewBtn");
  const shouldCollapse = typeof forceOpen === "boolean"
    ? !forceOpen
    : !pane.classList.contains("collapsed");
  pane.classList.toggle("collapsed", shouldCollapse);
  button.textContent = shouldCollapse ? "펼치기" : "접기";
  button.setAttribute("aria-expanded", String(!shouldCollapse));
}
function runPreview() {
  const source = currentContent();
  if (!source.trim()) {
    toast("실행할 내용이 없습니다.");
    return;
  }
  const frame = $("#previewFrame");
  $("#previewPlaceholder").classList.add("hidden");
  // 완전한 HTML 문서가 아니면 body 내용으로 감싸 실행합니다.
  const html = /<!doctype|<html[\s>]/i.test(source)
    ? source
    : `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${source}</body></html>`;
  frame.srcdoc = html;
  state.previewHasRun = true;
  togglePreview(true);
  toast("미리보기를 실행했습니다.");
}
function refreshPreview() {
  if (!state.previewHasRun) {
    runPreview();
    return;
  }
  runPreview();
}
function toggleFilePanel() {
  $("#filePanel").classList.toggle("collapsed");
}
async function requestFullscreen(element) {
  if (document.fullscreenElement) {
    try { await document.exitFullscreen(); } catch (_) {}
    return;
  }
  if (element.requestFullscreen) {
    try {
      await element.requestFullscreen();
    } catch (_) {
      toast("전체화면 전환이 거부되었습니다. 브라우저 전체화면 기능을 이용해 주세요.");
    }
  } else {
    toast("이 브라우저는 전체화면 API를 지원하지 않습니다.");
  }
}
function updateViewport() {
  const height = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty("--visible-height", `${height}px`);
}
function collapseAllFolders() {
  const collapsed = new Set();
  for (const file of state.files.values()) {
    const parts = (file.path || file.name).split("/");
    for (let i = 1; i < parts.length; i++) collapsed.add(parts.slice(0, i).join("/"));
  }
  state.treeCollapsed = collapsed;
  renderTree();
}

function setupEvents() {
  $("#menuToggle").addEventListener("click", toggleFilePanel);
  $("#hidePanelBtn").addEventListener("click", () => $("#filePanel").classList.add("collapsed"));
  $("#openFilesBtn").addEventListener("click", importWithPicker);
  $("#openFolderBtn").addEventListener("click", importFolderWithPicker);
  $("#fileInput").addEventListener("change", event => importInputFiles(event.target.files));
  $("#folderInput").addEventListener("change", event => importInputFiles(event.target.files));
  $("#collapseTreeBtn").addEventListener("click", collapseAllFolders);

  $("#editor").addEventListener("input", () => {
    syncEditorToFile();
    setDirty(true);
    updateCursor();
  });
  ["click", "keyup", "select"].forEach(type => $("#editor").addEventListener(type, updateCursor));
  $("#newBtn").addEventListener("click", newDocument);
  $("#saveBtn").addEventListener("click", saveCurrent);
  $("#saveAsBtn").addEventListener("click", openSaveDialog);

  $("#runBtn").addEventListener("click", runPreview);
  $("#refreshBtn").addEventListener("click", refreshPreview);
  $("#togglePreviewBtn").addEventListener("click", () => togglePreview());
  $("#previewFullscreenBtn").addEventListener("click", async () => {
    togglePreview(true);
    await requestFullscreen($("#previewPane"));
  });
  $("#fullscreenBtn").addEventListener("click", () => requestFullscreen(document.documentElement));

  $("#saveExtension").addEventListener("change", () => {
    $("#customExtensionWrap").hidden = $("#saveExtension").value !== "custom";
    if ($("#saveExtension").value === "custom") $("#customExtension").focus();
  });
  $("#cancelSaveBtn").addEventListener("click", closeSaveDialog);
  $("#saveDialog").addEventListener("click", event => {
    if (event.target === $("#saveDialog")) closeSaveDialog();
  });
  $("#saveForm").addEventListener("submit", async event => {
    event.preventDefault();
    let extension = $("#saveExtension").value;
    if (extension === "custom") extension = $("#customExtension").value;
    if (!extension) {
      toast("확장자를 선택하거나 입력해 주세요.");
      return;
    }
    const saved = await saveAs($("#saveName").value, extension);
    if (saved) closeSaveDialog();
  });
  $("#applyUpdateBtn").addEventListener("click", () => {
    if (pendingWorker) pendingWorker.postMessage({ type: "SKIP_WAITING" });
  });
  $("#dismissUpdateBtn").addEventListener("click", () => $("#updateBanner").hidden = true);

  window.addEventListener("beforeunload", event => {
    if (state.dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  window.addEventListener("resize", updateViewport);
  window.visualViewport?.addEventListener("resize", updateViewport);
  window.visualViewport?.addEventListener("scroll", updateViewport);
}

async function setupServiceWorker() {
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
  try {
    const registration = await navigator.serviceWorker.register("./sw.js");
    registration.update().catch(() => {});
    const showWaiting = () => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        pendingWorker = registration.waiting;
        $("#updateBanner").hidden = false;
      }
    };
    showWaiting();
    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      worker?.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          pendingWorker = worker;
          $("#updateBanner").hidden = false;
        }
      });
    });
    navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
  } catch (error) {
    console.warn("서비스 워커 등록 실패", error);
  }
}

function init() {
  $("#versionLabel").textContent = `v${VERSION}`;
  setupEvents();
  updateViewport();
  const id = addFile("새 문서", "", "새 문서");
  setActive(id);
  togglePreview(false); // 기본 접힘
  setupServiceWorker();
}
document.addEventListener("DOMContentLoaded", init);
})();