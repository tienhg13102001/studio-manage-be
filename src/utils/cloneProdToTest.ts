import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config({ path: path.join(__dirname, '../..', '.env') });

const CLONE_BATCH_SIZE = 500;

const clearTargetDatabase = async (
  targetDb: mongoose.mongo.Db,
  targetDbName: string,
): Promise<boolean> => {
  try {
    await targetDb.dropDatabase();
    console.log(`Dropped target database before clone: ${targetDbName}`);
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`dropDatabase failed, falling back to per-collection cleanup: ${message}`);
  }

  const targetCollections = await targetDb.listCollections({}, { nameOnly: true }).toArray();
  for (const { name } of targetCollections) {
    if (!name || name.startsWith('system.')) continue;
    await targetDb.collection(name).deleteMany({});
    console.log(`Cleared target collection: ${name}`);
  }

  return false;
};

const getDbName = (uri: string): string => {
  try {
    const parsed = new URL(uri);
    return parsed.pathname.replace(/^\//, '') || 'test';
  } catch {
    return 'unknown';
  }
};

const cloneProdToTest = async (): Promise<void> => {
  const sourceUri = process.env.MONGO_URI_PROD;
  const targetUri = process.env.MONGO_URI;

  if (!sourceUri) {
    throw new Error('Missing MONGO_URI_PROD in backend/.env');
  }

  if (!targetUri) {
    throw new Error('Missing MONGO_URI in backend/.env');
  }

  if (sourceUri === targetUri) {
    throw new Error('MONGO_URI_PROD and MONGO_URI must be different.');
  }

  const sourceConn = await mongoose.createConnection(sourceUri).asPromise();
  const targetConn = await mongoose.createConnection(targetUri).asPromise();

  try {
    const sourceDb = sourceConn.db;
    const targetDb = targetConn.db;

    if (!sourceDb || !targetDb) {
      throw new Error('Unable to initialize source or target database connection.');
    }

    const sourceDbName = getDbName(sourceUri);
    const targetDbName = getDbName(targetUri);

    console.log(`Connected source database: ${sourceDbName}`);
    console.log(`Connected target database: ${targetDbName}`);

    if (sourceDbName === targetDbName) {
      console.warn('Warning: source and target database names are equal.');
    }

    const collections = await sourceDb.listCollections({}, { nameOnly: true }).toArray();

    const didDropDatabase = await clearTargetDatabase(targetDb, targetDbName);

    for (const { name } of collections) {
      if (!name || name.startsWith('system.')) continue;

      const sourceCollection = sourceDb.collection(name);
      const targetCollection = targetDb.collection(name);

      const indexes = await sourceCollection.indexes();
      const docs = await sourceCollection.find({}).toArray();

      if (docs.length > 0) {
        for (let i = 0; i < docs.length; i += CLONE_BATCH_SIZE) {
          const batch = docs.slice(i, i + CLONE_BATCH_SIZE);
          await targetCollection.insertMany(batch, { ordered: false });
        }
      }

      if (didDropDatabase) {
        for (const index of indexes) {
          if (index.name === '_id_') continue;

          const indexOptions: mongoose.mongo.CreateIndexesOptions = {
            name: index.name,
          };

          if (index.unique) indexOptions.unique = true;
          if (index.sparse) indexOptions.sparse = true;
          if (typeof index.expireAfterSeconds === 'number') {
            indexOptions.expireAfterSeconds = index.expireAfterSeconds;
          }
          if (index.partialFilterExpression) {
            indexOptions.partialFilterExpression = index.partialFilterExpression;
          }
          if (index.collation) {
            indexOptions.collation = index.collation;
          }
          if (index.weights) {
            indexOptions.weights = index.weights;
          }
          if (index.default_language) {
            indexOptions.default_language = index.default_language;
          }
          if (index.language_override) {
            indexOptions.language_override = index.language_override;
          }

          await targetCollection.createIndex(index.key, indexOptions);
        }
      }

      console.log(`Cloned collection ${name}: ${docs.length} documents`);
    }

    console.log('Clone completed successfully.');
  } finally {
    await Promise.all([sourceConn.close(), targetConn.close()]);
  }
};

cloneProdToTest()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Clone failed:', message);
    process.exit(1);
  });
