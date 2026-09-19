import { z, type ZodType } from 'zod'
import { supportsIndexedDB } from '@/utils/browserFeatures'
import { getUserEncryption, type EncryptedBinary } from '@/utils/userCrypto'

const databaseName = 'teeho-local-files'
const databaseVersion = 3
const fileStoreName = 'encrypted-files-v2'
const metadataStoreName = 'encrypted-file-metadata-v2'
const recordStoreName = 'encrypted-records-v3'
const ownerScopeIndexName = 'owner-scope'
const randomIdentifierRadix = 36
const randomIdentifierPrefixLength = 2

const storageEntryIdSchema = z.string().min(1)
const fileMetadataSchema = z.object({
    id: storageEntryIdSchema,
    name: z.string(),
    type: z.string(),
    size: z.number().int().nonnegative(),
    lastModified: z.number().int().nonnegative(),
    createdAt: z.number().int().nonnegative(),
})

/** IndexedDB 中的大文件元数据 */
export type LocalFileMetadata = z.infer<typeof fileMetadataSchema>

/** 从 IndexedDB 读取的本地文件 */
export interface LocalFile {
    metadata: LocalFileMetadata
    content: Blob
}

interface StoredEncryptedValue extends EncryptedBinary {
    storageId: string
    ownerScope: string
}

let databasePromise: Promise<IDBDatabase> | null = null

/** 把 IndexedDB 请求转换为 Promise */
function waitForRequest<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.addEventListener('success', () => resolve(request.result), { once: true })
        request.addEventListener(
            'error',
            () => reject(request.error ?? new Error('IndexedDB 请求失败')),
            { once: true },
        )
    })
}

/** 等待 IndexedDB 事务完成或失败 */
function waitForTransaction(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.addEventListener('complete', () => resolve(), { once: true })
        transaction.addEventListener(
            'abort',
            () => reject(transaction.error ?? new Error('IndexedDB 事务已中止')),
            { once: true },
        )
        transaction.addEventListener(
            'error',
            () => reject(transaction.error ?? new Error('IndexedDB 事务失败')),
            { once: true },
        )
    })
}

/** 通过游标读取对象仓库或索引的全部值 */
function readAllValues(
    source: IDBObjectStore | IDBIndex,
    query?: IDBValidKey | IDBKeyRange,
): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
        const values: unknown[] = []
        const request = source.openCursor(query)

        request.addEventListener('success', () => {
            const cursor = request.result
            if (!cursor) {
                resolve(values)
                return
            }

            values.push(cursor.value as unknown)
            cursor.continue()
        })
        request.addEventListener(
            'error',
            () => reject(request.error ?? new Error('无法读取 IndexedDB 数据')),
            { once: true },
        )
    })
}

/** 生成新的本地文件标识 */
function createFileId() {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }

    return `${Date.now()}-${Math.random()
        .toString(randomIdentifierRadix)
        .slice(randomIdentifierPrefixLength)}`
}

/** 校验 IndexedDB 中的加密记录结构 */
function parseStoredEncryptedValue(
    value: unknown,
    expectedStorageId?: string,
): StoredEncryptedValue | null {
    if (value === undefined) {
        return null
    }

    if (
        typeof value !== 'object' ||
        value === null ||
        !('storageId' in value) ||
        !('ownerScope' in value) ||
        !('version' in value) ||
        !('iv' in value) ||
        !('ciphertext' in value) ||
        typeof value.storageId !== 'string' ||
        typeof value.ownerScope !== 'string' ||
        value.version !== 1 ||
        !(value.iv instanceof ArrayBuffer) ||
        !(value.ciphertext instanceof ArrayBuffer) ||
        (expectedStorageId !== undefined && value.storageId !== expectedStorageId)
    ) {
        throw new Error('IndexedDB 加密数据无效')
    }

    return {
        storageId: value.storageId,
        ownerScope: value.ownerScope,
        version: 1,
        iv: value.iv,
        ciphertext: value.ciphertext,
    }
}

/** 组装可写入 IndexedDB 的加密记录 */
function createEncryptedRecord(
    storageId: string,
    ownerScope: string,
    encrypted: EncryptedBinary,
): StoredEncryptedValue {
    return { storageId, ownerScope, ...encrypted }
}

