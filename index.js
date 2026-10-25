const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');

const IMAGE_STYLE = "Modern editorial graphic novel illustration";
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function formatTime(seconds) {
    const date = new Date(seconds * 1000);
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    const ss = String(date.getUTCSeconds()).padStart(2, '0');
    const ms = String(date.getUTCMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss},${ms}`;
}

async function generateImage(text, index) {
    // 1. تولید پرامپت با Groq
    const groqUrl = 'https://api.groq.com/openai/v1/chat/completions';
    const promptCommand = `Write a VERY SHORT (max 30 words) highly descriptive English prompt for an AI image generator based on this text: "${text}". The image MUST strictly follow this art style: "${IMAGE_STYLE}". Reply ONLY with the prompt, no extra words.`;
    
    let imagePrompt = text; 
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
        console.log(`[Scene ${index}] Prompt: ${imagePrompt.substring(0, 50)}...`);
    } catch (e) {
        console.log(`[Scene ${index}] Using original text for prompt.`);
    }

    // 2. تولید تصویر با Hugging Face (مدل Stable Diffusion XL)
    const hfUrl = 'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-xl-base-1.0';
    const imageName = `image_${String(index).padStart(3, '0')}.jpg`;
    const imagePath = path.join(__dirname, 'images', imageName);
    
    let retries = 3;
    for (let i = 0; i < retries; i++) {
        try {
            const imgRes = await axios.post(hfUrl, { inputs: imagePrompt }, {
                headers: { 
                    'Authorization': `Bearer ${process.env.HF_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                responseType: 'arraybuffer',
                timeout: 120000 // زمان کافی برای پردازش مدل
            });
            fs.writeFileSync(imagePath, imgRes.data);
            console.log(`[Scene ${index}] Image successfully saved.`);
            return imageName;
        } catch (error) {
            const status = error.response ? error.response.status : 'Network Error';
            if (status === 503) {
                console.log(`[Scene ${index}] Model is loading on HuggingFace... Waiting 15s (Attempt ${i + 1}/${retries})`);
                await sleep(15000);
            } else {
                console.error(`[Scene ${index}] Image API Error: ${status}`);
                if (i === retries - 1) return null;
                await sleep(5000);
            }
        }
    }
    return null;
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

    console.log('Phase 2: Generating Images with Hugging Face...');
    if (!fs.existsSync('images')) fs.mkdirSync('images');
    
    let ffmpegInput = '';
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        const duration = (seg.end - seg.start).toFixed(2);
        
        console.log(`\nProcessing Scene ${i + 1}/${segments.length}...`);
        const imgName = await generateImage(seg.text, i + 1);
        
        if (imgName) {
            ffmpegInput += `file 'images/${imgName}'\n`;
            ffmpegInput += `duration ${duration}\n`;
        }
    }
    fs.writeFileSync('input.txt', ffmpegInput);
    console.log('\nSuccess: SRT and Images are ready in the folder!');
}

processAudioToImages('./test-audio.mp3');
