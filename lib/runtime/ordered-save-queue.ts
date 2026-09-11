export type SaveJob = () => Promise<void>;

/**
 * Runs persistence jobs in insertion order. A failed job remains at the head
 * until a later enqueue or an explicit retry starts another drain attempt.
 */
export class OrderedSaveQueue {
  private readonly jobs: SaveJob[] = [];
  private drainPromise: Promise<void> | null = null;

  get hasPending() {
    return this.jobs.length > 0;
  }

  enqueue(job: SaveJob) {
    this.jobs.push(job);
    return this.drain();
  }

  retry() {
    return this.drain();
  }

  private drain() {
    if (this.drainPromise) return this.drainPromise;
    if (this.jobs.length === 0) return Promise.resolve();

    this.drainPromise = this.runJobs().finally(() => {
      this.drainPromise = null;
    });
    return this.drainPromise;
  }

  private async runJobs() {
    while (this.jobs.length > 0) {
      await this.jobs[0]();
      this.jobs.shift();
    }
  }
}
