const fs = require('fs');
const { execSync } = require('child_process');

function processVideo() {
    console.log('Starting Cloud Video Rendering with FFmpeg...');
    if (fs.existsSync('input.txt') && fs.existsSync('test-audio.mp3')) {
        execSync('ffmpeg -y -f concat -safe 0 -i input.txt -i "test-audio.mp3" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest final_video.mp4', { stdio: 'inherit' });
        console.log('Video rendered successfully!');
    } else {
        console.log('Required assets (input.txt or audio) not found.');
    }
}

processVideo();
