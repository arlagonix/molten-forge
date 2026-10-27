import type { BackgroundTheme } from "./appearance";

const DB_NAME = "molten-forge-pi-appearance";
const DB_VERSION = 1;
const STORE_NAME = "backgrounds";

export type StoredBackgroundImage = {
  theme: BackgroundTheme;
  name: string;
  type: string;
  blob: Blob;
  updatedAt: number;
};

export function isStoredBackgroundImage(value: unknown): value is StoredBackgroundImage {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StoredBackgroundImage>;
  return (
    (record.theme === "light" || record.theme === "dark") &&
    typeof record.name === "string" &&
    record.name.trim().length > 0 &&
    typeof record.type === "string" &&
    typeof Blob !== "undefined" &&
    record.blob instanceof Blob &&
    typeof record.updatedAt === "number" &&
    Number.isFinite(record.updatedAt)
  );
}

function openBackgroundDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable in this webview."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Could not open background image storage."));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "theme" });
    };
    request.onsuccess = () => resolve(request.result);
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Background image storage request failed."));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const db = await openBackgroundDb();
  try {
    const tx = db.transaction(STORE_NAME, mode);
    const completion = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Background image storage transaction failed."));
      tx.onabort = () => reject(tx.error ?? new Error("Background image storage transaction was aborted."));
    });
    const result = await run(tx.objectStore(STORE_NAME));
    await completion;
    return result;
  } finally {
    db.close();
  }
}

export async function loadStoredBackground(theme: BackgroundTheme): Promise<StoredBackgroundImage | null> {
  return withStore("readonly", async (store) => {
    const value = await requestResult(store.get(theme));
    return isStoredBackgroundImage(value) ? value : null;
  });
}

export async function saveStoredBackground(theme: BackgroundTheme, file: File): Promise<StoredBackgroundImage> {
  const record: StoredBackgroundImage = {
    theme,
    name: file.name.trim() || `${theme}-background`,
    type: file.type,
    blob: file,
    updatedAt: Date.now(),
  };
  await withStore("readwrite", async (store) => {
    await requestResult(store.put(record));
  });
  return record;
}

export async function clearStoredBackground(theme: BackgroundTheme): Promise<void> {
  await withStore("readwrite", async (store) => {
    await requestResult(store.delete(theme));
  });
}
