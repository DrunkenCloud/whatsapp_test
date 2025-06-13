const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const csv = require('csv-parser');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

let mainWindow;
let whatsappClient;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: path.join(__dirname, 'assets/icon.png') // Add your app icon here
  });

  mainWindow.loadFile('index.html');

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.disableHardwareAcceleration();
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (whatsappClient) {
    whatsappClient.destroy();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers
ipcMain.handle('select-csv-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'CSV Files', extensions: ['csv'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('read-csv-file', async (event, filePath) => {
  try {
    const contacts = [];
    
    return new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => {
          // Normalize column names (remove spaces, convert to lowercase)
          const normalizedData = {};
          Object.keys(data).forEach(key => {
            const normalizedKey = key.trim().toLowerCase().replace(/\s+/g, '_');
            normalizedData[normalizedKey] = data[key].trim();
          });
          contacts.push(normalizedData);
        })
        .on('end', () => {
          resolve(contacts);
        })
        .on('error', (error) => {
          reject(error);
        });
    });
  } catch (error) {
    throw new Error(`Failed to read CSV file: ${error.message}`);
  }
});

ipcMain.handle('initialize-whatsapp', async (event, chromePath) => {
  try {
    if (!chromePath) {
      throw new Error('Chrome path is required');
    }

    whatsappClient = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        headless: true,
        executablePath: chromePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--incognito',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-software-rasterizer'
        ]
      }
    });

    return new Promise((resolve, reject) => {
      whatsappClient.on('qr', async (qr) => {
        try {
          const qrDataUrl = await qrcode.toDataURL(qr);
          mainWindow.webContents.send('qr-code', qrDataUrl);
        } catch (error) {
          console.error('QR Code generation error:', error);
        }
      });

      whatsappClient.on('ready', () => {
        console.log('WhatsApp client is ready!');
        mainWindow.webContents.send('whatsapp-ready');
        resolve(true);
      });

      whatsappClient.on('authenticated', () => {
        console.log('WhatsApp client authenticated');
        mainWindow.webContents.send('whatsapp-authenticated');
      });

      whatsappClient.on('auth_failure', async (msg) => {
        console.error('Authentication failed:', msg);
        mainWindow.webContents.send('whatsapp-auth-failed', msg);
        try {
          await whatsappClient.destroy();
          whatsappClient = null;
        } catch (error) {
          console.error('Error cleaning up session:', error);
        }
        reject(new Error('Authentication failed'));
      });

      whatsappClient.on('disconnected', async (reason) => {
        console.log('WhatsApp client disconnected:', reason);
        mainWindow.webContents.send('whatsapp-disconnected', reason);
        try {
          await whatsappClient.destroy();
          whatsappClient = null;
        } catch (error) {
          console.error('Error cleaning up session:', error);
        }
      });

      whatsappClient.on('error', async (error) => {
        console.error('WhatsApp client error:', error);
        mainWindow.webContents.send('whatsapp-error', error.message);
        try {
          await whatsappClient.destroy();
          whatsappClient = null;
        } catch (err) {
          console.error('Error cleaning up session:', err);
        }
      });

      whatsappClient.initialize().catch(error => {
        console.error('Failed to initialize WhatsApp client:', error);
        reject(error);
      });
    });
  } catch (error) {
    throw new Error(`Failed to initialize WhatsApp: ${error.message}`);
  }
});

ipcMain.handle('send-bulk-messages', async (event, { contacts, message, delay }) => {
  if (!whatsappClient) {
    throw new Error('WhatsApp client not initialized');
  }

  const results = [];
  const totalContacts = contacts.length;

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    
    try {
      // Get phone number (try different possible column names)
      let phoneNumber = contact.phone || contact.number || contact.mobile || 
                       contact.phone_number || contact.contact || contact.whatsapp;
      
      if (!phoneNumber) {
        throw new Error('Phone number not found in contact data');
      }

      // Clean and format phone number
      phoneNumber = phoneNumber.replace(/\D/g, ''); // Remove non-digits
      
      // Add country code if not present (assuming default country code)
      if (!phoneNumber.startsWith('91') && phoneNumber.length === 10) {
        phoneNumber = '91' + phoneNumber; // Adjust country code as needed
      }

      // Format for WhatsApp
      const chatId = phoneNumber + '@c.us';

      // Replace placeholders in message
      let personalizedMessage = message;
      Object.keys(contact).forEach(key => {
        const placeholder = `{{${key}}}`;
        personalizedMessage = personalizedMessage.replace(
          new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), 
          contact[key] || ''
        );
      });

      // Send message
      await whatsappClient.sendMessage(chatId, personalizedMessage);
      
      results.push({
        contact: contact,
        status: 'success',
        message: 'Message sent successfully'
      });

      // Send progress update
      mainWindow.webContents.send('message-progress', {
        current: i + 1,
        total: totalContacts,
        contact: contact,
        status: 'success'
      });

      // Wait for specified delay
      if (delay > 0 && i < contacts.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delay * 1000));
      }

    } catch (error) {
      console.error(`Failed to send message to ${contact.phone}:`, error);
      results.push({
        contact: contact,
        status: 'failed',
        message: error.message
      });

      // Send progress update
      mainWindow.webContents.send('message-progress', {
        current: i + 1,
        total: totalContacts,
        contact: contact,
        status: 'failed',
        error: error.message
      });
    }
  }

  return results;
});

ipcMain.handle('disconnect-whatsapp', async () => {
  if (whatsappClient) {
    await whatsappClient.destroy();
    whatsappClient = null;
  }
  return true;
});

ipcMain.handle('select-chrome-path', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Chrome Executable', extensions: ['exe', 'app', ''] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});