/** 打开并按当前版本升级本地 IndexedDB */
function openDatabase() {
    if (!supportsIndexedDB()) {
        return Promise.reject(new Error('当前浏览器不支持 IndexedDB'))
    }

    if (!databasePromise) {
        databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
            const request = window.indexedDB.open(databaseName, databaseVersion)

            request.addEventListener('upgradeneeded', () => {
                const database = request.result
                if (!database.objectStoreNames.contains(fileStoreName)) {
                    const fileStore = database.createObjectStore(fileStoreName, {
                        keyPath: 'storageId',
                    })
                    fileStore.createIndex(ownerScopeIndexName, 'ownerScope', { unique: false })
                }
                if (!database.objectStoreNames.contains(metadataStoreName)) {
                    const metadataStore = database.createObjectStore(metadataStoreName, {
                        keyPath: 'storageId',
                    })
                    metadataStore.createIndex(ownerScopeIndexName, 'ownerScope', {
                        unique: false,
                    })
                }
                if (!database.objectStoreNames.contains(recordStoreName)) {
                    const recordStore = database.createObjectStore(recordStoreName, {
                        keyPath: 'storageId',
                    })
                    recordStore.createIndex(ownerScopeIndexName, 'ownerScope', {
                        unique: false,
                    })
                }
            })
            request.addEventListener('success', () => {
                const database = request.result
                database.addEventListener('versionchange', () => {
                    database.close()
                    databasePromise = null
                })
                resolve(database)
            })
            request.addEventListener(
                'error',
                () => reject(request.error ?? new Error('无法打开 IndexedDB')),
                { once: true },
            )
            request.addEventListener(
                'blocked',
                () => reject(new Error('IndexedDB 升级被其他页面阻止')),
                { once: true },
            )
        }).catch((error: unknown) => {
            databasePromise = null
            throw error
        })
    }

    return databasePromise
}

/** 按 Auth 用户 ID 分区并加密存取 IndexedDB 大文件 */
export class IndexedDbFileManager {
    private readonly userId: string
    private readonly ownerScopePromise: Promise<string>

    /**
     * 创建绑定到指定 Auth 用户分区的加密 IndexedDB 管理器。
     * @param userId Supabase Auth 验证后的用户 ID
     */
    constructor(userId: string) {
        this.userId = z.string().min(1).parse(userId)
        this.ownerScopePromise = getUserEncryption().getUserScope(this.userId)
    }

    /** 生成当前用户范围内的存储身份 */
    private async getStorageIdentity(id: string) {
        const validId = storageEntryIdSchema.parse(id)
        const ownerScope = await this.ownerScopePromise
        return {
            id: validId,
            ownerScope,
            storageId: `${ownerScope}:${validId}`,
        }
    }

    /** 读取、解密并校验当前用户的记录列表 */
    private async listEncryptedValues<T>(
        storeName: string,
        associatedDataNamespace: 'metadata' | 'record',
        schema: ZodType<T>,
        ownershipError: string,
        idPrefix?: string,
    ): Promise<T[]> {
        const ownerScope = await this.ownerScopePromise
        const database = await openDatabase()
        const transaction = database.transaction(storeName, 'readonly')
        const transactionDone = waitForTransaction(transaction)
        const [values] = await Promise.all([
            readAllValues(
                transaction.objectStore(storeName).index(ownerScopeIndexName),
                ownerScope,
            ),
            transactionDone,
        ])
        const encryption = getUserEncryption()

        const pendingValues = values.flatMap((value) => {
                const storedValue = parseStoredEncryptedValue(value)
                if (!storedValue || storedValue.ownerScope !== ownerScope) {
                    throw new Error(ownershipError)
                }

                if (
                    idPrefix !== undefined &&
                    !storedValue.storageId.startsWith(`${ownerScope}:${idPrefix}`)
                ) {
                    return []
                }

                return [
                    encryption
                        .decrypt(
                            this.userId,
                            storedValue,
                            `indexedDB:${associatedDataNamespace}:${storedValue.storageId}`,
                        )
                        .then((decrypted) =>
                            schema.parse(
                                JSON.parse(new TextDecoder().decode(decrypted)) as unknown,
                            ),
                        ),
                ]
            })
        return Promise.all(pendingValues)
    }

