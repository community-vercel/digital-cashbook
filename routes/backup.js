const express = require('express');
const router = express.Router();
const BackupService = require('../utils/backupService');
const auth = require('../middleware/auth');

const backupService = new BackupService();

// Create a new backup
router.post('/create', auth, async (req, res) => {
  try {
    const backup = await backupService.createBackup();
    const { url, fileName } = await backupService.uploadBackupToVercel(backup); // Use uploadBackupToVercel
    res.json({ success: true, message: 'Backup created successfully', url, filename: fileName });
  } catch (error) {
    console.error('Backup creation error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to create backup' });
  } finally {
    await backupService.disconnect();
  }
});

// List all backups
router.get('/list', auth, async (req, res) => {
  try {
    const backups = await backupService.listBackups();

    const sortedBackups = Array.isArray(backups)
      ? backups.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt)) // Fixed sorting field to uploadedAt
      : [];

    res.json({ success: true, backups: sortedBackups });
  } catch (error) {
    console.error('List backups error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to list backups' });
  } finally {
    await backupService.disconnect();
  }
});

// Restore a backup
router.post('/restore', auth, async (req, res) => {
  const { url } = req.body; // Changed to expect url instead of filename
  if (!url) {
    return res.status(400).json({ success: false, message: 'Backup URL is required' });
  }
  try {
    const backupData = await backupService.downloadBackup(url); // Use downloadBackup
    const result = await backupService.restoreBackup(backupData);
    res.json({ success: true, message: result.message });
  } catch (error) {
    console.error('Restore backup error:', error);
    res.status(404).json({ success: false, message: error.message || 'Failed to restore backup' });
  } finally {
    await backupService.disconnect();
  }
});

module.exports = router;