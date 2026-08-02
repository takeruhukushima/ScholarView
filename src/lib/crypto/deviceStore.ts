"use client";

// Device envelope: wraps the VMK with a NON-EXTRACTABLE WebCrypto AES-GCM key
// stored in IndexedDB. This gives zero-input auto-unlock on this device while
// keeping the raw VMK off disk (the wrapping key cannot be exported).

const DB_NAME = "scholarview-vault";
const DB_VERSION = 1;
const STORE = "device";

interface DeviceRecord {
  did: string;
  deviceKey: CryptoKey; // non-extractable AES-GCM key (structured-cloned into IDB)
  iv: ArrayBuffer;
  wrappedVmk: ArrayBuffer;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "did" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open vault DB"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

async function getRecord(did: string): Promise<DeviceRecord | null> {
  const db = await openDb();
  try {
    const tx = db.transaction([STORE], "readonly");
    const record = (await requestToPromise(tx.objectStore(STORE).get(did))) as
      | DeviceRecord
      | undefined;
    return record ?? null;
  } finally {
    db.close();
  }
}

// Store the VMK on this device, wrapped by a fresh non-extractable device key.
export async function saveDeviceEnvelope(did: string, vmk: Uint8Array): Promise<void> {
  const deviceKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false, // non-extractable
    ["encrypt", "decrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappedVmk = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    deviceKey,
    vmk as unknown as BufferSource,
  );

  const db = await openDb();
  try {
    const tx = db.transaction([STORE], "readwrite");
    await requestToPromise(
      tx.objectStore(STORE).put({
        did,
        deviceKey,
        iv: iv.buffer,
        wrappedVmk,
      } satisfies DeviceRecord),
    );
  } finally {
    db.close();
  }
}

// Returns the VMK if this device already has an envelope, else null.
export async function loadVmkFromDevice(did: string): Promise<Uint8Array | null> {
  const record = await getRecord(did);
  if (!record) return null;
  try {
    const vmk = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(record.iv) },
      record.deviceKey,
      record.wrappedVmk,
    );
    return new Uint8Array(vmk);
  } catch {
    return null;
  }
}

export async function hasDeviceEnvelope(did: string): Promise<boolean> {
  return (await getRecord(did)) !== null;
}

export async function clearDeviceEnvelope(did: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction([STORE], "readwrite");
    await requestToPromise(tx.objectStore(STORE).delete(did));
  } finally {
    db.close();
  }
}
