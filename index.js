const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

// تابع تبدیل ثانیه به فرمت زمان‌بندی SRT
function formatTime(seconds) {
    const date = new Date(seconds * 1000);
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss},${ms}`;
}

async function generateSRT(audioFilePath) {
    if (!fs.existsSync(audioFilePath)) {
        console.error(`File not found: ${audioFilePath}`);
        process.exit(1); 
    }

    const formData = new FormData();
    formData.append('file', fs.createReadStream(audioFilePath));
    formData.append('model', 'whisper-large-v3');
    // درخواست دیتای کامل همراه با زمان‌بندی
    formData.append('response_format', 'verbose_json'); 

    try {
        console.log('Sending audio to Groq API...');
        const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                ...formData.getHeaders()
            },
            maxBodyLength: Infinity,
        });

        const segments = response.data.segments;
        if (!segments || segments.length === 0) {
            console.error('No speech segments found.');
            process.exit(1);
        }

        // تبدیل دیتای دریافتی به فرمت استاندارد SRT
        let srtContent = '';
        segments.forEach((segment, index) => {
            const startTime = formatTime(segment.start);
            const endTime = formatTime(segment.end);
            srtContent += `${index + 1}\n`;
            srtContent += `${startTime} --> ${endTime}\n`;
            srtContent += `${segment.text.trim()}\n\n`;
        });

        fs.writeFileSync('output.srt', srtContent.trim());
        console.log('Success: output.srt created with exact timestamps!');
    } catch (error) {
        console.error('Error:', error.response ? error.response.data : error.message);
        process.exit(1);
    }
}

generateSRT('./test-audio.mp3');
