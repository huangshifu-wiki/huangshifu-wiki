import ExifReader from 'exifreader'

export interface GpsCoordinate {
  latitude: number
  longitude: number
}

export interface ImageGpsResult {
  file: File
  gps: GpsCoordinate | null
}

function convertGpsCoordinate(
  value: { numerator: number; denominator: number }[],
  ref: string
): number {
  if (!value || value.length < 3) {
    return 0
  }

  const degrees = value[0].numerator / value[0].denominator
  const minutes = value[1].numerator / value[1].denominator
  const seconds = value[2].numerator / value[2].denominator

  let decimal = degrees + minutes / 60 + seconds / 3600

  if (ref === 'S' || ref === 'W') {
    decimal = -decimal
  }

  return decimal
}

export async function extractGpsFromFile(file: File): Promise<GpsCoordinate | null> {
  try {
    const arrayBuffer = await file.arrayBuffer()
    const tags = ExifReader.load(arrayBuffer, { expanded: true })

    if (!tags.gps) {
      return null
    }

    const gpsTags = tags.gps as Record<string, unknown>
    const gpsLatitude = gpsTags.Latitude as unknown as { numerator: number; denominator: number }[]
    const gpsLongitude = gpsTags.Longitude as unknown as {
      numerator: number
      denominator: number
    }[]
    const latRef = (gpsTags.LatitudeRef as string) || 'N'
    const lngRef = (gpsTags.LongitudeRef as string) || 'E'

    if (!gpsLatitude || !gpsLongitude) {
      return null
    }

    const latitude = convertGpsCoordinate(gpsLatitude, latRef || 'N')
    const longitude = convertGpsCoordinate(gpsLongitude, lngRef || 'E')

    if (isNaN(latitude) || isNaN(longitude)) {
      return null
    }

    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return null
    }

    return { latitude, longitude }
  } catch (error) {
    console.error(`Failed to extract GPS from file ${file.name}:`, error)
    return null
  }
}

export async function extractGpsFromMultipleFiles(
  files: File[],
  onProgress?: (completed: number, total: number) => void
): Promise<ImageGpsResult[]> {
  const results: ImageGpsResult[] = []
  const total = files.length

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const gps = await extractGpsFromFile(file)

    results.push({
      file,
      gps,
    })

    if (onProgress) {
      onProgress(i + 1, total)
    }
  }

  return results
}

export function findMostFrequentGpsCoordinates(
  gpsResults: ImageGpsResult[],
  tolerance: number = 0.01
): GpsCoordinate | null {
  const validCoords = gpsResults.filter((r) => r.gps !== null).map((r) => r.gps!)

  if (validCoords.length === 0) {
    return null
  }

  if (validCoords.length === 1) {
    return validCoords[0]
  }

  interface CoordBucket {
    coord: GpsCoordinate
    count: number
  }

  const buckets: CoordBucket[] = []

  for (const coord of validCoords) {
    let found = false

    for (const bucket of buckets) {
      const latDiff = Math.abs(bucket.coord.latitude - coord.latitude)
      const lngDiff = Math.abs(bucket.coord.longitude - coord.longitude)

      if (latDiff < tolerance && lngDiff < tolerance) {
        bucket.count++
        found = true
        break
      }
    }

    if (!found) {
      buckets.push({ coord, count: 1 })
    }
  }

  buckets.sort((a, b) => b.count - a.count)
  return buckets[0].coord
}
