import { Model } from 'mongoose';
import type * as t from '~/types';
import { applyTenantIsolation } from '~/models/plugins/tenantIsolation';
import openIdIdentityTombstoneSchema from '~/schema/openid/tombstone';

export function createOpenIdIdentityTombstoneModel(
  mongoose: typeof import('mongoose'),
): Model<t.IOpenIdIdentityTombstone> {
  applyTenantIsolation(openIdIdentityTombstoneSchema);
  return (
    mongoose.models.OpenIdIdentityTombstone ||
    mongoose.model<t.IOpenIdIdentityTombstone>(
      'OpenIdIdentityTombstone',
      openIdIdentityTombstoneSchema,
    )
  );
}
