import { z } from 'zod'

const coordinateNumber = (min: number, max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.coerce.number().finite().min(min).max(max)
  )

export const coordinateSchema = z.object({
  lng: coordinateNumber(-180, 180),
  lat: coordinateNumber(-90, 90),
})

export const addressSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  city: z.string().trim().max(50).optional(),
})
