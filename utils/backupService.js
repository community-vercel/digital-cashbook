// backend/utils/backupService.js
const { MongoClient, ObjectId } = require('mongodb');
const { put, list, download } = require('@vercel/blob');

// Try to import fetch - handle different Node.js versions
let fetch;
try {
  fetch = globalThis.fetch;
  if (!fetch) {
    fetch = require('node-fetch');
  }
} catch (error) {
  console.warn('Could not import fetch, will try alternative methods');
}

const https = require('https');

console.log('Vercel Blob exports:', { put, list, download });
console.log('Fetch available:', !!fetch);

class BackupService {
  constructor() {
    this.client = null;
    this.mongoUri = 'mongodb+srv://zuhooruddin055:HCCCDKtAhIzEnWKW@cluster0.qizf2vq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
    if (!this.mongoUri) {
      throw new Error('MONGO_URI is not defined in environment variables');
    }
    
    // Common ObjectId field names to look for
    this.objectIdFields = ['_id', 'customerId', 'productId', 'userId', 'categoryId', 'orderId', 'transactionId'];
  }

  async connect() {
    if (!this.client) {
      this.client = new MongoClient(this.mongoUri);
      await this.client.connect();
    }
    return this.client;
  }

  // Helper function to check if a string is a valid ObjectId
  isValidObjectId(str) {
    return typeof str === 'string' && /^[0-9a-fA-F]{24}$/.test(str);
  }

  // Enhanced ObjectId conversion for backup
  convertObjectIdsForBackup(obj) {
    if (obj === null || obj === undefined) return obj;
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.convertObjectIdsForBackup(item));
    }
    
    if (typeof obj === 'object') {
      if (obj instanceof ObjectId) {
        return { __objectId: obj.toString() };
      }
      
      const converted = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value instanceof ObjectId) {
          converted[key] = { __objectId: value.toString() };
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

  // Enhanced ObjectId restoration
  convertObjectIdsForRestore(obj) {
    if (obj === null || obj === undefined) return obj;
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.convertObjectIdsForRestore(item));
    }
    
    if (typeof obj === 'object') {
      // Check if this is our special ObjectId marker
      if (obj.__objectId && typeof obj.__objectId === 'string') {
        try {
          return new ObjectId(obj.__objectId);
        } catch (error) {
          console.warn('Invalid ObjectId format:', obj.__objectId);
          return obj.__objectId;
        }
      }
      
      const converted = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value && typeof value === 'object' && value.__objectId) {
          // Handle nested ObjectId markers
          try {
            converted[key] = new ObjectId(value.__objectId);
          } catch (error) {
            console.warn(`Invalid ObjectId for field ${key}:`, value.__objectId);
            converted[key] = value.__objectId;
          }
        } else if (this.objectIdFields.includes(key) && typeof value === 'string' && this.isValidObjectId(value)) {
          // Handle common ObjectId fields that might have been stored as strings
          try {
            converted[key] = new ObjectId(value);
          } catch (error) {
            console.warn(`Could not convert ${key} to ObjectId:`, value);
            converted[key] = value;
          }
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

  async createBackup() {
    try {
      const client = await this.connect();
      const db = client.db();
      const collections = await db.listCollections().toArray();
      const backup = {
        timestamp: new Date().toISOString(),
        database: db.databaseName,
        collections: {},
      };

      console.log('Creating backup for collections:', collections.map(c => c.name));

      for (const collection of collections) {
        const collectionName = collection.name;
        const data = await db.collection(collectionName).find({}).toArray();
        console.log(`Backing up collection ${collectionName}: ${data.length} documents`);
        
        // Convert ObjectIds to a special format for JSON serialization
        backup.collections[collectionName] = this.convertObjectIdsForBackup(data);
      }

      console.log('Backup created successfully');
      return backup;
    } catch (error) {
      console.error('Backup creation failed:', error);
      throw error;
    }
  }

  async restoreBackup(backupData) {
    try {
      const client = await this.connect();
      const db = client.db();
      
      console.log('Starting database restoration...');
      
      // Clear existing collections
      const existingCollections = await db.listCollections().toArray();
      for (const collection of existingCollections) {
        console.log(`Clearing collection: ${collection.name}`);
        await db.collection(collection.name).deleteMany({});
      }

      // Restore data
      for (const [collectionName, data] of Object.entries(backupData.collections)) {
        if (data && data.length > 0) {
          console.log(`Restoring collection ${collectionName}: ${data.length} documents`);
          
          // Convert ObjectIds back from backup format
          const restoredData = this.convertObjectIdsForRestore(data);
          
          // Log sample of restored data for debugging
          if (restoredData.length > 0) {
            console.log(`Sample restored document from ${collectionName}:`, JSON.stringify(restoredData[0], null, 2));
          }
          
          await db.collection(collectionName).insertMany(restoredData);
        }
      }

      console.log('Database restoration completed successfully');
      return { success: true, message: 'Database restored successfully' };
    } catch (error) {
      console.error('Restore failed:', error);
      throw error;
    }
  }

  async saveBackupToBlob(backup) {
    const filename = this.getBackupFilename();
    const backupData = JSON.stringify(backup, null, 2);
    console.log('Saving backup to blob:', filename);
    const { url } = await put(`backups/${filename}`, backupData, {
      access: 'public',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      addRandomSuffix: false,
    });
    return { url, filename };
  }

  async fetchWithHttps(url) {
    return new Promise((resolve, reject) => {
      const request = https.get(url, {
        headers: {
          'Authorization': `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}`,
        }
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
              status: response.statusCode
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

  async loadBackupFromBlob(filename) {
    try {
      console.log('Listing blobs with prefix:', `backups/${filename}`);
      const { blobs } = await list({ prefix: `backups/${filename}`, limit: 1 });
      if (!blobs || blobs.length === 0) {
        throw new Error(`Backup file ${filename} not found`);
      }
      const blobUrl = blobs[0].url;
      console.log('Loading backup from:', blobUrl);

      let response;
      
      // Try @vercel/blob download first
      if (typeof download === 'function') {
        console.log('Using @vercel/blob download');
        try {
          response = await download(blobUrl, {
            token: process.env.BLOB_READ_WRITE_TOKEN,
          });
        } catch (downloadError) {
          console.warn('Vercel Blob download failed:', downloadError.message);
          response = null;
        }
      }
      
      // Fallback to fetch if download didn't work
      if (!response && fetch) {
        console.log('Using fetch as fallback');
        try {
          response = await fetch(blobUrl, {
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
      
      // Final fallback to https module
      if (!response) {
        console.log('Using https module as final fallback');
        response = await this.fetchWithHttps(blobUrl);
      }

      const backupData = await response.text();
      const parsedData = JSON.parse(backupData);
      
      console.log('Backup loaded successfully. Collections:', Object.keys(parsedData.collections || {}));
      return parsedData;
    } catch (error) {
      console.error('Error loading backup from blob:', error);
      throw error;
    }
  }

  async listBackups() {
    try {
      console.log('Listing all backups');
      const { blobs } = await list({ prefix: 'backups/' });
      return blobs.map(blob => ({
        filename: blob.pathname.split('/').pop(),
        url: blob.url,
        createdAt: blob.uploadedAt,
      }));
    } catch (error) {
      console.error('Error listing backups:', error);
      throw error;
    }
  }

  getBackupFilename() {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
    return `backup-${dateStr}-${timeStr}.json`;
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }
}

module.exports = BackupService;