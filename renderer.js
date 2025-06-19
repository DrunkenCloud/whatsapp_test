const { ipcRenderer } = require('electron');

// Global variables
let contacts = [];
let templates = [];
let currentStep = 1;
let selectedContact = null;
let isWhatsAppConnected = false;

// DOM Elements
const steps = document.querySelectorAll('.step');
const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const chromePathInput = document.getElementById('chrome-path');
const browseChromeBtn = document.getElementById('browse-chrome-btn');
const selectCsvBtn = document.getElementById('select-csv-btn');
const csvInfo = document.getElementById('csv-info');
const csvFilename = document.getElementById('csv-filename');
const contactCount = document.getElementById('contact-count');
const csvPreview = document.getElementById('csv-preview');
const contactsTable = document.getElementById('contacts-table');
const tableHead = document.getElementById('table-head');
const tableBody = document.getElementById('table-body');
const templateFolderInput = document.getElementById('template-folder');
const selectTemplateFolderBtn = document.getElementById('select-template-folder-btn');
const templateInfo = document.getElementById('template-info');
const templateList = document.getElementById('template-list');
const availablePlaceholders = document.getElementById('available-placeholders');
const messagePreviewContent = document.getElementById('message-preview-content');
const connectWhatsappBtn = document.getElementById('connect-whatsapp-btn');
const qrSection = document.getElementById('qr-section');
const qrCode = document.getElementById('qr-code');
const connectionStatus = document.getElementById('connection-status');
const statusMessage = document.getElementById('status-message');
const sendMessagesBtn = document.getElementById('send-messages-btn');
const delayMin = document.getElementById('delay-min');
const delayMax = document.getElementById('delay-max');
const breakAfter = document.getElementById('break-after');
const breakMin = document.getElementById('break-min');
const breakMax = document.getElementById('break-max');
const progressSection = document.getElementById('progress-section');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const progressLog = document.getElementById('progress-log');
const pauseMessagesBtn = document.getElementById('pause-messages-btn');
const resumeMessagesBtn = document.getElementById('resume-messages-btn');
const stopMessagesBtn = document.getElementById('stop-messages-btn');

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
    updateStepVisibility();
    updateNavigation();
    setupEventListeners();
});