    /** 按用户分区清理一个或多个对象仓库 */
    private async clearOwnedStores(indexedStoreName: string, storeNames: string[]): Promise<void> {
        const ownerScope = await this.ownerScopePromise
        const database = await openDatabase()
        const readTransaction = database.transaction(indexedStoreName, 'readonly')
        const readDone = waitForTransaction(readTransaction)
        const keysRequest = readTransaction
            .objectStore(indexedStoreName)
            .index(ownerScopeIndexName)
            .getAllKeys(ownerScope)
        const [storageIds] = await Promise.all([waitForRequest(keysRequest), readDone])
        if (storageIds.length === 0) {
            return
        }

        const writeTransaction = database.transaction(storeNames, 'readwrite')
        const writeDone = waitForTransaction(writeTransaction)
        storageIds.forEach((storageId) => {
            storeNames.forEach((storeName) => {
                writeTransaction.objectStore(storeName).delete(storageId)
            })
        })
        await writeDone
    }

    /** 保存当前账号的加密文件；可传入稳定 id 覆盖同一文件 */
    async saveFile(file: File, id = createFileId()): Promise<LocalFileMetadata> {
        if (!(file instanceof File)) {
            throw new TypeError('file 必须是 File 对象')
        }

        const identity = await this.getStorageIdentity(id)
        const metadata = fileMetadataSchema.parse({
            id: identity.id,
            name: file.name,
            type: file.type,
            size: file.size,
            lastModified: file.lastModified,
            createdAt: Date.now(),
        })
        const encryption = getUserEncryption()
        const [encryptedFile, encryptedMetadata, database] = await Promise.all([
            encryption.encrypt(
                this.userId,
                await file.arrayBuffer(),
                `indexedDB:file:${identity.storageId}`,
            ),
            encryption.encrypt(
                this.userId,
                new TextEncoder().encode(JSON.stringify(metadata)).buffer,
                `indexedDB:metadata:${identity.storageId}`,
            ),
            openDatabase(),
        ])
        const transaction = database.transaction(
            [fileStoreName, metadataStoreName],
            'readwrite',
        )
        const transactionDone = waitForTransaction(transaction)

        transaction
            .objectStore(fileStoreName)
            .put(createEncryptedRecord(identity.storageId, identity.ownerScope, encryptedFile))
        transaction
            .objectStore(metadataStoreName)
            .put(createEncryptedRecord(identity.storageId, identity.ownerScope, encryptedMetadata))
        await transactionDone
        return metadata
    }

    /** 按 id 解密当前账号的单个文件；不存在时返回 null */
    async getFile(id: string): Promise<LocalFile | null> {
        const identity = await this.getStorageIdentity(id)
        const database = await openDatabase()
        const transaction = database.transaction([fileStoreName, metadataStoreName], 'readonly')
        const transactionDone = waitForTransaction(transaction)
        const fileRequest = transaction.objectStore(fileStoreName).get(identity.storageId)
        const metadataRequest = transaction.objectStore(metadataStoreName).get(identity.storageId)
        const [fileValue, metadataValue] = await Promise.all([
            waitForRequest<unknown>(fileRequest),
            waitForRequest<unknown>(metadataRequest),
            transactionDone,
        ])
        const storedFile = parseStoredEncryptedValue(fileValue, identity.storageId)
        const storedMetadata = parseStoredEncryptedValue(metadataValue, identity.storageId)
        if (!storedFile || !storedMetadata) {
            return null
        }

        const encryption = getUserEncryption()
        const [fileContent, metadataContent] = await Promise.all([
            encryption.decrypt(
                this.userId,
                storedFile,
                `indexedDB:file:${identity.storageId}`,
            ),
            encryption.decrypt(
                this.userId,
                storedMetadata,
                `indexedDB:metadata:${identity.storageId}`,
            ),
        ])
        const metadata = fileMetadataSchema.parse(
            JSON.parse(new TextDecoder().decode(metadataContent)) as unknown,
        )
        if (fileContent.byteLength !== metadata.size) {
            throw new Error('IndexedDB 文件大小与元数据不一致')
        }

        return {
            metadata,
            content: new Blob([fileContent], { type: metadata.type }),
        }
    }

