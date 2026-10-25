const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

const IMAGE_STYLE = "Cinematic, moody lighting, highly detailed photography";
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function formatTime(seconds) {
    const pad = (num, size = 2) => String(num).padStart(size, '0');
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const millis = Math.floor((seconds % 1) * 1000);
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)},${pad(millis, 3)}`;
}

async function generateImage(text, index) {
    const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
    const promptCommand = `Write a very short, simple English description for a cinematic background image based on this text: "${text}". Style: "${IMAGE_STYLE}". Reply ONLY with the description.`;
    
    let imagePrompt = "Cinematic landscape, moody lighting"; 
    try {
        const groqRes = await axios.post(groqUrl, {
            model: "openai/gpt-oss-20b",
            messages: [{ role: "user", content: promptCommand }]
        }, {
            headers: { 
                'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                'Content-Type': 'application/json' 
            }
        });
        imagePrompt = groqRes.data.choices[0].message.content.trim().replace(/[\r\n]+/g, ' ');
    } catch (e) {
        imagePrompt = "Cinematic background scene";
    }

    const encodedPrompt = encodeURIComponent(imagePrompt);
    const imageUrl = `https://image.pollinations.ai/prompt/${encodedProvenance(encodedPrompt)}?width=1920&height=1080&nologo=true`;
    const fallbackUrl = `https://picsum.photos/seed/${index}/1920/1080`;

    const imageName = `image_${String(index).padStart(3, '0')}.jpg`;
    const imagePath = path.join(__dirname, 'images', imageName);
    
    let success = false;
    for (let urlToTry of [imageUrl, fallbackUrl]) {
        try {
            const imgRes = await axios({ 
                url: urlToTry, 
                responseType: 'arraybuffer',
                timeout: 20000,
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            fs.writeFileSync(imagePath, imgRes.data);
            console.log(`[Scene ${index}] Image downloaded successfully.`);
            success = true;
            break;
        } catch (e) {
            continue;
        }
    }
    
    if (!success) {
        console.error(`[Scene ${index}] Could not download image.`);
        return null;
    }
    return imageName;
}

function encodedProvenance(str) {
    return str.replace(/[^a-zA-Z0-9-_]/g, '_');
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
        console.error('Groq Audio Error:', error.message);
        process.exit(1);
    }

    let srtContent = '';
    segments.forEach((seg, index) => {
        srtContent += `${index + 1}\n${formatTime(seg.start)} --> ${formatTime(seg.end)}\n${seg.text.trim()}\n\n`;
    });
    fs.writeFileSync('output.srt', srtContent.trim());

    console.log('Phase 2: Grouping segments and generating major scene images...');
    if (!fs.existsSync('images')) fs.mkdirSync('images');

    let chunks = [];
    let currentChunkText = '';
    let chunkStart = segments[0].start;
    let chunkEnd = segments[0].end;
    const targetDuration = 30;

    segments.forEach((seg) => {
        currentChunkText += ' ' + seg.text;
        chunkEnd = seg.end;
        if ((chunkEnd - chunkStart) >= targetDuration) {
            chunks.push({ start: chunkStart, end: chunkEnd, text: currentChunkText.trim() });
            currentChunkText = '';
            chunkStart = seg.end;
        }
    });
    if (currentChunkText.trim().length > 0) {
        chunks.push({ start: chunkStart, end: chunkEnd, text: currentChunkText.trim() });
    }

    let ffmpegInput = '';
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const duration = (chunk.end - chunk.start).toFixed(2);
        
        console.log(`Processing Main Scene ${i + 1}/${chunks.length} (Duration: ${duration}s)...`);
        const imgName = await generateImage(chunk.text, i + 1);
        
        if (imgName) {
            ffmpegInput += `file 'images/${imgName}'\n`;
            ffmpegInput += `duration ${duration}\n`;
        }
        
        if (i < chunks.length - 1) {
            await sleep(2000); 
        }
    }
    
    fs.writeFileSync('input.txt', ffmpegInput);
    console.log('Success: Grouped SRT and optimized Images are ready!');
}

processAudioToImages('./test-audio.mp3');
