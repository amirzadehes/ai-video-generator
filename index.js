const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

async function generateSRT(audioFilePath) {
    if (!fs.existsSync(audioFilePath)) {
        console.error(`File not found: ${audioFilePath}`);
        process.exit(1); 
    }

    const formData = new FormData();
    formData.append('file', fs.createReadStream(audioFilePath));
    formData.append('model', 'whisper-large-v3');
    formData.append('response_format', 'srt');

    try {
        console.log('Sending audio to Groq API...');
        const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                ...formData.getHeaders()
            },
            maxBodyLength: Infinity,
        });

        fs.writeFileSync('output.srt', response.data);
        console.log('Success: output.srt created!');
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
        process.exit(1);
    }
}

generateSRT('./test-audio.mp3');
