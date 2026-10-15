import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import './style.css';

const scene = document.querySelector('.scene');
const video = document.querySelector('#camera');
const magicCanvas = document.querySelector('#magic');
const skeletonCanvas = document.querySelector('#skeleton');
const spriteCanvas = document.querySelector('#sprite');
const snowCanvas = document.querySelector('#snow');
const button = document.querySelector('#cameraButton');
const status = document.querySelector('#status');
const hint = document.querySelector('#hint');
const magic = magicCanvas.getContext('2d');
const skeleton = skeletonCanvas.getContext('2d');
const spriteContext = spriteCanvas.getContext('2d');
const snow = snowCanvas.getContext('2d');
const particles = [];
const MAX_PARTICLES = 820;
const HAND_DETECTION_INTERVAL = 1000 / 24;
const tipIndices = [4, 8, 12, 16, 20];
const tipColors = ['#b8eaff', '#c9f0ff', '#dff8ff', '#c5ecff', '#eefaff'];
const handConnections = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];

let sceneWidth = 0;
let sceneHeight = 0;
let dpr = 1;
let handLandmarker;
let stream;
let modelPromise;
let lastVideoTime = -1;
let lastDetectionAt = 0;
let lastTips = Array(5).fill(null);
let skeletonTargetHands = [];
let skeletonRenderedHands = [];
const controlHistory = [];
const controlPoint = { x: 0, y: 0, vx: 0, vy: 0, target: null, filteredTarget: null, hasTarget: false };
const controlColor = '#c9efff';
let wasFist = false;
let spriteActive = false;
const sprite = { x: 0, y: 0, vx: 0, vy: 0, delayedTarget: null, wanderTarget: null, nextWander: 0, targetIndex: 1, nextSwitch: 0, nextHop: 2200, hopProgress: -1, ringPhase: -1, phase: Math.random() * Math.PI * 2, mode: 'follow', pounceTarget: null, modeUntil: 0 };

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = scene.getBoundingClientRect();
  sceneWidth = rect.width;
  sceneHeight = rect.height;
  magicCanvas.width = Math.floor(sceneWidth * dpr);
  magicCanvas.height = Math.floor(sceneHeight * dpr);
  magic.setTransform(dpr, 0, 0, dpr, 0, 0);
  spriteCanvas.width = Math.floor(sceneWidth * dpr);
  spriteCanvas.height = Math.floor(sceneHeight * dpr);
  spriteContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cameraRect = video.getBoundingClientRect();
  skeletonCanvas.width = Math.floor(cameraRect.width * dpr);
  skeletonCanvas.height = Math.floor(cameraRect.height * dpr);
  skeleton.setTransform(dpr, 0, 0, dpr, 0, 0);
  snowCanvas.width = Math.floor(sceneWidth * dpr);
  snowCanvas.height = Math.floor(sceneHeight * dpr);
  snow.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

function setStatus(message, state = '') {
  status.textContent = message;
  status.dataset.state = state;
}

function addParticle(x, y, options = {}) {
  if (particles.length >= MAX_PARTICLES) return;
  const angle = options.angle ?? Math.random() * Math.PI * 2;
  const speed = options.speed ?? (0.2 + Math.random() * 1.4);
  const life = options.life ?? (38 + Math.random() * 62);
  particles.push({
    x, y, px: x, py: y,
    vx: Math.cos(angle) * speed + (options.vx || 0),
    vy: Math.sin(angle) * speed + (options.vy || 0),
    radius: options.radius ?? (0.7 + Math.random() * 2.2),
    life, maxLife: life,
    color: options.color ?? tipColors[Math.floor(Math.random() * tipColors.length)],
    shimmer: Math.random() * Math.PI * 2,
  });
}

