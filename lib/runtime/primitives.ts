export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  generate(): string;
}

export const systemClock: Clock = { now: () => new Date() };
export const webIdGenerator: IdGenerator = { generate: () => crypto.randomUUID() };
