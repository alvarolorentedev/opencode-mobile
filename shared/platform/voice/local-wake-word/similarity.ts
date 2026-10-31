export function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  if (length === 0) {
    return 0;
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < length; index++) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return 0;
  }
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

export function normalizeEmbedding(embedding: number[]): number[] {
  let magnitude = 0;
  for (const value of embedding) {
    magnitude += value * value;
  }
  if (magnitude === 0) {
    return embedding.map(() => 0);
  }
  const scale = Math.sqrt(magnitude);
  return embedding.map((value) => value / scale);
}

export function averageEmbeddings(embeddings: number[][]): number[] | undefined {
  const usable = embeddings.filter((embedding) => embedding.length > 0);
  if (usable.length === 0) {
    return undefined;
  }
  const dimension = usable[0].length;
  const total = new Array<number>(dimension).fill(0);
  for (const embedding of usable) {
    for (let index = 0; index < dimension; index++) {
      total[index] += embedding[index] ?? 0;
    }
  }
  return normalizeEmbedding(total.map((value) => value / usable.length));
}
