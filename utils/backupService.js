const { MongoClient, ObjectId } = require('mongodb');
const { put, list, download, del } = require('@vercel/blob');

let fetch;
try {
  fetch = globalThis.fetch || require('node-fetch');
} catch (error) {
  console.warn('Could not import fetch, falling back to https module');
}

const https = require('https');

console.log('Vercel Blob exports:', { put, list, download, del });
console.log('Fetch available:', !!fetch);

class BackupService {
  constructor() {
    this.client = null;
    this.mongoUri = process.env.MONGO_URI || 'mongodb+srv://zuhooruddin055:HCCCDKtAhIzEnWKW@cluster0.qizf2vq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
    if (!this.mongoUri) {
      throw new Error('MONGO_URI is not defined in environment variables');
    }

    this.objectIdFields = ['_id', 'customerId', 'userId', 'shopId', 'transactionId'];
    this.dateFields = ['date', 'dueDate', 'createdAt', 'updatedAt', 'timestamp'];
    this.BACKUP_RETENTION_DAYS = 7;
  }

  async connect() {
    if (!this.client) {
      this.client = new MongoClient(this.mongoUri);
      await this.client.connect();
      console.log('Connected to MongoDB');
    }
    return this.client;
  }

  isValidObjectId(str) {
    return typeof str === 'string' && /^[0-9a-fA-F]{24}$/.test(str);
  }

  isValidDate(value) {
    return value instanceof Date && !isNaN(value.getTime());
  }

