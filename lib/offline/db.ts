import { DB_NAME, DB_VERSION, ALL_STORES, type StoreName, type PendingOperation } from "./constants"

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result
      for (const storeName of ALL_STORES) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: "id", autoIncrement: true })
        }
      }
    }
  })
}

export async function addPendingOperation(
  storeName: StoreName,
  operation: Omit<PendingOperation, "id" | "storeName">
): Promise<number> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite")
    const store = tx.objectStore(storeName)
    const request = store.add({ ...operation, storeName })

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result as number)
    tx.oncomplete = () => db.close()
  })
}

export async function getPendingOperations(storeName: StoreName): Promise<PendingOperation[]> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly")
    const store = tx.objectStore(storeName)
    const request = store.getAll()

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    tx.oncomplete = () => db.close()
  })
}

export async function getAllPendingOperations(): Promise<PendingOperation[]> {
  const db = await openDB()
  const allOps: PendingOperation[] = []

  for (const storeName of ALL_STORES) {
    if (db.objectStoreNames.contains(storeName)) {
      const ops = await new Promise<PendingOperation[]>((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly")
        const store = tx.objectStore(storeName)
        const request = store.getAll()
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
      })
      allOps.push(...ops)
    }
  }

  db.close()
  return allOps.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
}

export async function removePendingOperation(storeName: StoreName, id: number): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite")
    const store = tx.objectStore(storeName)
    const request = store.delete(id)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
    tx.oncomplete = () => db.close()
  })
}

export async function updatePendingOperation(
  storeName: StoreName,
  id: number,
  updates: Partial<PendingOperation>
): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite")
    const store = tx.objectStore(storeName)
    const getRequest = store.get(id)

    getRequest.onsuccess = () => {
      const existing = getRequest.result
      if (!existing) {
        reject(new Error(`Operation ${id} not found`))
        return
      }
      const putRequest = store.put({ ...existing, ...updates })
      putRequest.onerror = () => reject(putRequest.error)
      putRequest.onsuccess = () => resolve()
    }
    getRequest.onerror = () => reject(getRequest.error)
    tx.oncomplete = () => db.close()
  })
}

export async function getPendingCount(): Promise<number> {
  const db = await openDB()
  let total = 0

  for (const storeName of ALL_STORES) {
    if (db.objectStoreNames.contains(storeName)) {
      const count = await new Promise<number>((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly")
        const store = tx.objectStore(storeName)
        const request = store.count()
        request.onerror = () => reject(request.error)
        request.onsuccess = () => resolve(request.result)
      })
      total += count
    }
  }

  db.close()
  return total
}

export async function clearStore(storeName: StoreName): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite")
    const store = tx.objectStore(storeName)
    const request = store.clear()

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
    tx.oncomplete = () => db.close()
  })
}
