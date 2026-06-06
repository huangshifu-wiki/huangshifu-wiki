export const runInBatches = async <T>(
  items: T[],
  batchSize: number,
  handler: (item: T) => Promise<void>
) => {
  for (let index = 0; index < items.length; index += batchSize) {
    await Promise.all(items.slice(index, index + batchSize).map(handler))
  }
}
