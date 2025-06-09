const fs = require('fs').promises;

const getMessageTemplate = (contact) => {
    return `Hi ${contact?.name},

Can you believe this year is ending in just one day? Time really flew by! 
As we look ahead to the new year, I’d love to hear your thoughts - what qualities or habits do you think I should work on changing, and what have you liked or appreciated about me this year?

*Wishing you an advance Happy New Year 2025 filled with joy, growth, and new beginnings! 🎉*
 `
}

const logger = (message) => console.log(`[ ${new Date().toLocaleTimeString()} ] :: ${message}`);

const getRecipientNumber = (mobileNo='') => {
    if (mobileNo.startsWith('+')) {
        mobileNo = mobileNo.slice(1);
    }
    
    if (!mobileNo.startsWith('91') || mobileNo.length > 10) {
        mobileNo = `91${mobileNo}`;
    }
    return `${mobileNo}@c.us`;
}

const sleep = (timeInSec, minTimeoutSec = 1) => {
    return new Promise(resolve => {
        const randomDelay = Math.random() * timeInSec * 1000;
        const finalDelay = Math.max(randomDelay, minTimeoutSec * 1000);
        setTimeout(resolve, finalDelay);
    });
};

module.exports = { getContacts, getMessageTemplate, logger, getRecipientNumber, sleep };
