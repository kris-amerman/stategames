export class SeededRandom {
  private state: number;

  constructor(seed: string | number | null | undefined) {
    this.state = SeededRandom.normalizeSeed(seed);
  }

  static normalizeSeed(seed: string | number | null | undefined): number {
    if (seed === null || seed === undefined) {
      return Math.floor(Math.random() * 0xffffffff) || 1;
    }
    if (typeof seed === 'number' && Number.isFinite(seed)) {
      const n = seed % 0xffffffff;
      return (n >>> 0) || 1;
    }
    const str = String(seed);
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) || 1;
  }

  next(): number {
    this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0;
    return this.state / 0xffffffff;
  }

  nextInt(max: number): number {
    if (max <= 0) return 0;
    return Math.floor(this.next() * max);
  }

  nextRange(min: number, max: number): number {
    if (max <= min) return min;
    return min + this.next() * (max - min);
  }

  nextBoolean(): boolean {
    return this.next() < 0.5;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new Error('Cannot pick from empty collection');
    }
    return items[this.nextInt(items.length)];
  }

  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}