  convertObjectIdsForBackup(obj) {
    if (obj === null || obj === undefined) return obj;

    if (Array.isArray(obj)) {
      return obj.map(item => this.convertObjectIdsForBackup(item));
    }

    if (typeof obj === 'object') {
      if (obj instanceof ObjectId) {
        return { __objectId: obj.toString() };
      }

      if (obj instanceof Date) {
        return { __date: obj.toISOString() };
      }

      const converted = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value instanceof ObjectId) {
          converted[key] = { __objectId: value.toString() };
        } else if (value instanceof Date) {
          converted[key] = { __date: value.toISOString() };
        } else if (value === null || value === undefined) {
          converted[key] = value;
        } else if (typeof value === 'object') {
          converted[key] = this.convertObjectIdsForBackup(value);
        } else {
          converted[key] = value;
        }
      }
      return converted;
    }

    return obj;
  }

  convertObjectIdsForRestore(obj) {
    if (obj === null || obj === undefined) return obj;

    if (Array.isArray(obj)) {
      return obj.map(item => this.convertObjectIdsForRestore(item));
    }

    if (typeof obj === 'object') {
      if (obj.__objectId && typeof obj.__objectId === 'string') {
        try {
          return new ObjectId(obj.__objectId);
        } catch (error) {
          console.warn('Invalid ObjectId format:', obj.__objectId);
          return obj.__objectId;
        }
      }

      if (obj.__date && typeof obj.__date === 'string') {
        try {
          return new Date(obj.__date);
        } catch (error) {
          console.warn('Invalid Date format:', obj.__date);
          return obj.__date;
        }
      }

      const converted = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value && typeof value === 'object' && value.__objectId) {
          try {
            converted[key] = new ObjectId(value.__objectId);
          } catch (error) {
            console.warn(`Invalid ObjectId for field ${key}:`, value.__objectId);
            converted[key] = value.__objectId;
          }
        } else if (value && typeof value === 'object' && value.__date) {
          try {
            converted[key] = new Date(value.__date);
          } catch (error) {
            console.warn(`Invalid Date for field ${key}:`, value.__date);
            converted[key] = value.__date;
          }
        } else if (this.objectIdFields.includes(key) && typeof value === 'string' && this.isValidObjectId(value)) {
          try {
            converted[key] = new ObjectId(value);
          } catch (error) {
            console.warn(`Could not convert ${key} to ObjectId:`, value);
            converted[key] = value;
          }
        } else if (this.dateFields.includes(key) && typeof value === 'string') {
          try {
            const dateValue = new Date(value);
            if (this.isValidDate(dateValue)) {
              converted[key] = dateValue;
            } else {
              converted[key] = value;
            }
          } catch (error) {
            console.warn(`Could not convert ${key} to Date:`, value);
            converted[key] = value;
          }
        } else if (value === null || value === undefined) {
          converted[key] = value;
        } else if (typeof value === 'object') {
          converted[key] = this.convertObjectIdsForRestore(value);
        } else {
          converted[key] = value;
        }
      }
      return converted;
    }

    return obj;
  }

  async createBackup(shopId = null) {
    try {
      const client = await this.connect();
      const db = client.db();
      const collections = await db.listCollections().toArray();
      const backup = {
        timestamp: new Date().toISOString(),
        database: db.databaseName,
        shopId: shopId || 'all',
        collections: {},
      };

      console.log('Creating backup for collections:', collections.map(c => c.name), `shopId: ${shopId || 'all'}`);

      for (const collection of collections) {
        const collectionName = collection.name;
        const query = collectionName !== 'shops' && shopId ? { shopId: new ObjectId(shopId) } : {};
        const data = await db.collection(collectionName).find(query).toArray();
        console.log(`Backing up collection ${collectionName}: ${data.length} documents`);

        if (data.length > 0 && collectionName === 'transactions') {
          console.log(`Sample transaction before backup conversion:`, JSON.stringify(data[0], null, 2));
        }

        const convertedData = this.convertObjectIdsForBackup(data);
        backup.collections[collectionName] = convertedData;

        if (convertedData.length > 0 && collectionName === 'transactions') {
          console.log(`Sample transaction after backup conversion:`, JSON.stringify(convertedData[0], null, 2));
        }
      }

      console.log('Backup created successfully');
      return backup;
    } catch (error) {
      console.error('Backup creation failed:', error);
      throw new Error(`Failed to create backup: ${error.message}`);
    }
  }

  async restoreBackup(backupData, shopId = null) {
    try {
      const client = await this.connect();
      const db = client.db();

      console.log('Starting database restoration for shopId:', shopId || 'all');

      // Clear shop-specific collections if shopId is provided, else clear all
      const existingCollections = await db.listCollections().toArray();
      for (const collection of existingCollections) {
        const collectionName = collection.name;
        if (collectionName === 'shops' && shopId) continue; // Don't clear shops collection for shop-specific restore
        const query = collectionName !== 'shops' && shopId ? { shopId: new ObjectId(shopId) } : {};
        console.log(`Clearing collection: ${collectionName} for shopId: ${shopId || 'all'}`);
        await db.collection(collectionName).deleteMany(query);
      }

      // Restore data
      for (const [collectionName, data] of Object.entries(backupData.collections)) {
        if (data && data.length > 0) {
          console.log(`Restoring collection ${collectionName}: ${data.length} documents`);

          if (collectionName === 'transactions') {
            console.log(`Sample transaction before restore conversion:`, JSON.stringify(data[0], null, 2));
          }

          const restoredData = this.convertObjectIdsForRestore(data);

          if (restoredData.length > 0) {
            console.log(`Sample restored document from ${collectionName}:`, JSON.stringify(restoredData[0], null, 2));
            if (collectionName === 'transactions') {
              console.log(`Transaction dueDate value:`, restoredData[0].dueDate);
              console.log(`Transaction dueDate type:`, typeof restoredData[0].dueDate);
            }
          }

          // Filter data for shopId if provided
          const dataToInsert = shopId && collectionName !== 'shops'
            ? restoredData.filter(doc => doc.shopId && doc.shopId.toString() === shopId)
            : restoredData;

          if (dataToInsert.length > 0) {
            await db.collection(collectionName).insertMany(dataToInsert);
          }
        }
      }

      console.log('Database restoration completed successfully');
      return { success: true, message: 'Database restored successfully' };
    } catch (error) {
      console.error('Restore failed:', error);
      throw new Error(`Failed to restore database: ${error.message}`);
    } finally {
      await this.disconnect();
    }
  }

  async uploadBackupToVercel(backupData) {
    try {
      const backupBuffer = Buffer.from(JSON.stringify(backupData));
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const shopId = backupData.shopId || 'all';
      const fileName = `backups/backup_${shopId}_${timestamp}.json`;

      console.log('Saving backup to Vercel Blob:', fileName);
      const { url } = await put(fileName, backupBuffer, {
        access: 'public',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        addRandomSuffix: true,
      });

      console.log(`Backup uploaded successfully to ${url}`);
      return { url, fileName }; // Return both URL and filename
    } catch (error) {
      console.error('Failed to upload backup:', error);
      throw new Error(`Failed to upload backup: ${error.message}`);
    }
  }

  async listBackups(shopId = null) {
    try {
      const prefix = shopId ? `backups/backup_${shopId}_` : 'backups/';
      console.log('Listing blobs with prefix:', prefix);
      const { blobs } = await list({
        prefix,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.BACKUP_RETENTION_DAYS);

      const validBackups = blobs.filter(blob => {
        const blobDate = new Date(blob.uploadedAt);
        return blobDate >= cutoffDate;
      });

      console.log(`Found ${validBackups.length} valid backups`);
      return validBackups.map(blob => ({
        url: blob.url,
        uploadedAt: blob.uploadedAt,
        size: blob.size,
        shopId: blob.pathname.includes('_all_') ? 'all' : blob.pathname.split('_')[1],
        filename: blob.pathname.split('/').pop(),
      }));
    } catch (error) {
      console.error('Error listing backups:', error);
      throw new Error(`Failed to list backups: ${error.message}`);
    }
  }

  async deleteOldBackups() {
    try {
      console.log(`Starting cleanup of backups older than ${this.BACKUP_RETENTION_DAYS} days`);
      const { blobs } = await list({
        prefix: 'backups/',
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.BACKUP_RETENTION_DAYS);

      const backupsToDelete = blobs.filter(blob => {
        const blobDate = new Date(blob.uploadedAt);
        return blobDate < cutoffDate;
      });

      if (backupsToDelete.length === 0) {
        console.log('No old backups found to delete');
        return { deleted: 0, message: 'No old backups to delete' };
      }

      console.log(`Found ${backupsToDelete.length} backups to delete`);
      const deletionResults = [];
      for (const blob of backupsToDelete) {
        try {
          console.log(`Deleting backup: ${blob.pathname} (created: ${blob.uploadedAt})`);
          await del(blob.url, {
            token: process.env.BLOB_READ_WRITE_TOKEN,
          });
          deletionResults.push({
            filename: blob.pathname.split('/').pop(),
            success: true,
            createdAt: blob.uploadedAt,
          });
        } catch (deleteError) {
          console.error(`Failed to delete backup ${blob.pathname}:`, deleteError);
          deletionResults.push({
            filename: blob.pathname.split('/').pop(),
            success: false,
            error: deleteError.message,
            createdAt: blob.uploadedAt,
          });
        }
      }

      const successfulDeletions = deletionResults.filter(result => result.success);
      const failedDeletions = deletionResults.filter(result => !result.success);

      console.log(`Backup cleanup completed: ${successfulDeletions.length} deleted, ${failedDeletions.length} failed`);
      return {
        deleted: successfulDeletions.length,
        failed: failedDeletions.length,
        results: deletionResults,
        message: `Deleted ${successfulDeletions.length} old backups`,
      };
    } catch (error) {
      console.error('Error during backup cleanup:', error);
      throw new Error(`Failed to clean up old backups: ${error.message}`);
    }
  }

  async deleteBackup(filename) {
    try {
      console.log(`Deleting specific backup: ${filename}`);
      const { blobs } = await list({ prefix: `backups/${filename}`, limit: 1 });
      if (!blobs || blobs.length === 0) {
        throw new Error(`Backup file ${filename} not found`);
      }

      const blob = blobs[0];
      await del(blob.url, {
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });

      console.log(`Successfully deleted backup: ${filename}`);
      return { success: true, message: `Backup ${filename} deleted successfully` };
    } catch (error) {
      console.error(`Error deleting backup ${filename}:`, error);
      throw new Error(`Failed to delete backup: ${error.message}`);
    }
  }

  async fetchWithHttps(url) {
    return new Promise((resolve, reject) => {
      const request = https.get(url, {
        headers: {
          'Authorization': `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
        },
      }, (response) => {
        let data = '';
        response.on('data', (chunk) => {
          data += chunk;
        });
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve({
              ok: true,
              text: async () => data,
              status: response.statusCode,
            });
          } else {
            reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
          }
        });
      });

      request.on('error', (error) => {
        reject(error);
      });

      request.end();
    });
  }

  async downloadBackup(url) {
    try {
      console.log('Downloading backup from:', url);
      let response;
      if (typeof download === 'function') {
        console.log('Using @vercel/blob download');
        try {
          response = await download(url, {
            token: process.env.BLOB_READ_WRITE_TOKEN,
          });
        } catch (downloadError) {
          console.warn('Vercel Blob download failed:', downloadError.message);
          response = null;
        }
      }

      if (!response && fetch) {
        console.log('Using fetch as fallback');
        try {
          response = await fetch(url, {
            headers: {
              'Authorization': `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
            },
          });
          if (!response.ok) {
            throw new Error(`Failed to fetch blob: ${response.statusText}`);
          }
        } catch (fetchError) {
          console.warn('Fetch failed:', fetchError.message);
          response = null;
        }
      }

      if (!response) {
        console.log('Using https module as final fallback');
        response = await this.fetchWithHttps(url);
      }

      const backupData = await response.text();
      const parsedData = JSON.parse(backupData);
      console.log('Backup loaded successfully. Collections:', Object.keys(parsedData.collections || {}));
      return parsedData;
    } catch (error) {
      console.error('Error downloading backup:', error);
      throw new Error(`Failed to download backup: ${error.message}`);
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.client = null;
      console.log('Disconnected from MongoDB');
    }
  }
}

module.exports = BackupService;