function trace(x, y, dx, dy, color) {
  const movement = Math.hypot(dx, dy);
  if (movement < 0.18) return;
  const amount = Math.min(7, 2 + Math.floor(movement / 10));
  for (let i = 0; i < amount; i += 1) {
    const progress = i / Math.max(1, amount - 1);
    addParticle(x - dx * progress * 0.42 + (Math.random() - 0.5) * 9, y - dy * progress * 0.42 + (Math.random() - 0.5) * 9, {
      vx: dx * 0.045,
      vy: dy * 0.045,
      speed: 0.12 + Math.random() * 0.72,
      radius: 0.55 + Math.random() * 1.35,
      life: 38 + Math.random() * 48,
      color,
    });
  }
}

function burst(x, y) {
  for (let i = 0; i < 150; i += 1) {
    const angle = (Math.PI * 2 * i) / 150 + (Math.random() - 0.5) * 0.16;
    const speed = 1.2 + Math.random() * 4.5;
    addParticle(x, y, {
      angle,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      speed: 0.2 + Math.random() * 0.75,
      radius: 0.9 + Math.random() * 2.6,
      life: 70 + Math.random() * 90,
    });
  }
}

function convergeAndBurst(hand) {
  const palm = mapTip(hand[9]);
  tipIndices.forEach((landmarkIndex, fingerIndex) => {
    const start = mapTip(hand[landmarkIndex]);
    const dx = palm.x - start.x;
    const dy = palm.y - start.y;
    for (let i = 0; i < 18; i += 1) {
      addParticle(start.x, start.y, {
        vx: dx * 0.035 + (Math.random() - 0.5) * 0.7,
        vy: dy * 0.035 + (Math.random() - 0.5) * 0.7,
        speed: 0.15 + Math.random() * 0.7,
        radius: 0.7 + Math.random() * 1.6,
        life: 26 + Math.random() * 24,
        color: tipColors[fingerIndex],
      });
    }
  });
  window.setTimeout(() => {
    burst(palm.x, palm.y);
    sprite.mode = 'pounce';
    sprite.pounceTarget = palm;
    sprite.modeUntil = performance.now() + 760;
    sprite.ringPhase = 0;
  }, 230);
}

function mapTip(point) {
  return { x: (1 - point.x) * sceneWidth, y: point.y * sceneHeight };
}

function drawSkeleton(hands) {
  const width = skeletonCanvas.clientWidth;
  const height = skeletonCanvas.clientHeight;
  skeleton.clearRect(0, 0, width, height);
  if (!hands.length || !video.videoWidth || !video.videoHeight) return;

  const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
  const renderedWidth = video.videoWidth * scale;
  const renderedHeight = video.videoHeight * scale;
  const offsetX = (width - renderedWidth) / 2;
  const offsetY = (height - renderedHeight) / 2;
  const point = (landmark) => ({
    x: offsetX + (video.videoWidth - landmark.x * video.videoWidth) * scale,
    y: offsetY + landmark.y * video.videoHeight * scale,
  });

  skeleton.save();
  skeleton.lineCap = 'round';
  skeleton.lineJoin = 'round';
  hands.forEach((hand) => {
    const points = hand.map(point);
    skeleton.lineWidth = 1.15;
    skeleton.strokeStyle = 'rgba(176, 231, 255, .56)';
    handConnections.forEach(([from, to]) => {
      skeleton.beginPath();
      skeleton.moveTo(points[from].x, points[from].y);
      skeleton.lineTo(points[to].x, points[to].y);
      skeleton.stroke();
    });
    points.forEach((item, index) => {
      const isTip = tipIndices.includes(index);
      skeleton.beginPath();
      skeleton.fillStyle = isTip ? 'rgba(226, 249, 255, .98)' : 'rgba(177, 228, 255, .78)';
      skeleton.shadowColor = isTip ? 'rgba(148, 224, 255, .9)' : 'transparent';
      skeleton.shadowBlur = isTip ? 5 : 0;
      skeleton.arc(item.x, item.y, isTip ? 2.35 : 1.55, 0, Math.PI * 2);
      skeleton.fill();
    });
  });
  skeleton.restore();
}

