import { z } from 'zod'

const booleanSchema = z.preprocess(
  (value) =>
    value === true || value === 'true'
      ? true
      : value === false || value === 'false'
        ? false
        : value,
  z.boolean()
)

export const maintenanceTypeSchema = z.enum(['all', 'gallery', 'song', 'album'])
const modeSchema = z.enum(['dry-run', 'apply']).default('dry-run')
const cursorSchema = z.string().trim().min(1).max(1024).optional()
const batchSizeSchema = z.preprocess(
  (value) => (value === undefined ? 100 : Number(value)),
  z.number().int().min(1).max(100)
)
const olderThanHoursSchema = z.preprocess(
  (value) => (value === undefined ? 1 : Number(value)),
  z.number().finite().min(0).max(8760)
)

export const mediaMaintenanceBatchSchema = z.object({
  mode: modeSchema,
  cursor: cursorSchema,
  batchSize: batchSizeSchema,
  type: maintenanceTypeSchema.default('all'),
})

export const mediaMaintenanceScanQuerySchema = z.object({
  mode: z.enum(['strict', 'business']).default('strict'),
  limit: batchSizeSchema,
  type: maintenanceTypeSchema.default('all'),
})

export const mediaMaintenanceOrphanPreviewSchema = z.object({
  cursor: cursorSchema,
  batchSize: batchSizeSchema,
  olderThanHours: olderThanHoursSchema,
  includeVariants: booleanSchema.default(false),
})

export const mediaMaintenanceOrphanDeleteSchema = z
  .object({
    previewToken: z.string().trim().min(1).max(32768),
    storageKeys: z.array(z.string().min(1).max(512)).min(1).max(100),
  })
  .strict()
