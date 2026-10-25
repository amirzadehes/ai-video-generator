const fs = require('fs');
const { execFileSync } = require('child_process');

const AUDIO = 'test-audio.mp3';
const FPS = 30;
const ALLOWED = [
    'slideleft', 'slideright', 'slideup', 'slidedown',
    'wipeleft', 'wiperight', 'smoothleft', 'smoothright',
    'circleopen', 'circleclose', 'fade', 'fadeblack', 'dissolve', 'pixelize', 'radial'
];
const RANDOM_POOL = ['slideleft', 'slideright', 'wipeleft', 'smoothleft', 'circleopen', 'fade'];

function loadConfig() {
    const defaults = { transition: 'slideleft', transitionDuration: 0.8, width: 1920, height: 1080 };
    try {
        if (fs.existsSync('config.json')) {
            return { ...defaults, ...JSON.parse(fs.readFileSync('config.json', 'utf8')) };
        }
    } catch (e) {
        console.log('config.json could not be read, using defaults.');
    }
    return defaults;
}

// خواندن input.txt (همان فرمت قبلی: file '...' و duration ...)
function parseInput() {
    const scenes = [];
    let current = null;
    for (const raw of fs.readFileSync('input.txt', 'utf8').split('\n')) {
        const line = raw.trim();
        let m = line.match(/^file\s+'(.+)'$/);
        if (m) {
            current = { file: m[1], duration: 0 };
            scenes.push(current);
            continue;
        }
        m = line.match(/^duration\s+([\d.]+)$/);
        if (m && current) current.duration = parseFloat(m[1]);
    }
    return scenes;
}

// صحنه‌ای که عکسش آپلود نشده، به صحنه‌ی قبلی اضافه می‌شود تا هماهنگی با صدا به هم نخورد
function dropMissing(scenes) {
    const out = [];
    let carry = 0;
    for (const s of scenes) {
        if (!fs.existsSync(s.file)) {
            console.log(`Missing image ${s.file}: extending the previous scene instead.`);
            if (out.length) out[out.length - 1].duration += s.duration;
            else carry += s.duration;
            continue;
        }
        out.push({ file: s.file, duration: s.duration + carry });
        carry = 0;
    }
    return out;
}

function pickTransition(name) {
    if (name === 'random') return RANDOM_POOL[Math.floor(Math.random() * RANDOM_POOL.length)];
    return ALLOWED.includes(name) ? name : 'slideleft';
}

function fitFilter(W, H) {
    return `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${FPS},format=yuv420p`;
}

// بدون افکت: برش مستقیم بین عکس‌ها
function renderCuts(scenes, cfg) {
    let list = '';
    for (const s of scenes) {
        list += `file '${s.file}'\nduration ${s.duration.toFixed(3)}\n`;
    }
    list += `file '${scenes[scenes.length - 1].file}'\n`;
    fs.writeFileSync('concat_list.txt', list);

    execFileSync('ffmpeg', [
        '-y', '-f', 'concat', '-safe', '0', '-i', 'concat_list.txt', '-i', AUDIO,
        '-vf', fitFilter(cfg.width, cfg.height),
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-shortest', 'final_video.mp4'
    ], { stdio: 'inherit' });
}

// با افکت انتقال بین عکس‌ها (xfade)
function renderTransitions(scenes, cfg) {
    const W = cfg.width;
    const H = cfg.height;
    const minDuration = Math.min(...scenes.map(s => s.duration));
    const t = Math.max(0.1, Math.min(Number(cfg.transitionDuration) || 0.8, minDuration / 2));

    const args = ['-y'];
    scenes.forEach((s, i) => {
        const len = i < scenes.length - 1 ? s.duration + t : s.duration;
        args.push('-loop', '1', '-framerate', String(FPS), '-t', len.toFixed(3), '-i', s.file);
    });
    args.push('-i', AUDIO);

    const filters = [];
    scenes.forEach((_, i) => {
        filters.push(`[${i}:v]${fitFilter(W, H)}[v${i}]`);
    });

    let last = 'v0';
    let offset = 0;
    for (let i = 1; i < scenes.length; i++) {
        offset += scenes[i - 1].duration;
        const out = i === scenes.length - 1 ? 'vout' : `x${i}`;
        const name = pickTransition(cfg.transition);
        filters.push(`[${last}][v${i}]xfade=transition=${name}:duration=${t.toFixed(3)}:offset=${offset.toFixed(3)}[${out}]`);
        last = out;
    }
    fs.writeFileSync('filter.txt', filters.join(';\n'));

    args.push(
        '-filter_complex_script', 'filter.txt',
        '-map', '[vout]', '-map', `${scenes.length}:a`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-shortest', 'final_video.mp4'
    );
    execFileSync('ffmpeg', args, { stdio: 'inherit' });
}

function processVideo() {
    console.log('Starting Cloud Video Rendering with FFmpeg...');
    if (!fs.existsSync('input.txt') || !fs.existsSync(AUDIO)) {
        console.log('Required assets (input.txt or audio) not found.');
        process.exit(1);
    }

    const cfg = loadConfig();
    const scenes = dropMissing(parseInput());
    if (scenes.length === 0) {
        console.log('No scene images found.');
        process.exit(1);
    }

    console.log(`Scenes: ${scenes.length}, transition: ${cfg.transition}, size: ${cfg.width}x${cfg.height}`);

    if (cfg.transition === 'none' || scenes.length < 2) {
        renderCuts(scenes, cfg);
    } else {
        renderTransitions(scenes, cfg);
    }
    console.log('Video rendered successfully!');
}

processVideo();
