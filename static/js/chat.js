document.addEventListener('DOMContentLoaded', () => {
    const chatMessages = document.getElementById('chat-messages');
    const userInput = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const fileInput = document.getElementById('file-input');
    const attachmentButton = document.getElementById('attachment-button');
    let ws = null;
    let currentMessageDiv = null;
    let currentContentDiv = null;
    let isStreaming = false;

    // File upload configuration
    const FILE_CONFIG = {
        maxSize: 5 * 1024 * 1024, // 5MB
        allowedTypes: [
            'image/jpeg',
            'image/png',
            'image/gif',
            'application/pdf',
            'text/plain',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/csv'
        ],
        maxFiles: 5
    };

    // Configure marked options
    marked.setOptions({
        highlight: function(code, lang) {
            if (lang && hljs.getLanguage(lang)) {
                return hljs.highlight(code, { language: lang }).value;
            }
            return hljs.highlightAuto(code).value;
        },
        breaks: false,
        gfm: true,
        pedantic: false,
        smartypants: false
    });

    // Connect to WebSocket
    function connectWebSocket() {
        console.log('Attempting to connect to WebSocket...');
        ws = new WebSocket(`ws://${window.location.host}/ws`);

        ws.onopen = () => {
            console.log('Successfully connected to WebSocket');
            addMessage('Connected to chat server', 'system');
        };

        ws.onmessage = (event) => {
            // console.log('Raw WebSocket message received:', event.data);
            const response = JSON.parse(event.data);
            // console.log('Parsed WebSocket message:', response);
            
            if (response.type === 'stream_start') {
                console.log('Starting new streaming message');
                startStreamingMessage();
            } else if (response.type === 'stream_content') {
                // console.log('Received stream content chunk:', response.content);
                appendStreamingContent(response.content);
            } else if (response.type === 'stream_end') {
                console.log('Ending streaming message');
                endStreamingMessage();
            } else {
                console.log('Received regular message:', response);
                addMessage(response.content, response.role);
            }
        };

        ws.onclose = () => {
            console.log('Disconnected from WebSocket');
            addMessage('Disconnected from chat server', 'system');
            setTimeout(connectWebSocket, 1000);
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            addMessage('Error in WebSocket connection', 'system');
        };
    }

    // Start a new streaming message
    function startStreamingMessage() {
        isStreaming = true;
        currentMessageDiv = document.createElement('div');
        currentMessageDiv.className = 'message assistant';
        
        currentContentDiv = document.createElement('div');
        currentContentDiv.className = 'message-content';
        
        currentMessageDiv.appendChild(currentContentDiv);
        chatMessages.appendChild(currentMessageDiv);
    }

    // Append content to streaming message
    function appendStreamingContent(content) {
        if (!isStreaming || !currentContentDiv) {
            console.log('Not in streaming mode or no content div, ignoring chunk');
            return;
        }
    
        // console.log('content:', content);
        // console.log('content length:', content.length);
        // console.log('content contains newline:', content.includes('\n'));
        // console.log('content contains double newline:', content.includes('\n\n'));
        // console.log('content char codes:', Array.from(content).map(c => c.charCodeAt(0)));
        // console.log('currentContentDiv.innerHTML:', currentContentDiv.innerHTML);
        
        // Get the current HTML content and append new content
        let currentText = currentContentDiv.innerHTML + content;

        // Check for any kind of newline (both \n and actual line breaks)
        const hasNewline = content.includes('\n') || content.includes('\r\n') || content.includes('\r');
        const hasDoubleNewline = content.includes('\n\n') || content.includes('\r\n\r\n') || content.includes('\r\r');

        // Only parse markdown if we receive a new line or double newline
        if (hasDoubleNewline || hasNewline) {
            console.log('Detected newline, parsing markdown');
            try {
                const renderedContent = marked.parse(currentText);
                console.log('Rendered Markdown:', renderedContent);
                currentContentDiv.innerHTML = renderedContent;
        
                currentContentDiv.querySelectorAll('pre code').forEach((block) => {
                    hljs.highlightElement(block);
                });
            } catch (e) {
                console.error("Markdown rendering error:", e);
            }
        } else {
            // Just append the content without parsing, maintaining HTML structure
            currentContentDiv.innerHTML = currentText;
        }
    
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // End streaming message
    function endStreamingMessage() {
        isStreaming = false;
        currentMessageDiv = null;
        currentContentDiv = null;
    }

    // Add a message to the chat
    function addMessage(content, role) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        // Render Markdown for assistant messages, plain text for others
        if (role !== 'assistant') {
            contentDiv.innerHTML = content.replace(/\n/g, '<br>');
        } else {
            // For assistant messages, use marked with proper line breaks
            contentDiv.innerHTML = marked.parse(content);
            // Apply syntax highlighting
            contentDiv.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
        }
        
        messageDiv.appendChild(contentDiv);
        chatMessages.appendChild(messageDiv);
        
        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Validate file
    function validateFile(file) {
        // Check file size
        if (file.size > FILE_CONFIG.maxSize) {
            addMessage(`File "${file.name}" is too large. Maximum size is ${FILE_CONFIG.maxSize / (1024 * 1024)}MB`, 'system');
            return false;
        }

        // Check file type
        if (!FILE_CONFIG.allowedTypes.includes(file.type)) {
            addMessage(`File type "${file.type}" is not allowed.`, 'system');
            return false;
        }

        return true;
    }

    // Add an attachment to the chat
    function addAttachment(file) {
        if (!validateFile(file)) {
            return;
        }

        const messageDiv = document.createElement('div');
        messageDiv.className = 'message user';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        const attachment = document.createElement('a');
        attachment.className = 'attachment';
        attachment.href = URL.createObjectURL(file);
        attachment.download = file.name;
        
        const icon = document.createElement('svg');
        icon.innerHTML = `
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
        `;
        
        const fileName = document.createTextNode(file.name);
        const fileSize = document.createElement('span');
        fileSize.className = 'file-size';
        fileSize.textContent = ` (${formatFileSize(file.size)})`;
        
        attachment.appendChild(icon);
        attachment.appendChild(fileName);
        attachment.appendChild(fileSize);
        contentDiv.appendChild(attachment);
        messageDiv.appendChild(contentDiv);
        chatMessages.appendChild(messageDiv);
        
        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Format file size
    function formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Send message
    function sendMessage() {
        const message = userInput.value.trim();
        console.log('Attempting to send message:', message);
        
        if (!message) {
            console.log('Message is empty, not sending');
            return;
        }
        
        if (!ws) {
            console.error('WebSocket is not initialized');
            addMessage('Not connected to server', 'system');
            return;
        }
        
        if (ws.readyState !== WebSocket.OPEN) {
            console.error('WebSocket is not open. Current state:', ws.readyState);
            addMessage('Connection lost. Reconnecting...', 'system');
            connectWebSocket();
            return;
        }

        const messageObj = {
            content: message,
            role: 'user'
        };
        
        console.log('Sending message object:', messageObj);
        ws.send(JSON.stringify(messageObj));
        addMessage(message, 'user');
        userInput.value = '';
    }

    // Handle file selection
    function handleFileSelect(event) {
        const files = event.target.files;
        
        // Check number of files
        if (files.length > FILE_CONFIG.maxFiles) {
            addMessage(`Too many files. Maximum ${FILE_CONFIG.maxFiles} files allowed.`, 'system');
            event.target.value = '';
            return;
        }

        for (let file of files) {
            addAttachment(file);
        }
        // Reset file input
        event.target.value = '';
    }

    // Event listeners
    sendButton.addEventListener('click', sendMessage);

    userInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    attachmentButton.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', handleFileSelect);

    // Auto-resize textarea
    userInput.addEventListener('input', () => {
        userInput.style.height = 'auto';
        userInput.style.height = userInput.scrollHeight + 'px';
    });

    // Connect to WebSocket when page loads
    connectWebSocket();
}); 