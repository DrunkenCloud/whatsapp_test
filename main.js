const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const csv = require('csv-parser');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { MessageMedia } = require('whatsapp-web.js');

let mainWindow;
let whatsappClient;
let isPaused = false;
let isStopped = false;

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
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--incognito',
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

// ph: +1-223-223-223    => 1223223223
// ph: 123 456 7890      => 1234567890
// +91 (987) 654-3210    => 919876543210
// 9876543210            => 9876543210

function cleanPhoneNumber(input) {
  const match = input.match(/ph:\s*([+0-9\-()\s]+)/i);
  let raw = match ? match[1] : input;

  raw = raw.trim();

  // Remove all non-digit characters
  return raw.replace(/\D/g, '');
}


ipcMain.handle('send-bulk-messages', async (event, { contacts, templates, delayRange, breakAfter, breakRange }) => {
  if (!whatsappClient) {
    throw new Error('WhatsApp client not initialized');
  }

  const results = [];
  const totalContacts = contacts.length;

  isPaused = false;
  isStopped = false;

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    
    try {
      // Get phone number (try different possible column names)
      let phoneNumber = contact.phone || contact.number || contact.mobile || 
                       contact.phone_number || contact.contact || contact.whatsapp;
      
      if (!phoneNumber) {
        throw new Error('Phone number not found in contact data');
      }

      // Check network connectivity before sending
      await waitForNetworkConnectivity();

      // Split by ';' and take the first element, then clean it
      phoneNumber = phoneNumber.split(';')[0].trim();
      phoneNumber = cleanPhoneNumber(phoneNumber);

      // Format for WhatsApp (remove any + symbol if present)
      const chatId = phoneNumber.replace(/^\+/, '') + '@c.us';

      // Select random template if templates are provided
      let selectedTemplateObj;
      if (templates && templates.length > 0) {
        const randomIndex = Math.floor(Math.random() * templates.length);
        selectedTemplateObj = templates[randomIndex];
      } else {
        throw new Error('No templates available');
      }

      // Replace placeholders in message
      let personalizedMessage = selectedTemplateObj.content;
      Object.keys(contact).forEach(key => {
        const placeholder = `{{${key}}}`;
        personalizedMessage = personalizedMessage.replace(
          new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), 
          contact[key] || ''
        );
      });

      // Check for stop
      if (isStopped) {
        results.push({
          contact: contact,
          status: 'stopped',
          message: 'Sending stopped by user'
        });
        mainWindow.webContents.send('message-progress', {
          current: i + 1,
          total: totalContacts,
          contact: contact,
          status: 'stopped'
        });
        break;
      }

      // Check for pause
      while (isPaused) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check for stop
        if (isStopped) {
          results.push({
            contact: contact,
            status: 'stopped',
            message: 'Sending stopped by user'
          });
          mainWindow.webContents.send('message-progress', {
            current: i + 1,
            total: totalContacts,
            contact: contact,
            status: 'stopped'
          });
          break;
        }
      }

      while (!whatsappClient.pupPage || whatsappClient.pupPage.isClosed()) {
        console.log('No whatsapp connection. Waiting 10 seconds...');
        await new Promise(resolve => setTimeout(resolve, 10000));
      }

      // Send message (with image if available)
      if (selectedTemplateObj.imagePath) {
        const media = await MessageMedia.fromFilePath(selectedTemplateObj.imagePath);
        await whatsappClient.sendMessage(chatId, media, { caption: personalizedMessage });
      } else {
        await whatsappClient.sendMessage(chatId, personalizedMessage);
      }
      
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

      // Wait for random delay within the specified range
      if (delayRange && delayRange.min > 0 && delayRange.max > 0 && i < contacts.length - 1) {
        const randomDelay = getRandomDelay(delayRange.min, delayRange.max);
        await new Promise(resolve => setTimeout(resolve, randomDelay * 1000));
      }

      // Check if we need to take a break after certain number of messages
      if (breakAfter && breakRange && (i + 1) % breakAfter === 0 && i < contacts.length - 1) {
        const breakDelay = getRandomDelay(breakRange.min, breakRange.max);
        mainWindow.webContents.send('break-notification', {
          message: `Taking a break for ${breakDelay} seconds after ${breakAfter} messages...`,
          duration: breakDelay
        });
        await new Promise(resolve => setTimeout(resolve, breakDelay * 1000));
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

// New IPC handler for template folder selection
ipcMain.handle('select-template-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Template Folder'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// New IPC handler to read template files from folder
ipcMain.handle('read-template-folder', async (event, folderPath) => {
  try {
    const templates = [];
    const files = await fs.readdir(folderPath);
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif'];
    
    for (const file of files) {
      if (file.endsWith('.txt')) {
        const filePath = path.join(folderPath, file);
        const content = await fs.readFile(filePath, 'utf8');
        const baseName = file.replace('.txt', '');
        let imagePath = null;
        for (const ext of imageExtensions) {
          const candidate = path.join(folderPath, baseName + ext);
          if (await fs.pathExists(candidate)) {
            imagePath = candidate;
            break;
          }
        }
        templates.push({
          name: baseName,
          content: content.trim(),
          imagePath: imagePath
        });
      }
    }
    
    return templates;
  } catch (error) {
    throw new Error(`Failed to read template folder: ${error.message}`);
  }
});

// Helper function to get random number between min and max
function getRandomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Helper function to check network connectivity
async function checkNetworkConnectivity() {
  try {
    const https = require('https');
    return new Promise((resolve) => {
      const req = https.get('https://google.com', (res) => {
        resolve(true);
      });
      
      req.on('error', () => {
        resolve(false);
      });
      
      req.setTimeout(5000, () => {
        req.destroy();
        resolve(false);
      });
    });
  } catch (error) {
    return false;
  }
}

// Helper function to wait for network connectivity
async function waitForNetworkConnectivity() {
  while (!(await checkNetworkConnectivity())) {
    console.log('No internet connection. Waiting 10 seconds...');
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
}

ipcMain.handle('pause-sending', () => {
  isPaused = true;
  return true;
});

ipcMain.handle('resume-sending', () => {
  isPaused = false;
  return true;
});

ipcMain.handle('stop-sending', () => {
  isStopped = true;
  return true;
});