# Template Files

This folder contains text files that will be used as message templates. Each `.txt` file will be randomly selected when sending messages to contacts.

## Template Format

Each template file should be a `.txt` file containing your message template. You can use placeholders to personalize messages for each contact.

## Available Placeholders

- `{{name}}` - Contact's name
- `{{phone}}` - Contact's phone number
- `{{email}}` - Contact's email (if available in CSV)
- `{{company}}` - Contact's company (if available in CSV)
- Any other column from your CSV file can be used as `{{column_name}}`

## Example Templates

### template1.txt
```
Hi {{name}},

Hope you're doing well! I wanted to reach out from {{company}} to see how things are going.

Best regards,
Team
```

### template2.txt
```
Hello {{name}},

Just checking in to see if you received our previous message about {{company}}.

Looking forward to hearing from you!

Thanks,
Team
```

### template3.txt
```
Dear {{name}},

Thank you for your interest in {{company}}. We appreciate your time and look forward to working with you.

Best wishes,
Team
```

## How It Works

1. Place your `.txt` template files in this folder
2. The application will randomly select one template for each message
3. Placeholders will be replaced with actual contact data from your CSV file
4. Each contact will receive a personalized message using a randomly chosen template 