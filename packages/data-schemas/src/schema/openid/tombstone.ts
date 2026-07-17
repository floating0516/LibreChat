import mongoose, { Schema } from 'mongoose';
import type { IOpenIdIdentityTombstone } from '~/types';

const openIdIdentityTombstoneSchema: Schema<IOpenIdIdentityTombstone> =
  new Schema<IOpenIdIdentityTombstone>(
    {
      openidIssuer: {
        type: String,
        required: true,
      },
      subjectHash: {
        type: String,
        required: true,
        match: /^[0-9a-f]{64}$/,
      },
      deletedUserId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
      },
      tenantId: {
        type: String,
        index: true,
      },
      deletedAt: {
        type: Date,
        required: true,
        default: Date.now,
      },
    },
    { timestamps: true },
  );

openIdIdentityTombstoneSchema.index(
  { openidIssuer: 1, subjectHash: 1, tenantId: 1 },
  { unique: true },
);

export default openIdIdentityTombstoneSchema;