// Event Listeners
function setupEventListeners() {
    // Navigation
    prevBtn.addEventListener('click', () => {
        if (currentStep > 1) {
            currentStep--;
            updateStepVisibility();
            updateNavigation();
        }
    });

    nextBtn.addEventListener('click', () => {
        if (currentStep < 4) {
            currentStep++;
            updateStepVisibility();
            updateNavigation();
        }
    });

    // Chrome path browsing
    browseChromeBtn.addEventListener('click', async () => {
        try {
            const result = await ipcRenderer.invoke('select-chrome-path');
            if (result) {
                chromePathInput.value = result;
            }
        } catch (error) {
            console.error('Error selecting Chrome path:', error);
            alert('Error selecting Chrome path: ' + error.message);
        }
    });

    // CSV File Selection
    selectCsvBtn.addEventListener('click', async () => {
        try {
            const filePath = await ipcRenderer.invoke('select-csv-file');
            if (filePath) {
                await loadCsvFile(filePath);
            }
        } catch (error) {
            console.error('Error selecting CSV file:', error);
            alert('Error selecting CSV file: ' + error.message);
        }
    });

    // Template folder selection
    selectTemplateFolderBtn.addEventListener('click', async () => {
        try {
            const folderPath = await ipcRenderer.invoke('select-template-folder');
            if (folderPath) {
                await loadTemplateFolder(folderPath);
            }
        } catch (error) {
            console.error('Error selecting template folder:', error);
            alert('Error selecting template folder: ' + error.message);
        }
    });

    // Message template changes
    // Removed since we're now using template folders

    // WhatsApp connection
    connectWhatsappBtn.addEventListener('click', async () => {
        try {
            const chromePath = chromePathInput.value.trim();
            if (!chromePath) {
                alert('Please enter the Chrome/Chromium path first');
                return;
            }

            connectWhatsappBtn.disabled = true;
            connectWhatsappBtn.innerHTML = '<span class="loading"></span>Connecting...';
            updateConnectionStatus('Initializing WhatsApp connection...', 'connecting');
            
            await ipcRenderer.invoke('initialize-whatsapp', chromePath);
        } catch (error) {
            console.error('Error connecting to WhatsApp:', error);
            updateConnectionStatus('Connection failed: ' + error.message, 'error');
            connectWhatsappBtn.disabled = false;
            connectWhatsappBtn.textContent = 'Connect to WhatsApp';
        }
    });

    // Send messages
    sendMessagesBtn.addEventListener('click', async () => {
        if (!contacts.length) {
            alert('Please select a CSV file with contacts first.');
            return;
        }

        if (!templates.length) {
            alert('Please select a template folder with .txt files.');
            return;
        }

        if (!isWhatsAppConnected) {
            alert('Please connect to WhatsApp first.');
            return;
        }

        const delayRange = {
            min: parseInt(delayMin.value) || 5,
            max: parseInt(delayMax.value) || 10
        };

        const breakConfig = {
            after: parseInt(breakAfter.value) || 10,
            range: {
                min: parseInt(breakMin.value) || 30,
                max: parseInt(breakMax.value) || 60
            }
        };
        
        if (confirm(`Send messages to ${contacts.length} contacts with random delays between ${delayRange.min}-${delayRange.max} seconds?`)) {
            await sendBulkMessages(delayRange, breakConfig);
        }
    });

    pauseMessagesBtn.addEventListener('click', async () => {
        await ipcRenderer.invoke('pause-sending');
        pauseMessagesBtn.style.display = 'none';
        resumeMessagesBtn.style.display = 'inline-block';
    });

    resumeMessagesBtn.addEventListener('click', async () => {
        await ipcRenderer.invoke('resume-sending');
        resumeMessagesBtn.style.display = 'none';
        pauseMessagesBtn.style.display = 'inline-block';
    });

    stopMessagesBtn.addEventListener('click', async () => {
        await ipcRenderer.invoke('stop-sending');
        stopMessagesBtn.disabled = true;
        pauseMessagesBtn.disabled = true;
        resumeMessagesBtn.disabled = true;
    });
}

// Step Management
function updateStepVisibility() {
    steps.forEach((step, index) => {
        step.classList.toggle('active', index + 1 === currentStep);
    });
}

function updateNavigation() {
    prevBtn.disabled = currentStep === 1;
    nextBtn.style.display = "block";
    
    // Update next button based on step requirements
    switch (currentStep) {
        case 1:
            nextBtn.disabled = contacts.length === 0;
            break;
        case 2:
            nextBtn.disabled = templates.length === 0;
            break;
        case 3:
            nextBtn.disabled = !isWhatsAppConnected;
            break;
        case 4:
            nextBtn.style.display = 'none';
            break;
        default:
            nextBtn.disabled = false;
    }
}

// CSV File Handling
async function loadCsvFile(filePath) {
    try {
        contacts = await ipcRenderer.invoke('read-csv-file', filePath);
        
        if (contacts.length === 0) {
            alert('The CSV file appears to be empty or invalid.');
            return;
        }

        // Update UI
        csvFilename.textContent = filePath.split('/').pop();
        contactCount.textContent = contacts.length;
        csvInfo.classList.remove('hidden');
        csvPreview.classList.remove('hidden');

        // Display contacts table
        displayContactsTable();
        
        // Update placeholders
        updateAvailablePlaceholders();
        
        // Update navigation
        updateNavigation();
        
        console.log('Loaded contacts:', contacts.length);
    } catch (error) {
        console.error('Error loading CSV file:', error);
        alert('Error loading CSV file: ' + error.message);
    }
}

