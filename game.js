const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const startScreen = document.getElementById("start-screen");
const gameOverScreen = document.getElementById("game-over-screen");
const startBtn = document.getElementById("start-btn");
const restartBtn = document.getElementById("restart-btn");
const scoreDisplay = document.getElementById("score");
const levelDisplay = document.getElementById("level");
const finalScoreDisplay = document.getElementById("final-score");

const TAU = Math.PI * 2;
const BASE_R = 10;                 // radio base de la pelota (para colisiones)
const BASE_GRAVITY = 0.38;
const RING_RY = 22;                // "profundidad" visual del anillo (elipse)
const RING_LINE = 12;              // grosor del anillo
const verticalSpacing = 110;
const platformRadius = 110;        // radio horizontal del anillo
const colors = ["#ff00ff", "#00ffff", "#ffff00", "#ff3333", "#00ff66"];
const CAMERA_Y = () => canvas.height * 0.45; // la pelota nunca baja de aquí

let gameRunning = false;
let rafId = null;
let score = 0;
let level = 1;
let highScore = 0;
try { highScore = parseInt(localStorage.getItem("neonDropHighScore")) || 0; } catch (e) {}
let rotation = 0;
let targetRotation = 0;

let ball = {
    x: 200,
    y: 180,
    radius: BASE_R,
    color: "#00ffff",
    baseColor: "#00ffff",
    vy: 0,
    gravity: BASE_GRAVITY,
    bounce: -7.2,
    trail: [],
    streak: 0,
    isSuper: false
};

let platforms = [];
let particles = [];

// --- AUDIO NATIVO ---
let audioCtx = null;
try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}

function playSound(type) {
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") audioCtx.resume();

    let osc = audioCtx.createOscillator();
    let gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    let now = audioCtx.currentTime;

    if (type === "bounce") {
        osc.type = "sine";
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(80, now + 0.1);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.1);
        osc.start(now); osc.stop(now + 0.1);
    } else if (type === "pass") {
        osc.type = "triangle";
        let freq = 300 + (ball.streak * 40);
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(freq + 200, now + 0.15);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.15);
        osc.start(now); osc.stop(now + 0.15);
    } else if (type === "gameover") {
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.linearRampToValueAtTime(40, now + 0.4);
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.linearRampToValueAtTime(0.01, now + 0.4);
        osc.start(now); osc.stop(now + 0.4);
    }
}

// y de la plataforma = borde frontal del anillo (donde rebota la pelota)
function surfaceY(p) {
    return p.y - RING_LINE / 2;
}

function spawnPlatform(y, isFirst = false) {
    let minGap = Math.PI * 0.55;
    let baseGap = Math.PI * 1.0;
    let reduction = (level / 1000) * (baseGap - minGap);
    const gapSize = Math.max(minGap, baseGap - reduction);

    let rotFactor = level > 250 ? (level > 750 ? 0.025 : 0.012) : 0.004;
    let rotSpeed = (Math.random() - 0.5) * rotFactor;

    platforms.push({
        y: y,
        angle: isFirst ? 0 : Math.random() * TAU,
        gapSize: gapSize,
        color: colors[Math.floor(Math.random() * colors.length)],
        passed: false,
        broken: false,
        rotSpeed: rotSpeed,
        alphaFade: 1,
        rel: 0
    });
}

function ensurePlatforms() {
    while (platforms.length && platforms[0].y < -100) platforms.shift();
    while (!platforms.length || platforms[platforms.length - 1].y < canvas.height + verticalSpacing) {
        const lastY = platforms.length ? platforms[platforms.length - 1].y : 300 - verticalSpacing;
        spawnPlatform(lastY + verticalSpacing, platforms.length === 0);
    }
}

function initGame() {
    score = 0;
    level = 1;
    rotation = 0;
    targetRotation = 0;
    ball.x = canvas.width / 2;
    ball.y = 180;
    ball.vy = 0;
    ball.gravity = BASE_GRAVITY;
    ball.radius = BASE_R;
    ball.trail = [];
    ball.streak = 0;
    ball.isSuper = false;
    ball.color = ball.baseColor;
    particles = [];
    platforms = [];

    scoreDisplay.textContent = score;
    levelDisplay.textContent = level;

    ensurePlatforms();
}

