import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Annotation, Book, ReadingProgress } from '../types'

interface StoredFile {
  id: string
  data: Blob | ArrayBuffer
  type: string
  name: string
}

interface StoredProgress {
  id: string
  progress: ReadingProgress
  lastOpenedAt: number
}

type StoredBook = Omit<Book, 'file' | 'cover' | 'progress' | 'lastOpenedAt'> & {
  lastOpenedAt?: number
  progress?: ReadingProgress
  // legacy records created before v2 stored the file and cover inline
  file?: Blob
  cover?: Blob | null
  coverData?: ArrayBuffer
  coverType?: string
}

interface MoyueDB extends DBSchema {
  books: {
    key: string
    value: StoredBook
    indexes: { 'by-last-opened': number; 'by-added': number }
  }
  files: {
    key: string
    value: StoredFile
  }
  progress: {
    key: string
    value: StoredProgress
  }
  annotations: {
    key: string
    value: Annotation
    indexes: { 'by-book': string; 'by-book-kind': [string, string] }
  }
}

let dbPromise: Promise<IDBPDatabase<MoyueDB>> | null = null

const getDB = () => {
  if (!dbPromise) {
    dbPromise = openDB<MoyueDB>('moyue-reader', 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('books')) {
          const books = db.createObjectStore('books', { keyPath: 'id' })
          books.createIndex('by-last-opened', 'lastOpenedAt')
          books.createIndex('by-added', 'addedAt')
        }
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('progress')) {
          db.createObjectStore('progress', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('annotations')) {
          const annotations = db.createObjectStore('annotations', { keyPath: 'id' })
          annotations.createIndex('by-book', 'bookId')
          annotations.createIndex('by-book-kind', ['bookId', 'kind'])
        }
      },
    })
  }
  return dbPromise
}

const toBlob = (data: Blob | ArrayBuffer, type: string) =>
  data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' })

const hydrateBook = (
  record: StoredBook,
  fileRecord?: StoredFile,
  progressRecord?: StoredProgress,
): Book | null => {
  let file: Blob | null = null
  if (record.file instanceof Blob) file = record.file
  else if (fileRecord) file = toBlob(fileRecord.data, fileRecord.type)
  if (!file) return null

  let cover: Blob | null = null
  if (record.cover instanceof Blob) cover = record.cover
  else if (record.coverData) {
    cover = new Blob([record.coverData], { type: record.coverType || 'image/jpeg' })
  }

  const progress: ReadingProgress = progressRecord?.progress
    ?? record.progress
    ?? { fraction: 0, updatedAt: record.addedAt }
  const lastOpenedAt = progressRecord?.lastOpenedAt ?? record.lastOpenedAt ?? 0

  const {
    file: _file, cover: _cover, progress: _progress, lastOpenedAt: _opened,
    coverData: _coverData, coverType: _coverType, ...metadata
  } = record

  return {
    ...metadata,
    file,
    cover,
    progress,
    lastOpenedAt,
  }
}

const sortBooks = (books: Book[]) => books.sort(
  (a, b) => (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt),
)

export const getAllBooks = async (): Promise<Book[]> => {
  const db = await getDB()
  const [records, files, progresses] = await Promise.all([
    db.getAll('books'),
    db.getAll('files'),
    db.getAll('progress'),
  ])
  const fileMap = new Map(files.map(record => [record.id, record]))
  const progressMap = new Map(progresses.map(record => [record.id, record]))
  const books: Book[] = []
  for (const record of records) {
    const book = hydrateBook(record, fileMap.get(record.id), progressMap.get(record.id))
    if (book) books.push(book)
  }
  return sortBooks(books)
}

export const getBook = async (id: string): Promise<Book | undefined> => {
  const db = await getDB()
  const [record, fileRecord, progressRecord] = await Promise.all([
    db.get('books', id),
    db.get('files', id),
    db.get('progress', id),
  ])
  return record ? hydrateBook(record, fileRecord, progressRecord) ?? undefined : undefined
}

const storeFile = async (db: IDBPDatabase<MoyueDB>, book: Book) => {
  const record: StoredFile = {
    id: book.id,
    data: book.file,
    type: book.file.type,
    name: book.fileName,
  }
  try {
    await db.put('files', record)
  } catch {
    // WebKit may refuse to store File/Blob values in IndexedDB.
    const data = await book.file.arrayBuffer()
    await db.put('files', { ...record, data })
  }
}

export const saveBook = async (book: Book): Promise<void> => {
  const db = await getDB()
  const { file: _file, cover, progress, lastOpenedAt, ...metadata } = book

  let coverData: ArrayBuffer | undefined
  let coverType: string | undefined
  if (cover) {
    try {
      coverData = await cover.arrayBuffer()
      coverType = cover.type || 'image/jpeg'
    } catch {
      /* cover is optional */
    }
  }

  await storeFile(db, book)

  const record: StoredBook = {
    ...metadata,
    lastOpenedAt,
    coverData,
    coverType,
  }
  try {
    const tx = db.transaction(['books', 'progress'], 'readwrite')
    await tx.objectStore('books').put(record)
    await tx.objectStore('progress').put({ id: book.id, progress, lastOpenedAt })
    await tx.done
  } catch (error) {
    await db.delete('files', book.id).catch(() => {})
    throw error
  }
}

/** Progress changes are small and frequent; never rewrite the book file for them. */
export const saveProgress = async (
  id: string,
  progress: ReadingProgress,
  lastOpenedAt: number,
): Promise<void> => {
  const db = await getDB()
  await db.put('progress', { id, progress, lastOpenedAt })
}

export const removeBook = async (id: string): Promise<void> => {
  const db = await getDB()
  const tx = db.transaction(['books', 'files', 'progress', 'annotations'], 'readwrite')
  await tx.objectStore('books').delete(id)
  await tx.objectStore('files').delete(id)
  await tx.objectStore('progress').delete(id)
  const index = tx.objectStore('annotations').index('by-book')
  let cursor = await index.openCursor(IDBKeyRange.only(id))
  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }
  await tx.done
}

export const getAnnotations = async (bookId: string): Promise<Annotation[]> => {
  const db = await getDB()
  const list = await db.getAllFromIndex('annotations', 'by-book', bookId)
  return list.sort((a, b) => a.createdAt - b.createdAt)
}

export const putAnnotation = async (annotation: Annotation): Promise<void> => {
  const db = await getDB()
  await db.put('annotations', annotation)
}

export const removeAnnotation = async (id: string): Promise<void> => {
  const db = await getDB()
  await db.delete('annotations', id)
}

export const findBookByFingerprint = async (
  fileName: string, fileSize: number,
): Promise<Book | undefined> => {
  const books = await getAllBooks()
  return books.find(book => book.fileName === fileName && book.fileSize === fileSize)
}