function updateSkeletonInterpolation(dt) {
  if (!skeletonTargetHands.length) {
    skeletonRenderedHands = [];
    drawSkeleton([]);
    return;
  }
  if (skeletonRenderedHands.length !== skeletonTargetHands.length || skeletonRenderedHands[0]?.length !== skeletonTargetHands[0]?.length) {
    skeletonRenderedHands = skeletonTargetHands.map((hand) => hand.map((point) => ({ ...point })));
  } else {
    const blend = 1 - Math.pow(1 - 0.55, dt);
    skeletonRenderedHands = skeletonTargetHands.map((hand, handIndex) => hand.map((point, pointIndex) => {
      const previous = skeletonRenderedHands[handIndex][pointIndex];
      return {
        x: previous.x + (point.x - previous.x) * blend,
        y: previous.y + (point.y - previous.y) * blend,
        z: (previous.z ?? 0) + ((point.z ?? 0) - (previous.z ?? 0)) * blend,
      };
    }));
  }
  drawSkeleton(skeletonRenderedHands);
}

function isFist(hand) {
  const wrist = hand[0];
  const foldedFingers = [8, 12, 16, 20].every((tipIndex) => {
    const pipIndex = tipIndex - 2;
    return Math.hypot(hand[tipIndex].x - wrist.x, hand[tipIndex].y - wrist.y)
      < Math.hypot(hand[pipIndex].x - wrist.x, hand[pipIndex].y - wrist.y) * 0.92;
  });
  const thumbFolded = Math.hypot(hand[4].x - wrist.x, hand[4].y - wrist.y)
    < Math.hypot(hand[5].x - wrist.x, hand[5].y - wrist.y) * 1.18;
  return foldedFingers && thumbFolded;
}

function handleHands(result) {
  const detectedHands = result.landmarks ?? [];
  skeletonTargetHands = detectedHands.map((hand) => hand.map((point) => ({ ...point })));
  const hand = detectedHands[0];
  if (!hand) {
    lastTips = Array(5).fill(null);
    skeletonTargetHands = [];
    controlPoint.hasTarget = false;
    controlPoint.target = null;
    controlPoint.vx *= 0.82;
    controlPoint.vy *= 0.82;
    controlHistory.splice(0, controlHistory.length);
    wasFist = false;
    hint.textContent = 'Move your hand into the frame';
    return;
  }
  tipIndices.forEach((landmarkIndex, fingerIndex) => {
    const rawTip = mapTip(hand[landmarkIndex]);
    const previous = lastTips[fingerIndex];
    lastTips[fingerIndex] = previous
      ? { x: previous.x + (rawTip.x - previous.x) * 0.72, y: previous.y + (rawTip.y - previous.y) * 0.72 }
      : rawTip;
  });
  const center = lastTips.reduce((sum, tip) => ({ x: sum.x + tip.x, y: sum.y + tip.y }), { x: 0, y: 0 });
  controlPoint.target = { x: center.x / lastTips.length, y: center.y / lastTips.length };
  if (!controlPoint.filteredTarget) {
    controlPoint.filteredTarget = { ...controlPoint.target };
    controlPoint.x = controlPoint.target.x;
    controlPoint.y = controlPoint.target.y;
  }
  controlPoint.hasTarget = true;
  const fist = isFist(hand);
  if (fist && !wasFist) {
    convergeAndBurst(hand);
    hint.textContent = 'Magic released';
  } else if (!fist) {
    hint.textContent = 'Move five fingertips · close your hand to release';
  }
  wasFist = fist;
}

