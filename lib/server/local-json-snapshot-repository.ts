import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { requireLegacyWorkspace, type RequestContext } from "@/lib/runtime/context";
import type { SnapshotRepository } from "@/lib/runtime/snapshot-repository";
import { writeFileAtomically } from "@/lib/sitemap";

export class LocalJsonSnapshotRepository<T> implements SnapshotRepository<T> {
  constructor(
    private readonly filePath: () => string,
    private readonly parse: (value: unknown) => T,
    private readonly empty: () => T,
    private readonly corruptMessage: string,
    private readonly readFailure: "throw" | "empty" = "throw",
  ) {}

  async read(context: RequestContext) {
    requireLegacyWorkspace(context);
    try {
      return this.parse(JSON.parse(await readFile(this.filePath(), "utf8")) as unknown);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || this.readFailure === "empty") return this.empty();
      throw new Error(this.corruptMessage, { cause: error });
    }
  }

  async write(context: RequestContext, value: T) {
    requireLegacyWorkspace(context);
    const target = this.filePath();
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFileAtomically(target, `${JSON.stringify(value, null, 2)}\n`);
  }
}
