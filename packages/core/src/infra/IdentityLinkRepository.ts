import { eq, and } from 'drizzle-orm';
import type { Database } from './db.js';
import { identityLinks } from './schema.js';

export interface IdentityLink {
  readonly id: string;
  readonly tenantId: string;
  readonly externalId: string;
  readonly platformCustomerId: string;
  readonly createdAt: Date;
}

export class IdentityLinkRepository {
  constructor(private readonly db: Database) {}

  async create(
    tenantId: string,
    externalId: string,
    platformCustomerId: string,
  ): Promise<IdentityLink> {
    const [row] = await this.db
      .insert(identityLinks)
      .values({ tenantId, externalId, platformCustomerId })
      .returning();
    return row as IdentityLink;
  }

  async findByExternalId(tenantId: string, externalId: string): Promise<IdentityLink | null> {
    const [row] = await this.db
      .select()
      .from(identityLinks)
      .where(and(eq(identityLinks.tenantId, tenantId), eq(identityLinks.externalId, externalId)));
    return (row as IdentityLink) ?? null;
  }

  async findByPlatformId(
    tenantId: string,
    platformCustomerId: string,
  ): Promise<IdentityLink | null> {
    const [row] = await this.db
      .select()
      .from(identityLinks)
      .where(
        and(
          eq(identityLinks.tenantId, tenantId),
          eq(identityLinks.platformCustomerId, platformCustomerId),
        ),
      );
    return (row as IdentityLink) ?? null;
  }

  async deleteByTenant(id: string, tenantId: string): Promise<boolean> {
    const result = await this.db
      .delete(identityLinks)
      .where(and(eq(identityLinks.id, id), eq(identityLinks.tenantId, tenantId)))
      .returning();
    return result.length > 0;
  }
}