function getSpriteTarget(now) {
  if (sprite.mode === 'pounce' && now < sprite.modeUntil && sprite.pounceTarget) return sprite.pounceTarget;
  sprite.mode = 'follow';
  const available = lastTips.map((tip, index) => (tip ? { tip, index } : null)).filter(Boolean);
  if (!available.length) {
    if (!sprite.wanderTarget || now > sprite.nextWander) {
      const originX = sprite.x || sceneWidth * 0.63;
      const originY = sprite.y || sceneHeight * 0.48;
      const rangeX = Math.min(150, sceneWidth * 0.16);
      const rangeY = Math.min(100, sceneHeight * 0.14);
      sprite.wanderTarget = {
        x: Math.max(52, Math.min(sceneWidth - 52, originX + (Math.random() - 0.5) * rangeX * 2)),
        y: Math.max(52, Math.min(sceneHeight - 52, originY + (Math.random() - 0.5) * rangeY * 2)),
      };
      sprite.nextWander = now + 1800 + Math.random() * 2300;
    }
    return sprite.wanderTarget;
  }
  sprite.wanderTarget = null;
  if (now > sprite.nextSwitch || !lastTips[sprite.targetIndex]) {
    sprite.targetIndex = available.reduce((closest, item) => {
      const currentDistance = Math.hypot(item.tip.x - sprite.x, item.tip.y - sprite.y);
      const closestDistance = Math.hypot(closest.tip.x - sprite.x, closest.tip.y - sprite.y);
      return currentDistance < closestDistance ? item : closest;
    }).index;
    sprite.nextSwitch = now + 720 + Math.random() * 720;
  }
  const tip = lastTips[sprite.targetIndex] ?? available[0].tip;
  const palm = lastTips.reduce((sum, point) => point ? { x: sum.x + point.x, y: sum.y + point.y } : sum, { x: 0, y: 0 });
  const count = lastTips.filter(Boolean).length || 1;
  const dx = tip.x - palm.x / count;
  const dy = tip.y - palm.y / count;
  const length = Math.hypot(dx, dy) || 1;
  return { x: tip.x + (dx / length) * 38, y: tip.y + (dy / length) * 38 };
}

