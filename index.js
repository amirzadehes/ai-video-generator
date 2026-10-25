const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

const IMAGE_STYLE = "Cinematic, realistic, 4k, moody lighting, highly detailed";

function formatTime(seconds) {
    const date = new Date(seconds * 1000);
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss},${ms}`;
}

async function generateImage(text, index) {
    const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
    const promptCommand = `Write a short, highly descriptive English prompt for an AI image generator based on this text: "${text}". The image MUST strictly follow this art style: "${IMAGE_STYLE}". Reply ONLY with the prompt, no extra words.`;
    
    let imagePrompt = text; 
    try {
        const groqRes = await axios.post(groqUrl, {
            model: "llama-3.1-8b-instant",
            messages: [{ role: "user", content: promptCommand }]
        }, {
            headers: { 
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json' 
            }
        });
        imagePrompt = groqRes.data.choices[0].message.content.trim();
        console.log(`[Scene ${index}] Llama 3.1 Prompt Generated.`);
    } catch (e) {
        console.error(`[Scene ${index}] Groq Error Details:`, e.response ? JSON.stringify(e.response.data) : e.message);
        console.log(`[Scene ${index}] Using original text.`);
    }

    const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(imagePrompt)}?width=1920&height=1080&nologo=true`;
    const imageName = `image_${String(index).padStart(3, '0')}.jpg`;
    const imagePath = path.join(__dirname, 'images', imageName);
    
    try {
        const imgRes = await axios({ url: imageUrl, responseType: 'stream' });
        const writer = fs.createWriteStream(imagePath);
        imgRes.data.pipe(writer);
        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(imageName));
            writer.on('error', reject);
        });
    } catch (e) {
        console.error(`[Scene ${index}] Image download failed.`);
        return null;
    }
}

async function processAudioToImages(audioFilePath) {
    if (!fs.existsSync(audioFilePath)) {
        console.error(`File not found: ${audioFilePath}`);
        process.exit(1);
    }

    console.log('Phase 1: Sending audio to Groq API...');
    const formData = new FormData();
    formData.append('file', fs.createReadStream(audioFilePath));
    formData.append('model', 'whisper-large-v3');
    formData.append('response_format', 'verbose_json'); 

    let segments = [];
    try {
        const response = await axios.post('https://api.groq.com/openai/v1/audio/transcriptions', formData, {
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                ...formData.getHeaders()
            },
            maxBodyLength: Infinity,
        });
        segments = response.data.segments;
    } catch (error) {
        console.error('Groq Audio Error:', error.response ? error.response.data : error.message);
        process.exit(1);
    }

    let srtContent = '';
    segments.forEach((seg, index) => {
        srtContent += `${index + 1}\n${formatTime(seg.start)} --> ${formatTime(seg.end)}\n${seg.text.trim()}\n\n`;
    });
    fs.writeFileSync('output.srt', srtContent.trim());

    console.log('Phase 2: Generating Images...');
    if (!fs.existsSync('images')) fs.mkdirSync('images');
    
    let ffmpegInput = '';
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const duration = (seg.end - seg.start).toFixed(2);
        
        console.log(`Processing Scene ${i + 1}/${segments.length}...`);
        const imgName = await generateImage(seg.text, i + 1);
        
        if (imgName) {
            ffmpegInput += `file 'images/${imgName}'\n`;
            ffmpegInput += `duration ${duration}\n`;
        }
    }
    fs.writeFileSync('input.txt', ffmpegInput);
    console.log('Success: SRT and Images are ready in the folder!');
}

processAudioToImages('./test-audio.mp3');
