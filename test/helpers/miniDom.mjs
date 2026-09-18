// preact가 실제로 만지는 DOM 표면만 흉내 낸 최소 구현 — 컴포넌트가 throw 없이 그려지는지만 본다.
class MiniNode {
  constructor(nodeType) {
    this.nodeType = nodeType;
    this.childNodes = [];
    this.parentNode = null;
    this.firstChild = null;
    this.nextSibling = null;
  }
  _sync() {
    this.firstChild = this.childNodes[0] || null;
    this.childNodes.forEach((c, i) => { c.nextSibling = this.childNodes[i + 1] || null; });
  }
  appendChild(child) { return this.insertBefore(child, null); }
  insertBefore(child, ref) {
    if (child.parentNode) child.parentNode.removeChild(child);
    const index = ref ? this.childNodes.indexOf(ref) : this.childNodes.length;
    this.childNodes.splice(index < 0 ? this.childNodes.length : index, 0, child);
    child.parentNode = this;
    this._sync();
    return child;
  }
  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
    this._sync();
    return child;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  // 리스너를 실제로 들고 있는다 — 버튼이 "그려졌는가"만이 아니라 "눌렀을 때 엔진을 부르는가"를
  // 보려면 테스트가 그 핸들러에 닿을 수 있어야 한다(fire 참고).
  addEventListener(type, fn) { (this._listeners ||= {})[type] = [...(this._listeners?.[type] || []), fn]; }
  removeEventListener(type, fn) {
    if (!this._listeners?.[type]) return;
    this._listeners[type] = this._listeners[type].filter((entry) => entry !== fn);
  }
  get textContent() {
    return this.nodeType === 3 ? this.data : this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(value) { this.childNodes = []; this._sync(); if (value) this.appendChild(new MiniText(String(value))); }
}
class MiniText extends MiniNode {
  constructor(data) { super(3); this.data = data; }
}
class MiniElement extends MiniNode {
  constructor(localName, ns) {
    super(1);
    this.localName = localName;
    this.nodeName = localName.toUpperCase();
    this.namespaceURI = ns || null;
    this.attributes = {};
    this.style = { setProperty() {}, removeProperty() {}, cssText: '' };
    this.ownerSVGElement = ns ? {} : undefined;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  focus() {}
  contains() { return false; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
}
export function installMiniDom() {
  const document = {
    createElement: (name) => new MiniElement(name),
    createElementNS: (ns, name) => new MiniElement(name, ns),
    createTextNode: (data) => new MiniText(String(data)),
    addEventListener() {}, removeEventListener() {},
  };
  document.documentElement = new MiniElement('html');
  document.body = new MiniElement('body');
  globalThis.document = document;
  globalThis.Node = MiniNode;
  globalThis.Element = MiniElement;
  globalThis.Text = MiniText;
  if (!globalThis.window) globalThis.window = globalThis;
  // 컴포넌트가 useEffect에서 window에 키/리사이즈 리스너를 거는 일이 있다 — Node의 globalThis에는
  // 이 둘이 없어서, 없으면 아무 일도 하지 않는 자리만 채워 준다.
  if (typeof globalThis.window.addEventListener !== 'function') globalThis.window.addEventListener = () => {};
  if (typeof globalThis.window.removeEventListener !== 'function') globalThis.window.removeEventListener = () => {};
  return document;
}
export function makeRoot() { return new MiniElement('div'); }
export function textOf(node) { return node.textContent; }

/** 트리 전체를 훑어 조건에 맞는 엘리먼트를 모은다. */
export function queryAll(root, predicate) {
  const found = [];
  const walk = (node) => {
    if (node.nodeType === 1 && predicate(node)) found.push(node);
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  return found;
}

/** 글자로 버튼 하나를 찾는다 — 화면에서 사람이 누르는 방식과 같은 기준이다. */
export function findByText(root, localName, text) {
  return queryAll(root, (node) => node.localName === localName && node.textContent.includes(text))[0] || null;
}

/**
 * 그 엘리먼트에 붙은 핸들러를 부른다. preact는 addEventListener로 자기 프록시를 한 번 붙이고
 * 실제 핸들러는 `dom._listeners[type]`에 직접 넣으므로(그래서 여기 저장한 배열을 덮어쓴다),
 * 함수와 배열 두 형태를 모두 받는다.
 */
export function fire(element, type, event = {}) {
  // preact는 addEventListener로 자기 프록시 하나만 붙이고, 실제 핸들러는 `dom.l['Click' + 캡처
  // 여부]`에 넣는다. 그 표를 먼저 보고, 없으면 여기 모아 둔 리스너를 쓴다.
  const proxied = Object.entries(element?.l || {})
    .filter(([key]) => key.toLowerCase().startsWith(type.toLowerCase()))
    .map(([, fn]) => fn);
  const entry = element?._listeners?.[type];
  const listeners = proxied.length
    ? proxied
    : (typeof entry === 'function' ? [entry] : (Array.isArray(entry) ? entry : []));
  const payload = { type, preventDefault() {}, stopPropagation() {}, currentTarget: element, target: element, ...event };
  for (const listener of listeners) listener(payload);
  return listeners.length;
}