function drawSprite(now) {
  const dt = Math.min((now - (drawSprite.last || now)) / 16.67, 2.5);
  drawSprite.last = now;
  if (!spriteActive) {
    spriteContext.clearRect(0, 0, sceneWidth, sceneHeight);
    requestAnimationFrame(drawSprite);
    return;
  }
  const target = getSpriteTarget(now);
  if (!sprite.delayedTarget) sprite.delayedTarget = { x: target.x, y: target.y };
  const targetLag = sprite.mode === 'pounce' ? 0.16 : 0.045;
  sprite.delayedTarget.x += (target.x - sprite.delayedTarget.x) * (1 - Math.pow(1 - targetLag, dt));
  sprite.delayedTarget.y += (target.y - sprite.delayedTarget.y) * (1 - Math.pow(1 - targetLag, dt));
  if (!sprite.x && !sprite.y) { sprite.x = sprite.delayedTarget.x; sprite.y = sprite.delayedTarget.y; }
  const driftAmount = sprite.mode === 'follow' ? 6 : 1.5;
  const driftX = Math.sin(now * 0.00115 + sprite.phase) * driftAmount;
  const driftY = Math.cos(now * 0.0009 + sprite.phase * 1.7) * driftAmount * 0.78;
  const dx = sprite.delayedTarget.x + driftX - sprite.x;
  const dy = sprite.delayedTarget.y + driftY - sprite.y;
  sprite.vx = (sprite.vx + dx * 0.0065 * dt) * Math.pow(0.94, dt);
  sprite.vy = (sprite.vy + dy * 0.0065 * dt) * Math.pow(0.94, dt);
  sprite.x += sprite.vx * dt;
  sprite.y += sprite.vy * dt;
  if (sprite.mode === 'follow' && sprite.hopProgress < 0 && now > sprite.nextHop) {
    sprite.hopProgress = 0;
    sprite.nextHop = now + 2200 + Math.random() * 3400;
  }
  if (sprite.hopProgress >= 0) {
    sprite.hopProgress += 0.035 * dt;
    if (sprite.hopProgress >= 1) sprite.hopProgress = -1;
  }
  if (sprite.ringPhase >= 0) {
    sprite.ringPhase += 0.035 * dt;
    if (sprite.ringPhase >= 1) sprite.ringPhase = -1;
  }
  const bob = Math.sin(now * 0.0015 + sprite.phase) * 2.2;
  const hop = sprite.hopProgress >= 0 ? Math.sin(sprite.hopProgress * Math.PI) * 10 : 0;
  const ringPulse = sprite.ringPhase >= 0 ? Math.sin(sprite.ringPhase * Math.PI) : 0;
  const heading = Math.atan2(sprite.vy, sprite.vx);
  spriteContext.clearRect(0, 0, sceneWidth, sceneHeight);
  spriteContext.save();
  spriteContext.translate(sprite.x, sprite.y + bob - hop);
  spriteContext.rotate(heading + Math.sin(now * 0.0012 + sprite.phase) * 0.08);
  spriteContext.globalCompositeOperation = 'lighter';
  const glow = spriteContext.createRadialGradient(0, 0, 2, 0, 0, 42);
  glow.addColorStop(0, 'rgba(244, 226, 255, .48)');
  glow.addColorStop(.35, 'rgba(206, 167, 255, .25)');
  glow.addColorStop(1, 'rgba(153, 121, 224, 0)');
  spriteContext.fillStyle = glow;
  spriteContext.beginPath(); spriteContext.arc(0, 0, 42, 0, Math.PI * 2); spriteContext.fill();

  const tail = spriteContext.createLinearGradient(-38, 0, -3, 0);
  tail.addColorStop(0, 'rgba(173, 143, 236, 0)');
  tail.addColorStop(.55, 'rgba(193, 161, 255, .28)');
  tail.addColorStop(1, 'rgba(222, 246, 255, .78)');
  spriteContext.strokeStyle = tail;
  spriteContext.lineCap = 'round';
  spriteContext.lineWidth = 2.2;
  spriteContext.beginPath(); spriteContext.moveTo(-34, 2); spriteContext.quadraticCurveTo(-18, -5, -3, 0); spriteContext.stroke();
  spriteContext.globalAlpha = .5;
  spriteContext.lineWidth = 1;
  spriteContext.beginPath(); spriteContext.moveTo(-29, 7); spriteContext.quadraticCurveTo(-15, 3, -4, 3); spriteContext.stroke();
  spriteContext.globalAlpha = 1;

  const ringSizes = [15, 22, 29];
  ringSizes.forEach((base, index) => {
    const radius = base + ringPulse * (10 + index * 5);
    spriteContext.globalAlpha = .5 - index * .1 + ringPulse * .28;
    spriteContext.strokeStyle = index === 1 ? '#e4caff' : '#b995ed';
    spriteContext.lineWidth = index === 1 ? 1.25 : .8;
    spriteContext.setLineDash(index === 1 ? [7, 4] : [3, 6]);
    spriteContext.beginPath();
    spriteContext.arc(0, 0, radius, now * 0.0008 * (index % 2 ? -1 : 1), Math.PI * 2 + now * 0.0008 * (index % 2 ? -1 : 1));
    spriteContext.stroke();
  });
  spriteContext.setLineDash([]);
  spriteContext.globalAlpha = 1;

  const core = spriteContext.createRadialGradient(-2, -2, 1, 0, 0, 11);
  core.addColorStop(0, '#ffffff');
  core.addColorStop(.28, '#f1e5ff');
  core.addColorStop(.72, '#c39af4');
  core.addColorStop(1, 'rgba(113, 83, 190, .3)');
  spriteContext.shadowColor = 'rgba(218, 184, 255, .95)';
  spriteContext.shadowBlur = 14 + ringPulse * 8;
  spriteContext.fillStyle = core;
  spriteContext.beginPath(); spriteContext.arc(0, 0, 9 + ringPulse * 1.5, 0, Math.PI * 2); spriteContext.fill();
  spriteContext.shadowBlur = 0;
  spriteContext.restore();
  requestAnimationFrame(drawSprite);
}

