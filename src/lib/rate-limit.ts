interface Bucket {
  count: number;
  resetsAt: number;
}

const buckets = new Map<string, Bucket>();

export function consumeImportAttempt(key: string, limit = 8, windowMs = 60_000) {
  const now = Date.now();
  const existing = buckets.get(key);
  const bucket = !existing || existing.resetsAt <= now
    ? { count: 0, resetsAt: now + windowMs }
    : existing;
  bucket.count += 1;
  buckets.set(key, bucket);

  if (buckets.size > 2_000) {
    for (const [bucketKey, value] of buckets) {
      if (value.resetsAt <= now) buckets.delete(bucketKey);
    }
  }
  return {
    allowed: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetsAt - now) / 1000)),
  };
}
