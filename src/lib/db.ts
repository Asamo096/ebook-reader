import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Annotation, Book } from '../types'

interface MoyueDB extends DBSchema {
  books: {
    key: string
    value: Book
    indexes: { 'by-last-opened': number; 'by-added': number }
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
    dbPromise = openDB<MoyueDB>('moyue-reader', 1, {
      upgrade(db) {
        const books = db.createObjectStore('books', { keyPath: 'id' })
        books.createIndex('by-last-opened', 'lastOpenedAt')
        books.createIndex('by-added', 'addedAt')
        const annotations = db.createObjectStore('annotations', { keyPath: 'id' })
        annotations.createIndex('by-book', 'bookId')
        annotations.createIndex('by-book-kind', ['bookId', 'kind'])
      },
    })
  }
  return dbPromise
}

export const getAllBooks = async (): Promise<Book[]> => {
  const db = await getDB()
  const books = await db.getAll('books')
  return books.sort((a, b) => (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt))
}

export const getBook = async (id: string): Promise<Book | undefined> => {
  const db = await getDB()
  return db.get('books', id)
}

export const putBook = async (book: Book): Promise<void> => {
  const db = await getDB()
  await db.put('books', book)
}

export const removeBook = async (id: string): Promise<void> => {
  const db = await getDB()
  const tx = db.transaction(['books', 'annotations'], 'readwrite')
  await tx.objectStore('books').delete(id)
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