function displayContactsTable() {
    if (contacts.length === 0) return;

    const headers = Object.keys(contacts[0]);
    tableHead.innerHTML = '';
    const headerRow = document.createElement('tr');
    headers.forEach(header => {
        const th = document.createElement('th');
        th.textContent = header.charAt(0).toUpperCase() + header.slice(1).replace(/_/g, ' ');
        headerRow.appendChild(th);
    });
    tableHead.appendChild(headerRow);

    // Create table body
    tableBody.innerHTML = '';
    contacts.slice(0, 10).forEach((contact, index) => { // Show first 10 contacts
        const row = document.createElement('tr');
        row.addEventListener('click', () => selectContactForPreview(contact, row));
        
        headers.forEach(header => {
            const td = document.createElement('td');
            td.textContent = contact[header] || '';
            row.appendChild(td);
        });
        
        tableBody.appendChild(row);
    });

    if (contacts.length > 10) {
        const row = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = headers.length;
        td.textContent = `... and ${contacts.length - 10} more contacts`;
        td.style.textAlign = 'center';
        td.style.fontStyle = 'italic';
        td.style.color = '#666';
        row.appendChild(td);
        tableBody.appendChild(row);
    }
}

function selectContactForPreview(contact, row) {
    // Remove previous selection
    document.querySelectorAll('tbody tr').forEach(r => r.classList.remove('selected'));
    
    // Add selection to current row
    row.classList.add('selected');
    
    selectedContact = contact;
    updateMessagePreview();
}

function updateAvailablePlaceholders() {
    if (contacts.length === 0) {
        availablePlaceholders.innerHTML = '<p>Upload a CSV file to see available placeholders</p>';
        return;
    }

    const headers = Object.keys(contacts[0]);
    availablePlaceholders.innerHTML = '';
    
    headers.forEach(header => {
        const tag = document.createElement('span');
        tag.className = 'placeholder-tag';
        tag.textContent = `{{${header}}}`;
        tag.addEventListener('click', () => {
            // Insert placeholder at cursor position
            const textarea = messageTemplate;
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const text = textarea.value;
            textarea.value = text.substring(0, start) + `{{${header}}}` + text.substring(end);
            textarea.focus();
            textarea.setSelectionRange(start + header.length + 4, start + header.length + 4);
            updateMessagePreview();
        });
        availablePlaceholders.appendChild(tag);
    });
}

function updateMessagePreview() {
    if (templates.length > 0) {
        nextBtn.disabled = false;
    } else {
        nextBtn.disabled = true;
    }
    
    if (!selectedContact || templates.length === 0) {
        messagePreviewContent.innerHTML = '<p>Select a contact from the table above to preview the personalized message</p>';
        return;
    }

    // Use a random template for preview
    const randomTemplate = templates[Math.floor(Math.random() * templates.length)];
    let preview = randomTemplate.content;
    
    // Replace placeholders
    Object.keys(selectedContact).forEach(key => {
        const placeholder = `{{${key}}}`;
        // Properly escape curly braces for RegExp
        const regex = new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g');
        preview = preview.replace(regex, selectedContact[key] || '');
    });

    messagePreviewContent.textContent = preview;
    
    // Update navigation
    updateNavigation();
}

// WhatsApp Connection Management
function updateConnectionStatus(message, type) {
    statusMessage.textContent = message;
    connectionStatus.className = `status-section ${type}`;
}

// IPC Event Listeners for WhatsApp
ipcRenderer.on('qr-code', (event, qrDataUrl) => {
    qrCode.src = qrDataUrl;
    qrSection.classList.remove('hidden');
    updateConnectionStatus('Scan the QR code with your phone', 'connecting');
});

ipcRenderer.on('whatsapp-authenticated', () => {
    updateConnectionStatus('Authenticated successfully', 'connecting');
});

ipcRenderer.on('whatsapp-ready', () => {
    isWhatsAppConnected = true;
    qrSection.classList.add('hidden');
    updateConnectionStatus('Connected to WhatsApp', 'connected');
    connectWhatsappBtn.textContent = 'Connected ✓';
    connectWhatsappBtn.disabled = true;
    sendMessagesBtn.disabled = false;
    updateNavigation();
});

ipcRenderer.on('whatsapp-auth-failed', (event, message) => {
    updateConnectionStatus('Authentication failed: ' + message, 'error');
    connectWhatsappBtn.disabled = false;
    connectWhatsappBtn.textContent = 'Retry Connection';
});

ipcRenderer.on('whatsapp-disconnected', (event, reason) => {
    isWhatsAppConnected = false;
    updateConnectionStatus('Disconnected: ' + reason, 'error');
    connectWhatsappBtn.disabled = false;
    connectWhatsappBtn.textContent = 'Reconnect to WhatsApp';
    sendMessagesBtn.disabled = true;
    updateNavigation();
});

