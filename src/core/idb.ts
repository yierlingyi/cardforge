/** 极简 IndexedDB 键值存储（无依赖） */

const DB_NAME = 'cardforge';
const DB_VERSION = 1;
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB，无法使用本地持久化'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
    req.onblocked = () => reject(new Error('IndexedDB 被其他标签页阻塞，请关闭其他窗口后重试'));
  });
  return dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let req: IDBRequest<T>;
    try {
      req = fn(store);
    } catch (e) {
      reject(e);
      return;
    }
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T = any>(key: string): Promise<T | undefined> {
  try {
    return await tx<T>('readonly', (s) => s.get(key) as IDBRequest<T>);
  } catch {
    return undefined;
  }
}

export async function idbSet(key: string, value: any): Promise<void> {
  await tx('readwrite', (s) => s.put(value, key) as IDBRequest<any>);
}

export async function idbDel(key: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(key) as IDBRequest<any>);
}

export async function idbKeys(): Promise<string[]> {
  try {
    const keys = await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys() as IDBRequest<IDBValidKey[]>);
    return keys.map(String);
  } catch {
    return [];
  }
}

export async function idbClear(): Promise<void> {
  await tx('readwrite', (s) => s.clear() as IDBRequest<any>);
}

export const storageKeys = {
  project: (id: string) => `project:${id}`,
  projectIndex: 'projects:index',
  settings: 'app:settings',
  lastProject: 'app:lastProject',
};