// Controles: arrastrar a la derecha mueve la cara frontal hacia la derecha
let isDragging = false;
let lastX = 0;

function handleDown(x) { isDragging = true; lastX = x; }
function handleMove(x) {
    if (!isDragging || !gameRunning) return;
    let deltaX = x - lastX;
    targetRotation -= deltaX * 0.009;
    lastX = x;
}
function handleUp() { isDragging = false; }

window.addEventListener("mousedown", (e) => handleDown(e.clientX));
window.addEventListener("mousemove", (e) => handleMove(e.clientX));
window.addEventListener("mouseup", handleUp);

canvas.addEventListener("touchstart", (e) => { e.preventDefault(); handleDown(e.touches[0].clientX); }, { passive: false });
canvas.addEventListener("touchmove", (e) => { e.preventDefault(); handleMove(e.touches[0].clientX); }, { passive: false });
canvas.addEventListener("touchend", handleUp);
canvas.addEventListener("touchcancel", handleUp);

class Particle {
    constructor(x, y, color) {
        this.x = x; this.y = y; this.color = color;
        this.vx = (Math.random() - 0.5) * 6;
        this.vy = Math.random() * -4 - 1;
        this.alpha = 1;
        this.size = Math.random() * 4 + 2;
        this.gravity = 0.15;
    }
    update() {
        this.x += this.vx; this.y += this.vy;
        this.vy += this.gravity; this.alpha -= 0.035;
    }
    draw() {
        ctx.save();
        ctx.globalAlpha = Math.max(0, this.alpha);
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, TAU);
        ctx.fill();
        ctx.restore();
    }
}

function triggerBreakEffect(y, color) {
    for (let i = 0; i < 10; i++) {
        particles.push(new Particle(ball.x, y, color));
    }
}

function passPlatform(p, smashed) {
    if (!p.passed) {
        ball.streak++;
        score += 10 * ball.streak;
        scoreDisplay.textContent = score;
        p.passed = true;

        level = Math.min(1000, Math.floor(score / 40) + 1);
        levelDisplay.textContent = level;

        playSound("pass");
        triggerBreakEffect(p.y, p.color);
    }

    if (smashed) {
        // El modo furia rompe la plataforma y se gasta
        p.broken = true;
        ball.isSuper = false;
        ball.streak = 0;
        ball.color = ball.baseColor;
    } else if (ball.streak >= 3) {
        ball.isSuper = true;
        ball.color = "#ff3300";
    }
}

function update() {
    if (!gameRunning) return;

    rotation += (targetRotation - rotation) * 0.2;

    ball.gravity = level > 750
        ? BASE_GRAVITY + Math.sin(Date.now() * 0.003) * 0.08
        : BASE_GRAVITY;

    const maxFall = 8 + (level / 1000) * 3;
    const scroll = 1.5 + Math.min(2.5, (level / 1000) * 2.5); // las plataformas suben solas

    // Posición relativa ANTES de mover (para detectar cruces sin "túnel")
    platforms.forEach(p => { p.rel = surfaceY(p) - (ball.y + BASE_R); });

    // Física de la pelota
    ball.vy = Math.min(ball.vy + ball.gravity, maxFall);
    ball.y += ball.vy;

    // Cámara: la pelota no baja más de CAMERA_Y, el mundo sube en su lugar
    const extra = Math.max(0, ball.y - CAMERA_Y());
    ball.y -= extra;
    const move = scroll + extra;

    // Estela
    if (Math.random() > 0.3) {
        ball.trail.push({ x: ball.x, y: ball.y, color: ball.color, alpha: 0.5 });
    }
    for (let i = 0; i < ball.trail.length; i++) {
        ball.trail[i].alpha -= 0.05;
        ball.trail[i].y -= move;
    }
    ball.trail = ball.trail.filter(t => t.alpha > 0);

    particles.forEach(p => { p.update(); p.y -= move; });
    particles = particles.filter(p => p.alpha > 0);

    platforms.forEach(p => {
        p.y -= move;
        p.angle += p.rotSpeed;

        if (level > 750) {
            p.alphaFade = 0.5 + Math.sin(p.y * 0.05) * 0.5;
        }

        if (p.broken) return;

        // La plataforma cruzó la parte baja de la pelota
        const relNow = surfaceY(p) - (ball.y + BASE_R);
        if (p.rel > 0 && relNow <= 0) {
            // Ángulo que queda justo en el frente (donde está la pelota)
            let rel = (Math.PI / 2 - (rotation + p.angle)) % TAU;
            if (rel < 0) rel += TAU;
            const inGap = rel < p.gapSize;

            if (inGap) {
                passPlatform(p, false);
            } else if (ball.isSuper) {
                passPlatform(p, true);
            } else {
                // Rebota en la parte sólida
                ball.y = surfaceY(p) - BASE_R;
                ball.vy = ball.bounce;
                ball.radius = 12;
                ball.streak = 0;
                ball.color = ball.baseColor;
                playSound("bounce");
            }
        }
    });

    ensurePlatforms();

    if (ball.radius > BASE_R) ball.radius = Math.max(BASE_R, ball.radius * 0.9);

    // Aplastado contra el techo por las plataformas que suben
    if (ball.y < -30) {
        endGame();
    }
}