function updateControlPoint(dt) {
  if (!controlPoint.hasTarget || !controlPoint.target) return;
  const targetBlend = 1 - Math.pow(1 - 0.38, dt);
  controlPoint.filteredTarget.x += (controlPoint.target.x - controlPoint.filteredTarget.x) * targetBlend;
  controlPoint.filteredTarget.y += (controlPoint.target.y - controlPoint.filteredTarget.y) * targetBlend;
  const dx = controlPoint.filteredTarget.x - controlPoint.x;
  const dy = controlPoint.filteredTarget.y - controlPoint.y;
  controlPoint.vx = (controlPoint.vx + dx * 0.018 * dt) * Math.pow(0.88, dt);
  controlPoint.vy = (controlPoint.vy + dy * 0.018 * dt) * Math.pow(0.88, dt);
  controlPoint.x += controlPoint.vx * dt;
  controlPoint.y += controlPoint.vy * dt;
  const movementX = controlPoint.vx * dt;
  const movementY = controlPoint.vy * dt;
  if (Math.hypot(movementX, movementY) > 0.18) {
    trace(controlPoint.x, controlPoint.y, movementX, movementY, controlColor);
    controlHistory.push({ x: controlPoint.x, y: controlPoint.y });
    if (controlHistory.length > 42) controlHistory.shift();
  }
}

function drawTipTrails() {
  magic.save();
  magic.globalCompositeOperation = 'lighter';
  magic.lineCap = 'round';
  if (controlHistory.length >= 2) {
    const width = Math.max(2.4, Math.min(5.2, sceneWidth * 0.0038));
    const layers = [
      { color: 'rgba(187, 157, 255, .22)', size: width * 4.6, blur: width * 3.8 },
      { color: 'rgba(126, 218, 255, .34)', size: width * 2.25, blur: width * 1.8 },
      { color: 'rgba(233, 251, 255, .86)', size: width * .78, blur: width * .55 },
    ];
    layers.forEach((layer) => {
      magic.strokeStyle = layer.color;
      magic.lineWidth = layer.size;
      magic.shadowColor = layer.color;
      magic.shadowBlur = layer.blur;
      for (let i = 1; i < controlHistory.length - 1; i += 1) {
        const before = controlHistory[i - 1];
        const current = controlHistory[i];
        const after = controlHistory[i + 1];
        const startX = (before.x + current.x) * 0.5;
        const startY = (before.y + current.y) * 0.5;
        const endX = (current.x + after.x) * 0.5;
        const endY = (current.y + after.y) * 0.5;
        magic.globalAlpha = Math.pow(i / controlHistory.length, 1.35) * (layer === layers[2] ? 0.84 : 0.76);
        magic.beginPath();
        magic.moveTo(startX, startY);
        magic.quadraticCurveTo(current.x, current.y, endX, endY);
        magic.stroke();
      }
    });
    magic.shadowBlur = 0;
  }
  magic.restore();
}

async function loadLandmarker() {
  if (!modelPromise) {
    modelPromise = FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm')
      .then((vision) => HandLandmarker.createFromOptions(vision, {
        baseOptions: {
    modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.55,
        minHandPresenceConfidence: 0.55,
        minTrackingConfidence: 0.5,
      }));
  }
  handLandmarker = await modelPromise;
}

async function enableCamera() {
  button.disabled = true;
  button.textContent = 'Loading...';
  setStatus('Requesting camera', 'loading');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera-unavailable');
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    await loadLandmarker();
    scene.classList.add('camera-ready');
    spriteActive = true;
    button.remove();
    setStatus('Camera ready', 'ready');
    hint.textContent = 'Move your five fingertips to draw light';
    burst(sceneWidth * 0.5, sceneHeight * 0.5);
  } catch (error) {
    console.error(error);
    button.disabled = false;
    button.textContent = 'Enable camera';
    setStatus(error.name === 'NotAllowedError' ? 'Camera permission needed' : 'Camera unavailable', 'error');
    hint.textContent = 'Allow camera access to begin';
  }
}
button.addEventListener('click', enableCamera);

function trackHands() {
  const now = performance.now();
  if (handLandmarker && video.readyState >= 2 && video.currentTime !== lastVideoTime && now - lastDetectionAt >= HAND_DETECTION_INTERVAL) {
    lastVideoTime = video.currentTime;
    lastDetectionAt = now;
    handleHands(handLandmarker.detectForVideo(video, now));
  }
  requestAnimationFrame(trackHands);
}
trackHands();

