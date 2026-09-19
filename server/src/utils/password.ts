/** 使用 bcrypt 生成口令哈希 */
export async function hashPassword(password: string) {
    return Bun.password.hash(password, { algorithm: 'bcrypt' })
}

/** 校验明文口令与 bcrypt 哈希是否匹配 */
export async function verifyPassword(password: string, hash: string) {
    return Bun.password.verify(password, hash)
}