function draw() {
    let gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, level > 750 ? "#3a1a1a" : "#1a1a3a");
    gradient.addColorStop(1, "#0b0b16");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Guías verticales del "cilindro"
    ctx.strokeStyle = "rgba(0, 255, 255, 0.08)";
    ctx.lineWidth = 2;
    const cx = canvas.width / 2;
    ctx.beginPath();
    ctx.moveTo(cx - platformRadius, 0); ctx.lineTo(cx - platformRadius, canvas.height);
    ctx.moveTo(cx + platformRadius, 0); ctx.lineTo(cx + platformRadius, canvas.height);
    ctx.stroke();

    // Estela
    ball.trail.forEach(p => {
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, ball.radius * 0.6, 0, TAU);
        ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Anillos (elipses con un hueco que gira)
    platforms.forEach(p => {
        if (p.broken) return;
        ctx.save();
        ctx.strokeStyle = p.color;
        ctx.lineWidth = RING_LINE;
        ctx.lineCap = "round";
        ctx.globalAlpha = p.alphaFade !== undefined ? p.alphaFade : 1;

        ctx.shadowBlur = ball.isSuper ? 25 : 15;
        ctx.shadowColor = ball.isSuper ? "#ff3300" : p.color;

        const start = rotation + p.angle + p.gapSize;
        ctx.beginPath();
        ctx.ellipse(cx, p.y - RING_RY, platformRadius, RING_RY, 0, start, start + TAU - p.gapSize);
        ctx.stroke();
        ctx.restore();
    });

    particles.forEach(p => p.draw());

    // Pelota
    ctx.save();
    ctx.shadowBlur = ball.isSuper ? 35 : 25;
    ctx.shadowColor = ball.color;
    ctx.fillStyle = ball.color;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, ball.radius, 0, TAU);
    ctx.fill();
    ctx.restore();
}

function loop() {
    update();
    draw();
    if (gameRunning) {
        rafId = requestAnimationFrame(loop);
    }
}

function startGame() {
    if (rafId) cancelAnimationFrame(rafId);
    startScreen.classList.add("hidden");
    gameOverScreen.classList.add("hidden");
    initGame();
    gameRunning = true;
    loop();
}

function endGame() {
    if (!gameRunning) return;
    gameRunning = false;
    playSound("gameover");

    if (score > highScore) {
        highScore = score;
        try { localStorage.setItem("neonDropHighScore", highScore); } catch (e) {}
    }

    finalScoreDisplay.innerHTML = `Puntuación: ${score} <br> Nivel Alcanzado: ${level}/1000 <br><span style="color: #00ffff; font-size: 0.9rem;">Récord: ${highScore}</span>`;
    gameOverScreen.classList.remove("hidden");
}

startBtn.addEventListener("click", startGame);
restartBtn.addEventListener("click", startGame);