/** A clock port so time is injectable and tests are deterministic. */
export interface Clock {
  now(): Date;
  isoNow(): string;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
  isoNow(): string {
    return new Date().toISOString();
  }
}

/** Deterministic clock for tests; advances only when told to. */
export class FixedClock implements Clock {
  private current: Date;
  constructor(start = "2026-01-01T00:00:00.000Z") {
    this.current = new Date(start);
  }
  now(): Date {
    return new Date(this.current);
  }
  isoNow(): string {
    return this.current.toISOString();
  }
  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
