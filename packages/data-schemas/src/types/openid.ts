import type { Document, Types } from 'mongoose';

export interface IOpenIdIdentityTombstone extends Document {
  _id: Types.ObjectId;
  openidIssuer: string;
  subjectHash: string;
  deletedUserId: Types.ObjectId;
  tenantId?: string;
  deletedAt: Date;
  createdAt?: Date;
  updatedAt?: Date;
}
