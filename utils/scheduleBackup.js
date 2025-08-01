// utils/scheduleBackup.js
const cron = require('node-cron');
const BackupService = require('./backupService');

async function scheduleDailyBackup() {
  const backupService = new BackupService();

  // Daily backup at midnight (0:00)
  cron.schedule('0 0 * * *', async () => {
    try {
      console.log('Starting daily backup...');
      const backup = await backupService.createBackup();
      const { url, filename } = await backupService.saveBackupToBlob(backup);
      console.log(`Daily backup created: ${filename} at ${url}`);

      // Clean up old backups after creating new one
      try {
        console.log('Starting backup cleanup...');
        const cleanupResult = await backupService.deleteOldBackups();
        console.log('Backup cleanup completed:', cleanupResult.message);
      } catch (cleanupError) {
        console.error('Backup cleanup failed (backup still created successfully):', cleanupError);
      }
    } catch (error) {
      console.error('Daily backup failed:', error);
    } finally {
      await backupService.disconnect();
    }
  }, {
    timezone: 'Asia/Karachi',
  });

  // Optional: Weekly cleanup job (runs every Sunday at 1:00 AM)
  // This provides an additional safety net in case daily cleanup fails
  cron.schedule('0 1 * * 0', async () => {
    try {
      console.log('Starting weekly backup cleanup...');
      const cleanupResult = await backupService.deleteOldBackups();
      console.log('Weekly backup cleanup completed:', cleanupResult.message);
    } catch (error) {
      console.error('Weekly backup cleanup failed:', error);
    } finally {
      await backupService.disconnect();
    }
  }, {
    timezone: 'Asia/Karachi',
  });

  console.log('Backup scheduler initialized:');
  console.log('- Daily backup: 12:00 AM (Asia/Karachi)');
  console.log('- Weekly cleanup: Sunday 1:00 AM (Asia/Karachi)');
  console.log('- Retention period: 7 days');
}

/**
 * Manual backup with optional cleanup
 */
async function createManualBackup(includeCleanup = true) {
  const backupService = new BackupService();
  
  try {
    console.log('Creating manual backup...');
    const backup = await backupService.createBackup();
    const { url, filename } = await backupService.saveBackupToBlob(backup);
    console.log(`Manual backup created: ${filename} at ${url}`);

    let cleanupResult = null;
    if (includeCleanup) {
      try {
        console.log('Running cleanup after manual backup...');
        cleanupResult = await backupService.deleteOldBackups();
        console.log('Cleanup completed:', cleanupResult.message);
      } catch (cleanupError) {
        console.error('Cleanup failed (backup still created successfully):', cleanupError);
      }
    }

    return {
      success: true,
      backup: { url, filename },
      cleanup: cleanupResult
    };
  } catch (error) {
    console.error('Manual backup failed:', error);
    throw error;
  } finally {
    await backupService.disconnect();
  }
}

/**
 * Manual cleanup of old backups
 */
async function cleanupOldBackups() {
  const backupService = new BackupService();
  
  try {
    console.log('Starting manual cleanup of old backups...');
    const result = await backupService.deleteOldBackups();
    console.log('Manual cleanup completed:', result.message);
    return result;
  } catch (error) {
    console.error('Manual cleanup failed:', error);
    throw error;
  } finally {
    await backupService.disconnect();
  }
}


module.exports = { 
  scheduleDailyBackup, 
  createManualBackup, 
  cleanupOldBackups 
};