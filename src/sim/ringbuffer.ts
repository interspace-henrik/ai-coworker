/** Fixed-capacity FIFO. Pushing beyond capacity overwrites the oldest item. */
export class RingBuffer<T> {
  private items: (T | undefined)[];
  private start = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    this.items = new Array(capacity);
  }

  get length(): number {
    return this.count;
  }

  push(item: T): void {
    const end = (this.start + this.count) % this.capacity;
    this.items[end] = item;
    if (this.count < this.capacity) this.count++;
    else this.start = (this.start + 1) % this.capacity;
  }

  /** Item by age: 0 is the oldest. */
  get(index: number): T {
    return this.items[(this.start + index) % this.capacity] as T;
  }

  /** Item counted from the newest: 0 is the newest. */
  fromEnd(index: number): T {
    return this.get(this.count - 1 - index);
  }

  last(): T | undefined {
    return this.count ? this.fromEnd(0) : undefined;
  }

  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.count; i++) out.push(this.get(i));
    return out;
  }

  clear(): void {
    this.items = new Array(this.capacity);
    this.start = 0;
    this.count = 0;
  }
}