    /** 只解密当前账号的文件列表元数据，不读取文件内容 */
    async listFiles(): Promise<LocalFileMetadata[]> {
        return this.listEncryptedValues(
            metadataStoreName,
            'metadata',
            fileMetadataSchema,
            'IndexedDB 文件元数据不属于当前账号',
        )
    }

    /** 删除当前账号的指定文件及其元数据 */
    async deleteFile(id: string): Promise<void> {
        const identity = await this.getStorageIdentity(id)
        const database = await openDatabase()
        const transaction = database.transaction(
            [fileStoreName, metadataStoreName],
            'readwrite',
        )
        const transactionDone = waitForTransaction(transaction)

        transaction.objectStore(fileStoreName).delete(identity.storageId)
        transaction.objectStore(metadataStoreName).delete(identity.storageId)
        await transactionDone
    }

    /** 只清空当前账号的全部加密文件 */
    async clearFiles(): Promise<void> {
        await this.clearOwnedStores(metadataStoreName, [fileStoreName, metadataStoreName])
    }

    /** 加密保存当前账号的结构化记录；相同 id 会被覆盖 */
    async saveRecord<T>(id: string, value: T): Promise<void> {
        const identity = await this.getStorageIdentity(id)
        const serializedValue = JSON.stringify(value)
        if (serializedValue === undefined) {
            throw new TypeError('IndexedDB 记录必须可以序列化为 JSON')
        }

        const [encrypted, database] = await Promise.all([
            getUserEncryption().encrypt(
                this.userId,
                new TextEncoder().encode(serializedValue).buffer,
                `indexedDB:record:${identity.storageId}`,
            ),
            openDatabase(),
        ])
        const transaction = database.transaction(recordStoreName, 'readwrite')
        const transactionDone = waitForTransaction(transaction)
        transaction
            .objectStore(recordStoreName)
            .put(createEncryptedRecord(identity.storageId, identity.ownerScope, encrypted))
        await transactionDone
    }

    /** 解密并校验当前账号的单条结构化记录 */
    async getRecord<T>(id: string, schema: ZodType<T>): Promise<T | null> {
        const identity = await this.getStorageIdentity(id)
        const database = await openDatabase()
        const transaction = database.transaction(recordStoreName, 'readonly')
        const transactionDone = waitForTransaction(transaction)
        const request = transaction.objectStore(recordStoreName).get(identity.storageId)
        const [value] = await Promise.all([waitForRequest<unknown>(request), transactionDone])
        const storedRecord = parseStoredEncryptedValue(value, identity.storageId)
        if (!storedRecord) {
            return null
        }
        if (storedRecord.ownerScope !== identity.ownerScope) {
            throw new Error('IndexedDB 记录不属于当前账号')
        }

        const decrypted = await getUserEncryption().decrypt(
            this.userId,
            storedRecord,
            `indexedDB:record:${identity.storageId}`,
        )
        return schema.parse(JSON.parse(new TextDecoder().decode(decrypted)) as unknown)
    }

    /** 只列出并解密当前账号的结构化记录 */
    async listRecords<T>(schema: ZodType<T>, idPrefix?: string): Promise<T[]> {
        return this.listEncryptedValues(
            recordStoreName,
            'record',
            schema,
            'IndexedDB 记录不属于当前账号',
            idPrefix,
        )
    }

    /** 删除当前账号的指定结构化记录 */
    async deleteRecord(id: string): Promise<void> {
        const identity = await this.getStorageIdentity(id)
        const database = await openDatabase()
        const transaction = database.transaction(recordStoreName, 'readwrite')
        const transactionDone = waitForTransaction(transaction)
        transaction.objectStore(recordStoreName).delete(identity.storageId)
        await transactionDone
    }

    /** 只清空当前账号的全部结构化记录 */
    async clearRecords(): Promise<void> {
        await this.clearOwnedStores(recordStoreName, [recordStoreName])
    }
}

/** 关闭当前页面持有的 IndexedDB 连接 */
export async function closeIndexedDbFileDatabase() {
    if (databasePromise) {
        const database = await databasePromise
        database.close()
        databasePromise = null
    }
}
