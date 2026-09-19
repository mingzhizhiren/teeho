import sharp from 'sharp'

/** 标准化图片支持的输出格式。 */
export type NormalizedImageFormat = 'jpeg' | 'png' | 'webp'

/** 图片标准化参数。 */
export interface ImageNormalizationProfile {
    inputPixelLimit: number
    maxEdgePixels: number
    outputFormat: NormalizedImageFormat
    lossyQuality: number
}

/** 标准化后的图片及其元数据。 */
export interface NormalizedImage {
    mediaType: 'image/jpeg' | 'image/png' | 'image/webp'
    byteSize: number
    width: number
    height: number
    content: Uint8Array
}

const mediaTypes = {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
} as const

/** 按显式档位规范化一张已进入服务端处理边界的静态图片。 */
export async function normalizeImage(
    inputContent: Uint8Array,
    profile: ImageNormalizationProfile,
): Promise<NormalizedImage> {
    const sharpOptions = {
        failOn: 'warning' as const,
        limitInputPixels: profile.inputPixelLimit,
        sequentialRead: true,
    }
    const source = sharp(inputContent, sharpOptions)
    const metadata = await source.metadata()
    if (!metadata.width || !metadata.height) {
        throw new Error('IMAGE_NORMALIZATION_DECODE_FAILED')
    }
    await sharp(inputContent, sharpOptions).stats()

    let pipeline = sharp(inputContent, sharpOptions).rotate().toColourspace('srgb').resize({
        width: profile.maxEdgePixels,
        height: profile.maxEdgePixels,
        fit: 'inside',
        withoutEnlargement: true,
    })
    if (profile.outputFormat === 'jpeg') {
        pipeline = pipeline.jpeg({ quality: profile.lossyQuality })
    } else if (profile.outputFormat === 'webp') {
        pipeline = pipeline.webp({ quality: profile.lossyQuality })
    } else {
        pipeline = pipeline.png({ compressionLevel: 9 })
    }

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
    return {
        mediaType: mediaTypes[profile.outputFormat],
        byteSize: data.byteLength,
        width: info.width,
        height: info.height,
        content: new Uint8Array(data),
    }
}
