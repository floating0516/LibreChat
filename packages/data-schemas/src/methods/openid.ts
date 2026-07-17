import type { IUser, IOpenIdIdentityTombstone } from '~/types';
import { getTenantId, SYSTEM_TENANT_ID } from '~/config/tenantContext';
import { hashToken } from '~/crypto';

export type OpenIdIdentityInput = {
  openidId: string;
  openidIssuer: string;
  tenantId?: string;
};

export type CreateOpenIdIdentityTombstoneInput = OpenIdIdentityInput & {
  userId: string;
};

export type LinkOpenIdIdentityInput = OpenIdIdentityInput & {
  userId: string;
};

export type LinkOpenIdIdentityResult =
  | { status: 'linked'; user: IUser }
  | { status: 'already_linked'; user: IUser }
  | {
      status: 'identity_in_use' | 'identity_retired' | 'user_already_linked' | 'user_not_found';
    };

export type OpenIdIdentityMethods = {
  isOpenIdIdentityTombstoned: (input: OpenIdIdentityInput) => Promise<boolean>;
  createOpenIdIdentityTombstone: (
    input: CreateOpenIdIdentityTombstoneInput,
  ) => Promise<IOpenIdIdentityTombstone>;
  linkOpenIdIdentity: (input: LinkOpenIdIdentityInput) => Promise<LinkOpenIdIdentityResult>;
};

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

function resolveTenantId(tenantId: string | undefined): string | undefined {
  if (tenantId !== undefined) {
    return tenantId;
  }
  const contextTenantId = getTenantId();
  return contextTenantId === SYSTEM_TENANT_ID ? undefined : contextTenantId;
}

function tenantFilter(tenantId: string | undefined): { tenantId: string | null } {
  return { tenantId: tenantId ?? null };
}

function validateIdentity(input: OpenIdIdentityInput): void {
  if (!input.openidId.trim() || !input.openidIssuer.trim()) {
    throw new Error('OpenID subject and issuer are required');
  }
}

export function createOpenIdIdentityMethods(
  mongoose: typeof import('mongoose'),
): OpenIdIdentityMethods {
  async function getIdentityFilter(input: OpenIdIdentityInput) {
    validateIdentity(input);
    const tenantId = resolveTenantId(input.tenantId);
    return {
      openidIssuer: input.openidIssuer,
      subjectHash: await hashToken(input.openidId),
      ...tenantFilter(tenantId),
    };
  }

  async function isOpenIdIdentityTombstoned(input: OpenIdIdentityInput): Promise<boolean> {
    const Tombstone = mongoose.models.OpenIdIdentityTombstone;
    const filter = await getIdentityFilter(input);
    return (await Tombstone.exists(filter)) != null;
  }

  async function createOpenIdIdentityTombstone({
    userId,
    ...identity
  }: CreateOpenIdIdentityTombstoneInput): Promise<IOpenIdIdentityTombstone> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      throw new Error('A valid user ID is required for an OpenID identity tombstone');
    }

    const Tombstone = mongoose.models.OpenIdIdentityTombstone;
    const filter = await getIdentityFilter(identity);
    const existing = await Tombstone.findOne(filter).lean<IOpenIdIdentityTombstone>();
    if (existing) {
      if (existing.deletedUserId.toString() !== userId) {
        throw new Error('OpenID identity is already retired');
      }
      return existing;
    }

    try {
      const tombstone = await Tombstone.create({
        ...filter,
        tenantId: filter.tenantId ?? undefined,
        deletedUserId: userId,
        deletedAt: new Date(),
      });
      return tombstone.toObject() as IOpenIdIdentityTombstone;
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
      const raced = await Tombstone.findOne(filter).lean<IOpenIdIdentityTombstone>();
      if (!raced || raced.deletedUserId.toString() !== userId) {
        throw new Error('OpenID identity is already retired');
      }
      return raced;
    }
  }

  async function linkOpenIdIdentity({
    userId,
    ...identity
  }: LinkOpenIdIdentityInput): Promise<LinkOpenIdIdentityResult> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return { status: 'user_not_found' };
    }
    validateIdentity(identity);
    if (await isOpenIdIdentityTombstoned(identity)) {
      return { status: 'identity_retired' };
    }

    const User = mongoose.models.User;
    const current = await User.findById(userId).lean<IUser>();
    if (!current) {
      return { status: 'user_not_found' };
    }
    if (current.openidId) {
      const sameIdentity =
        current.openidId === identity.openidId && current.openidIssuer === identity.openidIssuer;
      return sameIdentity
        ? { status: 'already_linked', user: current }
        : { status: 'user_already_linked' };
    }

    let linked: IUser | null;
    try {
      linked = await User.findOneAndUpdate(
        {
          _id: userId,
          $or: [{ openidId: { $exists: false } }, { openidId: null }, { openidId: '' }],
        },
        {
          $set: {
            provider: 'openid',
            openidId: identity.openidId,
            openidIssuer: identity.openidIssuer,
          },
          $unset: { expiresAt: '' },
        },
        { new: true, runValidators: true },
      ).lean<IUser>();
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return { status: 'identity_in_use' };
      }
      throw error;
    }

    if (!linked) {
      return { status: 'user_already_linked' };
    }

    if (await isOpenIdIdentityTombstoned(identity)) {
      await User.updateOne(
        {
          _id: userId,
          openidId: identity.openidId,
          openidIssuer: identity.openidIssuer,
        },
        {
          $set: { provider: current.provider },
          $unset: { openidId: '', openidIssuer: '' },
        },
      );
      return { status: 'identity_retired' };
    }

    return { status: 'linked', user: linked };
  }

  return {
    isOpenIdIdentityTombstoned,
    createOpenIdIdentityTombstone,
    linkOpenIdIdentity,
  };
}
