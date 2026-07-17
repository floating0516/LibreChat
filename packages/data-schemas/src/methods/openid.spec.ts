import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { IUser, IOpenIdIdentityTombstone } from '~/types';
import openIdIdentityTombstoneSchema from '~/schema/openid/tombstone';
import userSchema from '~/schema/user';
import { createOpenIdIdentityMethods } from './openid';

let mongoServer: MongoMemoryServer | undefined;
let User: mongoose.Model<IUser>;
let Tombstone: mongoose.Model<IOpenIdIdentityTombstone>;
let methods: ReturnType<typeof createOpenIdIdentityMethods>;

beforeAll(async () => {
  const externalUri = process.env.OPENID_IDENTITY_TEST_MONGO_URI;
  if (externalUri) {
    await mongoose.connect(externalUri);
  } else {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }
  User = mongoose.models.User || mongoose.model<IUser>('User', userSchema);
  Tombstone =
    mongoose.models.OpenIdIdentityTombstone ||
    mongoose.model<IOpenIdIdentityTombstone>(
      'OpenIdIdentityTombstone',
      openIdIdentityTombstoneSchema,
    );
  await Promise.all([User.syncIndexes(), Tombstone.syncIndexes()]);
  methods = createOpenIdIdentityMethods(mongoose);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer?.stop();
});

beforeEach(async () => {
  await mongoose.connection.dropDatabase();
  await Promise.all([User.syncIndexes(), Tombstone.syncIndexes()]);
});

describe('OpenID identity methods', () => {
  const identity = {
    openidId: 'stable-api-account-subject',
    openidIssuer: 'https://api.lihe.chat',
  };

  it('links an existing local user without replacing its MongoDB identity', async () => {
    const user = await User.create({
      email: 'local@example.com',
      provider: 'local',
    });

    const result = await methods.linkOpenIdIdentity({
      ...identity,
      userId: user._id.toString(),
    });

    expect(result.status).toBe('linked');
    if (result.status !== 'linked') {
      throw new Error('Expected identity to be linked');
    }
    expect(result.user._id.toString()).toBe(user._id.toString());
    expect(result.user).toMatchObject({
      provider: 'openid',
      openidId: identity.openidId,
      openidIssuer: identity.openidIssuer,
    });
  });

  it('does not bind an identity already owned by another user', async () => {
    await User.create({
      email: 'owner@example.com',
      provider: 'openid',
      ...identity,
    });
    const target = await User.create({
      email: 'target@example.com',
      provider: 'local',
    });

    await expect(
      methods.linkOpenIdIdentity({ ...identity, userId: target._id.toString() }),
    ).resolves.toEqual({ status: 'identity_in_use' });

    const unchanged = await User.findById(target._id).lean<IUser>();
    expect(unchanged).toMatchObject({ provider: 'local' });
    expect(unchanged?.openidId).toBeUndefined();
  });

  it('stores only a subject hash and permanently blocks reuse after deletion', async () => {
    const deleted = await User.create({
      email: 'deleted@example.com',
      provider: 'openid',
      ...identity,
    });
    await methods.createOpenIdIdentityTombstone({
      ...identity,
      userId: deleted._id.toString(),
    });
    await User.deleteOne({ _id: deleted._id });

    const stored = await Tombstone.findOne().lean<IOpenIdIdentityTombstone>();
    expect(stored?.subjectHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(identity.openidId);
    await expect(methods.isOpenIdIdentityTombstoned(identity)).resolves.toBe(true);

    const replacement = await User.create({
      email: 'replacement@example.com',
      provider: 'local',
    });
    await expect(
      methods.linkOpenIdIdentity({ ...identity, userId: replacement._id.toString() }),
    ).resolves.toEqual({ status: 'identity_retired' });
  });

  it('treats creating the same tombstone for the same user as idempotent', async () => {
    const user = await User.create({
      email: 'idempotent@example.com',
      provider: 'openid',
      ...identity,
    });
    const input = { ...identity, userId: user._id.toString() };

    const first = await methods.createOpenIdIdentityTombstone(input);
    const second = await methods.createOpenIdIdentityTombstone(input);

    expect(second._id.toString()).toBe(first._id.toString());
    expect(await Tombstone.countDocuments()).toBe(1);
  });
});