function drawMagic(now) {
  const dt = Math.min((now - (drawMagic.last || now)) / 16.67, 2.5);
  drawMagic.last = now;
  magic.clearRect(0, 0, sceneWidth, sceneHeight);
  magic.globalCompositeOperation = 'lighter';
  updateSkeletonInterpolation(dt);
  updateControlPoint(dt);
  drawTipTrails();
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    p.life -= dt;
    p.px = p.x; p.py = p.y;
    p.vx *= Math.pow(0.987, dt);
    p.vy = p.vy * Math.pow(0.988, dt) - 0.004 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.shimmer += 0.08 * dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    const fade = Math.min(1, p.life / 24, (p.maxLife - p.life) / 10 + 0.2);
    const alpha = Math.max(0, fade * (0.62 + Math.sin(p.shimmer) * 0.2));
    const radius = p.radius * (0.7 + Math.min(1, p.life / p.maxLife) * 0.3);
    if (i % 3 === 0 && radius > 0.7) {
      magic.globalAlpha = alpha * 0.17;
      magic.fillStyle = p.color;
      magic.beginPath(); magic.arc(p.x, p.y, radius * 4.4, 0, Math.PI * 2); magic.fill();
    }
    magic.globalAlpha = alpha;
    magic.fillStyle = p.color;
    magic.beginPath(); magic.arc(p.x, p.y, radius, 0, Math.PI * 2); magic.fill();
    if (i % 2 === 0 && Math.hypot(p.x - p.px, p.y - p.py) > 0.4) {
      magic.globalAlpha = alpha * 0.34;
      magic.lineWidth = Math.max(0.5, radius * 0.8);
      magic.strokeStyle = p.color;
      magic.beginPath(); magic.moveTo(p.px, p.py); magic.lineTo(p.x, p.y); magic.stroke();
    }
  }
  magic.globalAlpha = 1;
  magic.globalCompositeOperation = 'source-over';
  requestAnimationFrame(drawMagic);
}

function drawSnow(now) {
  if (drawSnow.last && now - drawSnow.last < 33) {
    requestAnimationFrame(drawSnow);
    return;
  }
  drawSnow.last = now;
  const w = sceneWidth;
  const h = sceneHeight;
  snow.clearRect(0, 0, w, h);
  const gradient = snow.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, '#07111f');
  gradient.addColorStop(0.48, '#0a1a2e');
  gradient.addColorStop(1, '#102840');
  snow.fillStyle = gradient;
  snow.fillRect(0, 0, w, h);
  snow.globalCompositeOperation = 'screen';
  const mistSpots = [
    { x: .2, y: .26, radius: .5, color: 'rgba(84, 151, 208, .12)', speed: .00019, phase: .3 },
    { x: .72, y: .42, radius: .62, color: 'rgba(119, 194, 218, .1)', speed: .00014, phase: 2.1 },
    { x: .44, y: .78, radius: .55, color: 'rgba(65, 126, 190, .1)', speed: .00011, phase: 4.2 },
  ];
  mistSpots.forEach((mist) => {
    const x = (mist.x + Math.sin(now * mist.speed + mist.phase) * .06) * w;
    const y = (mist.y + Math.cos(now * mist.speed * .8 + mist.phase) * .035) * h;
    const radius = Math.max(w, h) * mist.radius;
    const haze = snow.createRadialGradient(x, y, 0, x, y, radius);
    haze.addColorStop(0, mist.color);
    haze.addColorStop(.58, 'rgba(100, 170, 220, .035)');
    haze.addColorStop(1, 'rgba(100, 170, 220, 0)');
    snow.fillStyle = haze;
    snow.fillRect(0, 0, w, h);
  });
  snow.globalAlpha = 1;
  snow.globalCompositeOperation = 'source-over';
  requestAnimationFrame(drawSnow);
}

requestAnimationFrame(drawMagic);
requestAnimationFrame(drawSprite);
requestAnimationFrame(drawSnow);
window.addEventListener('beforeunload', () => stream?.getTracks().forEach((track) => track.stop()));
