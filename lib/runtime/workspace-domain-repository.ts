import type { RequestContext } from "@/lib/runtime/context";

export type WorkspaceDomain = "CONTENT" | "DAILY_BRIEF" | "INDUSTRY_DISCOVERY" | "NEWSLETTER_EVIDENCE" | "AUDIENCE_HISTORY" | "SITEMAP_SNAPSHOT";
export type WorkspaceDomainRecord<T = unknown> = Readonly<{ key: string; value: T; updatedAt: string }>;

/** Runtime-neutral durable boundary for remaining workspace-owned collector state. */
export interface WorkspaceDomainRepository {
  get<T>(context: RequestContext, domain: WorkspaceDomain, key: string): Promise<WorkspaceDomainRecord<T> | null>;
  put<T>(context: RequestContext, domain: WorkspaceDomain, record: WorkspaceDomainRecord<T>): Promise<void>;
  delete(context: RequestContext, domain: WorkspaceDomain, key: string): Promise<void>;
  list<T>(context: RequestContext, domain: WorkspaceDomain): Promise<WorkspaceDomainRecord<T>[]>;
}

export type ContentRepository = WorkspaceDomainRepository;
export type DailyBriefRepository = WorkspaceDomainRepository;
export type IndustryDiscoveryRepository = WorkspaceDomainRepository;
export type NewsletterEvidenceRepository = WorkspaceDomainRepository;
export type AudienceHistoryRepository = WorkspaceDomainRepository;
export type SitemapSnapshotRepository = WorkspaceDomainRepository;
