export const analysisMediaCleanupConstraints = {
    batchSize: 100,
    maxBatches: 5,
    leaseSeconds: 2 * 60,
    maxPathLength: 1000,
    minimumSecretLength: 32,
    storageBucket: 'analysis-media',
} as const