// Message Sending
async function sendBulkMessages(delayRange, breakConfig) {
    try {
        sendMessagesBtn.disabled = true;
        sendMessagesBtn.style.display = 'none';
        pauseMessagesBtn.style.display = 'inline-block';
        pauseMessagesBtn.disabled = false;
        resumeMessagesBtn.style.display = 'none';
        resumeMessagesBtn.disabled = false;
        stopMessagesBtn.style.display = 'inline-block';
        stopMessagesBtn.disabled = false;
        progressSection.classList.remove('hidden');
        progressLog.innerHTML = '';

        const results = await ipcRenderer.invoke('send-bulk-messages', {
            contacts: contacts,
            templates: templates,
            delayRange: delayRange,
            breakAfter: breakConfig.after,
            breakRange: breakConfig.range
        });

        // Show completion message
        const successCount = results.filter(r => r.status === 'success').length;
        const failureCount = results.filter(r => r.status === 'failed').length;
        const stoppedCount = results.filter(r => r.status === 'stopped').length;
        let msg = `Message sending completed!\nSuccess: ${successCount}\nFailed: ${failureCount}`;
        if (stoppedCount > 0) msg += `\nStopped: ${stoppedCount}`;
        alert(msg);

    } catch (error) {
        console.error('Error sending messages:', error);
        alert('Error sending messages: ' + error.message);
    } finally {
        sendMessagesBtn.disabled = false;
        sendMessagesBtn.style.display = 'inline-block';
        pauseMessagesBtn.style.display = 'none';
        resumeMessagesBtn.style.display = 'none';
        stopMessagesBtn.style.display = 'none';
        pauseMessagesBtn.disabled = false;
        resumeMessagesBtn.disabled = false;
        stopMessagesBtn.disabled = false;
    }
}

// Break notification handler
ipcRenderer.on('break-notification', (event, data) => {
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry break';
    logEntry.textContent = `⏸️ ${data.message}`;
    progressLog.appendChild(logEntry);
    progressLog.scrollTop = progressLog.scrollHeight;
});

// Progress Updates
ipcRenderer.on('message-progress', (event, data) => {
    const { current, total, contact, status, error } = data;
    
    // Update progress bar
    const percentage = (current / total) * 100;
    progressFill.style.width = percentage + '%';
    progressText.textContent = `${current} / ${total} messages sent`;

    // Add log entry
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${status}`;
    
    const phoneNumber = contact.phone || contact.number || contact.mobile || 'Unknown';
    const contactName = contact.name || contact.first_name || phoneNumber;
    
    if (status === 'success') {
        logEntry.textContent = `✓ Message sent to ${contactName} (${phoneNumber})`;
    } else {
        logEntry.textContent = `✗ Failed to send to ${contactName} (${phoneNumber}): ${error}`;
    }
    
    progressLog.appendChild(logEntry);
    progressLog.scrollTop = progressLog.scrollHeight;
});

// Cleanup on window close
window.addEventListener('beforeunload', async () => {
    if (isWhatsAppConnected) {
        await ipcRenderer.invoke('disconnect-whatsapp');
    }
});

// Load template folder
async function loadTemplateFolder(folderPath) {
    try {
        templates = await ipcRenderer.invoke('read-template-folder', folderPath);
        templateFolderInput.value = folderPath;
        templateInfo.classList.remove('hidden');
        
        // Display templates
        templateList.innerHTML = '';
        templates.forEach(template => {
            const templateItem = document.createElement('div');
            templateItem.className = 'template-item';
            templateItem.innerHTML = `
                <strong>${template.name}</strong>
                <div class="template-preview">${template.content.substring(0, 100)}${template.content.length > 100 ? '...' : ''}</div>
                ${template.imagePath ? `<img src="file://${template.imagePath}" alt="Image for ${template.name}" style="max-width: 100px; max-height: 100px; margin-top: 8px; border-radius: 6px; border: 1px solid #ccc;" />` : ''}
            `;
            templateList.appendChild(templateItem);
        });
        
        updateNavigation();
        updateMessagePreview();
        
    } catch (error) {
        console.error('Error loading template folder:', error);
        alert('Error loading template folder: ' + error.message);
    }
}